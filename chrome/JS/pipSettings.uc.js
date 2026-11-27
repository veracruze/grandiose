// ==UserScript==
// @name           pipSettings.uc.js
// @description    Applies two Customize-panel settings to Picture-in-Picture windows:
//                 uc.pip.mouse (1 = normal, 0 = no mouse interaction) -> [uc-pip-nomouse] on <html>
//                 uc.pip.opacity (10-100, unset = CSS default)       -> --uc-pip-opacity on <html>
//                 The CSS that reads them is in css/17-glass-transparency.css.
// @include        main
// ==/UserScript==
(() => {
  "use strict";
  if (window.__ucPipSettings) return;
  window.__ucPipSettings = true;

  const TYPE = "Toolkit:PictureInPicture";
  const P_MOUSE = "uc.pip.mouse";
  const P_OPACITY = "uc.pip.opacity";

  function apply(win) {
    try {
      const el = win.document.documentElement;
      el.toggleAttribute("uc-pip-nomouse", Services.prefs.getIntPref(P_MOUSE, 1) === 0);
      if (Services.prefs.prefHasUserValue(P_OPACITY)) {
        const pct = Math.min(100, Math.max(10, Services.prefs.getIntPref(P_OPACITY, 100)));
        el.style.setProperty("--uc-pip-opacity", String(pct / 100));
      } else {
        el.style.removeProperty("--uc-pip-opacity");   // back to the CSS default
      }
    } catch (e) { /* window closing */ }
  }
  const applyAll = () => { for (const w of Services.wm.getEnumerator(TYPE)) apply(w); };

  // PiP windows opened later (same pattern as pipControl.uc.js)
  const listener = {
    onOpenWindow(xulWin) {
      const win = xulWin.docShell.domWindow;
      win.addEventListener("load", () => {
        if (win.document.documentElement.getAttribute("windowtype") === TYPE) apply(win);
      }, { once: true });
    },
    onCloseWindow() {},
  };
  Services.wm.addListener(listener);

  const obs = { observe: applyAll };
  for (const p of [P_MOUSE, P_OPACITY]) Services.prefs.addObserver(p, obs);

  applyAll();   // a PiP that is already open

  window.addEventListener("unload", () => {
    Services.wm.removeListener(listener);
    for (const p of [P_MOUSE, P_OPACITY]) {
      try { Services.prefs.removeObserver(p, obs); } catch (e) {}
    }
  }, { once: true });
})();
