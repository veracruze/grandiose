// ==UserScript==
// @name           bookmarksToolbarHeight.uc.js
// @description    Publishes the bookmarks toolbar's real height as --uc-bm-h on the root element (0px while the toolbar is hidden),
//                 so the fixed-height #navigator-toolbox rule in 02-base-layout.css can make room for it. The height is read from the
//                 toolbar itself, so it stays right at every density (Standard / Compact / Touch) and in "show on new tab" mode.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  const TAG = "bookmarksToolbarHeight";
  const VAR = "--uc-bm-h";
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[uc] ${TAG}: ${msg}`);
  };

  if (window.__ucBookmarksToolbarHeight) return; // already installed in this window
  const bar = document.getElementById("PersonalToolbar");
  if (!bar) { warnOnce("#PersonalToolbar is missing, script not loaded"); return; }
  if (typeof ResizeObserver !== "function" || typeof MutationObserver !== "function") {
    warnOnce("ResizeObserver or MutationObserver is missing, script not loaded");
    return;
  }
  window.__ucBookmarksToolbarHeight = true;

  const root = document.documentElement;
  let measured = 0; // the toolbar's height as last reported by the ResizeObserver (no layout is forced to read it)
  let last = "";    // the value last written, so nothing is rewritten for no reason

  // Shown = not collapsed / hidden by Firefox and actually rendered. Read from the toolbar's own state rather than assumed.
  const showing = () => {
    if (bar.getAttribute("collapsed") === "true" || bar.hidden) return false;
    const cs = getComputedStyle(bar);
    return cs.display !== "none" && cs.visibility === "visible";
  };

  const publish = () => {
    // showing() reads computed style, which forces layout: not before the window has finished loading
    if (document.readyState !== "complete") return;
    try {
      const px = (showing() ? Math.round(measured) : 0) + "px";
      if (px === last) return;
      last = px;
      root.style.setProperty(VAR, px);
    } catch (e) {
      warnOnce(`could not publish ${VAR} (${e && e.message})`);
    }
  };

  // size changes: density switch, first layout, the bar appearing or disappearing
  const sizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) {
      const b = e.borderBoxSize && e.borderBoxSize[0];
      measured = b ? b.blockSize : e.contentRect.height;
    }
    publish();
  });
  sizeObserver.observe(bar);

  // visibility changes (Firefox flips these when the setting or the "new tab only" mode changes)
  const stateObserver = new MutationObserver(publish);
  stateObserver.observe(bar, { attributes: true, attributeFilter: ["collapsed", "hidden"] });

  if (document.readyState === "complete") publish();
  else window.addEventListener("load", publish, { once: true });

  window.addEventListener("unload", () => {
    sizeObserver.disconnect();
    stateObserver.disconnect();
  }, { once: true });
})();
