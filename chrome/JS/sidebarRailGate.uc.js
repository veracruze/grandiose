// ==UserScript==
// @name           sidebarRailGate.uc.js
// @description    One shared "is the rail busy?" signal. Scripts hand it non-urgent work (measuring, publishing, hover re-checks);
//                 it runs that work once, in a single frame, after the rail has been quiet for QUIET_MS.
// @include        main
// ==/UserScript==
(() => {
  "use strict";
  if (window.__ucRailGate) return;
  const root = document.documentElement;
  const tabbox = document.getElementById("tabbrowser-tabbox");
  if (!tabbox) return;

  const QUIET_MS = 80;
  const jobs = new Map();   // key -> fn (latest wins)
  let lastTouch = 0, timer = 0;

  // Busy = Firefox's native rail animation, or the JS-owned push animation.
  // The old [uc-push-back] / [uc-push="out"] checks were written by the dormant
  // fullscreenRailPush script and never fire today; [uc-push-moving] is the
  // live equivalent set by sidebarPushSettle during animateTo/tick.
  const attrBusy = () =>
    tabbox.hasAttribute("sidebar-ongoing-animations") ||
    root.hasAttribute("uc-push-moving");
  const busy = () => attrBusy() || performance.now() - lastTouch < QUIET_MS;

  const flush = () => {
    timer = 0;
    if (busy()) return arm();
    const list = [...jobs.values()];
    jobs.clear();
    requestAnimationFrame(() => {            // one frame: all deferred work together
      for (const f of list) { try { f(); } catch (e) { console.error("[uc] railGate:", e); } }
    });
  };
  const arm = () => { if (!timer && jobs.size) timer = setTimeout(flush, QUIET_MS); };
  const touch = () => { lastTouch = performance.now(); arm(); };

  new MutationObserver(touch).observe(tabbox, { attributes: true,
    attributeFilter: ["sidebar-ongoing-animations", "sidebar-launcher-hovered"] });
  new MutationObserver(touch).observe(root, { attributes: true,
    attributeFilter: ["uc-push", "uc-push-moving"] });

  window.__ucRailGate = {
    busy,
    defer(key, fn) { if (!busy()) return fn(); jobs.set(key, fn); arm(); },
  };
})();