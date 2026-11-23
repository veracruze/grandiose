// ==UserScript==
// @name           sidebarPushSettle.uc.js
// @description    JS-managed sidebar/page geometry via CSS variables.
//                 One extent value E (px of rail on screen) drives everything:
//                   0 = hidden (fullscreen), strip = collapsed, full = expanded.
//                 Synchronized layout timing with zero-lag translate animations.
//                 A vertical-tabs / visibility toggle is treated as a transition: Firefox's own 200ms
//                 slide plays untouched (no cancel, no pin), so the page does not snap on the toggle.
//                 Sidebar panels (Customize) and their 300ms hover-settle window disown push-settle,
//                 so their own layout rules (css/13) control the page and the rail.
//                 The rail is only treated as expanded when BOTH [sidebar-launcher-hovered] (on tabbox)
//                 AND [sidebar-launcher-expanded] (on the container) are set, so a stale hover flag
//                 left over from before CS cannot push the page without also expanding the rail.
//                 The side is latched from the pref sidebar.position_start (2026-11-20). Firefox 160 leaves the
//                 container's [sidebar-positionend] unreliable after "Move sidebar to the right" in a running
//                 session, which made single frames use the LEFT formulas on a right rail (page jump until the
//                 next restart). A change of the pref drops our geometry and rebuilds it. The CSS follows JS via
//                 the root attribute [uc-push-end], so the two cannot disagree.
//                 Right-side uses the same translate-based formulas as left (push-outside-frame look,
//                 page reflows once at settle). This is the visual behaviour preferred over the
//                 reflow-during-animation variant, accepting the small settle-frame reflow that comes
//                 with it.
//                 Optionally logs state changes when uc.pushSettle.debug is true in about:config.
// @include        main
// ==/UserScript==
(() => {
  "use strict";
  if (window.__ucPushSettle) return;
  const TAG = "sidebarPushSettle";

  let DEBUG = false;
  const readDebug = () => {
    try { DEBUG = Services.prefs.getBoolPref("uc.pushSettle.debug", false); } catch (e) { DEBUG = false; }
  };
  readDebug();
  try {
    Services.prefs.addObserver("uc.pushSettle.debug", { observe: readDebug });
  } catch (e) {}
  const dbg = (...a) => { if (DEBUG) console.log(`[uc] ${TAG}`, ...a); };

  const root = document.documentElement;
  let tabbox = document.getElementById("tabbrowser-tabbox");
  if (!tabbox) {
    console.warn(`[uc] ${TAG}: #tabbrowser-tabbox is missing`);
    return;
  }
  window.__ucPushSettle = true;

  const TOGGLE_PREFS = ["sidebar.verticalTabs", "sidebar.visibility"];
  let vtToggleUntil = 0;
  let vtToggleTimer = 0;
  const inVtToggle = () => performance.now() < vtToggleUntil;
  const onToggle = () => {
    vtToggleUntil = performance.now() + 400;
    Promise.resolve().then(sync);
    clearTimeout(vtToggleTimer);
    vtToggleTimer = setTimeout(() => {
      vtToggleUntil = 0;
      sync();
    }, 400);
  };
  const toggleObserver = { observe: onToggle };
  for (const pref of TOGGLE_PREFS) {
    try {
      Services.prefs.addObserver(pref, toggleObserver);
    } catch (e) {
      console.warn(`[uc] ${TAG}: could not observe ${pref} (${e && e.message}); ` +
                   `the page may jump when vertical tabs are toggled.`);
    }
  }

  const DURATION_PREF = "sidebar.animation.expand-on-hover.duration-ms";

  const easeOpen = cubicBezier(0.42, 0, 0.58, 1);
  const easeClose = cubicBezier(0.42, 0, 0.58, 1);
  let ease = easeOpen;

  const EPS = 0.5;
  // How the PAGE reacts while a rail on the RIGHT expands / collapses (windowed and fullscreen overlay-off):
  //   "slide"  the page slides left by the amount the rail grew (the push look), then one reflow at the end. Cheap (a translate), but the page
  //            snaps back to its real position at the end / jumps at the start of a close, because a translate cannot shrink the page's right edge.
  //   "reflow" the page's right edge follows the rail every frame (padding-inline-end), no translate, no snap. The page re-lays out every frame,
  //            so it costs more on heavy pages.
  //   "still"  the page does not move while the rail overlays it, one reflow at the end.
  const RIGHT_PAGE_MODE = "slide";
  const MAX_DT = 24;
  const POS_PREF = "sidebar.position_start";

  // Overlay mode (uc-overlay-off absent) can run on this same engine: the rail gets the same JS-driven
  // width/slide as in push mode, but the page never moves. Turn it off with uc.overlay.js-rail = false
  // (then overlay mode goes back to the CSS-only slide in css/12 sections 2-3).
  const OVERLAY_PREF = "uc.overlay.js-rail";
  const overlayOn = () => !root.hasAttribute("uc-overlay-off");
  const overlayEngine = () => {
    try { return Services.prefs.getBoolPref(OVERLAY_PREF, true); } catch (e) { return true; }
  };
  try {
    Services.prefs.addObserver(OVERLAY_PREF, { observe: () => Promise.resolve().then(() => sync()) });
  } catch (e) {}

  let owned = false;
  let raf = 0;
  let fromQ = 0;
  let targetQ = 0;
  let q = 0;
  let moving = false;
  let progress = 0;
  let lastTs = 0;
  let duration = 0;
  let lastExpandedWidth = 0;
  let debugHold = false;

  // Animation-scoped cache. Set once per animation (in animateTo), reused every frame
  // by applyGeometry. Without these, applyGeometry did forced reads per frame:
  //   collapsedWidth()     -> getComputedStyle on :root + getComputedStyle on #browser
  //   expandedWidth(strip) -> rail().getBoundingClientRect() (forces full layout)
  // At ~24-48 frames per animation, that is ~100 forced reads per expand/collapse.
  // The values do not change mid-animation, so caching them eliminates the reads.
  //
  // atEnd() returns a latched value (see readSide), so it is free to call per frame.
  let cachedCollapsedW = 0;
  let cachedExpandedW = 0;
  let cachedRailEl = null;

  function updateAnimationCache() {
    cachedCollapsedW = collapsedWidth();
    cachedRailEl = rail();
    cachedExpandedW = expandedWidth(cachedCollapsedW);
  }

  const rail = () =>
    document.getElementById("sidebar-container") ||
    document.getElementById("sidebar-box");
  const sidebarMain = () => document.querySelector("sidebar-main");

  const hovered = () => tabbox.hasAttribute("sidebar-launcher-hovered");
  const expanded = () => {
    const c = document.getElementById("sidebar-container");
    return !!(c && c.hasAttribute("sidebar-launcher-expanded"));
  };
  const reallyExpanded = () => hovered() && expanded();

  const slideMode = () =>
    root.hasAttribute("inFullscreen") &&
    root.hasAttribute("fullscreenNavToolboxHidden");

  const baseExtent = () => (slideMode() ? 0 : collapsedWidth());

  const railMs = () => {
    try {
      return Math.max(80, Services.prefs.getIntPref(DURATION_PREF, 400));
    } catch {
      return 400;
    }
  };

  // WHICH SIDE THE RAIL IS ON. This used to be read from the container's [sidebar-positionend] on every call, including every animation
  // frame. After "Move sidebar to the right" in a running session Firefox 160 leaves that attribute unreliable (fullscreenOverlayMode.uc.js
  // has the same note: "Firefox's flickering attributes"), so a frame could be computed for the LEFT rail while the rail is on the right:
  // the left formulas (page translate +, padding-inline-start) were applied to a right rail and the page jumped. After a restart the
  // attribute is stable, which is why the jump was gone then. The side is now latched from the pref sidebar.position_start (the source of
  // truth Firefox itself writes the attribute from) and only changes when that pref changes; the flip is treated as a transition: our
  // geometry is dropped and rebuilt from a clean state once Firefox has finished moving the rail.
  const readSide = () => {
    try {
      return !Services.prefs.getBoolPref(POS_PREF, true);
    } catch (e) {}
    const c = document.getElementById("sidebar-container");
    return !!(c && c.hasAttribute("sidebar-positionend"));
  };
  let sideEnd = readSide();
  const atEnd = () => sideEnd;
  const sideObserver = {
    observe() {
      const next = readSide();
      if (next === sideEnd) return;
      sideEnd = next;
      dbg("side changed, end=", sideEnd);
      disownGeometry();
      for (const ms of [0, 60, 200, 500]) setTimeout(sync, ms);
    },
  };
  try {
    Services.prefs.addObserver(POS_PREF, sideObserver);
  } catch (e) {
    console.warn(`[uc] ${TAG}: could not observe ${POS_PREF} (${e && e.message}); the rail side is read once at startup.`);
  }

  const applies = () => {
    if (inVtToggle()) return false;
    if (root.hasAttribute("uc-customize-open")) return false;
    if (root.hasAttribute("uc-hover-suppressed")) return false;
    if (overlayOn() && !overlayEngine()) return false;
    if (!root.hasAttribute("sidebar-expand-on-hover")) return false;
    if (root.hasAttribute("inDOMFullscreen")) return false;
    if (tabbox.hasAttribute("sidebar-panel-open")) return false;
    const container = document.getElementById("sidebar-container");
    if (container && container.hasAttribute("sidebar-panel-open")) return false;
    return true;
  };

  // CPU: these --uc-push-* variables used to be written on :root, ~9 of them every frame. A changed custom property on :root makes the browser
  // re-resolve styles for EVERY element in the window (custom properties inherit), which is where the 10-13% CPU per expand went. The CSS that
  // reads them (12 sections 7 and 8) only matters for #sidebar-container and #tabbrowser-tabbox, both children of #browser, so they are written
  // there instead (the restyle stays inside #browser, the toolbox and everything above it are left alone). If #browser does not hold both
  // elements on some Firefox, :root is used as before. Values are also cached, so a variable that did not change (the margins and paddings
  // while the rail moves) is not written at all.
  let varHost = null;
  const hostForVars = () => {
    if (varHost && varHost.isConnected) return varHost;
    const b = document.getElementById("browser");
    const r = rail();
    varHost = b && b.contains(tabbox) && r && b.contains(r) ? b : root;
    return varHost;
  };
  const writtenVars = new Map();
  const setRootVar = (name, value) => {
    const host = hostForVars();
    const prev = writtenVars.get(name);
    if (prev && prev.host === host && prev.value === value) return;
    host.style.setProperty(name, value, "important");
    writtenVars.set(name, { host, value });
  };
  const removeRootVar = (name) => {
    const prev = writtenVars.get(name);
    if (prev) prev.host.style.removeProperty(name);
    writtenVars.delete(name);
    root.style.removeProperty(name);   // anything an older version left on :root
  };
  let lastState = "";
  const setState = (value) => {
    if (value === lastState) return;   // setAttribute with the same value still queues a mutation record (sidebarRailGate watches this attribute)
    lastState = value;
    if (value) root.setAttribute("uc-push", value);
    else root.removeAttribute("uc-push");
  };

  function cssPx(el, name, fallback = 0) {
    if (!el) return fallback;
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function collapsedWidth() {
    const browser = document.getElementById("browser");
    return (
      cssPx(root, "--uc-rail-collapsed", 0) ||
      cssPx(browser, "--sidebar-launcher-collapsed-width", 0) ||
      60
    );
  }

  function expandedWidth(collapsed) {
    const r = rail();
    const rectWidth = r?.getBoundingClientRect().width || 0;
    if (rectWidth > collapsed + 4) {
      lastExpandedWidth = Math.max(lastExpandedWidth, rectWidth);
    }
    const fromVar =
      cssPx(root, "--uc-rail-expanded-w", 0) ||
      cssPx(root, "--sidebar-expanded-launcher-width", 0) ||
      cssPx(r, "--sidebar-expanded-launcher-width", 0);
    return Math.max(
      collapsed,
      fromVar || lastExpandedWidth || collapsed + 240
    );
  }

  // Reads a duration custom property (e.g. --uc-fs-rail-dur: 400ms) as milliseconds; 0 if unset.
  function cssMs(name) {
    const el = document.getElementById("browser") || root;
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return 0;
    if (/ms$/.test(raw)) return v;
    if (/s$/.test(raw)) return v * 1000;
    return 0;
  }

  function measureRailBox() {
    const rect = tabbox.getBoundingClientRect();
    const fs = root.hasAttribute("inFullscreen");
    const fsTop = cssPx(root, "--uc-fs-rail-top", NaN);
    const top = fs && Number.isFinite(fsTop) ? fsTop : rect.top;
    const height = fs || rect.height <= 20
      ? Math.max(0, window.innerHeight - top)
      : rect.height;
    setRootVar("--uc-push-rail-top", `${Math.round(top)}px`);
    setRootVar("--uc-push-rail-h", `${Math.round(height)}px`);
  }

  const remeasureTimers = [];
  function remeasureSoon() {
    for (const id of remeasureTimers.splice(0)) clearTimeout(id);
    for (const ms of [0, 50, 150, 350, 700]) {
      remeasureTimers.push(
        setTimeout(() => {
          if (owned) measureRailBox();
        }, ms)
      );
    }
  }

  const HOLD_WINDOW = 300;
  const recentRemovals = [];
  const held = new Map();
  const isExpandedAttr = (name) =>
    /expanded/i.test(name) && !name.startsWith("aria-") && !name.startsWith("uc-");
  const closing = () => owned && !hovered() && (raf !== 0 || q > baseExtent() + EPS);

  function hold(el, name, value) {
    if (!el.isConnected || el.hasAttribute(name)) return;
    el.setAttribute(name, value);
    let attrs = held.get(el);
    if (!attrs) held.set(el, (attrs = new Map()));
    attrs.set(name, value);
  }

  function snapshotExpanded() {
    const roots = [rail(), sidebarMain(), tabbox, document.getElementById("tabbrowser-tabs")].filter(Boolean);
    for (const rootEl of roots) {
      const elements = [rootEl, ...rootEl.querySelectorAll("*")];
      for (const el of elements) {
        for (const attr of el.attributes) {
          if (isExpandedAttr(attr.name)) {
            hold(el, attr.name, attr.value);
          }
        }
      }
    }
  }

  function holdRecent() {
    const now = performance.now();
    for (const r of recentRemovals) {
      if (now - r.t <= HOLD_WINDOW) hold(r.el, r.name, r.value);
    }
  }

  function releaseHeld() {
    const items = [...held];
    held.clear();
    if (!items.length || hovered()) return;
    for (const [el, attrs] of items) {
      if (!el.isConnected) continue;
      for (const name of attrs.keys()) el.removeAttribute(name);
    }
    expandedObserver.takeRecords();
    recentRemovals.length = 0;
  }

  const expandedObserver = new MutationObserver((records) => {
    const now = performance.now();
    for (const rec of records) {
      const name = rec.attributeName;
      if (!isExpandedAttr(name)) continue;
      const el = rec.target;
      if (rec.oldValue !== null && !el.hasAttribute(name)) {
        recentRemovals.push({ el, name, value: rec.oldValue, t: now });
        if (closing()) hold(el, name, rec.oldValue);
      }
    }
    while (recentRemovals.length && now - recentRemovals[0].t > HOLD_WINDOW) {
      recentRemovals.shift();
    }
  });

  function observeExpanded() {
    const roots = new Set(
      [rail(), sidebarMain(), document.getElementById("tabbrowser-tabs")].filter(Boolean)
    );
    for (const el of roots) {
      expandedObserver.observe(el, {
        attributes: true,
        subtree: true,
        attributeOldValue: true,
      });
    }
    expandedObserver.observe(tabbox, { attributes: true, attributeOldValue: true });
  }

  function markTabChain() {
    const r = rail();
    const start = document.getElementById("tabbrowser-tabs");
    if (!r || !start || !r.contains(start)) return;
    for (let el = start; el && el !== r; el = el.parentElement) {
      if (el.id !== "sidebar-main") el.setAttribute("uc-push-chain", "");
    }
  }

  function unmarkTabChain() {
    for (const el of document.querySelectorAll("[uc-push-chain]")) {
      el.removeAttribute("uc-push-chain");
    }
  }

  window.__ucPushDebug = (qv = 0.5, delay = 3000) => {
    setTimeout(() => {
      debugHold = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      ownGeometry();
      const strip = collapsedWidth();
      fromQ = baseExtent();
      targetQ = fromQ + (expandedWidth(strip) - fromQ) * clamp(qv);
      moving = true;
      applyGeometry(targetQ);
      setTimeout(() => {
        const r = rail();
        const rows = [{ node: "RAIL", width: r.getBoundingClientRect().width }];
        let el = document.querySelector("#sidebar-container .tabbrowser-tab");
        for (; el && el !== r; el = el.parentElement) {
          const cs = getComputedStyle(el);
          rows.push({
            node: `${el.localName}${el.id ? "#" + el.id : ""}${el.className ? "." + String(el.className).split(" ")[0] : ""}`,
            width: Math.round(el.getBoundingClientRect().width * 10) / 10,
            cssWidth: cs.width,
            minWidth: cs.minWidth,
            maxWidth: cs.maxWidth,
            transition: cs.transitionProperty,
            display: cs.display,
            boxSizing: cs.boxSizing,
          });
        }
        console.table(rows);
      }, 150);
      setTimeout(() => {
        debugHold = false;
        sync();
      }, 10000);
    }, delay);
  };

  // Firefox's own geometry animations on the host element only. The theme's chevron fades (uc-chevron-in / uc-chevron-out, driven by
  // sidebarRailHold via ::part() in sidebar-main's shadow root) must be left alone: finish() would jump them to their end state.
  const isThemeFade = (anim) =>
    anim instanceof CSSAnimation && String(anim.animationName).startsWith("uc-chevron-");

  function nativeGeometryAnimations(el) {
    if (!el?.getAnimations) return [];
    return el.getAnimations().filter((anim) => {
      if (isThemeFade(anim)) return false;
      const fx = anim.effect;
      // host element itself only: no pseudo-elements (::part etc.), no descendants
      if (fx && (fx.target !== el || fx.pseudoElement)) return false;
      return true;
    });
  }

  function cancelNativeGeometryAnimations() {
    for (const el of [rail(), sidebarMain(), tabbox]) {
      for (const anim of nativeGeometryAnimations(el)) {
        if (anim.playState === "finished") continue;
        try {
          anim.finish();
        } catch {
          try {
            anim.cancel();
          } catch {}
        }
      }
    }
  }

  function scheduleNativeCancel() {
    cancelNativeGeometryAnimations();
    setTimeout(cancelNativeGeometryAnimations, 0);
    setTimeout(cancelNativeGeometryAnimations, 16);
    setTimeout(cancelNativeGeometryAnimations, 50);
  }

  function applyGeometry(value) {
    q = Math.max(0, value);
    const r = cachedRailEl || rail();
    if (!r) return;
    const end = atEnd();
    root.toggleAttribute("uc-push-end", end);
    // The cache only holds within one animation; a static apply (sync, resize, density change) re-reads.
    const strip = (raf && cachedCollapsedW) || collapsedWidth();
    const full = (raf && cachedExpandedW) || expandedWidth(strip);
    const dir = end ? -1 : 1;
    const railWidth = Math.max(strip, q);
    const railX = -dir * Math.max(0, strip - q);
    let layout;
    let margin;
    let pad;
    let pageX;
    if (!end) {
      // --- LEFT RAIL ---
      if (!moving) {
        layout = q;
      } else {
        layout = Math.min(fromQ, targetQ);
      }
      margin = Math.min(layout, strip);
      pad = layout - margin;
      pageX = q - layout;
    } else {
      // --- RIGHT RAIL ---
      // Translate-based formulas: content shifts left/right during the animation
      // (push-outside-frame look), then the settled formulas take over and content
      // reflows once at the end. This is the original preferred behaviour.
      //
      // The settle-frame reflow (content[0] snapping from -240 back to 0) is the
      // "page resizes after the animation" symptom, which is the accepted trade-off
      // for the push-look. It cannot be avoided without changing to reflow-during-
      // animation on the right side, which visually behaves like overlay mode.
      if (!moving || RIGHT_PAGE_MODE === "reflow") {
        layout = q;
      } else {
        layout = Math.min(fromQ, targetQ);
      }
      margin = Math.min(layout, strip);
      pad = layout - margin;

      if (!moving || RIGHT_PAGE_MODE === "reflow") {
        pageX = 0;
      } else {
        // see RIGHT_PAGE_MODE at the top of the file
        pageX = RIGHT_PAGE_MODE === "slide" ? layout - q : 0;
      }
    }
    // Overlay mode: same rail motion, but the page stays put. Windowed overlay keeps the strip's width
    // reserved (the rail is out of the layout flow), fullscreen overlay lets the rail cover the page.
    const overlay = overlayOn();
    root.toggleAttribute("uc-push-overlay", overlay);
    if (overlay) {
      margin = root.hasAttribute("inFullscreen") ? 0 : strip;
      pad = 0;
      pageX = 0;
    }
    setRootVar("--uc-push-rail-w", `${railWidth}px`);
    setRootVar("--uc-push-rail-x", `${railX}px`);
    setRootVar("--uc-push-margin-start", `${end ? 0 : margin}px`);
    setRootVar("--uc-push-margin-end", `${end ? margin : 0}px`);
    setRootVar("--uc-push-pad-start", `${end ? 0 : pad}px`);
    setRootVar("--uc-push-pad-end", `${end ? pad : 0}px`);
    setRootVar("--uc-push-page-x", `${pageX}px`);
    setState(!moving && q >= full - EPS ? "settled" : "");
  }

  function ownGeometry() {
    if (owned) return;
    owned = true;
    // The cache is otherwise only refreshed when an animation starts. If the density (and with it the strip
    // width) changed while we were disowned (Customize open), applying with the old strip put the rail
    // partly off-screen: q was fresh, the cached strip was not.
    updateAnimationCache();
    const start = reallyExpanded() ? expandedWidth(collapsedWidth()) : baseExtent();
    q = fromQ = targetQ = start;
    moving = false;
    root.setAttribute("uc-push-managed", "");
    root.toggleAttribute("uc-push-end", atEnd());
    markTabChain();
    measureRailBox();
    applyGeometry(q);
    scheduleNativeCancel();
    dbg("own", "q=", q, "end=", atEnd(), "reallyExpanded=", reallyExpanded());
  }

  function disownGeometry() {
    if (!owned) return;
    dbg("disown", "inVtToggle=", inVtToggle(), "csOpen=", root.hasAttribute("uc-customize-open"),
        "hoverSuppressed=", root.hasAttribute("uc-hover-suppressed"));
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    owned = false;
    moving = false;
    q = 0;
    targetQ = 0;
    fromQ = 0;

    const rebase = [];
    let hasAnim = false;
    for (const el of [rail(), sidebarMain(), document.getElementById("sidebar-box"), tabbox]) {
      for (const anim of nativeGeometryAnimations(el)) {
        if (anim.playState === "finished") continue;
        hasAnim = true;
        const ct = anim.currentTime;
        if (ct === null || (typeof ct === "number" && ct < 50)) {
          rebase.push(anim);
        }
      }
    }
    if (!inVtToggle() && !hasAnim) {
      cancelNativeGeometryAnimations();
    }

    releaseHeld();
    unmarkTabChain();
    root.removeAttribute("uc-push-managed");
    root.removeAttribute("uc-push-end");
    root.removeAttribute("uc-push-moving");
    root.removeAttribute("uc-push-overlay");
    setState("");
    for (const name of [
      "--uc-push-rail-w",
      "--uc-push-rail-x",
      "--uc-push-rail-top",
      "--uc-push-rail-h",
      "--uc-push-margin-start",
      "--uc-push-margin-end",
      "--uc-push-pad-start",
      "--uc-push-pad-end",
      "--uc-push-page-x",
    ]) {
      removeRootVar(name);
    }
    root.removeAttribute("uc-push-back");
    root.removeAttribute("uc-push-back2");
    tabbox.style.removeProperty("pointer-events");

    for (const anim of rebase) {
      try { anim.startTime = document.timeline.currentTime; } catch (e) {}
    }
  }

  function animateTo(next) {
    next = Math.max(0, next);
    if (Math.abs(next - targetQ) < EPS && (raf || Math.abs(q - next) < EPS)) {
      return;
    }
    ownGeometry();
    updateAnimationCache();
    measureRailBox();
    scheduleNativeCancel();
    fromQ = q;
    targetQ = next;
    ease = targetQ > fromQ ? easeOpen : easeClose;
    if (targetQ < fromQ) {
      snapshotExpanded();
      holdRecent();
    } else {
      held.clear();
    }
    const strip = collapsedWidth();
    const span = Math.max(1, expandedWidth(strip) - strip);
    const distance = Math.min(1, Math.abs(targetQ - fromQ) / span);
    duration = Math.max(140, railMs() * distance);
    // Fullscreen overlay: sliding the rail on or off screen keeps css/12's own pace (--uc-fs-rail-dur),
    // not the short expand-on-hover pace, otherwise the 50px strip whips in and out in ~140ms.
    if (overlayOn() && root.hasAttribute("inFullscreen") && Math.min(fromQ, targetQ) < EPS) {
      const fsMs = cssMs("--uc-fs-rail-dur");
      if (fsMs) {
        duration = Math.max(duration, fsMs * Math.min(1, Math.abs(targetQ - fromQ) / Math.max(1, strip)));
      }
    }
    moving = true;
    progress = 0;
    lastTs = 0;
    root.setAttribute("uc-push-moving", "");
    applyGeometry(q);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (tabbox.hasAttribute("sidebar-ongoing-animations")) {
      cancelNativeGeometryAnimations();
    }
    if (root.hasAttribute("inFullscreen")) measureRailBox();
    if (!lastTs) lastTs = now;
    const dt = Math.min(Math.max(0, now - lastTs), MAX_DT);
    lastTs = now;
    progress = duration > 0 ? clamp(progress + dt / duration) : 1;
    const t = progress;
    const eased = ease(t);
    const nextQ = fromQ + (targetQ - fromQ) * eased;
    applyGeometry(nextQ);
    if (t < 1) {
      raf = requestAnimationFrame(tick);
      return;
    }
    raf = 0;
    moving = false;
    q = targetQ;
    applyGeometry(q);
    root.removeAttribute("uc-push-moving");
    scheduleNativeCancel();
    if (targetQ <= baseExtent() + EPS) releaseHeld();
    if (!applies()) disownGeometry();
  }

  function refreshTabbox() {
    const cur = document.getElementById("tabbrowser-tabbox");
    if (!cur || cur === tabbox) return;
    dbg("tabbox refreshed", { wasConnected: tabbox.isConnected, nowConnected: cur.isConnected });
    tabboxObserver.disconnect();
    tabbox = cur;
    tabboxObserver.observe(tabbox, {
      attributes: true,
      attributeFilter: [
        "sidebar-launcher-hovered",
        "sidebar-launcher-expanded",
        "sidebar-panel-open",
        "sidebar-positionend",
        "sidebar-ongoing-animations",
      ],
    });
  }

  let containerEl = document.getElementById("sidebar-container");
  const containerObserver = new MutationObserver(sync);
  if (containerEl) {
    containerObserver.observe(containerEl, {
      attributes: true,
      attributeFilter: ["sidebar-panel-open", "sidebar-launcher-expanded", "sidebar-positionend"],
    });
  }
  function refreshContainer() {
    const cur = document.getElementById("sidebar-container");
    if (!cur || cur === containerEl) return;
    if (containerEl) containerObserver.disconnect();
    containerEl = cur;
    containerObserver.observe(containerEl, {
      attributes: true,
      attributeFilter: ["sidebar-panel-open", "sidebar-launcher-expanded", "sidebar-positionend"],
    });
  }

  function sync() {
    if (debugHold) return;
    refreshTabbox();
    refreshContainer();
    try {
      if (!applies()) {
        if (owned) dbg("sync → disown", {
          csOpen: root.hasAttribute("uc-customize-open"),
          hoverSuppressed: root.hasAttribute("uc-hover-suppressed"),
          panelOpen: tabbox.hasAttribute("sidebar-panel-open"),
          containerPanelOpen: !!(containerEl && containerEl.hasAttribute("sidebar-panel-open")),
          inVtToggle: inVtToggle(),
        });
        disownGeometry();
        return;
      }
      if (!owned) dbg("sync → own", {
        q: q, targetQ: targetQ, hovered: hovered(), expanded: expanded(), reallyExpanded: reallyExpanded(),
      });
      ownGeometry();
      const strip = collapsedWidth();
      const desired = reallyExpanded() ? expandedWidth(strip) : baseExtent();
      if (
        Math.abs(desired - targetQ) > EPS ||
        (!raf && Math.abs(desired - q) > EPS)
      ) {
        dbg("animate", { from: q, to: desired, hovered: hovered(), expanded: expanded() });
        animateTo(desired);
      } else {
        if (!raf) {
          measureRailBox();
          applyGeometry(q);
        }
        scheduleNativeCancel();
      }
    } catch (error) {
      console.error(`[uc] ${TAG}:`, error);
    }
  }

  const tabboxObserver = new MutationObserver(sync);
  tabboxObserver.observe(tabbox, {
    attributes: true,
    attributeFilter: [
      "sidebar-launcher-hovered",
      "sidebar-launcher-expanded",
      "sidebar-panel-open",
      "sidebar-positionend",
      "sidebar-ongoing-animations",
    ],
  });

  const rootObserver = new MutationObserver(() => {
    remeasureSoon();
    sync();
  });
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: [
      "uc-overlay-off",
      "sidebar-expand-on-hover",
      "sidebar-positionend",
      "inFullscreen",
      "inDOMFullscreen",
      "fullscreenNavToolboxHidden",
      "uc-customize-open",
      "uc-hover-suppressed",
      "uidensity",
    ],
  });

  observeExpanded();

  let wasCustomizeOpen = root.hasAttribute("uc-customize-open");
  const customizeObserver = new MutationObserver(() => {
    const now = root.hasAttribute("uc-customize-open");
    if (wasCustomizeOpen && !now) {
      dbg("customize closed, forcing sync");
      setTimeout(sync, 50);
      setTimeout(sync, 300);
      setTimeout(sync, 600);
    }
    wasCustomizeOpen = now;
  });
  customizeObserver.observe(root, { attributes: true, attributeFilter: ["uc-customize-open"] });

  const tabboxResizeObserver = new ResizeObserver(() => {
    if (owned) measureRailBox();
  });
  tabboxResizeObserver.observe(tabbox);

  window.addEventListener("resize", () => {
    if (!owned) return;
    measureRailBox();
    remeasureSoon();
    applyGeometry(q);
  });

  window.addEventListener("unload", () => {
    tabboxObserver.disconnect();
    containerObserver.disconnect();
    rootObserver.disconnect();
    expandedObserver.disconnect();
    customizeObserver.disconnect();
    tabboxResizeObserver.disconnect();
    for (const pref of TOGGLE_PREFS) {
      try { Services.prefs.removeObserver(pref, toggleObserver); } catch (e) {}
    }
    clearTimeout(vtToggleTimer);
    try { Services.prefs.removeObserver(POS_PREF, sideObserver); } catch (e) {}
    disownGeometry();
  }, { once: true });

  function clamp(value) {
    return Math.min(1, Math.max(0, value));
  }

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      x = clamp(x);
      let t = x;
      for (let i = 0; i < 8; i++) {
        const dx = sampleX(t) - x;
        if (Math.abs(dx) < 1e-5) return sampleY(t);
        const d = sampleDX(t);
        if (Math.abs(d) < 1e-6) break;
        t -= dx / d;
      }
      let lo = 0;
      let hi = 1;
      t = x;
      while (lo < hi) {
        const xEst = sampleX(t);
        if (Math.abs(xEst - x) < 1e-5) break;
        if (x > xEst) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return sampleY(t);
    };
  }

  updateAnimationCache();
  sync();
})();