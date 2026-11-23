// When "Hide tabs and sidebar" is turned on, the rail can keep the "expanded" flag it had
// before, so it stays at its wide layout (about 184px, icons in a row) until the Customize
// panel is closed. This clears that flag so the rail goes straight to its narrow form.
// It only acts when the setting is "hide-sidebar" and the rail is still flagged expanded.
//
// Also at startup: in "hide-sidebar" Firefox starts every session with the whole rail hidden (its toolbar
// button is what brings it back, expanded). This script shows it again, in its narrow form, once the
// sidebar has finished starting up, so it looks the same as when you left it. It happens once per window;
// hiding the rail afterwards still works for the rest of that session.
//
// (Auto-reveal-on-edge-hover and the "Keep sidebar visible" pref live in sidebarAutoHide.uc.js — that
// script owns the reveal/keep-visible behaviour, this one stays small and mode-focused.)
(function () {
  // SidebarController._state (launcherVisible / launcherExpanded), updateToolbarButton and <sidebar-main>.expanded are Firefox-internal and
  // can change in an update. They are checked before use: if one is gone, that part quietly stops and ONE warning line is logged.
  const TAG = "sidebarCollapseRail";
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[uc] ${TAG}: ${msg}`);
  };

  const PREF = "sidebar.visibility";
  let timer = null;

  function collapseRail() {
    try {
      if (Services.prefs.getStringPref(PREF, "") !== "hide-sidebar") return;
      const rail = document.querySelector("sidebar-main");
      if (!rail || !rail.hasAttribute("expanded")) return;
      if ("expanded" in rail) rail.expanded = false; // Firefox's own property (re-renders the rail)
      else warnOnce("sidebar-main.expanded is missing, only the attribute is cleared");
      rail.removeAttribute("expanded"); // in case the property didn't clear the attribute
      // The state Firefox keeps behind the attribute too, otherwise the next render puts [expanded] back
      try {
        const st = window.SidebarController && window.SidebarController._state;
        if (st && st.launcherExpanded) st.launcherExpanded = false;
      } catch (e) {}
    } catch (e) {
      console.error("sidebarCollapseRail:", e);
    }
  }

  const observer = {
    observe() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(collapseRail, 450); // after Firefox's own toggle animation
    }
  };

  // Vertical tabs switched on (or off) while "hide-sidebar" is already the setting: sidebar.visibility does not change, so the observer above never
  // ran and the rail kept the "expanded" flag from the layout it had before. In that state the chevron rules (07 section 18, rule 4) do not match and the
  // rail shows its first tool button instead of the » chevron.
  const VT_PREF = "sidebar.verticalTabs";
  try {
    Services.prefs.addObserver(VT_PREF, observer);
    window.addEventListener("unload", () => {
      try { Services.prefs.removeObserver(VT_PREF, observer); } catch (e) {}
    }, { once: true });
  } catch (e) {
    console.error("sidebarCollapseRail: could not observe " + VT_PREF, e);
  }

  try {
    Services.prefs.addObserver(PREF, observer);
    window.addEventListener("unload", () => {
      try { Services.prefs.removeObserver(PREF, observer); } catch (e) {}
    }, { once: true });
  } catch (e) {
    console.error("sidebarCollapseRail: could not observe " + PREF, e);
  }

  // ---- Startup: bring the narrow rail back ----
  let missing = ""; // which _state member the latest startup run could not find
  // Returns true once the sidebar is ready (whether or not anything had to change), false to keep waiting.
  function showCollapsedRail() {
    try {
      const sc = window.SidebarController;
      const state = sc && sc._state;
      if (!state || !document.querySelector("sidebar-main")) return false;
      if (
        Services.prefs.getStringPref(PREF, "") !== "hide-sidebar" ||
        !Services.prefs.getBoolPref("sidebar.verticalTabs", false)
      ) {
        return true; // other modes: Firefox's own behaviour is already right
      }
      missing = "";
      if (!("launcherVisible" in state)) missing = "_state.launcherVisible";
      else if (!("launcherExpanded" in state)) missing = "_state.launcherExpanded";
      if (missing) return false; // may not be set up yet; the retries decide (a warning follows if it never appears)
      // FF 160: launcherVisible is derived (getter only); in hide-sidebar the user's choice is userLauncherVisible
      if ("userLauncherVisible" in state) { if (!state.userLauncherVisible) state.userLauncherVisible = true; }
      else if (!state.launcherVisible) state.launcherVisible = true; // un-hide the rail
      state.launcherExpanded = false;                           // narrow form, not the wide one
      if (typeof sc.updateToolbarButton === "function") sc.updateToolbarButton();
      else warnOnce("SidebarController.updateToolbarButton is missing, the toolbar button is not refreshed");
      return true;
    } catch (e) {
      console.error("sidebarCollapseRail (startup):", e);
      return true; // don't retry a broken call forever
    }
  }

  let tries = 0;
  const startup = setInterval(() => {
    if (showCollapsedRail() || ++tries > 80) { // up to ~20s
      clearInterval(startup);
      // Firefox can still apply its saved sidebar state just after it is ready; check again.
      setTimeout(showCollapsedRail, 1500);
      setTimeout(() => {
        showCollapsedRail();
        const sc = window.SidebarController;
        if (!sc || !sc._state) warnOnce("SidebarController._state is missing, startup rail restore skipped");
        else if (missing) warnOnce(`SidebarController.${missing} is missing, startup rail restore skipped`);
      }, 4000);
    }
  }, 250);
})();