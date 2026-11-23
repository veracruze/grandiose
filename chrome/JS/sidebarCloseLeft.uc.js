// ==UserScript==
// @name           sidebarCloseLeft.uc.js
// @description    Moves the Customize sidebar panel's close button to the left when the sidebar is on the right.
//                 Direct element styling (CSP-safe), searches both panel doc and chrome.
// @include        main
// ==/UserScript==

(() => {
  "use strict";
  const VERSION = "2026-11-16-j";
  if (window.__ucSidebarCloseLeft?.version === VERSION) return;
  try { window.__ucSidebarCloseLeft?.dispose?.(); } catch (e) {}

  const PREF           = "sidebar.position_start";
  const PANEL_FRAGMENT = "sidebar-customize";
  const SELECTORS = [
    '[data-l10n-id="sidebar-panel-header-close-button"]',
    'moz-button[data-l10n-id*="close"]',
  ];

  let Services = globalThis.Services;
  if (!Services) {
    try { Services = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services; } catch (e) {}
  }

  const DEBUG = false; // true: log [SCL] lines to the Browser Console
  const log = (...a) => { if (DEBUG) console.log("[SCL]", ...a); };

  const getBrowser = () => window.SidebarController?.browser ?? document.getElementById("sidebar");
  const shouldFlip = () => {
    try { return !(Services ? Services.prefs.getBoolPref(PREF, true) : true); } catch (e) { return false; }
  };

  // ---- closed shadow root support ----
  const closedRoots   = new WeakMap();
  const hookedWindows = new WeakSet();
  function hookWindow(win) {
    if (!win || hookedWindows.has(win)) return;
    const proto = win.Element?.prototype;
    if (!proto?.attachShadow) return;
    const orig = proto.attachShadow;
    proto.attachShadow = function (init) {
      const root = orig.call(this, init);
      if (init?.mode === "closed") closedRoots.set(this, root);
      return root;
    };
    hookedWindows.add(win);
    log("attachShadow hooked on", win.location.href);
  }

  // ---- BFS walker that finds the button in a doc (open + closed shadow roots) ----
  function findIn(root) {
    if (!root) return null;
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      for (const sel of SELECTORS) {
        try {
          const el = queue[i].querySelector?.(sel);
          if (el) return el;
        } catch (e) {}
      }
      try {
        for (const el of queue[i].querySelectorAll("*")) {
          const sr = el.shadowRoot || closedRoots.get(el);
          if (sr) queue.push(sr);
        }
      } catch (e) {}
    }
    return null;
  }

  function getPanelDoc() {
    try {
      const doc = getBrowser()?.contentDocument;
      if (doc?.location?.href?.includes(PANEL_FRAGMENT)) return doc;
    } catch (e) {}
    return null;
  }

  function findButton() {
    const panelDoc = getPanelDoc();
    if (panelDoc) {
      const btn = findIn(panelDoc);
      if (btn) return { btn, where: "panel" };
    }
    const btn = findIn(document);
    if (btn) return { btn, where: "chrome" };
    return null;
  }

  function applyNow() {
    const flip = shouldFlip();
    const found = findButton();
    if (!found) return { done: false, reason: "not-found" };

    const { btn, where } = found;
    try {
      if (flip) {
        btn.style.setProperty("order", "-1", "important");
        btn.style.setProperty("margin-inline-start", "0", "important");
        const p = btn.parentElement;
        const disp = p ? getComputedStyle(p).display : "?";
        log(`flipped <${btn.localName}> in ${where}; parent=<${p?.localName}.${p?.className}> display=${disp}`);
      } else {
        btn.style.removeProperty("order");
        btn.style.removeProperty("margin-inline-start");
      }
      return { done: true };
    } catch (e) {
      log("style error:", e?.message);
      return { done: true };
    }
  }

  // ---- bounded retries ----
  const RETRY_DELAYS = [0, 50, 150, 400, 800, 1500];
  let retryTimer = null;
  function kick() {
    if (retryTimer) clearTimeout(retryTimer);
    let i = 0;
    const step = () => {
      retryTimer = null;
      const r = applyNow();
      if (r.done) return;
      if (i >= RETRY_DELAYS.length) { log("retries exhausted:", r.reason); return; }
      retryTimer = setTimeout(step, RETRY_DELAYS[i++]);
    };
    step();
  }

  // ---- browser lifecycle ----
  let hookedBrowser = null;
  const onCreated = (ev) => {
    try {
      const doc = ev.target;
      if (doc?.location?.href?.includes(PANEL_FRAGMENT)) hookWindow(doc.defaultView ?? doc);
    } catch (e) {}
  };
  const onLoaded = (ev) => {
    try {
      const doc = ev.target;
      if (doc?.location?.href?.includes(PANEL_FRAGMENT)) {
        hookWindow(doc.defaultView ?? doc);
        kick();
      }
    } catch (e) {}
  };
  function installHook() {
    const b = getBrowser();
    if (!b || b === hookedBrowser) return;
    if (hookedBrowser) {
      hookedBrowser.removeEventListener("DOMWindowCreated", onCreated, true);
      hookedBrowser.removeEventListener("DOMContentLoaded", onLoaded, true);
    }
    hookedBrowser = b;
    b.addEventListener("DOMWindowCreated", onCreated, true);
    b.addEventListener("DOMContentLoaded", onLoaded, true);
    const doc = getPanelDoc();
    if (doc) { hookWindow(doc.defaultView ?? doc); kick(); }
  }

  const prefObserver = { observe() { kick(); } };
  try { Services?.prefs.addObserver(PREF, prefObserver); } catch (e) {}

  const timer = setInterval(() => { installHook(); }, 2000);

  window.__ucSidebarCloseLeft = {
    version: VERSION,
    dispose() {
      clearInterval(timer);
      if (retryTimer) clearTimeout(retryTimer);
      try { Services?.prefs.removeObserver(PREF, prefObserver); } catch (e) {}
      if (hookedBrowser) {
        hookedBrowser.removeEventListener("DOMWindowCreated", onCreated, true);
        hookedBrowser.removeEventListener("DOMContentLoaded", onLoaded, true);
      }
      // remove any styles we applied
      const found = findButton();
      if (found) {
        try {
          found.btn.style.removeProperty("order");
          found.btn.style.removeProperty("margin-inline-start");
        } catch (e) {}
      }
    },
  };

  // Hook both the chrome window and (when present) the panel window.
  hookWindow(window);
  installHook();
})();