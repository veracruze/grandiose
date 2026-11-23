// ==UserScript==
// @name           sidebarRailHold.uc.js
// @description    Expand-on-hover: sets uc-rail-hold on :root ("enter") so css/07 (§18 rule 3, the HOLD block) can fade the rail's
//                 button row and the » chevron out BEFORE Firefox expands the rail, and hide them at once when Firefox swaps the button column for
//                 the squeezed row, so that swap is never drawn. It reads Firefox's own hover-delay pref to time the early fade, and releases the
//                 hold once the view-transition / slide has ended (FF160 uses view transitions, not sidebar-ongoing-animations).
//
//                 THE » CHEVRON (shadow boundary): the rail's button row (.buttons-wrapper) is styled by plain CSS in css/07 (a user sheet such as
//                 userChrome.css does match .buttons-wrapper inside the shadow tree). The » chevron is the exception. Its fade was meant to be a rule on
//                 `.more-tools-button::part(button)`, and ::part() does NOT cross the shadow boundary from a user sheet, so that one rule (and its keyframes)
//                 is adopted into sidebar-main's own shadow root from here. On Firefox 160 even that does not match (measured: the inner <button> has no
//                 part="button"), so the visible fade is driven from JS: fadeChevron() runs Element.animate() on the inner <button>, following [uc-rail-hold]
//                 (set = fade out, removed = fade in), with the same uc.railHold.chevron* timings. The adopted sheet stays as the fallback in case a Firefox
//                 exposes the part again.
//
//                 CUSTOMIZE (2026-11-20, header corrected 2026-11-21): the » chevron is not CSS at all — it is populated by sidebar-main's own
//                 IntersectionObserver, which only runs while its expanded property is false (see "How the » chevron works" in shadow-dom-dependencies.md).
//                 If Customize opened while the rail was hover-expanded, sidebar-main[expanded] used to linger: the button row stayed in its expanded layout
//                 clipped to 50px and nothing was ever moved into the chevron, during Customize AND after closing. Two scripts now deal with it.
//                 sidebarContextMenuHold (marker 2026-11-20a) strips the stale expanded state on EVERY panel open, Customize included (forceCollapsedState():
//                 the container, #tabbrowser-tabs and sidebar-main, expand-on-hover only), and starts its 300 ms cooldown before uc-customize-open is removed.
//                 This script's strip is therefore partly redundant; it still adds what that one does not: the button row is held hidden for the layout swap
//                 (CS_SWAP_MS) and then fades back in, sidebar-main[expanded] is stripped again if Firefox re-adds it while Customize is open, and when
//                 Customize (and the cooldown's uc-hover-suppressed) are gone a still-hovering pointer is nudged with synthetic pointer/mouse events so the
//                 rail re-expands instead of waiting for a wiggle.
//
//                 TIMING (2026-11-09d): every visible fade duration and scheduling constant is behind a pref under uc.railHold.*, read at
//                 startup and re-read whenever one changes (no restart). The CSS variables are written onto sidebar-main from applyTiming(), so
//                 changing the pref updates the visible animation live. The scheduling constant `effectiveFadeOutMs` is COMPUTED from those prefs
//                 (the longest of the two visible fade-out times + its delay), so it can never drift from what the CSS is actually doing. Any pref
//                 left unset falls back to the constant below. Tunables:
//                   uc.railHold.chevronFadeOutMs   (180)  how long the » chevron takes to fade OUT (visible)
//                   uc.railHold.chevronFadeInMs    (60)   how long the » chevron takes to fade IN  (visible)
//                   uc.railHold.chevronDelayOutMs  (0)    delay before the » chevron starts fading out
//                   uc.railHold.chevronDelayInMs   (0)    delay before the » chevron starts fading in (added to --uc-rail-buttons-settle)
//                   uc.railHold.buttonsFadeOutMs   (0)    how long the button ROW takes to fade OUT (visible)
//                   uc.railHold.buttonsFadeInMs    (140)  how long the button ROW takes to fade IN  (visible)
//                   uc.railHold.buttonsSettleMs    (10)   wait after the slide before the row starts fading in (prevents pulsing)
//                   uc.railHold.preFadeLeadMs      (40)   extra buffer before the JS-armed pre-fade fires
//                   uc.railHold.releaseDelayMs     (10)   how long after the slide before the hold is released
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  // ---- every tunable, in one place ---------------------------------------------------------------
  // Pref names live under uc.railHold.*. If a pref is unset, the constant on the right is used.
  const DEFAULTS = {
    chevronFadeOutMs:  180,
    chevronFadeInMs:   60,
    chevronDelayOutMs: 0,
    chevronDelayInMs:  0,
    buttonsFadeOutMs:  0,
    buttonsFadeInMs:   140,
    buttonsSettleMs:   10,
    preFadeLeadMs:     40,
    releaseDelayMs:    10,
  };
  const PREF_BASE = "uc.railHold.";
  const readMs = (key) => {
    try {
      const v = Services.prefs.getIntPref(PREF_BASE + key, -1);
      return Number.isFinite(v) && v >= 0 ? v : DEFAULTS[key];
    } catch (e) { return DEFAULTS[key]; }
  };

  // Timing values that the scheduling logic uses. Recomputed on every applyTiming() call.
  //   effectiveFadeOutMs = the longest of the two visible fade-out times (chevron + its delay, or buttons).
  //     The pre-fade must fire at least this long before Firefox's slide, or the fade is cut mid-way.
  //     (2026-11-20: chevronDelayOutMs is part of the visible fade-out window, so it is counted here —
  //      the old formula ignored it and could schedule the pre-fade inside the chevron's delay.)
  let timings = { ...DEFAULTS, effectiveFadeOutMs: Math.max(DEFAULTS.chevronFadeOutMs + DEFAULTS.chevronDelayOutMs, DEFAULTS.buttonsFadeOutMs) };
  const readAllTimings = () => {
    const t = {
      chevronFadeOutMs:  readMs("chevronFadeOutMs"),
      chevronFadeInMs:   readMs("chevronFadeInMs"),
      chevronDelayOutMs: readMs("chevronDelayOutMs"),
      chevronDelayInMs:  readMs("chevronDelayInMs"),
      buttonsFadeOutMs:  readMs("buttonsFadeOutMs"),
      buttonsFadeInMs:   readMs("buttonsFadeInMs"),
      buttonsSettleMs:   readMs("buttonsSettleMs"),
      preFadeLeadMs:     readMs("preFadeLeadMs"),
      releaseDelayMs:    readMs("releaseDelayMs"),
    };
    t.effectiveFadeOutMs = Math.max(t.chevronFadeOutMs + t.chevronDelayOutMs, t.buttonsFadeOutMs);
    return t;
  };

  // FIREFOX 160 empirically starts the expand VT ~220 ms before the hover-delay pref value elapses.
  // This extra buffer keeps the fade-out completing before the VT starts. It is a constant
  // (not a pref) because it describes a Firefox behaviour, not a user preference. Tune via
  // uc.railHold.preFadeLeadMs on top of this if the visible lead looks wrong.
  const PRE_FADE_SAFETY_MS = 250;

  // ---- chevron stylesheet (the ONLY place the ::part() rule lives) --------------------------------
  // Reads the --uc-rail-* variables. applyTiming() writes those variables onto sidebar-main, so a pref
  // change shows up here on the next frame — no restart, no stylesheet rebuild.
  const CHEVRON_CSS = `
    @keyframes uc-chevron-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes uc-chevron-out { from { opacity: 1; } to { opacity: 0; } }
    .more-tools-button::part(button) {
      animation-name: var(--uc-rail-chevron-anim-name, uc-chevron-in) !important;
      animation-duration: var(--uc-rail-chevron-anim-duration, 60ms) !important;
      animation-delay: var(--uc-rail-chevron-anim-delay, 0s) !important;
      animation-timing-function: var(--uc-rail-chevron-anim-ease, ease-out) !important;
      animation-fill-mode: both !important;
      animation-iteration-count: 1 !important;
      animation-direction: normal !important;
      animation-play-state: running !important;
    }
  `;
  let chevronSheet = null;
  function applyChevronStyles() {
    const rail = document.querySelector("sidebar-main");
    const root = rail && rail.shadowRoot;
    if (!root) return false;
    if (!root.__ucRailChevron) {
      if (!chevronSheet) {
        chevronSheet = new CSSStyleSheet();
        chevronSheet.replaceSync(CHEVRON_CSS);
      }
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, chevronSheet];
      root.__ucRailChevron = true;
    }
    return true;
  }

  // ---- write the timings as CSS variables on sidebar-main ----------------------------------------
  // These override the same-named declarations in 07-split-glows-density.css (:root[sidebar-expand-on-hover]
  // sidebar-main { ... }) because they are set on the same element with the same-or-greater specificity
  // (inline style beats stylesheet). They inherit into the shadow root where the ::part() rule lives.
  function applyTiming() {
    const rail = document.querySelector("sidebar-main");
    if (!rail) return;
    timings = readAllTimings();
    const s = rail.style;
    s.setProperty("--uc-rail-buttons-fade-out", timings.buttonsFadeOutMs + "ms");
    s.setProperty("--uc-rail-buttons-fade-in",  timings.buttonsFadeInMs  + "ms");
    s.setProperty("--uc-rail-buttons-settle",   timings.buttonsSettleMs   + "ms");
    // The chevron's fade-out / fade-in durations and delays are chosen by the sliding / at-rest rules
    // in 07 via --uc-rail-chevron-anim-*. Those rules set anim-name / anim-duration / anim-delay, and
    // 07's two state rules override them (fade-out while sliding, fade-in at rest). So the timing
    // prefs need to be pushed into those two state rules, not into a single flat set here.
    // The simplest reliable path is: replace the two state rules' variable declarations by writing
    // the anim-duration and anim-delay from the actual pref values, using the same names the rules
    // consume. 07 defines:
    //   at rest:   --uc-rail-chevron-anim-duration: var(--uc-rail-chevron-fade-in, 220ms)
    //              --uc-rail-chevron-anim-delay:    calc(var(--uc-rail-buttons-settle, 160ms) + var(--uc-rail-chevron-delay-in, 0ms))
    //   sliding:   --uc-rail-chevron-anim-duration: var(--uc-rail-chevron-fade-out, 180ms)
    //              --uc-rail-chevron-anim-delay:    var(--uc-rail-chevron-delay-out, 0ms)
    // Writing the underlying fades + delays is what feeds those. Because the anim-* rules in 07 read
    // them with var(...), a pref change here takes effect immediately, and the state rules (sliding vs
    // at rest) keep deciding WHICH fade plays — only its duration / delay is ours.
    s.setProperty("--uc-rail-chevron-fade-out", timings.chevronFadeOutMs + "ms");
    s.setProperty("--uc-rail-chevron-fade-in",  timings.chevronFadeInMs  + "ms");
    s.setProperty("--uc-rail-chevron-delay-out", timings.chevronDelayOutMs + "ms");
    s.setProperty("--uc-rail-chevron-delay-in",  timings.chevronDelayInMs  + "ms");
  }

  // ---- constants & helpers -----------------------------------------------------------------------
  const HOVER_DELAY_PREF = "sidebar.animation.expand-on-hover.delay-duration-ms";
  const HOVER_DELAY_OVERRIDE = 0;
  const HOVER_DELAY_EXTRA = 0;
  const EXPAND_RELEASE_TIMEOUT = 700;   // once the rail has expanded: look for the end of the slide after this long even if no attribute change tells us
  const COLLAPSE_FAILSAFE_TIMEOUT = 800;
  const POLL_MS = 50;
  const POLL_MAX = 60;
  const DEBUG = false;
  const dbg = (msg) => {
    if (DEBUG) console.log(`[uc] railHold ${Math.round(performance.now())}ms ${msg} | hold=${document.documentElement.getAttribute("uc-rail-hold") || "-"} sliding=${isSliding()}`);
  };

  const html = document.documentElement;

  const getRail = () => document.querySelector("#sidebar-main") || document.querySelector("sidebar-main");
  const getTabs = () => document.querySelector("#tabbrowser-tabs");

  const isSuppressed = () =>
    html.hasAttribute("uc-customize-open") || html.hasAttribute("uc-hover-suppressed");

  // FIREFOX 160: Firefox no longer sets sidebar-ongoing-animations on #tabbrowser-tabbox (and SidebarController._ongoingAnimations is gone):
  // the rail slide is now a view transition. Waiting only for that attribute meant the hold was never released while the rail stayed open,
  // so the button row stayed at opacity 0 until the rail had collapsed again. "Sliding" is now any of:
  //   - the attribute (Firefox 159 and older),
  //   - uc-push-moving on :root (sidebarPushSettle.uc.js animating the page and rail, Overlay mode Off),
  //   - an active view transition (Firefox 160+, also covers Overlay mode On and fullscreen).
  const isSliding = () =>
    !!document.querySelector("#tabbrowser-tabbox[sidebar-ongoing-animations]") ||
    html.hasAttribute("uc-push-moving") ||
    !!document.activeViewTransition;

  const getHoverDelay = () => {
    if (HOVER_DELAY_OVERRIDE > 0) return HOVER_DELAY_OVERRIDE;
    try {
      const ms = Services.prefs.getIntPref(HOVER_DELAY_PREF, 0);
      return ms > 0 ? ms + HOVER_DELAY_EXTRA : 0;
    } catch (e) { return 0; }
  };

  let releaseTimer = null, failTimer = null, preTimer = null;
  let inside = false, wasExpanded = false, mouseenterAt = 0;

  // ---- FF160: hook startViewTransition so release fires when the VT finishes ---------------------
  // Firefox 160 uses view transitions for sidebar animations and no longer sets sidebar-ongoing-animations
  // on #tabbrowser-tabbox. In Overlay mode ON, neither slideObserver nor uc-push-moving fires, so release
  // was waiting for the failsafe. Hook startViewTransition's .finished promise so we release as soon as
  // the transition actually ends.
  if (typeof document.startViewTransition === "function" && !document.__ucVtReleaseHook) {
    document.__ucVtReleaseHook = true;
    const _origSV = document.startViewTransition.bind(document);
    document.startViewTransition = function (cb) {
      const t = _origSV(cb);
      if (t && t.finished) {
        t.finished.then(() => {
          if (!html.hasAttribute("uc-rail-hold")) return;
          setTimeout(() => {
            if (!isSliding() && html.hasAttribute("uc-rail-hold")) {
              release();
            }
          }, 20);
        }).catch(() => {});
      }
      return t;
    };
  }

  // Customize opened over a hover-expanded rail: the row is held hidden for this long while sidebar-main swaps from its expanded to its
  // collapsed layout, then released so the row and the » chevron FADE IN. Every release path (failsafe, view-transition end, slideObserver,
  // the suppression observer) goes through release(), which waits this window out.
  const CS_SWAP_MS = 220;
  let csHoldUntil = 0, csHoldTimer = 0;

  function release(tries = 0) {
    clearTimeout(releaseTimer);
    if (!html.hasAttribute("uc-rail-hold")) return;   // already released — nothing to do (also cancels the failsafe cascade)
    const csWait = csHoldUntil - performance.now();
    if (csWait > 0) {                                  // Customize swap in progress: come back when it is over
      releaseTimer = setTimeout(() => release(tries), csWait + 5);
      return;
    }
    if (isSliding() && tries < POLL_MAX) {
      releaseTimer = setTimeout(() => release(tries + 1), POLL_MS);
      return;
    }
    clearTimeout(failTimer);                          // cancel any pending failsafe
    dbg("release: scheduled");
    releaseTimer = setTimeout(() => {
      if (isSliding() && tries < POLL_MAX) { release(tries + 1); return; }
      html.removeAttribute("uc-rail-hold");
      dbg("released");
    }, timings.releaseDelayMs);
  }

  function hold(kind, failsafe) {
    if (!html.hasAttribute("sidebar-expand-on-hover")) return;
    clearTimeout(releaseTimer);
    clearTimeout(failTimer);
    html.setAttribute("uc-rail-hold", kind);
    dbg(`hold ${kind}, failsafe ${failsafe}ms`);
    failTimer = setTimeout(release, failsafe);
  }

  // ---- watchRail: pre-fade on expand AND on collapse ---------------------------------------------
  function watchRail() {
    const rail = getRail();
    if (!rail || rail.__ucRailHold) return;
    rail.__ucRailHold = true;

    rail.addEventListener("mouseenter", () => {
      if (isSuppressed()) return;
      // Cancel a pre-fade hold set by a mouseleave that didn't lead to a collapse
      // (the user came right back). Without this, buttons would stay hidden while
      // the rail is still expanded.
      if (html.getAttribute("uc-rail-hold") === "enter" && !isSliding() && rail.hasAttribute("expanded")) {
        release();
      }
      inside = true;
      mouseenterAt = performance.now();
      if (rail.hasAttribute("expanded")) return;

      // PRE-FADE ON EXPAND. Firefox expands after `hoverDelay` ms; arming the hold at
      // hover-delay − fadeOut − lead makes the button row and » chevron fully faded
      // BEFORE the rail starts sliding. FF160 starts the expand VT ~220 ms before the
      // pref value elapses, hence the extra constant PRE_FADE_SAFETY_MS on top of the
      // user-tunable preFadeLeadMs. (This whole block was missing from the old file —
      // it only had a "...existing pre-fade-on-expand logic..." stub and never pre-faded.)
      const hoverDelay = getHoverDelay();
      if (hoverDelay <= 0) return;
      const fireAt = Math.max(0, hoverDelay - timings.effectiveFadeOutMs - timings.preFadeLeadMs - PRE_FADE_SAFETY_MS);
      clearTimeout(preTimer);
      preTimer = setTimeout(() => {
        if (isSuppressed() || !inside) return;
        if (rail.hasAttribute("expanded") || isSliding()) return;
        hold("enter", EXPAND_RELEASE_TIMEOUT);
        dbg(`pre-fade on expand (delay ${hoverDelay}, lead ${timings.preFadeLeadMs}, fadeOut ${timings.effectiveFadeOutMs}, elapsed ${Math.round(performance.now() - mouseenterAt)})`);
      }, fireAt);
    });

    rail.addEventListener("mouseleave", () => {
      inside = false;
      clearTimeout(preTimer);
      if (isSuppressed()) return;

      // PRE-FADE ON COLLAPSE. On FF160 the [expanded] removal fires late (end of the view
      // transition), so the buttons would stay visible until the rail had already shrunk.
      // Start the fade the moment the pointer leaves an expanded rail. Long failsafe —
      // the slide is ~400 ms, so a short one releases mid-slide. (Old file used the
      // 250 ms idle failsafe here, which released the hold before the collapse finished.)
      if (rail.hasAttribute("expanded") && !html.hasAttribute("uc-rail-hold")) {
        hold("enter", COLLAPSE_FAILSAFE_TIMEOUT);
      }
      if (html.getAttribute("uc-rail-hold") === "enter" && !rail.hasAttribute("expanded")) {
        release();
      }
    });
  }

  // ---- watchTabs: track the expanded state across every carrier Firefox uses ----------------------
  function watchTabs() {
    const tabs = getTabs();
    if (!tabs || tabs.__ucRailHold) return;
    tabs.__ucRailHold = true;
    wasExpanded = tabs.hasAttribute("expanded");
    new MutationObserver(() => {
      const now = tabs.hasAttribute("expanded");
      if (isSuppressed()) {
        wasExpanded = now;
        clearTimeout(preTimer);
        return;
      }
      if (now === wasExpanded) return;
      wasExpanded = now;
      clearTimeout(preTimer);
      if (now) {
        if (html.getAttribute("uc-rail-hold") !== "enter") {
          hold("enter", EXPAND_RELEASE_TIMEOUT);
        } else {
          // the pre-fade already set the hold (armed with the long failsafe): the rail is open now, so shorten it
          clearTimeout(failTimer);
          failTimer = setTimeout(release, EXPAND_RELEASE_TIMEOUT);
        }
      } else {
        hold("enter", COLLAPSE_FAILSAFE_TIMEOUT);
      }
    }).observe(tabs, { attributes: true, attributeFilter: ["expanded"] });
  }

  // ---- Customize: strip sidebar-main[expanded] so the » chevron keeps working --------------------
  // The » chevron is populated by sidebar-main's own IntersectionObserver, which ONLY runs while
  // expanded is false. If Customize opened while the rail was hover-expanded, [expanded] would
  // otherwise linger for the whole Customize session (and past it, since the cooldown handler
  // never clears sidebar-main): the button row stays in its expanded layout clipped to the 50px
  // the css/13 pins force, and nothing is ever moved into the chevron. Stripping the attribute
  // while uc-customize-open is set lets the observer run; the pins keep the rail at 50px anyway.
  // We also watch the rail for the attribute being re-added (Firefox can re-sync it from
  // sc._state.launcherExpanded, which still says expanded) and strip it again.
  let customizeStrippedExpanded = false;
  let customizeRailObserver = null;
  function stripRailExpandedForCustomize() {
    const rail = getRail();
    if (!rail) return;
    if (rail.hasAttribute("expanded")) {
      // Hide the row BEFORE the swap (instant, uc-rail-buttons-fade-out is 0ms) and fade it back in once the chevron has been rebuilt.
      if (performance.now() >= csHoldUntil) {
        csHoldUntil = performance.now() + CS_SWAP_MS;
        hold("enter", CS_SWAP_MS + 300);
        clearTimeout(csHoldTimer);
        csHoldTimer = setTimeout(() => release(), CS_SWAP_MS);
      }
      customizeStrippedExpanded = true;
      rail.removeAttribute("expanded");
      dbg("customize: stripped sidebar-main[expanded] so the IntersectionObserver rebuilds the chevron");
    }
    if (!customizeRailObserver) {
      customizeRailObserver = new MutationObserver(() => {
        if (!html.hasAttribute("uc-customize-open")) return;
        if (rail.hasAttribute("expanded")) {
          customizeStrippedExpanded = true;
          rail.removeAttribute("expanded");
          dbg("customize: re-stripped sidebar-main[expanded]");
        }
      });
      customizeRailObserver.observe(rail, { attributes: true, attributeFilter: ["expanded"] });
    }
  }

  function restoreAfterCustomize() {
    if (customizeRailObserver) {
      customizeRailObserver.disconnect();
      customizeRailObserver = null;
    }
    const stripped = customizeStrippedExpanded;
    customizeStrippedExpanded = false;
    if (!stripped) return;
    const rail = getRail();
    if (!rail || rail.hasAttribute("expanded") || !rail.matches(":hover")) return;
    // The pointer never left the rail, so Firefox's own hover-expand will not re-fire
    // (no new mouseenter is generated for a stationary pointer). Nudge it with the
    // pointer/mouse events it may be listening to. railHold's own mouseenter listener
    // fires too, which is exactly what we want: it re-arms the pre-fade, so the timing
    // behaves as if the user had re-entered the rail.
    const init = { bubbles: true, cancelable: true, view: window };
    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
      try {
        rail.dispatchEvent(type.startsWith("pointer") && typeof PointerEvent === "function"
          ? new PointerEvent(type, init)
          : new MouseEvent(type, init));
      } catch (e) {}
    }
    dbg("customize closed: pointer still on rail, nudged hover-expand");
  }

  new MutationObserver(() => {
    if (html.hasAttribute("uc-customize-open")) {
      clearTimeout(preTimer);
      stripRailExpandedForCustomize();
      if (html.hasAttribute("uc-rail-hold")) {
        dbg("suppression started with hold set: releasing");
        release();
      }
      return;
    }
    if (!isSuppressed()) {
      // uc-customize-open is gone and the cooldown's uc-hover-suppressed is gone too:
      // safe to restore (waiting for the cooldown to end avoids expanding the rail
      // underneath the settle animation).
      restoreAfterCustomize();
      return;
    }
    clearTimeout(preTimer);
    if (html.hasAttribute("uc-rail-hold")) {
      dbg("suppression started with hold set: releasing");
      release();
    }
  }).observe(html, { attributes: true, attributeFilter: ["uc-customize-open", "uc-hover-suppressed"] });

  const slideObserver = new MutationObserver(() => {
    dbg("sidebar-ongoing-animations changed");
    if (!html.hasAttribute("uc-rail-hold")) return;
    if (isSliding()) {
      clearTimeout(releaseTimer);
      clearTimeout(failTimer);
    } else {
      release();
    }
  });
  slideObserver.observe(document, { attributes: true, subtree: true, attributeFilter: ["sidebar-ongoing-animations", "uc-push-moving"] });

  // ---- » chevron fade, driven from JS (Web Animations) --------------------------------------------
  // The CSS route does not work on Firefox 160: the inner <button> of .more-tools-button has no part="button" (measured: getAttribute("part")
  // is null, and a test rule .more-tools-button::part(button) matched nothing), so the adopted ::part() sheet above never applies and the
  // chevron never faded. Element.animate() on the inner button needs no part and no stylesheet. Durations and delays are the same
  // uc.railHold.chevron* prefs (read through `timings`). The fade follows [uc-rail-hold]: set = fade out, removed = fade in.
  // (If a Firefox ever exposes the part again, the CSS animation and this one both run; this one is later in the animation order and wins.)
  let chevronAnim = null, chevronBtn = null;
  const chevronHost = () => {
    const rail = getRail();
    return (rail && rail.shadowRoot && rail.shadowRoot.querySelector(".more-tools-button")) || null;
  };
  const chevronEl = () => {
    const host = chevronHost();
    if (!host) return null;
    return (host.shadowRoot && host.shadowRoot.querySelector("button")) || host;
  };

  function fadeChevron(dir, instant) {
    if (!html.hasAttribute("uc-vertical")) return;   // horizontal tabs: 07 turns every rail fade off there
    const b = chevronEl();
    if (!b) return;
    const to = dir === "out" ? 0 : 1;
    const from = parseFloat(getComputedStyle(b).opacity);
    if (chevronAnim) { chevronAnim.cancel(); chevronAnim = null; }
    chevronBtn = b;
    if (to === 1 && from >= 1) return;               // nothing was faded out: nothing to fade in
    const dur = instant ? 0 : (dir === "out" ? timings.chevronFadeOutMs : timings.chevronFadeInMs);
    const delay = instant ? 0 : (dir === "out" ? timings.chevronDelayOutMs : timings.buttonsSettleMs + timings.chevronDelayInMs);
    const anim = b.animate([{ opacity: Number.isFinite(from) ? from : 1 }, { opacity: to }], {
      duration: dur, delay, easing: dir === "out" ? "ease-in" : "ease-out", fill: "both",
    });
    chevronAnim = anim;
    if (dir === "in") {
      anim.onfinish = () => { if (chevronAnim === anim) { anim.cancel(); chevronAnim = null; } };   // back to the natural opacity: 1
    }
    dbg(`chevron fade ${dir}${instant ? " (instant)" : ""} ${Math.round(from * 100) / 100} -> ${to}`);
  }

  const holdAttrObserver = new MutationObserver(() => {
    const kind = html.getAttribute("uc-rail-hold");
    if (kind) fadeChevron("out", kind === "snap");
    else fadeChevron("in", false);
  });
  holdAttrObserver.observe(html, { attributes: true, attributeFilter: ["uc-rail-hold"] });

  // Lit can create (or replace) the chevron while the hold is on, e.g. when sidebar-main re-renders after Customize strips [expanded]:
  // a new element has opacity 1 and no animation, so it is hidden at once and takes part in the release fade like the old one would have.
  const chevronRebuilt = () => {
    if (!html.hasAttribute("uc-rail-hold")) return;
    const b = chevronEl();
    if (b && b !== chevronBtn) fadeChevron("out", true);
  };
  const chevronObserver = new MutationObserver(() => { watchChevronFade(); chevronRebuilt(); });
  function watchChevronFade() {
    const rail = getRail();
    const sr = rail && rail.shadowRoot;
    if (!sr) return;
    if (!sr.__ucChevFade) {
      sr.__ucChevFade = true;
      chevronObserver.observe(sr, { childList: true, subtree: true });
    }
    const host = chevronHost();
    const inner = host && host.shadowRoot;
    if (inner && !inner.__ucChevFade) {
      inner.__ucChevFade = true;
      chevronObserver.observe(inner, { childList: true, subtree: true });
    }
  }

  const ready = () => {
    const rail = getRail();
    const tabs = getTabs();
    return !!(rail && rail.__ucRailHold && rail.shadowRoot && rail.shadowRoot.__ucRailChevron && tabs && tabs.__ucRailHold);
  };
  const setup = () => {
    applyChevronStyles();
    applyTiming();
    watchRail();
    watchTabs();
    watchChevronFade();
    return ready();
  };

  let startupObserver = null;
  let parentObserver = null;
  const watchParent = () => {
    const rail = getRail();
    const parent = rail && rail.parentNode;
    if (!parent) return;
    if (parentObserver) parentObserver.disconnect();
    parentObserver = new MutationObserver(() => {
      setup();
      watchParent();
    });
    parentObserver.observe(parent, { childList: true });
  };

  if (setup()) {
    watchParent();
  } else {
    startupObserver = new MutationObserver(() => {
      if (!setup()) return;
      startupObserver.disconnect();
      startupObserver = null;
      watchParent();
    });
    startupObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---- pref observer: any uc.railHold.* pref change re-applies the timings live -------------------
  const timingPrefObserver = { observe: () => applyTiming() };
  const timingPrefs = Object.keys(DEFAULTS).map((k) => PREF_BASE + k);
  for (const pref of timingPrefs) {
    try { Services.prefs.addObserver(pref, timingPrefObserver); } catch (e) {}
  }

  window.addEventListener("unload", () => {
    if (startupObserver) startupObserver.disconnect();
    if (parentObserver) parentObserver.disconnect();
    if (customizeRailObserver) customizeRailObserver.disconnect();
    slideObserver.disconnect();
    clearTimeout(csHoldTimer);
    holdAttrObserver.disconnect();
    chevronObserver.disconnect();
    if (chevronAnim) chevronAnim.cancel();
    for (const pref of timingPrefs) {
      try { Services.prefs.removeObserver(pref, timingPrefObserver); } catch (e) {}
    }
  }, { once: true });
})();