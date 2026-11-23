// Remembers the sidebar visibility setting ("Show sidebar", "Hide tabs and sidebar",
// "Expand on hover") across turning vertical tabs off and on, and across restarts.
//
// Why a script: user.js is only read once at startup, so it cannot react to vertical tabs
// being toggled in the middle of a session, and Firefox rewrites sidebar.visibility when
// that happens. This script keeps its own copy of the last choice made while vertical tabs
// were on, and puts it back when they come back on.
//
// The copy lives in the pref uc.sidebar.savedVisibility (delete it in about:config to forget).
(function () {
  const VT = "sidebar.verticalTabs";
  const VIS = "sidebar.visibility";
  const SAVED = "uc.sidebar.savedVisibility";
  const QUIET_MS = 1500;   // ignore visibility changes this long after vertical tabs are toggled
  const RESTORE_MS = 700;  // wait this long after vertical tabs come back on, then restore

  let quietUntil = 0;
  let timer = null;

  const vtOn = () => Services.prefs.getBoolPref(VT, false);
  const getVis = () => Services.prefs.getStringPref(VIS, "");
  const getSaved = () => Services.prefs.getStringPref(SAVED, "");

  // Save the setting, but only a choice made while vertical tabs are on and settled.
  function remember() {
    if (!vtOn() || Date.now() < quietUntil) return;
    const v = getVis();
    if (v) Services.prefs.setStringPref(SAVED, v);
  }

  function restore() {
    const saved = getSaved();
    if (vtOn() && saved && getVis() !== saved) {
      Services.prefs.setStringPref(VIS, saved);
    }
  }

  const visObserver = { observe: remember };

  const vtObserver = {
    observe() {
      // Firefox rewrites sidebar.visibility around this toggle; don't save that value.
      quietUntil = Date.now() + QUIET_MS;
      if (timer) clearTimeout(timer);
      if (vtOn()) timer = setTimeout(restore, RESTORE_MS);
    }
  };

  try {
    Services.prefs.addObserver(VIS, visObserver);
    Services.prefs.addObserver(VT, vtObserver);
    window.addEventListener("unload", () => {
      try { Services.prefs.removeObserver(VIS, visObserver); } catch (e) {}
      try { Services.prefs.removeObserver(VT, vtObserver); } catch (e) {}
    }, { once: true });
  } catch (e) {
    console.error("vtRememberVisibility: could not observe prefs", e);
  }

  // Startup: put the remembered setting back, or record the current one the first time.
  setTimeout(() => {
    if (!vtOn()) return;
    if (getSaved()) restore();
    else remember();
  }, 1000);
})();
