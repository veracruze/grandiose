// ==UserScript==
// @name           horizontalTabOverflow.uc.js
// @description    Horizontal tab strip sizing, chosen by MEASURING (never sticky):
//                   0 normal   nothing set — selected tab keeps its default width / title
//                   1 compact  root[uc-tabstrip-compact]  selected tab = idle-tab width,
//                              idle tabs widen on hover
//                 Applies to single tabs, split-view pairs and tab groups alike.
//                 The LAYOUT is owned by css/20-tabstrip-overflow.css via the window state:
//                 a restored window (sizemode="normal") always stacks the tabs above the
//                 navbar (one-line disabled); a maximized window keeps the core one-line
//                 layout. This script only decides the sizing, and only in a restored
//                 window, measuring the two-line full-width strip. Maximized / fullscreen /
//                 vertical => mode 0. Each evaluation probes mode 0 first (the layout
//                 attribute is independent of compact), so the decision has hysteresis and
//                 cannot oscillate. Flips happen in ONE task with transitions off
//                 (root[uc-tabstrip-probing]).
// @include        main
// ==/UserScript==
(() => {
  "use strict";
  if (window.__ucHorizontalTabOverflow) return;
  window.__ucHorizontalTabOverflow = true;

  const ROOT = document.documentElement;
  const CONFIG = { tolerancePx: 1, debug: false };
  const ATTR = { compact: "uc-tabstrip-compact", probing: "uc-tabstrip-probing" };
  const TAG = "[uc] horizontalTabOverflow";
  const dbg = (...a) => CONFIG.debug && console.log(TAG, ...a);
  const byId = (id) => document.getElementById(id);
  const scrollbox = () => byId("tabbrowser-arrowscrollbox");
  const inner = () => {
    const sb = scrollbox();
    return sb && (sb.scrollbox || (sb.shadowRoot && sb.shadowRoot.querySelector("scrollbox")) || sb);
  };
  const sizingActive = () =>
    ROOT.getAttribute("sizemode") === "normal" && !ROOT.hasAttribute("uc-vertical");

  let mode = 0, rafId = 0, trailTimer = 0;
  const applyMode = (m) => ROOT.toggleAttribute(ATTR.compact, m >= 1);
  const metrics = () => {
    const el = inner();
    return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
  };
  const overflows = () => {
    const m = metrics();
    return !!m && m.clientWidth > 0 && m.scrollWidth - m.clientWidth > CONFIG.tolerancePx;
  };

  function evaluate() {
    rafId = 0;
    if (!sizingActive()) {
      if (mode !== 0) { applyMode(0); mode = 0; }
      return;
    }
    const el = inner();
    if (!el || !el.clientWidth) return;
    ROOT.setAttribute(ATTR.probing, "");
    try {
      applyMode(0);
      const next = overflows() ? 1 : 0;
      applyMode(next);
      void el.offsetWidth;
      if (next !== mode) { dbg("mode", mode, "->", next, metrics()); mode = next; }
    } finally {
      ROOT.removeAttribute(ATTR.probing);
    }
  }

  function request(trail = 0) {
    if (!rafId) rafId = requestAnimationFrame(evaluate);
    if (trail > 0) { clearTimeout(trailTimer); trailTimer = setTimeout(request, trail); }
  }

  const cleanups = [];
  const listen = (t, type, fn, opts) => {
    if (!t) return;
    t.addEventListener(type, fn, opts);
    cleanups.push(() => t.removeEventListener(type, fn, opts));
  };

  function initialize() {
    const sb = scrollbox();
    if (!sb) { console.warn(TAG + ": #tabbrowser-arrowscrollbox not found, script disabled"); return; }
    ROOT.removeAttribute("uc-urlbar-wide");
    ROOT.removeAttribute("uc-tabstrip-overflow-fallback");

    listen(window, "resize", () => request(120));
    const ro = new ResizeObserver(() => request());
    const toolbar = byId("TabsToolbar");
    if (toolbar) ro.observe(toolbar);
    cleanups.push(() => ro.disconnect());

    listen(sb, "overflow", () => request());
    listen(sb, "underflow", () => request());
    const sbMo = new MutationObserver(() => request());
    sbMo.observe(sb, { attributes: true, attributeFilter: ["overflowing"] });
    cleanups.push(() => sbMo.disconnect());

    const stripMo = new MutationObserver(() => request(120));
    stripMo.observe(sb, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hasactivetab", "collapsed", "multiselected", "hidden"],
    });
    cleanups.push(() => stripMo.disconnect());

    const tc = window.gBrowser && gBrowser.tabContainer;
    if (tc) {
      for (const type of [
        "TabOpen", "TabClose", "TabSelect", "TabPinned", "TabUnpinned", "TabHide", "TabShow", "TabMove",
        "TabGroupCreate", "TabGroupRemoved", "TabGrouped", "TabUngrouped",
      ]) {
        listen(tc, type, () => request(type === "TabClose" ? 320 : 120));
      }
      listen(tc, "TabAttrModified", (e) => {
        const ch = e.detail && e.detail.changed;
        if (ch && ch.some((k) => k === "soundplaying" || k === "muted" || k === "activemedia-blocked" || k === "pinned")) request(120);
      });
    }

    const rootMo = new MutationObserver(() => request(150));
    rootMo.observe(ROOT, { attributes: true, attributeFilter: ["sizemode", "uidensity", "uc-vertical", "inFullscreen", "fullscreenNavToolboxHidden"] });
    cleanups.push(() => rootMo.disconnect());

    window.__ucHorizontalTabOverflowDebug = { CONFIG, evaluate, metrics, overflows, getMode: () => mode };
    request(400);
  }

  window.addEventListener("unload", () => {
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    clearTimeout(trailTimer);
    cancelAnimationFrame(rafId);
  }, { once: true });

  if (document.readyState === "complete") initialize();
  else window.addEventListener("load", initialize, { once: true });
})();
