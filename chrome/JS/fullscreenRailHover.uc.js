// ==UserScript==
// @name           fullscreenRailHover.uc.js
// @description    Keeps the fullscreen toolbox open while the pointer is over the sidebar rail, including while the rail is still growing
//                 (audit item 7): getComputedStyle on :root is now cached instead of being called on every mousemove. The cache is
//                 refreshed only when :root[uidensity] changes (the only trigger for --uc-rail-collapsed in this theme; --uc-rail-expanded-w
//                 is a constant in 01-tokens.css).
// @include        main
// ==/UserScript==

(() => {
  if (!window.FullScreen || FullScreen.__ucRailHoverPatched) return;
  FullScreen.__ucRailHoverPatched = true;

  // Cached rail dimensions. Both are CSS custom properties on :root:
  //   --uc-rail-collapsed  (per density: 40 / 50 / 60)
  //   --uc-rail-expanded-w (constant 290px)
  // Recomputing them on every mousemove is what the audit flagged; instead they live here and are
  // refreshed by the MutationObserver below whenever :root[uidensity] changes.
  const recomputeCache = () => {
    const cs = getComputedStyle(document.documentElement);
    FullScreen.__ucRailStripW = parseFloat(cs.getPropertyValue("--uc-rail-collapsed")) || 50;
    FullScreen.__ucRailExpandedW = parseFloat(cs.getPropertyValue("--uc-rail-expanded-w")) || 290;
  };

  if (document.readyState === "complete") recomputeCache();
  else window.addEventListener("load", recomputeCache, { once: true });

  new MutationObserver(recomputeCache).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["uidensity"],
  });

  const getStripW = () => FullScreen.__ucRailStripW || 50;
  const getExpandedW = () => FullScreen.__ucRailExpandedW || 290;

  const original = FullScreen.getMouseTargetRect;

  FullScreen.getMouseTargetRect = function () {
    const rect = original.call(this);
    try {
      const box = document.getElementById("sidebar-container");
      if (!rect || !box) return rect;

      const b = box.getBoundingClientRect();
      const atStart = b.left < window.innerWidth / 2;
      let { top, bottom, left, right } = rect;

      // Overlay modes (css/12-fullscreen-overlay.css): the bars lie on top of the page, so the page area Firefox measures is
      // too big. Cut them out, or Firefox would think the pointer is on the page and hide them at once.
      const rootEl = document.documentElement;
      const overBar = rootEl.hasAttribute("uc-fs-overlay-bar");
      const overRail = rootEl.hasAttribute("uc-fs-overlay-rail");
      if (overBar || overRail) {
        if (!rootEl.hasAttribute("fullscreenNavToolboxHidden")) {
          const tb = document.getElementById("navigator-toolbox");
          if (overBar && tb) top = Math.max(top, tb.getBoundingClientRect().bottom);
          if (overRail && b.width) {
            // The rail slides in from off screen, so its box is still small (or off screen) for the first frames. Use the width
            // it will have: a pointer at the very edge (which is what revealed the rail) must not count as "on the page", or
            // the bars would be hidden again at once. A transform does not change b.width, so it is the real width.
            if (atStart) left = Math.max(left, b.right, b.width);
            else right = Math.min(right, b.left, window.innerWidth - b.width);
          }
        }
        // the bar that is NOT overlaid still pushes the page, so fall through to the normal handling for it
        if (overRail) return { top, bottom, left, right, x: left, y: top, width: right - left, height: bottom - top };
      }

      const settled = this._expandedMouseTargetRect;
      if (settled) {
        if (atStart) left = Math.max(left, settled.left);
        else right = Math.min(right, settled.right);
      }

      // Fully expanded rail overlays the page: the page starts after it.
      // Without expand-on-hover the rail is permanently expanded and grows from 0 when it is revealed (css/11); the pointer at the
      // screen edge would count as "on the page" for the first frames and hide it again, so its final width is used instead.
      const permanent = !rootEl.hasAttribute("sidebar-expand-on-hover");
      if (box.hasAttribute("sidebar-launcher-expanded") && (b.width || permanent)) {
        const full = permanent ? getExpandedW() : 0;
        if (atStart) left = Math.max(left, b.right, full);
        else right = Math.min(right, b.left, window.innerWidth - full);
      }

      // "Hide tabs and sidebar" rail (vertical tabs, no expand-on-hover, not expanded): it grows from 0 to the collapsed width when
      // revealed (css/11, last block), so use that final width or a pointer at the screen edge would hide it again at once.
      if (!rootEl.hasAttribute("sidebar-expand-on-hover") && !box.hasAttribute("sidebar-launcher-expanded") && rootEl.hasAttribute("uc-vertical")) {
        const narrow = getStripW();
        if (atStart) left = Math.max(left, b.right, narrow);
        else right = Math.min(right, b.left, window.innerWidth - narrow);
      }

      // WHATEVER THE MODE: the strip of screen edge the rail lives on (the collapsed rail's width) is never "the page".
      // The branches above only cover some modes, and the rail is 0 wide while the bars have been hidden for a while. Firefox then measured
      // the page as reaching the very edge, so a reveal from the edge put the pointer "on the page" and the bars were hidden again at once:
      // in a capture the bars flipped shown/hidden every ~8ms (one flip per mouse event) and the rail never got any width.
      // The side comes from the rail's own attribute, not from its box (a rail 0 wide has no useful position).
      // Tunable: none; the width is --uc-rail-collapsed. To undo: delete this block.
      if (!rootEl.hasAttribute("inDOMFullscreen")) {
        const strip = getStripW();
        const railAtEnd = box.hasAttribute("sidebar-positionend") || rootEl.hasAttribute("sidebar-positionend");
        if (railAtEnd) right = Math.min(right, window.innerWidth - strip);
        else left = Math.max(left, strip);
      }

      return {
        top, bottom, left, right,
        x: left, y: top,
        width: right - left, height: bottom - top,
      };
    } catch (e) {
      return rect;
    }
  };
})();