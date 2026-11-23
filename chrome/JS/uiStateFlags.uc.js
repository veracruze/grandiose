// ==UserScript==
// @name           uiStateFlags.uc.js
// @description    Mirrors "vertical tabs are on" onto the window (:root, id main-window) as the attribute uc-vertical, so the CSS can write
//                 #main-window[uc-vertical] instead of :root:has(#tabbrowser-tabs[orient="vertical"]). A :has() on the root is re-checked on
//                 every DOM/attribute change anywhere in the window; an attribute is a plain lookup. Same specificity as the :has() it replaces.
//                 Only this state (plus the debug flag below) is mirrored: it changes when you toggle vertical tabs, nothing measures the layout in that same step.
//                 The rail's own states (expanded / sliding / hover-expanded) must stay :has() in the CSS: Firefox sets them and reads the
//                 rail's width in the same step, before an observer could update an attribute, so the width rules saw the wrong state.
//                 Also mirrors the debug pref uc.urlbar.keep-visible (true/false in about:config) as uc-urlbar-keep, which keeps the floating
//                 address bar of vertical-tabs mode visible even when the window loses focus (css/03, DEBUG rule).
//                 Used by css/02, 03, 07 (section 18) and 11 (and read by statusJson.uc.js and fullscreenRailHover.uc.js). Without this script those rules do not match.
// @include        main
// ==/UserScript==

(() => {
  const root = document.documentElement;
  const SELECTOR = '#tabbrowser-tabs[orient="vertical"]';

  // Plain id/attribute lookup: no layout is read, so this is safe at any point of startup.
  const sync = () => {
    const on = !!document.querySelector(SELECTOR);
    if (root.hasAttribute("uc-vertical") !== on) root.toggleAttribute("uc-vertical", on);
  };

  sync();

  const KEEP_PREF = "uc.urlbar.keep-visible";
  const syncKeep = () => root.toggleAttribute("uc-urlbar-keep", Services.prefs.getBoolPref(KEEP_PREF, false));
  const keepObserver = { observe: syncKeep };
  syncKeep();
  try { Services.prefs.addObserver(KEEP_PREF, keepObserver); } catch (e) {}

  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, subtree: true, attributeFilter: ["orient"] });
  window.addEventListener("unload", () => {
    mo.disconnect();
    try { Services.prefs.removeObserver(KEEP_PREF, keepObserver); } catch (e) {}
  }, { once: true });
})();
