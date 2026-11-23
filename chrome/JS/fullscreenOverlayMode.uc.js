// ==UserScript==
// @name           fullscreenOverlayMode.uc.js
// @description    Overlay mode (css/12). Uses [uc-fs-rail-end] on the root based on the pref/DOM
//                 to prevent Firefox 160 from momentarily snapping the right rail to the left.
// @include        main
// ==/UserScript==

(() => {
  const PREF = "uc.fullscreen.overlay-mode";
  const root = document.documentElement;
  const rail = document.getElementById("sidebar-container");
  const enabled = () => Services.prefs.getIntPref(PREF, 1) === 1;

  let raf = 0;
  let until = 0;
  const setTop = () => {
    const tb = document.getElementById("navigator-toolbox");
    if (tb) root.style.setProperty("--uc-fs-rail-top", Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) + "px");
  };
  const loop = () => {
    setTop();
    raf = performance.now() < until ? requestAnimationFrame(loop) : 0;
  };
  const kick = (ms) => {
    if (!enabled() || !root.hasAttribute("inFullscreen") || document.readyState !== "complete") return;
    until = performance.now() + ms;
    if (!raf) raf = requestAnimationFrame(loop);
  };

  function apply() {
    const on = enabled();
    
    // Determine side robustly
    let isRight = false;
    try {
      isRight = !Services.prefs.getBoolPref("sidebar.position_start", true);
    } catch (e) {}
    
    const railNow = document.getElementById("sidebar-container");
    if (railNow) {
      // If expanded, trust the DOM attribute (it is highly accurate when open)
      if (railNow.hasAttribute("sidebar-launcher-expanded") || !railNow.hasAttribute("sidebar-positionend")) {
         isRight = railNow.hasAttribute("sidebar-positionend");
      }
      // Nuke any leftover experimental attributes from previous versions
      railNow.removeAttribute("uc-force-start");
      railNow.removeAttribute("uc-force-end");
    }

    root.toggleAttribute("uc-fs-overlay-bar", on);
    root.toggleAttribute("uc-fs-overlay-rail", on);
    root.toggleAttribute("uc-fs-rail-end", on && isRight); // Rock-solid side lock
    root.toggleAttribute("uc-overlay-off", !on);
    
    if (on) kick(1200);
    else root.style.removeProperty("--uc-fs-rail-top");
  }

  let animTimer = 0;
  new MutationObserver((list) => {
    kick(700);
    if (list.some((m) => m.attributeName === "fullscreenNavToolboxHidden")) {
      root.setAttribute("uc-fs-toolbox-anim", "");
      clearTimeout(animTimer);
      animTimer = setTimeout(() => root.removeAttribute("uc-fs-toolbox-anim"), 600);
    }
  }).observe(root, {
    attributes: true,
    attributeFilter: ["fullscreenNavToolboxHidden", "inFullscreen", "uidensity"],
  });
  // Firefox flips [sidebar-positionend] a frame or two AFTER the pref changes, and apply() reads the DOM
  // attribute in some states. Without a second pass, [uc-fs-rail-end] stayed on the old side until the
  // next fullscreen toggle. Re-run apply() whenever the attribute itself changes.
  const sideObserver = new MutationObserver(() => apply());
  const watchSide = () => {
    sideObserver.disconnect();
    for (const el of [document.getElementById("sidebar-container"), document.getElementById("tabbrowser-tabbox")]) {
      if (el) sideObserver.observe(el, { attributes: true, attributeFilter: ["sidebar-positionend"] });
    }
  };
  watchSide();
  window.addEventListener("fullscreen", () => { watchSide(); apply(); kick(1200); });
  window.addEventListener("resize", () => kick(300));

  if (rail) {
    let expandedW = 291;
    let holdTimer = 0;
    let collapsingTimer = 0;
    new ResizeObserver((entries) => {
      if (!rail.hasAttribute("sidebar-launcher-expanded")) return;
      const e = entries[entries.length - 1];
      const w = e.borderBoxSize && e.borderBoxSize[0] ? e.borderBoxSize[0].inlineSize : e.contentRect.width;
      if (w > 100) expandedW = Math.round(w);
    }).observe(rail);
    const stopHold = () => {
      clearTimeout(holdTimer);
      root.removeAttribute("uc-fs-rail-shrinking");
      root.style.removeProperty("--uc-fs-rail-hold-w");
    };
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.attributeName === "sidebar-launcher-expanded") {
          if (m.oldValue === null || rail.hasAttribute("sidebar-launcher-expanded")) continue;
          if (!enabled() || !root.hasAttribute("inFullscreen")) continue;
          // sidebarPushSettle.uc.js drives the rail itself in overlay mode: no CSS hold/slide needed
          if (root.hasAttribute("uc-push-overlay")) continue;
          root.style.setProperty("--uc-fs-rail-hold-w", expandedW + "px");
          root.style.setProperty("--uc-fs-rail-slide-w", expandedW + "px");
          root.setAttribute("uc-fs-rail-shrinking", "");
          root.setAttribute("uc-fs-rail-collapsing", "");
          clearTimeout(holdTimer);
          holdTimer = setTimeout(stopHold, 900);
          clearTimeout(collapsingTimer);
          collapsingTimer = setTimeout(() => root.removeAttribute("uc-fs-rail-collapsing"), 1000);
        } else if (m.attributeName === "sidebar-ongoing-animations" && !rail.hasAttribute("sidebar-ongoing-animations")) {
          if (root.hasAttribute("uc-fs-rail-shrinking")) stopHold();
        }
      }
    }).observe(rail, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["sidebar-launcher-expanded", "sidebar-ongoing-animations"],
    });
  }

  // follow the toggle and position live
  const observer = { observe: apply };
  Services.prefs.addObserver(PREF, observer);
  Services.prefs.addObserver("sidebar.position_start", observer); 
  
  window.addEventListener("unload", () => {
    try { 
      Services.prefs.removeObserver(PREF, observer); 
      Services.prefs.removeObserver("sidebar.position_start", observer);
    } catch (e) {}
  }, { once: true });

  apply();
  if (document.readyState !== "complete") window.addEventListener("load", () => kick(1200), { once: true });
})();