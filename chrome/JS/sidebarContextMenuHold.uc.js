// ==UserScript==
// @name           sidebarContextMenuHold.uc.js
// @description    Expand on hover: while a popup (context menu) is open, the rail keeps the width it had. Left or right rail.
//                 Firefox already ignores hover changes while a popup is open (SidebarController._isMenuPopupOpen), but the
//                 log showed that its own list of open popups was EMPTY while a context menu was showing, so the check
//                 never fired. This script keeps its own list and makes _isMenuPopupOpen() use it as well, which re-enables
//                 all of Firefox's own guards (onMouseEnter, onMouseLeave, the re-check after an animation or a popup).
//                 It also:
//                   - cancels an expand that was still waiting for its hover delay when a popup shows;
//                   - refuses _collapseLauncher() while a popup is open;
//                   - a sidebar PANEL (History, Bookmarks, Customize...) opened from the rail holds the rail exactly like a context
//                     menu does, and the pointer is re-checked when the panel closes;
//                   - HOVER IS SUPPRESSED WHILE THE CUSTOMIZE PANEL IS OPEN, AND FOR 300ms AFTER IT CLOSES.
//                     SidebarController.onMouseEnter and .onMouseLeave are wrapped so that, while the new
//                     uc-hover-suppressed attribute is set on :root, they do nothing: no [sidebar-launcher-hovered]
//                     is set, no expand is armed, css/12's hover-driven page push can't fire, push-settle is
//                     disowned (via the same attribute in its applies() check), and no new collapse is started.
//                     When CS closes, uc-hover-suppressed stays for CS_SETTLE_MS, then is cleared.
//                     2026-11-20: the cooldown now STARTS BEFORE uc-customize-open is removed (beginCsCooldown in syncCustomize),
//                     so sidebarPushSettle can never see "panel gone, hover not suppressed yet, stale hover still set".
//                     Also 2026-11-20: ANY panel (Customize included) now strips the stale expanded state the moment it opens
//                     (forceCollapsedState), so nothing expanded is left under the css/13 pins to leak out when they drop and push the page.
//                     The pointer is NOT reconciled with Firefox's own _reconcileHoverState() at that moment on
//                     purpose: that method bypasses railExpandTargets.uc.js's veto list, so a pointer left over
//                     the » chevron would expand the rail anyway and make the chevron unreachable. After
//                     suppression lifts, the next real mouse event (mouseenter or the mousemove handled by
//                     railExpandTargets) runs the normal path with the veto intact;
//                   - the » chevron at the bottom of the collapsed (50px) rail WORKS in expand-on-hover and holds the rail while its menu is
//                     open. Firefox's sidebar-main.mjs deliberately gives the chevron no click handler in expand-on-hover (hovering is
//                     meant to expand the rail instead) and doesn't fill its overflow menu there; this script opens the same menu
//                     (showOverflowMenu) after filling it with the tool buttons (createCopyButton), and a click first cancels an
//                     expand that was still waiting for its hover delay. The menu is a normal popup (#sidebar-tools-overflow), so
//                     the hold below covers it;
//                     In "Hide tabs and sidebar" Firefox opens the menu itself, but after a cold start its list can still be empty (the rail was
//                     hidden when it last rendered), so a click there only fills the list first and leaves the opening to Firefox;
//                   - publishes the panel's widths on #browser for css/13-sidebar-panel-cover.css:
//                       --uc-panel-w       the panel's CURRENT width (fed by a ResizeObserver)
//                       --uc-panel-base-w  the panel's NATURAL width, captured once when Customize opens; the fullscreen
//                                          cover rule in css/13 sizes the panel from this so the cover never feeds back
//                                          into the ResizeObserver that publishes --uc-panel-w.
//                     The rail's own widths (--uc-rail-flow-w / -keep-w / -visible-w) are still published for the
//                     non-Customize case, but for Customize they are PINNED to --uc-rail-collapsed (or to
//                     --uc-rail-expanded-w in always-show) by css/13, so the panel's margins resolve to constants
//                     while it is open;
//                   - marks the Customize panel open by setting uc-customize-open on :root (css/13 keys its pinned rail
//                     width and its fullscreen cover on that attribute), then clears it once the panel is really closed
//                     (after the fullscreen leave animation, if any);
//                   - remembers whether the launcher was visible before Customize opened and restores it on close, so
//                     closing Customize does not leave the rail visible in "Hide tabs and sidebar" mode (Firefox
//                     reveals the launcher after a side panel closes; we undo that only when the rail was hidden
//                     before CS opened);
//                   - fullscreen only: the panel slides in from its screen edge and slides back out (uc-panel-anim="in" /
//                     "out" on #sidebar-box, css/13, end of the file);
//                   - the numbers above are only measured once the sidebar PAGE has finished loading;
//                   - safety net: if the rail's "sidebar-ongoing-animations" attributes stay on with no animation running,
//                     they are cleared;
//                   - uc-sidebar-mode (mirrored onto :root from the sidebar.visibility pref, for css/13) is kept up to date
//                     by a Services.prefs observer, NOT by a polling setInterval (audit item 8).
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  const TAG = "sidebarContextMenuHold";
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[uc] ${TAG}: ${msg}`);
  };
  const hasFn = (obj, name, label, effect) => {
    if (obj && typeof obj[name] === "function") return true;
    warnOnce(`${label} is missing, ${effect}`);
    return false;
  };
  const poke = (obj, name, label, effect) => {
    if (!obj) return;
    if (typeof obj[name] === "function") obj[name]();
    else warnOnce(`${label} is missing, ${effect}`);
  };

  const sc = window.SidebarController;
  if (!sc) { warnOnce("SidebarController is missing, script not loaded"); return; }
  if (sc.__ucMenuHold) return;
  sc.__ucMenuHold = "2026-11-20a";   // bumped: forceCollapsedState on every panel open, cooldown started before uc-customize-open is removed

  const rootEl = document.documentElement;

  // ===== CHANGE 1: publishMode via pref observer instead of setInterval =====
  const publishMode = () => {
    let mode = sc.sidebarRevampVisibility || "";
    if (!mode) {
      try { mode = Services.prefs.getStringPref("sidebar.visibility", ""); } catch (e) {}
    }
    if (rootEl.getAttribute("uc-sidebar-mode") !== mode) {
      if (mode) rootEl.setAttribute("uc-sidebar-mode", mode);
      else rootEl.removeAttribute("uc-sidebar-mode");
    }
  };
  publishMode();

  // Update uc-sidebar-mode when sidebar.visibility changes. Firefox fires the observer immediately on
  // pref change; sc.sidebarRevampVisibility may lag by a frame in some Firefox builds, so defer one
  // frame with requestAnimationFrame to let its own state settle.
  const VISIBILITY_PREF = "sidebar.visibility";
  const publishPrefObserver = {
    observe() { requestAnimationFrame(publishMode); }
  };
  try {
    Services.prefs.addObserver(VISIBILITY_PREF, publishPrefObserver);
  } catch (e) {
    warnOnce(`could not observe ${VISIBILITY_PREF}, uc-sidebar-mode may not update live`);
  }
  // ===== end CHANGE 1 =====

  const cancelPendingExpand = () => {
    try {
      poke(sc.mouseEnterTask, "disarm", "mouseEnterTask.disarm", "a pending hover expand is no longer cancelled");
      poke(sc._mouseEnterDeferred, "resolve", "_mouseEnterDeferred.resolve", "a pending hover expand is no longer cancelled");
    } catch (e) {
      warnOnce(`cancelling a pending hover expand failed (${e && e.message})`);
    }
  };

  const tabbox = () => document.getElementById("tabbrowser-tabbox");

  const ours = new Set();
  const counts = (p) =>
    p && p.tagName !== "tooltip" && p.id !== "tab-preview-panel";
  const prune = () => {
    for (const p of ours) {
      if (p.state !== "open" && p.state !== "showing") ours.delete(p);
    }
  };

  let chevronHold = false;
  let chevronTimer = 0;
  const isMoreTools = (e) => (e.composedPath ? e.composedPath() : []).some((n) => n.classList && n.classList.contains("more-tools-button"));

  function fillOverflowList(rail) {
    const list = document.getElementById("tools-overflow-list");
    if (!list) { warnOnce("#tools-overflow-list is missing, » chevron menu disabled"); return false; }
    for (const name of ["getToolsAndExtensions", "getEntrypointValues", "createCopyButton"]) {
      if (!hasFn(rail, name, `sidebar-main.${name}`, "» chevron menu disabled")) return false;
    }
    list.replaceChildren();
    const actions = [...rail.getToolsAndExtensions().values(), ...(rail.bottomActions || [])];
    for (const action of actions) {
      if (!rail.getEntrypointValues(action)) continue;
      const copy = rail.createCopyButton(action.view);
      if (copy) list.appendChild(copy);
    }
    return list.childElementCount > 0;
  }

  const onChevronDown = (e) => {
    if (!isMoreTools(e)) return;
    cancelPendingExpand();
    chevronHold = true;
    clearInterval(chevronTimer);
    const t0 = performance.now();
    let quiet = 0;
    chevronTimer = setInterval(() => {
      quiet = ours.size > 0 ? 0 : quiet + 1;
      const age = performance.now() - t0;
      if ((age > 600 && quiet >= 3) || age > 120000) {
        clearInterval(chevronTimer);
        chevronHold = false;
        setTimeout(() => { reconcileHover(); }, 50);
      }
    }, 100);
  };

  const onChevronClick = (e) => {
    if (!isMoreTools(e)) return;
    const mode = sc.sidebarRevampVisibility;
    if (mode !== "expand-on-hover" && mode !== "hide-sidebar") return;
    const rail = sc.sidebarMain;
    if (!rail || rail.expanded) return;
    try {
      if (mode === "hide-sidebar") {
        // Firefox normally opens the menu itself here, but after a cold start
        // its own click handler can leave the menu closed even once the list
        // is filled (observed directly: listItems = 7, panel.state = "closed").
        //
        // The capture handler runs before Firefox's own click handler, so:
        //   1. fill the list first (so Firefox has something to open);
        //   2. schedule a follow-up for the next frame and do whatever
        //      Firefox didn't do: open the menu if the click was meant to
        //      open it and it's still closed; close it if the click was
        //      meant to close it and it's still open.
        // When Firefox's handler did its job, the panel's state already
        // matches what we would have done, so we skip: the menu can never
        // be opened or closed twice by this code.
        const list = document.getElementById("tools-overflow-list");
        if (list && list.childElementCount === 0) fillOverflowList(rail);
        const panel = document.getElementById("sidebar-tools-overflow");
        const wasClosed = !panel || panel.state === "closed";
        const anchorEvent = e;
        requestAnimationFrame(() => {
          if (!hasFn(rail, "showOverflowMenu", "sidebar-main.showOverflowMenu", "» chevron menu disabled")) return;
          const p = document.getElementById("sidebar-tools-overflow");
          try {
            if (wasClosed) {
              if (!p || p.state === "closed") rail.showOverflowMenu(anchorEvent);
            } else if (p && (p.state === "open" || p.state === "showing")) {
              p.hidePopup();
            }
          } catch (err) {
            warnOnce(`» chevron menu failed (${err && err.message}), disabled`);
          }
        });
        return;
      }
      if (!hasFn(rail, "showOverflowMenu", "sidebar-main.showOverflowMenu", "» chevron menu disabled")) return;
      if (fillOverflowList(rail)) rail.showOverflowMenu(e);
    } catch (err) {
      warnOnce(`» chevron menu failed (${err && err.message}), disabled`);
    }
  };
  window.addEventListener("pointerdown", onChevronDown, true);
  window.addEventListener("click", onChevronClick, true);

  const holdOpen = () => {
    prune();
    return ours.size > 0 || chevronHold || !!sc.isOpen || rootEl.hasAttribute("uc-hover-suppressed");
  };
  const origIsOpen = sc._isMenuPopupOpen;
  if (hasFn(sc, "_isMenuPopupOpen", "SidebarController._isMenuPopupOpen", "Firefox's own popup guards are no longer fed our list")) {
    sc._isMenuPopupOpen = function (...args) {
      return holdOpen() || origIsOpen.apply(this, args);
    };
  }
  const popupOpen = () => (typeof sc._isMenuPopupOpen === "function" ? sc._isMenuPopupOpen() : holdOpen());

  const reconcileHover = () => {
    const g = window.__ucRailGate;
    if (g) g.defer("reconcile", reconcileNow); else reconcileNow();
  };
  const reconcileNow = () => {
    if (sc.sidebarRevampVisibility !== "expand-on-hover") return;
    try {
      if (!popupOpen() && typeof sc._reconcileHoverState === "function") sc._reconcileHoverState();
    } catch (e) {
      warnOnce(`_reconcileHoverState failed (${e && e.message}), the pointer re-check is skipped`);
    }
  };

  const onShown = (e) => {
    const p = e.composedTarget;
    if (!counts(p)) return;
    ours.add(p);
    cancelPendingExpand();
  };
  const onHidden = (e) => {
    const p = e.composedTarget;
    if (!counts(p)) return;
    ours.delete(p);
    setTimeout(() => { reconcileHover(); }, 0);
  };
  document.addEventListener("popupshown", onShown, true);
  document.addEventListener("popuphidden", onHidden, true);

  const origEnter = sc.debouncedMouseEnter;
  if (hasFn(sc, "debouncedMouseEnter", "SidebarController.debouncedMouseEnter", "a pending hover expand is no longer cancelled when a popup opens")) {
    sc.debouncedMouseEnter = function (...args) {
      if (popupOpen()) {
        poke(this._mouseEnterDeferred, "resolve", "_mouseEnterDeferred.resolve", "a pending hover expand is no longer cancelled");
        return undefined;
      }
      return origEnter.apply(this, args);
    };
  }

  const origCollapse = sc._collapseLauncher;
  if (hasFn(sc, "_collapseLauncher", "SidebarController._collapseLauncher", "the rail is no longer held open while a popup is showing")) {
    sc._collapseLauncher = function (...args) {
      if (popupOpen()) {
        return undefined;
      }
      return origCollapse.apply(this, args);
    };
  }

  // ---- HOVER SUPPRESSION: no hover signals during CS, one settle window after CS closes ---------------
  const CS_SETTLE_MS = 300;
  let csSettleTimer = 0;
  const origMouseEnter = sc.onMouseEnter;
  const origMouseLeave = sc.onMouseLeave;

  if (hasFn(sc, "onMouseEnter", "SidebarController.onMouseEnter", "hover is not blocked while CS is open (page may expand without the rail)")) {
    sc.onMouseEnter = function (...args) {
      if (rootEl.hasAttribute("uc-hover-suppressed")) return undefined;
      return origMouseEnter.apply(this, args);
    };
  }

  if (hasFn(sc, "onMouseLeave", "SidebarController.onMouseLeave", "hover leave is not blocked while CS is open (rail may collapse under the panel)")) {
    sc.onMouseLeave = function (...args) {
      if (rootEl.hasAttribute("uc-hover-suppressed")) return undefined;
      return origMouseLeave.apply(this, args);
    };
  }

  // ---- One place that puts Firefox AND the theme into "collapsed, not hovered" ----
  // Used when a panel opens (so nothing stale is left to leak out at close) and as a backstop when the cooldown ends.
  // Cheap no-op when nothing is stale, so it may be called from every syncCustomize() pass.
  //
  // What goes stale: if the rail was hover-expanded when a panel opened, Firefox keeps
  //   [sidebar-launcher-hovered] on #tabbrowser-tabbox, [sidebar-launcher-expanded] on #sidebar-container,
  //   [expanded] on #tabbrowser-tabs and sidebar-main, and _state.launcherExpanded = true,
  // because mouseleave is suppressed while the panel is open. css/13's pins only HIDE that (the rail looks collapsed);
  // when they drop at close, Firefox's expanded layout and slide push the page. Clearing it at open avoids that.
  function forceCollapsedState() {
    if (!rootEl.hasAttribute("sidebar-expand-on-hover")) return;
    try {
      const tabboxEl = tabbox();
      const container = sc.sidebarContainer || document.getElementById("sidebar-container");
      const tabsEl = document.getElementById("tabbrowser-tabs");
      const smEl = sc.sidebarMain || document.querySelector("sidebar-main");
      const stale =
        (tabboxEl && tabboxEl.hasAttribute("sidebar-launcher-hovered")) ||
        (container && container.hasAttribute("sidebar-launcher-expanded")) ||
        (tabsEl && tabsEl.hasAttribute("expanded")) ||
        (smEl && smEl.hasAttribute("expanded")) ||
        (sc._state && sc._state.launcherExpanded);
      if (!stale) return;

      cancelPendingExpand();
      if (tabboxEl) tabboxEl.removeAttribute("sidebar-launcher-hovered");
      try { if (sc._state && sc._state.launcherExpanded) sc._state.launcherExpanded = false; } catch (e) { /* read-only in a future Firefox: the DOM clear below still helps */ }
      if (container) container.removeAttribute("sidebar-launcher-expanded");
      if (tabsEl) tabsEl.removeAttribute("expanded");
      if (smEl) smEl.removeAttribute("expanded");

      // Firefox starts its own collapse animation when the state flips; finish it now so it cannot move the page afterwards
      for (const el of [container, smEl, tabboxEl]) {
        if (!el || !el.getAnimations) continue;
        for (const a of el.getAnimations()) {
          try { a.finish(); } catch (e) { try { a.cancel(); } catch (e2) {} }
        }
      }
    } catch (e) {
      warnOnce(`could not collapse the stale rail state (${e && e.message})`);
    }
  }

  // Cooldown after a panel closes. Idempotent: syncCustomize() starts it BEFORE it removes uc-customize-open, so
  // sidebarPushSettle can never see "panel gone, hover not suppressed yet, stale hover still set" (that was an
  // observer-order race: it re-owned the geometry from the EXPANDED width). The observer below is only a backstop.
  const beginCsCooldown = () => {
    if (rootEl.hasAttribute("uc-hover-suppressed") && csSettleTimer) return;
    rootEl.setAttribute("uc-hover-suppressed", "");
    clearTimeout(csSettleTimer);
    csSettleTimer = setTimeout(() => {
      csSettleTimer = 0;
      rootEl.removeAttribute("uc-hover-suppressed");
      forceCollapsedState();
    }, CS_SETTLE_MS);
  };

  let wasCsOpen = rootEl.hasAttribute("uc-customize-open");
  const csHoverObserver = new MutationObserver(() => {
    const isOpen = rootEl.hasAttribute("uc-customize-open");
    if (wasCsOpen && !isOpen) beginCsCooldown();
    wasCsOpen = isOpen;
  });
  csHoverObserver.observe(rootEl, { attributes: true, attributeFilter: ["uc-customize-open"] });

  const panelBox = sc._box || document.getElementById("sidebar-box");
  let panelObserver = null;
  if (panelBox) {
    panelObserver = new MutationObserver(() => {
      if (!panelBox.hidden) return;
      setTimeout(() => { reconcileHover(); }, 50);
    });
    panelObserver.observe(panelBox, { attributes: true, attributeFilter: ["hidden"] });
  }

  const PANEL_ANIM = "uc-panel-anim";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let panelAnimTimer = 0;
  const inFullscreen = () => rootEl.hasAttribute("inFullscreen") && !rootEl.hasAttribute("inDOMFullscreen");

  function endPanelAnim() {
    clearTimeout(panelAnimTimer);
    if (!panelBox || !panelBox.hasAttribute(PANEL_ANIM)) return;
    panelBox.removeAttribute(PANEL_ANIM);
    syncCustomize();
  }

  function startPanelAnim(kind) {
    if (!inFullscreen() || reducedMotion.matches || document.readyState !== "complete") return false;
    panelBox.setAttribute(PANEL_ANIM, kind);
    clearTimeout(panelAnimTimer);
    panelAnimTimer = setTimeout(endPanelAnim, 700);
    return true;
  }

  const onPanelAnimEnd = (e) => {
    if (e.target === panelBox && String(e.animationName).startsWith("uc-panel-")) endPanelAnim();
  };
  let panelAnimObserver = null;
  if (panelBox) {
    panelBox.addEventListener("animationend", onPanelAnimEnd);
    panelBox.addEventListener("animationcancel", onPanelAnimEnd);
    panelAnimObserver = new MutationObserver((list) => {
      for (const m of list) {
        if (m.attributeName !== "hidden") continue;
        const wasHidden = m.oldValue !== null;
        if (wasHidden === panelBox.hidden) continue;
        if (!startPanelAnim(panelBox.hidden ? "out" : "in")) endPanelAnim();
      }
    });
    panelAnimObserver.observe(panelBox, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
  }

  const browserEl = document.getElementById("browser");
  const CUSTOMIZE = "viewCustomizeSidebar";
  let collapsedW = 0;

  const customizeOpen = () =>
    !!panelBox && !panelBox.hidden && (panelBox.getAttribute("sidebarcommand") === CUSTOMIZE || sc.currentID === CUSTOMIZE);

  let preCustomizeLauncherVisible = null;

  const setWidth = (name, px) => {
    const cur = parseFloat(browserEl.style.getPropertyValue(name));
    if (Number.isFinite(cur) && Math.abs(cur - px) <= 1) return;
    browserEl.style.setProperty(name, px + "px");
  };

  const sidebarLoading = () => {
    try {
      const doc = sc.browser && sc.browser.contentDocument;
      return !!doc && doc.readyState === "loading";
    } catch (e) {
      return false;
    }
  };
  let sidebarWaitTimer = 0;
  let sidebarWaits = 0;

  let panelW = 0;
  let containerW = 0;
  const publish = () => {
    const g = window.__ucRailGate;
    if (g) g.defer("publish", publishNow); else publishNow();
  };
  const publishNow = () => {
    const c = sc.sidebarContainer;
    if (!browserEl || !c) return;
    if (document.readyState !== "complete") return;
    if (panelBox && !panelBox.hidden && panelW > 0) {
      browserEl.style.setProperty("--uc-panel-w", panelW + "px");
    }
    const ongoing = sc._ongoingAnimations;
    if (ongoing != null && (!Array.isArray(ongoing) || ongoing.some((a) => a && a.playState === "running"))) return;
    if (sidebarLoading() && sidebarWaits < 40) {
      if (!sidebarWaitTimer) {
        sidebarWaitTimer = setTimeout(() => { sidebarWaitTimer = 0; sidebarWaits++; publish(); }, 150);
      }
      return;
    }
    sidebarWaits = 0;
    const pos = getComputedStyle(c).position;
    const inLayout = pos !== "absolute" && pos !== "fixed";
    const w = c.hidden ? 0 : containerW;
    const flow = inLayout ? w : 0;
    if (inLayout && w > 0 && w < 100 && !c.hasAttribute("sidebar-launcher-expanded")) {
      collapsedW = w;
    }
    setWidth("--uc-rail-flow-w", flow);
    setWidth("--uc-rail-keep-w", inLayout ? w : collapsedW);
    setWidth("--uc-rail-visible-w", w);
  };

  const sizeObserver = new ResizeObserver((entries) => {
    for (const e of entries || []) {
      const w = e.borderBoxSize && e.borderBoxSize[0] ? e.borderBoxSize[0].inlineSize : e.contentRect.width;
      if (e.target === sc.sidebarContainer) containerW = Math.round(w);
      else if (e.target === panelBox && w > 0) panelW = Math.round(w);
    }
    if (!rootEl.hasAttribute("uc-customize-open") && customizeOpen() && panelW > 0) {
      syncCustomize();
    }
    publish();
  });
  if (sc.sidebarContainer) sizeObserver.observe(sc.sidebarContainer);
  if (panelBox) sizeObserver.observe(panelBox);
  const stateObserver = new MutationObserver(publish);
  if (sc.sidebarContainer) stateObserver.observe(sc.sidebarContainer, { attributes: true, attributeFilter: ["sidebar-launcher-expanded", "hidden"] });
  if (panelBox) stateObserver.observe(panelBox, { attributes: true, attributeFilter: ["hidden"] });
  if (document.readyState === "complete") publish();
  else window.addEventListener("load", () => publish(), { once: true });

  // ===== CHANGE 2: syncCustomize (panel / Customize state on :root) =====
  function syncCustomize() {
    // Any panel (not just CS) may be opening or closing. Update the generic
    // [uc-panel-open] attribute on :root so CSS/13 can apply the same rail-collapse
    // pins to ALL panels.
    const isAnyPanelOpen = !!panelBox && !panelBox.hidden;
    if (rootEl.hasAttribute("uc-panel-open") !== isAnyPanelOpen) {
      rootEl.toggleAttribute("uc-panel-open", isAnyPanelOpen);
    }

    // Any panel, Customize included, collapses the stale expanded state as soon as it opens.
    // The CSS in 13 pins the container / sidebar-main / tab strip to the collapsed width, but dozens of theme
    // and Firefox rules key on [expanded] / [sidebar-launcher-expanded] for the VISUAL mode (tile layout,
    // favicon gap, label visibility, button sizing). Stripping them makes Firefox and the theme render in TRUE
    // collapsed mode. It used to skip Customize, so the expanded state lived on under the 13 pins and leaked
    // out when they dropped at close, pushing the page.
    // Restoration for non-CS panels on close is handled by the panel-hidden observer, which calls
    // reconcileHover() -> _reconcileHoverState(), and that re-sets [expanded] from the pointer's position.
    // Only expand-on-hover needs this (forceCollapsedState returns at once in the other modes).
    if (isAnyPanelOpen) forceCollapsedState();

    if (customizeOpen()) {
      if (!rootEl.hasAttribute("uc-customize-open")) {
        if (!panelBox) return;
        const pw = panelW || Math.round(panelBox.getBoundingClientRect().width);
        if (!(pw > 0)) return;
        panelW = pw;
        if (sc._state && typeof sc._state.launcherVisible === "boolean") {
          preCustomizeLauncherVisible = sc._state.launcherVisible;
        }
        browserEl.style.setProperty("--uc-panel-w", pw + "px");
        browserEl.style.setProperty("--uc-panel-base-w", pw + "px");
        rootEl.setAttribute("uc-customize-open", "");
      } else if (panelBox) {
        const pw = Math.round(panelBox.getBoundingClientRect().width);
        if (pw > 0) {
          panelW = pw;
          browserEl.style.setProperty("--uc-panel-w", pw + "px");
        }
      }
    } else if (rootEl.hasAttribute("uc-customize-open")) {
      if (panelBox && panelBox.getAttribute(PANEL_ANIM) === "out") return;
      beginCsCooldown();                                   // BEFORE uc-customize-open goes away: no window where push-settle can re-own from stale hover
      rootEl.removeAttribute("uc-customize-open");
      browserEl.style.removeProperty("--uc-panel-base-w");

      if (sc.sidebarRevampVisibility === "hide-sidebar" && preCustomizeLauncherVisible === false && sc._state) {
        setTimeout(() => {
          try {
            // FF 160: launcherVisible is derived (getter only); in hide-sidebar the user's choice is userLauncherVisible
            if (sc._state && "userLauncherVisible" in sc._state) sc._state.userLauncherVisible = false;
            else if (sc._state) sc._state.launcherVisible = false;
          } catch (e) {
            warnOnce(`could not re-hide the rail after Customize closed (${e && e.message})`);
          }
        }, 250);
      }
      preCustomizeLauncherVisible = null;
    }
  }
  // ===== end CHANGE 2 =====

  let customizeObserver = null;
  if (panelBox) {
    customizeObserver = new MutationObserver(syncCustomize);
    customizeObserver.observe(panelBox, { attributes: true, attributeFilter: ["hidden", "sidebarcommand"] });
    panelBox.addEventListener("sidebar-show", syncCustomize);
    panelBox.addEventListener("sidebar-hide", syncCustomize);
    syncCustomize();
  }

  const ATTR = "sidebar-ongoing-animations";
  let watch = 0;
  const running = () => {
    const list = sc._ongoingAnimations;
    if (list == null) return false;
    if (!Array.isArray(list)) {
      warnOnce("SidebarController._ongoingAnimations is not an array, the stuck-attribute check falls back to a timeout");
      return true;
    }
    return list.some((a) => a && a.playState === "running");
  };

  function clearStuck() {
    const els = [sc.sidebarContainer, sc._box, sc._splitter, tabbox()];
    for (const el of els) {
      if (!el) continue;
      el.style.minWidth = el.style.maxWidth = el.style.marginLeft = el.style.marginRight = el.style.display = "";
    }
    for (const el of [sc.sidebarContainer, sc._box, tabbox(), sc.sidebarMain]) {
      if (el) el.removeAttribute(ATTR);
    }
  }

  function arm() {
    clearTimeout(watch);
    let waited = 0;
    const check = () => {
      const t = tabbox();
      if (!t || !t.hasAttribute(ATTR)) return;
      waited += 500;
      if (!running() || waited >= 4000) clearStuck();
      else watch = setTimeout(check, 500);
    };
    watch = setTimeout(check, 900);
  }

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.attributeName === ATTR) {
        if (m.target.hasAttribute(ATTR)) arm();
        else publish();
      }
    }
  });
  const box = sc.sidebarContainer;
  if (box) mo.observe(box, { attributes: true, attributeFilter: ["sidebar-launcher-expanded"] });
  if (tabbox()) mo.observe(tabbox(), { attributes: true, attributeFilter: [ATTR] });

  const audit = () => {
    for (const name of ["isOpen", "sidebarRevampVisibility", "sidebarContainer", "sidebarMain"]) {
      if (!(name in sc)) warnOnce(`SidebarController.${name} is missing, the parts that read it stop working`);
    }
    hasFn(sc, "_reconcileHoverState", "SidebarController._reconcileHoverState", "the pointer re-check after a popup closes is skipped");
  };
  if (document.readyState === "complete") setTimeout(audit, 3000);
  else window.addEventListener("load", () => setTimeout(audit, 3000), { once: true });

  window.addEventListener("unload", () => {
    window.removeEventListener("pointerdown", onChevronDown, true);
    window.removeEventListener("click", onChevronClick, true);
    clearInterval(chevronTimer);
    // ===== CHANGE 3: teardown for the pref observer replaces clearInterval(modeTimer) =====
    try { Services.prefs.removeObserver(VISIBILITY_PREF, publishPrefObserver); } catch (e) {}
    // ===== end CHANGE 3 =====
    document.removeEventListener("popupshown", onShown, true);
    document.removeEventListener("popuphidden", onHidden, true);
    mo.disconnect();
    if (panelObserver) panelObserver.disconnect();
    if (panelAnimObserver) panelAnimObserver.disconnect();
    csHoverObserver.disconnect();
    clearTimeout(csSettleTimer);
    clearTimeout(panelAnimTimer);
    clearTimeout(sidebarWaitTimer);
    if (customizeObserver) customizeObserver.disconnect();
    sizeObserver.disconnect();
    stateObserver.disconnect();
    clearTimeout(watch);
  }, { once: true });
})();