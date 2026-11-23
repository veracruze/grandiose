// ==UserScript==
// @name           sidebarAutoHide.uc.js
// @description    Hide-sidebar mode + vertical tabs: auto-hide the rail, reveal it when the pointer
//                 reaches the screen edge where it lives, give the user a "Keep sidebar visible"
//                 checkbox in the toolbar context menu to opt out, and offer a "Reveal sidebar"
//                 item in the page context menu as a manual escape hatch.
//
//                 Background: Firefox's hide-sidebar mode hides the rail entirely ([hidden] on
//                 #sidebar-container, display: none). In a normal window the toolbar's "Show Sidebar"
//                 button is always reachable, so a hidden rail is a mild inconvenience. In fullscreen
//                 with the toolbox hidden, the button is unreachable until the user hovers the top
//                 edge — and if they just clicked "Turn on vertical tabs" in the buttons-wrapper
//                 context menu (horizontal → vertical mode transition), Firefox hides the rail before
//                 they can react. The user is then stuck: no rail, no menus, no obvious escape.
//
//                 This script replaces "permanently invisible" with "invisible until needed":
//                   - default (uc.sidebar.keepVisible = false): rail is hidden by default, revealed
//                     when the pointer reaches the screen edge where it would be, hidden again when
//                     the pointer moves back into the page. Hover-dwell at the edge is 200ms
//                     (prevents accidental reveals while the pointer crosses the edge); hide grace
//                     is 500ms (enough to reach into the rail after it appears without it vanishing).
//                   - page context menu: "Reveal sidebar" item. Present in #contentAreaContextMenu
//                     whenever hide-sidebar + vertical tabs is on. Clicking it shows the rail and
//                     pauses auto-hide for 3 seconds so the user has time to move the pointer to it.
//                     If the rail is already visible (edge hovered, "Keep visible" set, CS open, …),
//                     clicking is a harmless no-op that just refreshes the 3-second grace.
//                   - opt-out (uc.sidebar.keepVisible = true): rail stays visible. Toggled from the
//                     toolbar context menu ("Keep sidebar visible" checkbox). Persisted across
//                     restarts via the pref. Only has an effect in hide-sidebar + vertical-tabs mode;
//                     in other modes this script does nothing.
//
//                 The rail is shown/hidden via SidebarController._state.launcherVisible (Firefox's
//                 own flag) and #sidebar-container's [hidden] attribute. No new hiding mechanism is
//                 introduced; the existing hide-sidebar behaviour is simply intercepted at the right
//                 moments.
//
//                 Popups: while a popup is open (context menu, panel, CS), the mouse-move handler
//                 skips its work. Otherwise hovering toward the toolbar while a menu is open would
//                 pop the rail in and out under the menu, which looks broken.
//
//                 Interaction with sidebarContextMenuHold.uc.js: that script's uc-hover-suppressed
//                 attribute during CS cooldown is respected here — the reveal logic bails while the
//                 attribute is set, so a mouse move over the rail just after CS closes does not
//                 trigger an auto-reveal that then fights the cooldown-end re-sync.
//
//                 The content-menu item is inserted into #contentAreaContextMenu at load time (with a
//                 retry loop for when the menu isn't in the DOM yet) and refreshed on every
//                 popupshowing directly on the menu element. Earlier versions relied on a
//                 document-level popupshowing capture listener; on some Firefox builds that event
//                 does not reliably propagate from XUL popups to document, and the item never
//                 appeared. Direct attachment fixes that. A document-level listener is kept as a
//                 last-resort backup.
// @include        main
// ==/UserScript==

