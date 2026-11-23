// ==UserScript==
// @name           verticalTabLabelSpeed.uc.js
// @description    Gives long tab titles (vertical rail AND the selected horizontal tab) a constant scroll speed: keeps --uc-label-dist (how far the hovered tab's title has to travel)
//                 up to date on the title, and css/06 turns it into the animation time (distance / --uc-label-speed).
//                 The distance is NOT measured at one moment any more. The old version measured when the pointer arrived and once more 500ms
//                 later, and skipped the measurement while the rail was sliding or the sidebar page was loading. With a slow or changing rail
//                 (hover delay, tile width animation) or a title that changes after the hover, it could be left without a value, and css/06
//                 then falls back to 200px: every long title scrolled in about 5.6s, i.e. far too fast.
//                 Now a ResizeObserver watches the hovered tab's title and title box. Its sizes come with the callback, so no layout is forced
//                 (nothing to wait for), and any later change (the rail opening, the back/forward buttons opening, a new title) updates the value.
//                 The value is applied once the sizes have stopped changing (SETTLE_MS), so the rail's width animation does not make the
//                 duration jitter while the title is already scrolling.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  if (window.__ucLabelSpeed) return;
  window.__ucLabelSpeed = true;

  const SETTLE_MS = 120; // sizes must stay unchanged this long before the distance is written

  let current = null;    // { tab, label, box }
  let labelW = NaN;
  let boxW = NaN;
  let timer = 0;

  function apply() {
    timer = 0;
    if (!current || !current.label.isConnected) return;
    if (Number.isNaN(labelW) || Number.isNaN(boxW)) return;
    const dist = Math.max(1, Math.round(labelW - boxW));
    if (current.label.style.getPropertyValue("--uc-label-dist") !== String(dist)) {
      current.label.style.setProperty("--uc-label-dist", String(dist));
    }
  }

  const observer = new ResizeObserver((entries) => {
    if (!current) return;
    for (const e of entries) {
      if (e.target === current.label) {
        labelW = e.borderBoxSize && e.borderBoxSize[0] ? e.borderBoxSize[0].inlineSize : e.contentRect.width;
      } else if (e.target === current.box) {
        // the title scrolls inside the content box (the 100cqw of css/06), so that is the width to compare with
        boxW = e.contentBoxSize && e.contentBoxSize[0] ? e.contentBoxSize[0].inlineSize : e.contentRect.width;
      }
    }
    clearTimeout(timer);
    timer = setTimeout(apply, SETTLE_MS);
  });

  function watch(tab) {
    const label = tab.querySelector(".tab-label");
    const box = tab.querySelector(".tab-label-container");
    if (!label || !box) return;
    if (current && current.label === label && current.box === box) return; // already watching this one
    observer.disconnect();
    clearTimeout(timer);
    current = { tab, label, box };
    labelW = NaN;
    boxW = NaN;
    observer.observe(label);
    observer.observe(box);   // both report once when observation starts, so the first value arrives without waiting for a change
  }

  document.addEventListener("mouseover", (e) => {
    const tab = e.target.closest && e.target.closest(".tabbrowser-tab");
    if (!tab) return;   // vertical rail and horizontal strip alike (css/04 and css/06 do the scrolling)
    watch(tab);
  }, true);

  window.addEventListener("unload", () => {
    observer.disconnect();
    clearTimeout(timer);
  }, { once: true });
})();