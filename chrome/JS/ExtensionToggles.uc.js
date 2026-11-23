// ==UserScript==
// @name            ExtensionToggles.uc.js
// @description     Sidebar-rail button and/or » overflow-menu entry + popup panel with an on/off switch for every installed extension.
//                  Uses Firefox's privileged AddonManager, so none of the WebExtension management.setEnabled limits apply.
// @include         main
// ==/UserScript==

(() => {
  "use strict";

  if (location.href !== "chrome://browser/content/browser.xhtml") return;
  if (window.__ucExtensionToggles) return; // one instance per window
  window.__ucExtensionToggles = true;

  const ID = "uc-ext-toggles";

  // Where the launcher lives. Set rail:false to keep it only inside the » overflow menu.
  const PLACE = { rail: true, overflow: true };
  const XHTML = "http://www.w3.org/1999/xhtml";
  const warn = (...a) => console.warn("[uc] ExtensionToggles:", ...a);

  // ---- Firefox internals (guarded: a Firefox update should degrade quietly) ----------------
  let AddonManager;
  try {
    ({ AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"));
  } catch (e) {
    warn("AddonManager unavailable, script disabled:", e);
    return;
  }
  if (typeof AddonManager?.getAddonsByTypes !== "function") {
    warn("AddonManager API changed, script disabled.");
    return;
  }

  // 16px toggle glyph. context-fill lets Firefox tint it like the other rail icons.
  const ICON =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="context-fill #8f8f9d">' +
        '<path d="M5 3.5a4.5 4.5 0 0 0 0 9h6a4.5 4.5 0 0 0 0-9H5zm0 1.5h6a3 3 0 0 1 0 6H5A3 3 0 0 1 5 5z"/>' +
        '<circle cx="11" cy="8" r="1.75"/></svg>'
    );

  // ---- Small DOM helper (no innerHTML in chrome) -------------------------------------------
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElementNS(XHTML, tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  };

  // ---- Styles: only transform/opacity animate; colours follow the panel's own tokens -------
  const CSS = `
    #${ID}-panel {
      --et-fg: var(--arrowpanel-color, light-dark(#36454F, #DCDCDC));
      --et-accent: AccentColor;
      --et-accent-fg: AccentColorText;
      --et-line: color-mix(in srgb, var(--et-fg) 14%, transparent);
      --et-hover: color-mix(in srgb, var(--et-fg) 8%, transparent);
      --arrowpanel-padding: 10px;
      min-width: 0;
    }
    #${ID}-panel .et-root { width: 340px; display: flex; flex-direction: column; gap: 8px; color: var(--et-fg); font: inherit; }
    #${ID}-panel .et-search {
      appearance: none; box-sizing: border-box; width: 100%; margin: 0; padding: 7px 10px;
      font: inherit; color: inherit; background: var(--et-hover);
      border: 1px solid transparent; border-radius: 8px; outline: none;
    }
    #${ID}-panel .et-search:focus { border-color: var(--et-accent); }
    #${ID}-panel .et-filters { display: flex; align-items: center; gap: 4px; }
    #${ID}-panel .et-filter {
      appearance: none; margin: 0; padding: 3px 10px; font: inherit; font-size: .92em; color: inherit;
      background: transparent; border: 1px solid transparent; border-radius: 999px; cursor: pointer;
    }
    #${ID}-panel .et-filter:hover { background: var(--et-hover); }
    #${ID}-panel .et-filter[aria-pressed="true"] { background: var(--et-accent); color: var(--et-accent-fg); }
    #${ID}-panel .et-count { margin-inline-start: auto; opacity: .65; font-size: .9em; }
    #${ID}-panel .et-list {
      list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow-y: auto; overscroll-behavior: contain;
      scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--et-fg) 35%, transparent) transparent;
    }
    #${ID}-panel .et-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
    #${ID}-panel .et-row:hover { background: var(--et-hover); }
    #${ID}-panel .et-icon { width: 20px; height: 20px; flex: none; border-radius: 4px; object-fit: contain; }
    #${ID}-panel .et-badge {
      width: 20px; height: 20px; flex: none; border-radius: 4px; display: grid; place-items: center;
      font-size: 11px; font-weight: 600; background: var(--et-line);
    }
    #${ID}-panel .et-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${ID}-panel .et-row[data-on="false"] .et-name,
    #${ID}-panel .et-row[data-on="false"] .et-icon,
    #${ID}-panel .et-row[data-on="false"] .et-badge { opacity: .55; }
    #${ID}-panel .et-sw { position: relative; width: 34px; height: 18px; flex: none; }
    #${ID}-panel .et-sw input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
    #${ID}-panel .et-track { position: absolute; inset: 0; border-radius: 9px; background: color-mix(in srgb, var(--et-fg) 25%, transparent); transition: background-color 140ms; }
    #${ID}-panel .et-track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: var(--et-fg); transition: transform 140ms;
    }
    #${ID}-panel .et-sw input:checked + .et-track { background: var(--et-accent); }
    #${ID}-panel .et-sw input:checked + .et-track::after { transform: translateX(16px); background: var(--et-accent-fg); }
    #${ID}-panel .et-sw input:focus-visible + .et-track { outline: 2px solid var(--et-accent); outline-offset: 2px; }
    #${ID}-panel .et-sw:has(input:disabled) { opacity: .45; }
    #${ID}-panel .et-sw input:disabled { cursor: default; }
    #${ID}-panel .et-msg { margin: 0; padding: 4px 8px; opacity: .75; }
    #${ID}-panel .et-error { color: light-dark(#b3261e, #ff8a80); opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      #${ID}-panel .et-track, #${ID}-panel .et-track::after { transition: none; }
    }
  `;

  // ---- Add-on helpers ----------------------------------------------------------------------
  const eligible = (a) => a && a.type === "extension" && !a.isSystem && !a.isBuiltin && !a.hidden;
  const isOn = (a) => !a.userDisabled && !a.appDisabled;
  const iconOf = (a) => a.iconURL || a.icons?.[32] || a.icons?.[48] || a.icons?.[64] || "";

  function lockReason(a) {
    if (a.appDisabled) return "Turned off by Firefox (blocked or incompatible)";
    const need = isOn(a) ? AddonManager.PERM_CAN_DISABLE : AddonManager.PERM_CAN_ENABLE;
    if (need !== undefined && !(a.permissions & need)) return "Firefox won't let this extension be switched (locked by policy)";
    return "";
  }

  // ---- State -------------------------------------------------------------------------------
  let addons = [];
  let filter = "all"; // all | on | off
  let dirty = true;
  let refreshing = false;

  // ---- Panel -------------------------------------------------------------------------------
  const searchEl = h("input", { class: "et-search", type: "search", placeholder: "Search extensions", autocomplete: "off", spellcheck: "false", "aria-label": "Search extensions" });
  const countEl = h("span", { class: "et-count" });
  const listEl = h("ul", { class: "et-list" });
  const emptyEl = h("p", { class: "et-msg", text: "No extensions match." });
  const errorEl = h("p", { class: "et-msg et-error" });
  emptyEl.hidden = true;
  errorEl.hidden = true;

  const filterBtns = ["all", "on", "off"].map((f) =>
    h("button", {
      class: "et-filter", type: "button", "data-filter": f,
      text: f === "all" ? "All" : f === "on" ? "On" : "Off",
      onclick: () => { filter = f; render(); },
    })
  );

  const panel = document.createXULElement("panel");
  panel.id = `${ID}-panel`;
  panel.setAttribute("type", "arrow");
  panel.setAttribute("orient", "vertical");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Extensions");
  panel.append(
    h("style", { text: CSS }),
    h("div", { class: "et-root" },
      searchEl,
      h("div", { class: "et-filters" }, ...filterBtns, countEl),
      listEl, emptyEl, errorEl)
  );
  (document.getElementById("mainPopupSet") || document.documentElement).append(panel);

  const showError = (msg) => { errorEl.textContent = msg || ""; errorEl.hidden = !msg; };

  function makeRow(a) {
    const on = isOn(a);
    const reason = lockReason(a);

    const input = h("input", { type: "checkbox", role: "switch", "aria-label": a.name });
    input.checked = on;
    input.disabled = !!reason;

    input.addEventListener("change", async () => {
      const want = input.checked;
      input.disabled = true;
      showError("");
      try {
        if (want) await a.enable();
        else await a.disable();
      } catch (e) {
        input.checked = !want;
        showError(`Could not switch ${a.name}: ${e?.message || e}`);
      } finally {
        dirty = true;
        refresh(); // rebuild from live state
      }
    });

    const src = iconOf(a);
    const badge = () => h("span", { class: "et-badge", "aria-hidden": "true", text: (a.name || "?").trim().charAt(0).toUpperCase() });
    const icon = src ? h("img", { class: "et-icon", src, alt: "", loading: "eager" }) : badge();
    if (src) icon.addEventListener("error", () => icon.replaceWith(badge()));

    const sw = h("label", { class: "et-sw", title: reason }, input, h("span", { class: "et-track" }));
    return h("li", { class: "et-row", "data-on": String(on) },
      icon, h("span", { class: "et-name", text: a.name, title: a.name }), sw);
  }

  function render() {
    const term = searchEl.value.trim().toLowerCase();
    const shown = addons.filter((a) => {
      if (filter === "on" && !isOn(a)) return false;
      if (filter === "off" && isOn(a)) return false;
      return !term || (a.name || "").toLowerCase().includes(term);
    });
    listEl.replaceChildren(...shown.map(makeRow));
    emptyEl.hidden = shown.length > 0;
    countEl.textContent = `${addons.filter(isOn).length} of ${addons.length} on`;
    for (const b of filterBtns) b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      while (dirty) {
        dirty = false;
        const all = await AddonManager.getAddonsByTypes(["extension"]);
        addons = all.filter(eligible).sort((x, y) => (x.name || "").localeCompare(y.name || "", undefined, { sensitivity: "base" }));
        render();
      }
    } catch (e) {
      showError("Could not read the extension list: " + (e?.message || e));
    } finally {
      refreshing = false;
    }
  }

  searchEl.addEventListener("input", render);

  panel.addEventListener("popupshowing", () => { dirty = true; refresh(); });
  panel.addEventListener("popupshown", () => searchEl.focus());
  panel.addEventListener("popuphidden", () => { searchEl.value = ""; showError(""); });

  // Open towards the page: right of a left-hand rail, left of a right-hand one (no Firefox internals needed).
  function togglePanel(anchor, vertical = false) {
    if (panel.state === "open" || panel.state === "showing") { panel.hidePopup(); return; }
    const r = anchor.getBoundingClientRect();
    const onLeft = r.left + r.width / 2 < window.innerWidth / 2;
    const pos = vertical ? (onLeft ? "after_start" : "after_end") : onLeft ? "end_before" : "start_before";
    panel.openPopup(anchor, pos, 0, 0, false, false);
  }

  // ---- Live updates (only does real work while the panel is open) --------------------------
  const markDirty = () => { dirty = true; if (panel.state === "open") refresh(); };
  const listener = { onEnabled: markDirty, onDisabled: markDirty, onInstalled: markDirty, onUninstalled: markDirty };
  AddonManager.addAddonListener(listener);

  // ---- Button: rail first, nav-bar fallback ------------------------------------------------
  let railBtn = null;
  let observer = null;
  let fallbackBtn = null;

  function makeRailButton(sibling) {
    const useMoz = !!customElements.get("moz-button");
    const el = document.createElement(useMoz ? "moz-button" : "button");
    el.id = `${ID}-button`;
    if (sibling?.className) el.className = sibling.className; // inherit the rail's own button styling
    el.setAttribute("title", "Extensions");
    el.setAttribute("aria-label", "Extensions");
    if (useMoz) {
      el.setAttribute("type", sibling?.getAttribute?.("type") || "icon ghost");
      el.setAttribute("iconsrc", ICON);
    } else {
      el.append(h("img", { src: ICON, width: "16", height: "16", alt: "" }));
    }
    // Stop the click here so the rail's own group-level click handling never sees an unknown button.
    el.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(el); });
    return el;
  }

  function ensureRailButton() {
    const root = document.querySelector("sidebar-main")?.shadowRoot;
    const wrap = root?.querySelector(".buttons-wrapper");
    if (!wrap) return false;
    // Top group (bookmarks, history, ...), not .bottom-actions and not the hidden overflow group.
    const group = wrap.querySelector(":scope > .tools-and-extensions:not(.overflow-button)");
    if (!group) return false;
    if (!railBtn) railBtn = makeRailButton(group.querySelector("moz-button:not([hidden]), button:not([hidden])"));
    if (railBtn.parentNode !== group) group.append(railBtn);
    if (!observer) {
      // Lit may re-render the rail; put the button back if it gets dropped.
      observer = new MutationObserver(() => requestAnimationFrame(ensureRailButton));
      observer.observe(root, { childList: true, subtree: true });
    }
    return true;
  }

  function addFallbackButton() {
    const target = document.getElementById("nav-bar-customization-target");
    if (!target || fallbackBtn) return;
    fallbackBtn = document.createXULElement("toolbarbutton");
    fallbackBtn.id = `${ID}-button`;
    fallbackBtn.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    fallbackBtn.setAttribute("label", "Extensions");
    fallbackBtn.setAttribute("tooltiptext", "Extensions");
    fallbackBtn.style.listStyleImage = `url("${ICON}")`;
    fallbackBtn.style.setProperty("-moz-context-properties", "fill");
    fallbackBtn.style.fill = "currentColor";
    fallbackBtn.addEventListener("command", () => togglePanel(fallbackBtn, true));
    target.append(fallbackBtn);
  }

  function placeButton(attempt = 0) {
    if (ensureRailButton()) return;
    if (attempt < 40) { setTimeout(() => placeButton(attempt + 1), 250); return; } // rail renders late
    warn("sidebar rail group not found (.buttons-wrapper > .tools-and-extensions), using a nav-bar button instead.");
    addFallbackButton();
  }

  // ---- » overflow menu entry ---------------------------------------------------------------
  // Firefox builds #sidebar-tools-overflow > #tools-overflow-list from copies of the rail buttons (matched by
  // their `view` attribute). Ours has no `view`, so Firefox never removes or recycles it; we only keep it
  // second-to-last, directly above "Customize sidebar" (or last if that copy isn't in the list).
  let overflowBtn = null;
  let overflowPopup = null;
  let overflowList = null;
  let overflowObserver = null;

  const findMoreToolsButton = () =>
    document.querySelector("sidebar-main")?.shadowRoot?.querySelector(".more-tools-button") || null;

  // The » button is re-rendered by Lit, so resolve the anchor fresh rather than caching it.
  const resolveAnchor = (preferred) =>
    (preferred?.isConnected ? preferred : null) || findMoreToolsButton() || railBtn || fallbackBtn;

  function makeOverflowButton() {
    const useMoz = !!customElements.get("moz-button");
    const el = document.createElement(useMoz ? "moz-button" : "button");
    el.id = `${ID}-overflow-button`;
    el.classList.add("expanded-button"); // same class Firefox gives its own overflow copies (icon + label)
    el.setAttribute("title", "Extensions");
    el.setAttribute("aria-label", "Extensions");
    if (useMoz) {
      el.setAttribute("type", "icon ghost");
      el.iconSrc = ICON;
      el.textContent = "Extensions";
    } else {
      el.append(h("img", { src: ICON, width: "16", height: "16", alt: "" }), h("span", { text: "Extensions" }));
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const popup = overflowPopup;
      const anchor = popup?.anchorNode || null; // capture before the popup closes
      const open = popup && (popup.state === "open" || popup.state === "showing");
      if (!open) { togglePanel(resolveAnchor(anchor)); return; }
      // Let the overflow panel finish closing first, otherwise its rollup can dismiss ours immediately.
      popup.addEventListener("popuphidden", () => togglePanel(resolveAnchor(anchor)), { once: true });
      popup.hidePopup();
    });
    return el;
  }

  function ensureOverflowButton() {
    const list = document.getElementById("tools-overflow-list");
    if (!list) return;
    overflowBtn ??= makeOverflowButton();
    const customize = list.querySelector(':scope > [view="viewCustomizeSidebar"]');
    const placed = overflowBtn.parentNode === list &&
      (customize ? overflowBtn.nextElementSibling === customize : list.lastElementChild === overflowBtn);
    if (!placed) list.insertBefore(overflowBtn, customize); // null → append
    if (overflowList !== list) {
      // Firefox adds/removes its copies while resizing; re-seat ours when that happens (no-op once placed, so no loop).
      overflowObserver?.disconnect();
      overflowList = list;
      overflowObserver = new MutationObserver(ensureOverflowButton);
      overflowObserver.observe(list, { childList: true });
    }
  }

  function setupOverflowEntry() {
    overflowPopup = document.getElementById("sidebar-tools-overflow");
    if (!overflowPopup) { warn("#sidebar-tools-overflow not found, » menu entry skipped."); return; }
    // popupshowing runs before the panel is laid out, so the entry is in place on first paint.
    overflowPopup.addEventListener("popupshowing", ensureOverflowButton);
    ensureOverflowButton();
  }

  // ---- Start / stop ------------------------------------------------------------------------
  function start() {
    if (PLACE.rail) placeButton();
    if (PLACE.overflow) setupOverflowEntry();
    refresh(); // warm the list so the first open is instant
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const obs = (subject) => {
      if (subject !== window) return;
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      start();
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }

  window.addEventListener("unload", () => {
    try { AddonManager.removeAddonListener(listener); } catch {}
    observer?.disconnect();
    overflowPopup?.removeEventListener("popupshowing", ensureOverflowButton);
    overflowObserver?.disconnect();
    overflowBtn?.remove();
    railBtn?.remove();
    fallbackBtn?.remove();
    panel.remove();
  }, { once: true });
})();