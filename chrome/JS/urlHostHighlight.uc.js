// ==UserScript==
// @name         urlHostHighlight.uc.js
// @description  Draws address bar text with dim protocols/www and highlighted subdomains/base domain (--uc-url-host-color). Supports floating bar and normal states.
// @include      main
// ==/UserScript==

(() => {
  const HTML = "http://www.w3.org/1999/xhtml";

  // Mirrors "the status panel (link text on hover) is showing" onto the urlbar as uc-status-active, so css/03 can hide the address text
  // with a plain attribute on the bar instead of :root:has(#statuspanel:not([inactive])), which was re-checked for the whole window on
  // every link hover. A MutationObserver callback runs before the next paint, so the text never shows for a frame it should be hidden.
  // This part comes BEFORE the guard below and needs only these two elements, so it keeps working even if the highlight has to switch itself off.
  const urlbarEl = document.getElementById("urlbar");
  const statusPanel = document.getElementById("statuspanel");
  let statusObserver = null;
  if (urlbarEl && statusPanel) {
    const syncStatus = () => urlbarEl.toggleAttribute("uc-status-active", !statusPanel.hasAttribute("inactive"));
    statusObserver = new MutationObserver(syncStatus);
    statusObserver.observe(statusPanel, { attributes: true, attributeFilter: ["inactive"] });
    syncStatus();
  }
  window.addEventListener("unload", () => {
    if (statusObserver) statusObserver.disconnect();
  }, { once: true });

  // GUARD: everything below uses Firefox internals (gURLBar.inputField, gBrowser's progress listeners, the urlbar's markup). If an update
  // renames or removes one of them, stop here with ONE message in the Browser Console instead of throwing halfway through the set-up
  // (which would leave the overlay half working). The address bar itself keeps working; only the domain highlight is off.
  const gUrlBar = window.gURLBar;
  const input = gUrlBar && gUrlBar.inputField;
  const urlbar = (gUrlBar && gUrlBar.textbox) || urlbarEl;
  const box = input && (input.closest(".urlbar-input-box") || input.parentNode);
  const tabHooks = window.gBrowser && typeof gBrowser.addTabsProgressListener === "function" && gBrowser.tabContainer;
  if (!input || !urlbar || !box || !tabHooks) {
    console.warn("urlHostHighlight: Firefox's address bar or tab hooks are not as expected (" +
      [!input && "gURLBar.inputField", !urlbar && "#urlbar", !box && ".urlbar-input-box", !tabHooks && "gBrowser tab hooks"].filter(Boolean).join(", ") +
      " missing). The domain highlight is switched off.");
    return;
  }

  // Firefox's own dimming of the non-domain part would show through the overlay, so turn it off.
  try {
    Services.prefs.setBoolPref("browser.urlbar.formatting.enabled", false);
  } catch (e) {
    console.warn("urlHostHighlight: could not set browser.urlbar.formatting.enabled", e);
  }

  const overlay = document.createElementNS(HTML, "div");
  overlay.id = "uc-url-overlay";
  box.appendChild(overlay);

  const span = (cls, text) => {
    const el = document.createElementNS(HTML, "span");
    el.className = cls;
    el.textContent = text;
    return el;
  };

  // The host as the address bar DISPLAYS it. new URL().hostname gives the punycode form ("xn--...") for international domains, which is
  // never found in the visible text, so those addresses were left uncoloured. displayHost is the decoded (unicode) form.
  function displayHostOf(urlString, fallback) {
    try {
      return Services.io.newURI(urlString).displayHost || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getHighlightRange(text) {
    if (!text || /\s/.test(text)) return null;
    const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text;
    let urlObj;
    try {
      urlObj = new URL(full);
    } catch (e) {
      return null;
    }

    const asciiHost = urlObj.hostname;
    if (!asciiHost) return null;

    // try the decoded host first, then the ASCII one
    const lower = text.toLowerCase();
    let host = displayHostOf(full, asciiHost);
    let hostStartIndex = lower.indexOf(host.toLowerCase());
    if (hostStartIndex < 0) {
      host = asciiHost;
      hostStartIndex = lower.indexOf(host.toLowerCase());
    }
    if (hostStartIndex < 0) return null;

    let offset = 0;
    if (host.toLowerCase().startsWith("www.")) offset = 4; // dim the "www."

    return { start: hostStartIndex + offset, length: host.length - offset };
  }

  // While the bar is focused, the overlay stays up while the text is untouched (pristine).
  // Once you type or edit, the overlay drops so native editing takes over.
  const markPristine = (pristine) => urlbar.toggleAttribute("uc-url-pristine", pristine);
  markPristine(true);

  let raf = 0;
  function frame() {
    raf = 0;
    if (!urlbar.hasAttribute("focused")) return;
    // update() follows the input's scroll AND any change of its selection: the select-all that happens when the bar gets focus, and the
    // one that follows Esc (Firefox puts the page's address back and selects it). Neither fires an event we can listen to, so while the
    // bar is focused it is checked once per frame (update() returns at once when nothing changed).
    update();
    raf = requestAnimationFrame(frame);
  }

  // The selected part of the address, [start, end), or [0, 0] when nothing is selected or the bar is not focused. The overlay covers the
  // input's own text while the floating bar is focused, so the selection has to be drawn by the overlay too (.uc-url-sel in css/03).
  function selectionRange() {
    if (!urlbar.hasAttribute("focused")) return [0, 0];
    try {
      const s = input.selectionStart;
      const e = input.selectionEnd;
      return s === e ? [0, 0] : [Math.min(s, e), Math.max(s, e)];
    } catch (err) {
      return [0, 0];
    }
  }

  let last = null;
  function update() {
    overlay.scrollLeft = input.scrollLeft; // follow the input if a long address has scrolled
    const text = input.value;
    const [selStart, selEnd] = selectionRange();
    const key = text + "\u0000" + selStart + "\u0000" + selEnd;
    if (key === last) return;
    last = key;

    const range = getHighlightRange(text);
    if (!range || range.start < 0) {
      urlbar.removeAttribute("uc-url-colored");
      overlay.textContent = "";
      return;
    }

    const { start, length } = range;
    const hostEnd = start + length;

    // match the input's typography so the overlay lands exactly on the original text
    const cs = getComputedStyle(input);
    Object.assign(overlay.style, {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      letterSpacing: cs.letterSpacing,
      paddingInlineStart: cs.paddingInlineStart,
      paddingInlineEnd: cs.paddingInlineEnd,
    });

    overlay.textContent = "";
    // Cut the text wherever the style changes: protocol/www (dim), subdomains and base domain (host), path and query (dim), and the edges
    // of the selection. Each piece is host or dim, and also .uc-url-sel when it lies inside the selection.
    const cuts = [...new Set([0, start, hostEnd, text.length, selStart, selEnd].filter((n) => n >= 0 && n <= text.length))]
      .sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i];
      const to = cuts[i + 1];
      const isHost = from >= start && to <= hostEnd;
      const isSelected = selEnd > selStart && from >= selStart && to <= selEnd;
      overlay.appendChild(span((isHost ? "uc-url-host" : "uc-url-dim") + (isSelected ? " uc-url-sel" : ""), text.slice(from, to)));
    }
    urlbar.setAttribute("uc-url-colored", "true");
  }

  // All triggers go through one scheduler: several events in the same frame cost one update.
  let pending = 0;
  const schedule = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      update();
    });
  };

  input.addEventListener("input", () => markPristine(false));
  input.addEventListener("focus", () => {
    markPristine(true);
    if (!raf) raf = requestAnimationFrame(frame);
  });
  // Blur and Escape make Firefox put the page's address back into the field from code (no event), so check again.
  input.addEventListener("blur", () => {
    markPristine(true);
    schedule();
  });

  // 1. Every programmatic change of the field's text. This is the one the previous version missed: setting `input.value` from code does not
  //    change the DOM (no attribute, no child node), so a MutationObserver never sees it. Wrapping the property on this one element does,
  //    and covers typed-then-reverted text, search-term display, trimmed https:// and anything else Firefox writes into the bar.
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (proto && proto.get && proto.set) {
    Object.defineProperty(input, "value", {
      configurable: true,
      enumerable: proto.enumerable,
      get() {
        return proto.get.call(this);
      },
      set(v) {
        proto.set.call(this, v);
        schedule();
      },
    });
  }

  // 2. Top-level navigation in the selected tab
  const progressListener = {
    onLocationChange(browser, webProgress) {
      if (webProgress.isTopLevel && browser === gBrowser.selectedBrowser) schedule();
    },
  };
  // 3. Switching between already loaded tabs
  const onTabSelect = () => schedule();
  // Each one is set up on its own, so a failure in one leaves the other (and everything above) working.
  try {
    gBrowser.addTabsProgressListener(progressListener);
  } catch (e) {
    console.warn("urlHostHighlight: could not listen for navigation", e);
  }
  try {
    gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect, { passive: true });
  } catch (e) {
    console.warn("urlHostHighlight: could not listen for tab switches", e);
  }

  window.addEventListener("unload", () => {
    try { gBrowser.removeTabsProgressListener(progressListener); } catch (e) {}
    try { gBrowser.tabContainer.removeEventListener("TabSelect", onTabSelect); } catch (e) {}
    cancelAnimationFrame(pending);
    cancelAnimationFrame(raf);
  }, { once: true });

  // Initial run once the window has loaded
  if (document.readyState === "complete") update();
  else window.addEventListener("load", update, { once: true });
})();
