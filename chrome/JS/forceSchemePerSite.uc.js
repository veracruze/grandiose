// ==UserScript==
// @name           Force color scheme per site
// @description    Per-site equivalent of layout.css.prefers-color-scheme.content-override.
//                 Does three things for each listed site:
//                   1) sets the tab's prefers-color-scheme override (for pages with their own dark/light CSS)
//                   2) registers a user stylesheet forcing `color-scheme` on the page root
//                      (for unstyled pages, whose default colours follow the used colour scheme)
//                   3) paints an opaque page background so nothing behind the page shows through
//                 Tab context menu: "Force light / dark mode on this site".
//                 Ctrl+Alt+L toggles light, Ctrl+Alt+D toggles dark on the current tab.
// @include        main
// ==/UserScript==

(() => {
  const PREF = "uc.forceScheme.sites"; // JSON object {hostname: "light" | "dark"}, kept in prefs.js
  const MODES = ["light", "dark"];     // light = override value 1, dark = override value 0

  // Opaque page background painted on listed sites. This covers pages whose root is
  // transparent, so whatever sits behind the page (theme, canvas) can't show through.
  const PAGE_BG = { light: "#ffffff", dark: "#1c1b22" };
  // Optional extra CSS added to every listed site, e.g. "body { background: #fff !important; }"
  const EXTRA_CSS = "";

  // ---------- localization ----------
  let _locale;
  const getLocale = () => {
    if (_locale) return _locale;
    try {
      _locale = (Services.locale && (
        Services.locale.appLocaleAsBCP47 ||
        Services.locale.requestedLocale ||
        Services.locale.appLocaleAsLangTag
      )) || "en-US";
    } catch (e) {
      _locale = "en-US";
    }
    return _locale;
  };
  const l10n = (messages) => {
    const locale = getLocale().toLowerCase();
    const lang = locale.split("-")[0];
    return messages[locale] || messages[lang] || messages.en;
  };

  const FORCE_LABELS = {
    light: {
      "en":    "Force light mode on this site",
      "de":    "Hellen Modus für diese Website erzwingen",
      "fr":    "Forcer le mode clair sur ce site",
      "es":    "Forzar el modo claro en este sitio",
      "it":    "Forza la modalità chiara su questo sito",
      "pt-BR": "Forçar modo claro neste site",
      "pt-PT": "Forçar modo claro neste site",
      "ru":    "Принудительно включить светлый режим на этом сайте",
      "zh-CN": "在此网站强制使用浅色模式",
      "zh-TW": "在此網站強制使用淺色模式",
      "ja":    "このサイトでライトモードを強制",
      "ko":    "이 사이트에서 라이트 모드 강제 적용",
      "pl":    "Wymuś tryb jasny na tej stronie",
      "nl":    "Lichte modus forceren op deze site",
      "tr":    "Bu sitede açık modu zorla",
      "cs":    "Vynutit světlý režim na tomto webu",
      "sv":    "Tvinga ljust läge på den här webbplatsen",
    },
    dark: {
      "en":    "Force dark mode on this site",
      "de":    "Dunklen Modus für diese Website erzwingen",
      "fr":    "Forcer le mode sombre sur ce site",
      "es":    "Forzar el modo oscuro en este sitio",
      "it":    "Forza la modalità scura su questo sito",
      "pt-BR": "Forçar modo escuro neste site",
      "pt-PT": "Forçar modo escuro neste site",
      "ru":    "Принудительно включить тёмный режим на этом сайте",
      "zh-CN": "在此网站强制使用深色模式",
      "zh-TW": "在此網站強制使用深色模式",
      "ja":    "このサイトでダークモードを強制",
      "ko":    "이 사이트에서 다크 모드 강제 적용",
      "pl":    "Wymuś tryb ciemny na tej stronie",
      "nl":    "Donkere modus forceren op deze site",
      "tr":    "Bu sitede koyu modu zorla",
      "cs":    "Vynutit tmavý režim na tomto webu",
      "sv":    "Tvinga mörkt läge på den här webbplatsen",
    },
  };

  // ---------- list storage ----------
  const readMap = () => {
    try {
      const v = JSON.parse(Services.prefs.getStringPref(PREF, "{}"));
      // migrate the old array format (light only)
      if (Array.isArray(v)) return Object.fromEntries(v.map((h) => [h, "light"]));
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  };
  const writeMap = (m) => Services.prefs.setStringPref(PREF, JSON.stringify(m));

  const hostOf = (uri) => {
    try {
      if (!uri || !/^https?$/.test(uri.scheme)) return null;
      return uri.host.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  };

  // key of the entry covering host (exact or parent domain), or undefined
  const matchKey = (host, map) =>
    host ? Object.keys(map).find((h) => host === h || host.endsWith("." + h)) : undefined;

  const modeFor = (host, map) => {
    const k = matchKey(host, map);
    return k && MODES.includes(map[k]) ? map[k] : null;
  };

  // ---------- user stylesheet: color-scheme + opaque background on the page root ----------
  // Same effect as putting this in userContent.css:
  //   @-moz-document domain("example.com") { html:root { color-scheme: light !important; background-color: #fff !important; } }
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  let sheetURI = null;

  const syncSheet = () => {
    try {
      const rules = Object.entries(readMap())
        .filter(([h, m]) => MODES.includes(m) && /^[a-z0-9.-]+$/i.test(h))
        .map(([h, m]) =>
          `@-moz-document domain("${h}") { html:root { color-scheme: ${m} !important;` +
          ` background-color: ${PAGE_BG[m]} !important; } ${EXTRA_CSS} }`)
        .join("\n");

      const next = rules
        ? Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(rules))
        : null;

      // the registry is shared by all windows, so check before touching it
      if (sheetURI && (!next || next.spec !== sheetURI.spec) && sss.sheetRegistered(sheetURI, sss.USER_SHEET)) {
        sss.unregisterSheet(sheetURI, sss.USER_SHEET);
      }
      if (next && !sss.sheetRegistered(next, sss.USER_SHEET)) {
        sss.loadAndRegisterSheet(next, sss.USER_SHEET);
      }
      sheetURI = next;
    } catch (e) {
      console.error("[forceScheme] stylesheet sync failed:", e);
    }
  };

  // ---------- applying the tab override ----------
  // Only reset browsers WE forced, so devtools' own emulation isn't clobbered.
  const forced = new WeakSet();

  const apply = (browser, uri = browser.currentURI) => {
    try {
      const bc = browser.browsingContext;
      if (!bc) return; // background tab that isn't loaded yet
      const top = bc.top;
      const mode = modeFor(hostOf(uri), readMap());
      if (mode) {
        if (top.prefersColorSchemeOverride !== mode) top.prefersColorSchemeOverride = mode;
        forced.add(browser);
      } else if (forced.has(browser)) {
        top.prefersColorSchemeOverride = "none";
        forced.delete(browser);
      }
    } catch (e) {
      console.error("[forceScheme] apply failed:", e);
    }
  };

  // Apply as EARLY as possible: when the navigation starts (so the new document
  // is created with the right scheme and scripts that read it at load see it),
  // then again on location change, shortly after, and when loading stops.
  const applyAll = () => gBrowser.browsers.forEach((b) => apply(b));

  gBrowser.addTabsProgressListener({
    onStateChange(browser, webProgress, request, flags) {
      if (!webProgress.isTopLevel) return;
      const L = Ci.nsIWebProgressListener;
      if (flags & L.STATE_IS_DOCUMENT && flags & L.STATE_START) {
        try {
          apply(browser, request.QueryInterface(Ci.nsIChannel).URI);
        } catch (e) { /* not a channel (e.g. about: page) */ }
      } else if (flags & L.STATE_IS_WINDOW && flags & L.STATE_STOP) {
        apply(browser);
      }
    },
    onLocationChange(browser, webProgress, request, location) {
      if (!webProgress.isTopLevel) return;
      apply(browser, location);
      setTimeout(() => apply(browser), 150);
    },
  });

  gBrowser.tabContainer.addEventListener("TabSelect", (e) => apply(e.target.linkedBrowser));

  // keeps every window in sync when the list changes
  const observer = {
    observe() {
      syncSheet();
      applyAll();
    },
  };
  Services.prefs.addObserver(PREF, observer);
  window.addEventListener("unload", () => Services.prefs.removeObserver(PREF, observer), { once: true });

  syncSheet();
  applyAll();

  // ---------- toggle ----------
  // Same mode again removes the site; the other mode switches it.
  const toggle = (browser, mode) => {
    const host = hostOf(browser.currentURI);
    if (!host) return;
    const map = readMap();
    const key = matchKey(host, map);
    if (key && map[key] === mode) delete map[key];
    else map[key ?? host] = mode;
    writeMap(map);
  };

  // ---------- tab context menu ----------
  const menu = document.getElementById("tabContextMenu");
  const items = MODES.map((mode) => {
    const item = document.createXULElement("menuitem");
    item.id = `uc-force-scheme-${mode}`;
    item.setAttribute("type", "checkbox");
    item.setAttribute("autocheck", "false"); // we control the tick ourselves
    item.setAttribute("label", l10n(FORCE_LABELS[mode]));
    item.addEventListener("command", () => toggle(TabContextMenu.contextTab.linkedBrowser, mode));
    menu.appendChild(item);
    return { mode, item };
  });

  menu.addEventListener("popupshowing", (e) => {
    if (e.target !== menu) return;
    const b = TabContextMenu.contextTab?.linkedBrowser;
    const host = b && hostOf(b.currentURI);
    const current = modeFor(host, readMap());
    for (const { mode, item } of items) {
      item.hidden = !host;
      if (current === mode) item.setAttribute("checked", "true");
      else item.removeAttribute("checked"); // a "false" value would still show the tick
    }
  });

  // ---------- shortcuts ----------
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    const mode = e.code === "KeyL" ? "light" : e.code === "KeyD" ? "dark" : null;
    if (!mode) return;
    e.preventDefault();
    toggle(gBrowser.selectedBrowser, mode);
  }, true);
})();