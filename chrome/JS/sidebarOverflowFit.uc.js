// ==UserScript==
// @name           sidebarOverflowFit.uc.js
// @description    The » overflow menu (#sidebar-tools-overflow) sometimes opens a few pixels too short, so its last item ("Customize sidebar")
//                 is half covered by the popup's bottom edge, and Firefox only corrects it some time later.
//                 Cause: Firefox sizes the popup window before the list has finished laying out (items are filled in just before it opens,
//                 and fonts / icons can change the row height a moment later), and in fullscreen it also keeps it inside the work area.
//                 Two measurements are taken and the larger wins:
//                   1) the list's own overflow (scrollHeight - clientHeight)
//                   2) how far the last item sticks out below the popup box or a clipping parent
//                If the result is positive the popup is moved up by that amount and made that much taller, so its bottom edge stays where
//                Firefox put it. The check runs right after the popup opens, then every 250ms while it stays open (up to 10s), and again
//                whenever the list changes size. Nothing is done when the content already fits. The size set by sizeTo() is cleared when the
//                menu closes so the next opening is sized by Firefox again.
//                The menu is kept invisible (opacity 0) while it is being corrected and revealed once it fits, so the resize is not seen.
//                A 700ms fallback reveals it in any case.
//                Fullscreen + "Hide tabs and sidebar": the rail and toolbar can hide the moment the pointer moves onto the menu, which closes
//                the menu (its anchor, the » button, disappears). While the menu is open the script sets Firefox's own "a popup is open"
//                veto (FullScreen._isPopupOpen) so the bars stay. Firefox's own popuphidden handler clears it again and re-checks the pointer.
//                The tooltip of the » button is disabled for good: its title / tooltiptext is removed (and removed again whenever the rail
//                re-renders it), browser.chrome.toolbar_tips is NOT touched (it would change tooltips for the whole interface; set it in user.js if you want them off globally), and any tooltip popup that still tries to show is cancelled.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  if (window.__ucOverflowFit) return;
  window.__ucOverflowFit = true;

  const PANEL_ID = "sidebar-tools-overflow";
  const LIST_ID = "tools-overflow-list";
  const POLL_MS = 250;     // re-check interval while the menu is open
  const POLL_MAX = 10000;  // stop polling after this long
  const MAX_GROW = 160;    // px: safety cap on the total growth per opening
  const TOLERANCE = 0.5;   // px: ignore sub-pixel differences

  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // per open panel: { grown, observer, timer, target, targetAt, retries }
  const sessions = new WeakMap();
  const resized = new WeakSet();

  // Returns { deficit, outer } : how many px the popup window is missing (<= 0 means it fits).
  function measure(panel, list) {
    const box = panel.getBoundingClientRect();
    const outer = panel.getOuterScreenRect();

    // 1) the list scrolls or is cut by its own box
    const scroll = list.scrollHeight - list.clientHeight;

    // 2) the last item reaches below the popup box or a clipping parent
    let tail = 0;
    const last = list.lastElementChild;
    if (last) {
      const padBottom = parseFloat(getComputedStyle(list).paddingBottom) || 0;
      let clip = box.bottom;
      for (let n = list.parentNode; n && n !== panel; n = n.parentNode || n.host) {
        if (n.nodeType === 1) clip = Math.min(clip, n.getBoundingClientRect().bottom);
      }
      tail = last.getBoundingClientRect().bottom + padBottom - clip;
    }

    return {
      deficit: Math.ceil(Math.max(scroll, tail)),
      outer,
    };
  }

  const SETTLE_MS = 300;   // after a resize, wait this long before checking that the window really followed
  const MAX_RETRIES = 5;

  function fitOnce(panel) {
    const s = sessions.get(panel);
    const list = document.getElementById(LIST_ID);
    if (!s || !list || panel.state !== "open") return;
    const now = performance.now();

    // A resize was asked for earlier: check that the popup WINDOW (not just its layout) has reached the size we asked for.
    // sizeTo() is asynchronous, and Firefox can also clamp or undo it, so re-apply it if the window is still short.
    if (s.target) {
      const o = panel.getOuterScreenRect();
      if (o.height >= s.target.h - 1) {
        // The popup window can keep showing a frame painted at its old size until something repaints it. Resizing by 1px and back
        // forces a real repaint of the window at its final size.
        const fw = s.target.w, fh = s.target.h;
        panel.sizeTo(fw, fh + 1);
        requestAnimationFrame(() => { if (panel.state === "open") panel.sizeTo(fw, fh); });
        s.target = null;
      } else if (now - s.targetAt < SETTLE_MS) {
        return; // still settling
      } else if (s.retries < MAX_RETRIES) {
        s.retries++;
        panel.moveTo(s.target.x, s.target.y);
        panel.sizeTo(s.target.w, s.target.h);
        s.targetAt = now;
        return;
      } else {
        s.target = null;
      }
    }

    const { deficit, outer } = measure(panel, list);
    if (deficit <= TOLERANCE) { reveal(panel); return; }

    const add = Math.min(deficit, MAX_GROW - s.grown);
    if (add <= 0) { reveal(panel); return; }
    s.grown += add;

    const top = Math.max(screen.availTop || 0, outer.y - add);
    s.target = { x: outer.x, y: top, w: outer.width, h: outer.height + add };
    s.targetAt = now;
    s.retries = 0;
    panel.moveTo(s.target.x, s.target.y);
    panel.sizeTo(s.target.w, s.target.h);
    resized.add(panel);
  }

  function stop(panel) {
    const s = sessions.get(panel);
    if (s) {
      if (s.observer) s.observer.disconnect();
      clearInterval(s.timer);
    }
    sessions.delete(panel);
  }

  async function start(panel) {
    stop(panel);
    const s = { grown: 0, observer: null, timer: 0, target: null, targetAt: 0, retries: 0 };
    sessions.set(panel, s);

    // refit whenever the list changes size while the menu is open (fonts, icons, items added late)
    const list = document.getElementById(LIST_ID);
    if (list && typeof ResizeObserver === "function") {
      let queued = false;
      s.observer = new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          if (sessions.get(panel) === s) fitOnce(panel);
        });
      });
      s.observer.observe(list);
    }

    // poll while open: the window can lag behind the layout for a while
    const t0 = performance.now();
    s.timer = setInterval(() => {
      if (sessions.get(panel) !== s || panel.state !== "open" || performance.now() - t0 > POLL_MAX) {
        clearInterval(s.timer);
        return;
      }
      fitOnce(panel);
    }, POLL_MS);

    // safety net: the menu can never stay invisible
    setTimeout(() => {
      if (sessions.get(panel) === s && panel.state === "open") reveal(panel);
    }, 700);

    await frame();
    if (sessions.get(panel) === s) fitOnce(panel);
  }

  // Clear anything a previous opening left behind (also needed when that menu was closed abnormally and no clean popuphidden followed).
  function resetSize(p) {
    stop(p);
    resized.delete(p);
    p.style.removeProperty("width");
    p.style.removeProperty("height");
    if (!p.getAttribute("style")) p.removeAttribute("style");
  }

  // Keep the menu invisible while it is being corrected, so the resize/move is never seen.
  function reveal(p) {
    p.style.removeProperty("opacity");
    if (!p.getAttribute("style")) p.removeAttribute("style");
  }

  // Fullscreen: keep the toolbar and rail from hiding while this menu is open.
  function veto() {
    try {
      if (window.fullScreen && window.FullScreen && !document.documentElement.hasAttribute("inDOMFullscreen")) {
        FullScreen._isPopupOpen = true;
      }
    } catch (e) {}
  }

  // ---- Tooltips: disabled for the » chevron only ----
  // Not by toggling `browser.chrome.toolbar_tips` globally: that changes Firefox's behaviour for the whole interface,
  // not just for the » chevron. The chevron's tooltip is suppressed per-element and per-event instead:
  //   • stripChevronTips()  removes its title / tooltiptext (and re-runs on every rail re-render via MutationObserver)
  //   • onShowing()         cancels any tooltip popup that still tries to show while the menu is open
  // If you want chrome tooltips off globally anyway, set `user_pref("browser.chrome.toolbar_tips", false);` in user.js.

  // The » button has no tooltip text any more (the rail re-renders, so it is removed again whenever it comes back)
  const TIP_ATTRS = ["title", "tooltiptext"];

  function chevronEls() {
    const rail = document.querySelector("sidebar-main");
    const root = rail && rail.shadowRoot;
    const btn = root && root.querySelector(".more-tools-button");
    if (!btn) return [];
    // the moz-button itself and the real <button> inside it
    return [btn, btn.shadowRoot && btn.shadowRoot.querySelector("button")].filter(Boolean);
  }

  function stripChevronTips() {
    for (const el of chevronEls()) {
      for (const attr of TIP_ATTRS) {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
      }
    }
  }

  function watchChevron(tries = 0) {
    const rail = document.querySelector("sidebar-main");
    const root = rail && rail.shadowRoot;
    if (!root) {
      if (tries < 60) setTimeout(() => watchChevron(tries + 1), 500);
      return;
    }
    const obs = new MutationObserver(() => {
      stripChevronTips();
      watchInner();
    });
    const opts = { subtree: true, childList: true, attributes: true, attributeFilter: TIP_ATTRS };
    obs.observe(root, opts);
    // the real <button> lives in the moz-button's own shadow root
    function watchInner() {
      const btn = root.querySelector(".more-tools-button");
      if (btn && btn.shadowRoot) obs.observe(btn.shadowRoot, opts);
    }
    stripChevronTips();
    watchInner();
  }
  watchChevron();

  // 3) any tooltip popup that still tries to show is cancelled
  const menuIsOpen = () => {
    const p = document.getElementById(PANEL_ID);
    return !!p && (p.state === "open" || p.state === "showing");
  };

  function closeTooltips() {
    for (const t of document.querySelectorAll("tooltip")) {
      try { if (t.state === "open" || t.state === "showing") t.hidePopup(); } catch (e) {}
    }
  }

  // <tooltip> elements, and the HTML title tooltip (its popupshowing target is the root element)
  const isTooltipLike = (t) =>
    t === document.documentElement || t.localName === "tooltip" || /tooltip/i.test(t.id || "") || /tooltip/i.test(String(t.className || ""));

  const onShowing = (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id !== PANEL_ID) {
      if (isTooltipLike(t)) e.preventDefault();
      return;
    }
    resetSize(t);
    t.style.setProperty("opacity", "0", "important");
    veto();
    stripChevronTips();
    closeTooltips();
  };

  const onShown = (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id !== PANEL_ID) {
      // a tooltip that still got shown while the menu is open: close it
      if (menuIsOpen() && isTooltipLike(t) && t !== document.documentElement) {
        try { t.hidePopup(); } catch (err) {}
      }
      return;
    }
    veto(); // Firefox's own popupshown handler has run by now; set it again in case it left the flag off
    closeTooltips();
    start(t);
  };

  const onHidden = (e) => {
    const p = e.target;
    if (!p || p.id !== PANEL_ID) return;
    stop(p);
    reveal(p);
    if (!resized.has(p)) return;
    resized.delete(p);
    p.style.removeProperty("width");
    p.style.removeProperty("height");
    if (!p.getAttribute("style")) p.removeAttribute("style");
  };

  document.addEventListener("popupshowing", onShowing, true);
  document.addEventListener("popupshown", onShown, true);
  document.addEventListener("popuphidden", onHidden, true);

  window.addEventListener("unload", () => {
    document.removeEventListener("popupshowing", onShowing, true);
    document.removeEventListener("popupshown", onShown, true);
    document.removeEventListener("popuphidden", onHidden, true);
  }, { once: true });
})();