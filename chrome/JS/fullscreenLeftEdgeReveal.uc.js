// ==UserScript==
// @name           fullscreenLeftEdgeReveal.uc.js
// @description    In fullscreen, moving the pointer along the screen edge the rail lives on brings the rail back
//                 (the same way the top edge brings the toolbar back). Not while a sidebar panel is open.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  const EDGE = 2; // how many CSS pixels from the screen edge count as "at the edge"

  // Firefox has its own edge watcher, but it only reacts to the pointer ARRIVING at the edge. A pointer that is
  // already there (for example one sliding up the edge after leaving the rail) never counts as arriving, so the
  // rail stayed hidden until the pointer reached the top. This reacts to any movement inside the edge strip
  // instead. A pointer that merely rests there still doesn't bring the rail back, because no mouse events fire.
  function onMove(event) {
    try {
      const root = document.documentElement;
      if (
        !window.fullScreen ||
        !root.hasAttribute("fullscreenNavToolboxHidden") || // rail is already showing
        root.hasAttribute("inDOMFullscreen")                 // video / page fullscreen: leave everything hidden
      ) {
        return;
      }
      // A sidebar panel (Customize sidebar, History, Bookmarks...) is open: the edge must not bring the rail back over it. The rail stays as it is.
      const tabbox = document.getElementById("tabbrowser-tabbox");
      if (tabbox && tabbox.hasAttribute("sidebar-panel-open")) {
        return;
      }
      // Same coordinates Firefox's own mouse tracker uses (window-relative CSS pixels; events from zoomed
      // documents such as devtools are rescaled).
      const source = event.target.ownerGlobal || window;
      const scale = source !== window ? source.devicePixelRatio / window.devicePixelRatio : 1;
      const x = event.screenX * scale - window.mozInnerScreenX;
      const rail = document.getElementById("sidebar-container");
      // sidebar-positionend is an attribute of the rail container, not of the window
      const atEnd = root.hasAttribute("sidebar-positionend") || !!(rail && rail.hasAttribute("sidebar-positionend")); // rail on the right
      if (atEnd ? x < window.innerWidth - EDGE : x > EDGE) {
        return;
      }
      FullScreen.showNavToolbox();
    } catch (e) {
      console.error("fullscreenLeftEdgeReveal:", e);
    }
  }

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("unload", () => window.removeEventListener("mousemove", onMove, true), { once: true });
})();