(() => {
  "use strict";
  if (window.__ucSidebarAutoHide) return;
  window.__ucSidebarAutoHide = true;

  const TAG = "sidebarAutoHide";
  const warn = (msg) => console.warn(`[uc] ${TAG}: ${msg}`);

  let DEBUG = false;
  try { DEBUG = Services.prefs.getBoolPref("uc.sidebarAutoHide.debug", false); } catch (e) {}
  const dbg = (...a) => { if (DEBUG) console.log(`[uc] ${TAG}`, ...a); };

  // ---- localization helpers -------------------------------------------------------------------
  // Locale is read once at load. Firefox requires a restart to change the UI locale anyway, and the
  // only strings we localize are the two menu-item labels set at load time.
  let _locale;
  const getLocale = () => {
    if (_locale) return _locale;
    try {
      _locale = (Services.locale && (
        Services.locale.appLocaleAsBCP47 ||
        Services.locale.requestedLocale ||
        Services.locale.appLocaleAsLangTag
      )) || "en-US";
    } catch (e) {
      _locale = "en-US";
    }
    return _locale;
  };
  // Lookup order: exact match (pt-BR), language-only (pt), then English.
  const l10n = (messages) => {
    const locale = getLocale().toLowerCase();
    const lang = locale.split("-")[0];
    return messages[locale] || messages[lang] || messages.en;
  };

  const KEEP_VISIBLE_LABELS = {
    "en":    "Keep sidebar visible",
    "de":    "Sidebar sichtbar halten",
    "fr":    "Garder la barre latérale visible",
    "es":    "Mantener visible la barra lateral",
    "it":    "Mantieni visibile la barra laterale",
    "pt-BR": "Manter barra lateral visível",
    "pt-PT": "Manter barra lateral visível",
    "ru":    "Держать боковую панель видимой",
    "zh-CN": "保持侧栏可见",
    "zh-TW": "保持側邊欄可見",
    "ja":    "サイドバーを表示したままにする",
    "ko":    "사이드바를 항상 표시",
    "pl":    "Zawsze pokazuj panel boczny",
    "nl":    "Zijbalk zichtbaar houden",
    "tr":    "Kenar çubuğunu görünür tut",
    "cs":    "Ponechat postranní panel viditelný",
    "sv":    "Håll sidofältet synligt",
  };

  const REVEAL_SIDEBAR_LABELS = {
    "en":    "Reveal sidebar",
    "de":    "Sidebar einblenden",
    "fr":    "Afficher la barre latérale",
    "es":    "Mostrar barra lateral",
    "it":    "Mostra barra laterale",
    "pt-BR": "Mostrar barra lateral",
    "pt-PT": "Mostrar barra lateral",
    "ru":    "Показать боковую панель",
    "zh-CN": "显示侧栏",
    "zh-TW": "顯示側邊欄",
    "ja":    "サイドバーを表示",
    "ko":    "사이드바 표시",
    "pl":    "Pokaż panel boczny",
    "nl":    "Zijbalk tonen",
    "tr":    "Kenar çubuğunu göster",
    "cs":    "Zobrazit postranní panel",
    "sv":    "Visa sidofältet",
  };

  const PREF_VIS   = "sidebar.visibility";
  const PREF_VT    = "sidebar.verticalTabs";
  const PREF_KEEP  = "uc.sidebar.keepVisible";
  const PREF_DBG   = "uc.sidebarAutoHide.debug";

  const EDGE_PX        = 3;
  const HOVER_DWELL_MS = 200;
  const HIDE_GRACE_MS  = 500;
  const MANUAL_REVEAL_GRACE_MS = 3000;

  const root = document.documentElement;

  const sc = () => window.SidebarController;
  const container = () => document.getElementById("sidebar-container");

  // Both the pref and the mode Firefox is actually running in must say "hide-sidebar": SidebarController.sidebarRevampVisibility is what Firefox's own
  // logic (and the rest of this theme) acts on. Nothing in this script may do anything in always-show or expand-on-hover.
  const prefHideSidebar = () => {
    try {
      if (Services.prefs.getStringPref(PREF_VIS, "") !== "hide-sidebar") return false;
      const live = window.SidebarController && window.SidebarController.sidebarRevampVisibility;
      return live === undefined || live === "hide-sidebar";
    } catch (e) { return false; }
  };
  const prefVerticalTabs = () => {
    try { return Services.prefs.getBoolPref(PREF_VT, false); }
    catch (e) { return false; }
  };
  const prefKeepVisible = () => {
    try { return Services.prefs.getBoolPref(PREF_KEEP, false); }
    catch (e) { return false; }
  };

  const autoHideActive = () =>
    prefHideSidebar() && prefVerticalTabs() && !prefKeepVisible();

  const isRailHidden = () => {
    const c = container();
    if (!c) return true;
    try {
      const cs = getComputedStyle(c);
      if (cs.display === "none") return true;
      return c.getBoundingClientRect().width === 0;
    } catch (e) { return false; }
  };

  // Reads the container attribute first, matching what CSS uses (same source as atEnd() in
  // sidebarPushSettle.uc.js). Root attribute only as a fallback for early startup, when the
  // container isn't in the DOM yet. Without this, root and container could disagree during a
  // position-change transition, and railAtEnd() would pick root's (potentially stale) value
  // while CSS picked container's, so edge-hover tracking went to the wrong side.
  const railAtEnd = () => {
    const c = container();
    if (c) return c.hasAttribute("sidebar-positionend");
    return root.hasAttribute("sidebar-positionend");
  };

  const atEdge = (x) =>
    railAtEnd() ? x >= window.innerWidth - EDGE_PX : x <= EDGE_PX;

  const overRail = (x) => {
    const c = container();
    if (!c) return false;
    try {
      const cs = getComputedStyle(c);
      if (cs.display === "none") return false;
      const rect = c.getBoundingClientRect();
      if (rect.width <= 0) return false;
      return railAtEnd()
        ? x >= rect.left && x <= window.innerWidth
        : x >= 0 && x <= rect.right;
    } catch (e) { return false; }
  };

  // FF 160 derives SidebarState.launcherVisible from the visibility mode: it is a getter, so assigning to it does nothing (and throws in strict mode).
  // In hide-sidebar the user's choice is _state.userLauncherVisible, which is what the toolbar button writes: Firefox then un-hides the container,
  // re-renders the rail and re-attaches its overflow observers (the » chevron). Forcing the container visible with CSS instead left sidebar-main
  // un-rendered while hidden (its shouldUpdate() is false for a hidden container), so after a vertical-tabs toggle it showed stale buttons and no chevron.
  // The CSS attribute stays as the fallback for a Firefox without userLauncherVisible.
  const hasUserLauncher = (s) => !!(s && s._state && "userLauncherVisible" in s._state);

  const showRail = () => {
    // Only in hide-sidebar + vertical tabs: also guards the page context menu item and the "Keep sidebar visible" checkbox
    if (!prefHideSidebar() || !prefVerticalTabs()) return;
    const s = sc();
    if (!s || !s._state) return;
    if (hasUserLauncher(s)) {
      root.removeAttribute("uc-sidebar-auto-revealed");
      if (!s._state.userLauncherVisible) {
        s._state.userLauncherVisible = true;
        try { s.updateToolbarButton?.(); } catch (e) {}
      }
      // The flag can already be true while Firefox still has the container hidden (it hides it around a vertical-tabs toggle without
      // touching the flag). If the container is still hidden a frame later, fall back to the CSS override (css/18 shows it at the collapsed width).
      requestAnimationFrame(() => {
        const c = container();
        if (c && c.hasAttribute("hidden") && prefHideSidebar() && prefVerticalTabs()) {
          root.setAttribute("uc-sidebar-auto-revealed", "");
        }
      });
      return;
    }
    root.setAttribute("uc-sidebar-auto-revealed", "");
    try {
      if (!s._state.launcherVisible) {
        s._state.launcherVisible = true;
        try { s.updateToolbarButton?.(); } catch (e) {}
      }
    } catch (e) { /* getter-only on this Firefox: the CSS attribute above does the work */ }
    const c = container();
    if (c && c.hasAttribute("hidden")) c.removeAttribute("hidden");
  };

  const hideRail = () => {
    if (!prefHideSidebar() || !prefVerticalTabs()) return;
    // Remove the CSS override first so FF's display: none takes effect again.
    root.removeAttribute("uc-sidebar-auto-revealed");
    const s = sc();
    if (!s || !s._state) return;
    if (hasUserLauncher(s)) {
      if (s._state.userLauncherVisible) {
        s._state.userLauncherVisible = false;
        try { s.updateToolbarButton?.(); } catch (e) {}
      }
      return;
    }
    try {
      if (s._state.launcherVisible) {
        s._state.launcherVisible = false;
        try { s.updateToolbarButton?.(); } catch (e) {}
      }
    } catch (e) {}
  };

  // ---- mouse tracker ----------------------------------------------------------------------------
  let showTimer = 0;
  let hideTimer = 0;
  let lastMouseX = null;
  let manuallyRevealedUntil = 0;

  const clearShow = () => { if (showTimer) { clearTimeout(showTimer); showTimer = 0; } };
  const clearHide = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; } };

  const tryScheduleHide = () => {
    if (hideTimer) return;
    if (performance.now() < manuallyRevealedUntil) return;
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      const x = lastMouseX;
      if (x == null) return;
      if (performance.now() < manuallyRevealedUntil) return;
      if (!overRail(x) && !atEdge(x) && autoHideActive()) hideRail();
    }, HIDE_GRACE_MS);
  };

  // rAF-throttled. The old version did 2 getComputedStyle + 2 getBoundingClientRect per
  // mousemove event. At 125Hz mouse polling that is ~500 forced style/layout reads per
  // second for cursor tracking alone, on a handler that does nothing whenever the pointer
  // is on the page (which is most of the time). The rAF wrapper coalesces every mousemove
  // in a frame into one call, so at most one style/layout pass happens per frame — and the
  // early bail-outs (autoHideActive, menu open, hover-suppressed) now run once per frame
  // instead of once per event. Behaviour is identical: lastMouseX is still updated on every
  // event, so the rAF handler always sees the freshest position.
  let pendingMoveRaf = 0;
  const onMouseMove = (e) => {
    lastMouseX = e.clientX;
    if (pendingMoveRaf) return;
    pendingMoveRaf = requestAnimationFrame(processMouseMove);
  };

  function processMouseMove() {
    pendingMoveRaf = 0;
    const x = lastMouseX;
    if (x == null) return;
    if (!autoHideActive()) { clearShow(); clearHide(); return; }

    const s = sc();
    if (s && typeof s._isMenuPopupOpen === "function" && s._isMenuPopupOpen()) return;
    if (root.hasAttribute("uc-hover-suppressed")) return;

    if (isRailHidden()) {
      clearHide();
      if (atEdge(x)) {
        if (!showTimer) {
          showTimer = setTimeout(() => {
            showTimer = 0;
            if (isRailHidden() && autoHideActive()) showRail();
          }, HOVER_DWELL_MS);
        }
      } else {
        clearShow();
      }
    } else {
      clearShow();
      if (overRail(x) || atEdge(x)) {
        clearHide();
      } else if (performance.now() >= manuallyRevealedUntil) {
        tryScheduleHide();
      }
    }
  }

  window.addEventListener("mousemove", onMouseMove, true);

  // ---- toolbar context menu item ("Keep sidebar visible") ---------------------------------------
  const TOOLBAR_MENU_ID = "uc-sidebar-keep-visible";

  // Firefox localizes the vertical-tabs toggle with Fluent. The stable IDs are
  // toolbar-context-turn-on-vertical-tabs / toolbar-context-turn-off-vertical-tabs; matching on the
  // translated label text (the old approach) breaks on any non-English locale.
  const VT_L10N_IDS = new Set([
    "toolbar-context-turn-on-vertical-tabs",
    "toolbar-context-turn-off-vertical-tabs",
  ]);
  const VT_ELEMENT_IDS = new Set([
    "toolbar-context-turn-on-vertical-tabs",
    "toolbar-context-turn-off-vertical-tabs",
  ]);

  const matchVTItem = (m) => {
    const l10nId = m.getAttribute("data-l10n-id") || m.getAttribute("data-lazy-l10n-id");
    if (l10nId && VT_L10N_IDS.has(l10nId)) return true;
    if (m.id && VT_ELEMENT_IDS.has(m.id)) return true;
    return false;
  };

  const createToolbarMenuItem = () => {
    const item = document.createXULElement("menuitem");
    item.id = TOOLBAR_MENU_ID;
    item.setAttribute("type", "checkbox");
    item.setAttribute("autocheck", "false");
    item.setAttribute("label", l10n(KEEP_VISIBLE_LABELS));
    if (prefKeepVisible()) item.setAttribute("checked", "true");
    item.addEventListener("command", () => {
      const next = !prefKeepVisible();
      Services.prefs.setBoolPref(PREF_KEEP, next);
      if (next) showRail();
    });
    return item;
  };

  document.addEventListener("popupshowing", (e) => {
    const popup = e.target;
    if (!popup || !popup.querySelectorAll) return;
    const vtCandidates = [...popup.querySelectorAll("menuitem")].filter(matchVTItem);
    if (!vtCandidates.length) return;
    // Prefer the visible one (Firefox keeps both "turn on" and "turn off" items in the DOM,
    // hiding whichever is not applicable to the current mode).
    const vtItem = vtCandidates.find((m) => !m.hidden) || vtCandidates[0];
    if (popup.querySelector(`#${TOOLBAR_MENU_ID}`)) return;
    const item = createToolbarMenuItem();
    item.hidden = !(prefHideSidebar() && prefVerticalTabs());
    vtItem.after(item);
  }, true);

  document.addEventListener("popupshowing", (e) => {
    const popup = e.target;
    const item = popup && popup.querySelector && popup.querySelector(`#${TOOLBAR_MENU_ID}`);
    if (!item) return;
    item.hidden = !(prefHideSidebar() && prefVerticalTabs());
    if (prefKeepVisible()) item.setAttribute("checked", "true");
    else item.removeAttribute("checked");
  }, true);

  // ---- PAGE context menu item ("Reveal sidebar") ------------------------------------------------
  // Attached directly to #contentAreaContextMenu (not only via a document-level popupshowing
  // listener), because on some Firefox builds that event does not reliably propagate to document
  // for XUL popups and the item never appeared. A retry loop handles the case where the menu isn't
  // in the DOM yet at script load. A document-level listener is kept as a last-resort backup.
  const CONTENT_MENU_ID = "uc-content-reveal-sidebar";

  const createContentMenuItem = () => {
    const item = document.createXULElement("menuitem");
    item.id = CONTENT_MENU_ID;
    item.setAttribute("label", l10n(REVEAL_SIDEBAR_LABELS));
    item.addEventListener("command", () => {
      showRail();
      manuallyRevealedUntil = performance.now() + MANUAL_REVEAL_GRACE_MS;
      setTimeout(() => {
        const x = lastMouseX;
        if (x == null) return;
        if (overRail(x) || atEdge(x)) return;
        if (!autoHideActive() || isRailHidden()) return;
        tryScheduleHide();
      }, MANUAL_REVEAL_GRACE_MS);
    });
    return item;
  };

  const ensureContentMenuItem = () => {
    const menu = document.getElementById("contentAreaContextMenu");
    if (!menu) return null;
    let item = menu.querySelector(`#${CONTENT_MENU_ID}`);
    if (!item) {
      item = createContentMenuItem();
      const nav = menu.querySelector("#context-navigation");
      if (nav && nav.parentNode === menu) {
        menu.insertBefore(item, nav.nextSibling);
      } else {
        menu.insertBefore(item, menu.firstChild);
      }
    }
    return item;
  };

  const updateContentMenuItem = () => {
    const item = ensureContentMenuItem();
    if (!item) return;
    // Show whenever hide-sidebar + VT is on. If the rail is already visible, clicking is a
    // harmless no-op that refreshes the 3-second grace. Hiding the item when the rail was
    // currently visible (the previous version) missed the item in exactly the state where the
    // user might want to reveal it again after an auto-hide.
    const show = prefHideSidebar() && prefVerticalTabs();
    if (show) item.removeAttribute("hidden");
    else item.setAttribute("hidden", "true");
    dbg("content menu item", show ? "shown" : "hidden",
        { hideSidebar: prefHideSidebar(), vt: prefVerticalTabs(), railHidden: isRailHidden() });
  };

  // Load-time setup with retry. The menu should exist by the time this script runs, but some
  // Firefox builds load popup menus lazily; a 5-second retry is cheap and covers that.
  let contentMenuRetries = 0;
  const tryContentMenuSetup = () => {
    const menu = document.getElementById("contentAreaContextMenu");
    if (!menu) {
      if (++contentMenuRetries < 50) {
        setTimeout(tryContentMenuSetup, 100);
      } else {
        warn("contentAreaContextMenu not found after 5s — the page context menu item may not appear");
      }
      return;
    }
    updateContentMenuItem();
    // Direct listeners on the menu itself (primary mechanism)
    menu.addEventListener("popupshowing", () => updateContentMenuItem());
    menu.addEventListener("popupshown", () => updateContentMenuItem());
    dbg("content menu listeners attached");
  };
  tryContentMenuSetup();

  // Last-resort backup in case the direct listener somehow misses an event.
  document.addEventListener("popupshowing", (e) => {
    if (!e.target || e.target.id !== "contentAreaContextMenu") return;
    updateContentMenuItem();
  }, true);

  // ---- pref observers ----------------------------------------------------------------------------
  const onPrefChange = () => {
    if (prefKeepVisible() && prefHideSidebar() && prefVerticalTabs()) {
      showRail();   // sets uc-sidebar-auto-revealed, forcing the rail visible
    } else if (root.hasAttribute("uc-sidebar-auto-revealed") && !(prefHideSidebar() && prefVerticalTabs())) {
      // Keep-visible was just turned off: drop the override so FF's normal
      // hide logic takes over on the next tick.
      root.removeAttribute("uc-sidebar-auto-revealed");
    }
    if (!autoHideActive()) {
      clearShow();
      clearHide();
      manuallyRevealedUntil = 0;
    }
  };
  // KEEP VISIBLE SURVIVES THE VERTICAL-TABS TOGGLE. Turning vertical tabs on makes Firefox rewrite sidebar.visibility and hide the rail a moment
  // AFTER the pref observer has run (vtRememberVisibility.uc.js then restores the saved mode ~700ms later), so a single showRail() call
  // on the pref change was undone straight away. While "Keep sidebar visible" is on, the rail is now re-asserted at several points over the
  // next ~2s, and whenever the container gets [hidden] again.
  const ENFORCE_DELAYS = [0, 150, 400, 800, 1300, 2000];
  let enforceTimers = [];
  const clearEnforce = () => { enforceTimers.forEach(clearTimeout); enforceTimers = []; };
  const enforceKeepVisible = () => {
    if (prefKeepVisible() && prefHideSidebar() && prefVerticalTabs()) showRail();
  };
  const scheduleEnforce = (onlyIfIdle) => {
    if (!prefKeepVisible()) { clearEnforce(); return; }
    if (onlyIfIdle && enforceTimers.length) return;
    clearEnforce();
    for (const ms of ENFORCE_DELAYS) {
      const t = setTimeout(() => {
        enforceTimers = enforceTimers.filter((x) => x !== t);
        watchContainer();
        enforceKeepVisible();
      }, ms);
      enforceTimers.push(t);
    }
  };

  let hiddenObs = null;
  let observedContainer = null;
  function watchContainer() {
    const c = container();
    if (!c || c === observedContainer) return;
    if (hiddenObs) hiddenObs.disconnect();
    observedContainer = c;
    hiddenObs = new MutationObserver(() => {
      if (c.hasAttribute("hidden") && prefKeepVisible() && prefHideSidebar() && prefVerticalTabs()) scheduleEnforce(true);
    });
    hiddenObs.observe(c, { attributes: true, attributeFilter: ["hidden"] });
  }
  watchContainer();

  const prefObserverObj = {
    observe(_subject, _topic, data) {
      onPrefChange();
      if (data === PREF_VT || data === PREF_VIS || data === PREF_KEEP) scheduleEnforce(false);
    },
  };
  for (const pref of [PREF_VIS, PREF_VT, PREF_KEEP]) {
    try { Services.prefs.addObserver(pref, prefObserverObj); }
    catch (e) { warn(`could not observe ${pref} (${e && e.message})`); }
  }

  const debugObserverObj = { observe: (_s, _t, d) => { if (d === PREF_DBG) { try { DEBUG = Services.prefs.getBoolPref(PREF_DBG, false); } catch (e) {} } } };
  try { Services.prefs.addObserver(PREF_DBG, debugObserverObj); } catch (e) {}

  setTimeout(() => { onPrefChange(); watchContainer(); scheduleEnforce(false); }, 500);

  window.addEventListener("unload", () => {
    window.removeEventListener("mousemove", onMouseMove, true);
    cancelAnimationFrame(pendingMoveRaf);
    clearEnforce();
    if (hiddenObs) hiddenObs.disconnect();
    clearShow();
    clearHide();
    for (const pref of [PREF_VIS, PREF_VT, PREF_KEEP]) {
      try { Services.prefs.removeObserver(pref, prefObserverObj); } catch (e) {}
    }
    try { Services.prefs.removeObserver(PREF_DBG, debugObserverObj); } catch (e) {}
  }, { once: true });
})();