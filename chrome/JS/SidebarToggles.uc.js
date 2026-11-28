// ==UserScript==
// @name           SidebarToggles.uc.js
// @description    Adds Color Scheme, Selection colour, Density and Overlay mode switches, an Expand-on-hover delay field, and the look tunables
//                 (Gradient amount, Gradient angle, Gradient colour, Glow strength, Accent colour, Accent opacity) and the background group (Background image, Image dimming, Surface opacity,
//                 Tab opacity, Popup opacity) to the Customize sidebar panel (Event-Driven).
//                 The look tunables are stored in prefs (uc.gradient.amount, uc.glow.strength, uc.accent.override) and applied as CSS variables
//                 on the window (see "Appearance tunables" below), live and in every open window.
//                 With no Background image chosen, --uc-bg-image points at chrome/1px-transparent.png (installed by install.ps1).
// @include        main
// @run-at         document-start
// ==/UserScript==

(() => {
  // PANEL ORDER: the order of the entries in PREFS below no longer matters. Edit PANEL_ORDER (right under PREFS) instead:
  // it lists the panel top-to-bottom. Any PREFS entry missing from PANEL_ORDER is appended at the bottom.
  const PREFS = {
    pipmouse: {
      id: "uc.pip.mouse",
      fsId: "uc-pipmouse-fieldset",
      label: "PiP mouse",
      fallback: 1,
      options: [[1, "On"], [0, "Off"]]
    },
    pipopacity: {
      id: "uc.pip.opacity",
      fsId: "uc-pipopacity-fieldset",
      label: "PiP opacity (%)",
      type: "number",
      min: 10,          // not 0: a fully invisible PiP window can't be found again
      max: 100,
      defaultValue: 100
    },
    popup: {
      id: "uc.popup.opacity",
      fsId: "uc-popupopacity-fieldset",
      label: "Popup opacity (%)",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 100
    },
    tab: {
      id: "uc.tab.opacity",
      fsId: "uc-tabopacity-fieldset",
      label: "Tab opacity (%)",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 100
    },
    surface: {
      id: "uc.surface.opacity",
      fsId: "uc-surfaceopacity-fieldset",
      label: "Surface opacity (%)",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 100
    },
    dim: {
      id: "uc.background.dim",
      fsId: "uc-bgdim-fieldset",
      label: "Image dimming (%)",
      type: "number",
      min: 0,
      max: 90,
      defaultValue: 40
    },
	imageopacity: {
      id: "uc.background.image.opacity",
      fsId: "uc-imageopacity-fieldset",
      label: "Image opacity (%)",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 50   // 50% = 0.5 in CSS
    },
    bgimage: {
      id: "uc.background.image",
      fsId: "uc-bgimage-fieldset",
      label: "Background image",
      type: "image"
    },
    glow: {
      id: "uc.glow.strength",
      fsId: "uc-glow-fieldset",
      label: "Glow strength",
      fallback: 2,
      options: [[0, "Off"], [1, "Light"], [2, "Normal"], [3, "Strong"]]
    },
    gradangle: {
      id: "uc.gradient.angle",
      fsId: "uc-gradangle-fieldset",
      label: "Gradient angle (°)",
      type: "number",
      min: 0,
      max: 360,
      defaultValue: 180
    },
    gradient: {
      id: "uc.gradient.amount",
      fsId: "uc-gradient-fieldset",
      label: "Gradient amount (%)",
      type: "number",
      min: 0,
      max: 100,
      defaultValue: 9
    },
    gradaccent: {
      id: "uc.gradient.accent",
      fsId: "uc-gradaccent-fieldset",
      label: "Gradient accent (%)",
      type: "number",
      min: 0,
      max: 80,
      defaultValue: 25
    },
    gradtwo: {
      id: "uc.gradient.two",
      fsId: "uc-gradtwo-fieldset",
      label: "Two-colour gradient",
      fallback: 0,
      options: [[0, "Off"], [1, "On"]]
    },
    gradcolor: {
      id: "uc.gradient.color",
      fsId: "uc-gradcolor-fieldset",
      label: "Gradient colour",
      type: "color",
      resetLabel: "Accent"
    },
    accent: {
      id: "uc.accent.override",
      fsId: "uc-accent-fieldset",
      label: "Accent colour",
      type: "color",
      opacityPref: {
        id: "uc.accent.opacity",
        label: "Accent opacity (%)",
        min: 0,
        max: 100,
        defaultValue: 100
      }
    },
    themecolors: {
      id: "uc.theme.colors",
      fsId: "uc-themecolors-fieldset",
      label: "Colour source",
      fallback: 0,
      options: [[0, "User Defined"], [1, "Firefox theme"]],
      // "User Defined" also switches Firefox back to the built-in Default theme, so no other theme keeps
      // painting over the user's own Accent / Gradient colour fields.
      apply: (v) => {
        setInt(PREFS.themecolors.id, v);
        if (v === 0) enableDefaultTheme();
      }
    },
    hoverDelay: {
      id: "sidebar.animation.expand-on-hover.delay-duration-ms",
      fsId: "uc-hoverdelay-fieldset",
      label: "Expand on hover delay (ms)",
      type: "number",
      min: 0,
      max: 5000
    },
    overlay: {
      id: "uc.fullscreen.overlay-mode",
      fsId: "uc-overlay-fieldset",
      label: "Overlay mode",
      fallback: 1,
      options: [[1, "On"], [0, "Off"]]
    },
    density: {
      id: "browser.uidensity",
      fsId: "uc-density-fieldset",
      label: "Density",
      options: [[0, "Standard"], [1, "Compact"], [2, "Touch"]]
    },
    selection: {
      id: "uc.selection-colour.mode",
      fsId: "uc-selection-fieldset",
      label: "Selection colour",
      fallback: 0,
      options: [[0, "Default"], [1, "Accent"], [2, "Soft accent"]],
      apply: (mode) => applySelection(mode)
    },
    color: {
      id: "layout.css.prefers-color-scheme.content-override",
      fsId: "uc-color-fieldset",
      label: "Color Scheme",
      options: [[0, "Dark"], [1, "Light"], [2, "System"], [3, "Browser"]]
    },
    // Same control and same pref as about:addons > Themes > Light / Dark / Device (aboutaddons-themes-mode):
    //   Light = 0, Dark = 1, Device = pref has NO user value (about:addons clears it). Defined last = shown first.
    themeMode: {
      id: "ui.systemUsesDarkTheme",
      fsId: "uc-thememode-fieldset",
      label: "Theme mode",
      options: [[0, "Light"], [1, "Dark"], [2, "Device"]],
      read: () => {
        try {
          if (!Services.prefs.prefHasUserValue("ui.systemUsesDarkTheme")) return 2;
          const v = Services.prefs.getIntPref("ui.systemUsesDarkTheme", 2);
          return v === 0 || v === 1 ? v : 2;
        } catch (e) { return 2; }
      },
      apply: (v) => {
        if (v === 2) Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
        else Services.prefs.setIntPref("ui.systemUsesDarkTheme", v);
      }
    }
  };

  // Panel order, TOP to BOTTOM. Reorder this list freely; keys are the names used in PREFS above.
  const PANEL_ORDER = [
    "pipmouse",
    "pipopacity",
    "themeMode",
    "color",
    "selection",
    "density",
    "overlay",
    "hoverDelay",
    "themecolors",
    "accent",
    "gradcolor",
    "gradtwo",
    "gradaccent",
    "gradient",
    "gradangle",
    "glow",
    "bgimage",
    "imageopacity",
    "dim",
    "surface",
    "tab",
    "popup"
  ];

  // Every control is inserted directly after the anchor, so each new one lands ABOVE the previous.
  // To get PANEL_ORDER top-to-bottom we therefore inject in reverse. Unlisted PREFS keys go last (bottom).
  const injectionOrder = () => {
    const listed = PANEL_ORDER.filter((k) => k in PREFS);
    const unlisted = Object.keys(PREFS).filter((k) => !listed.includes(k));
    if (unlisted.length) console.warn("[uc-sidebar-toggles] not in PANEL_ORDER (placed last):", unlisted);
    return listed.concat(unlisted).reverse();
  };

  try {
    Services.prefs.getDefaultBranch("").setIntPref(PREFS.color.id, 3);
  } catch (e) {}

  const PANEL_URL = "chrome://browser/content/sidebar/sidebar-customize.html";
  const log = (...a) => console.log("[uc-sidebar-toggles]", ...a);

  const whenLoaded = (fn) => {
    if (document.readyState === "complete") fn();
    else window.addEventListener("load", () => fn(), { once: true });
  };

  const colorCache = new Map();
  // Only these cache keys depend on live state; everything else is a pure function of its input.
  const invalidateDynamicColors = () => {
    colorCache.delete("AccentColor");
    colorCache.delete("var(--uc-accent-base, AccentColor)");
  };
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // Pure JS parser for hex / rgb() / rgba() / hsl() / hsla(). Firefox writes theme variables in these forms.
  // WHY: the DOM probe in colorRGB() is skipped while the sidebar document is not "complete" (always the case
  // when the Customize panel is closed or still loading), and returned null. A theme change with the panel
  // closed therefore read "no colour", fell back to the old Accent fields and left everything stale.
  function parseCssColor(css) {
    if (!css) return null;
    const s = String(css).trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return null;
      const rgb = p.slice(0, 3).map((v) => v.endsWith("%") ? Math.round(parseFloat(v) * 2.55) : Math.round(parseFloat(v)));
      return rgb.some(Number.isNaN) ? null : rgb.map((v) => Math.min(255, Math.max(0, v)));
    }
    m = s.match(/^hsla?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return null;
      const h = ((parseFloat(p[0]) % 360) + 360) % 360, sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
      if ([h, sat, l].some(Number.isNaN)) return null;
      const a = sat * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
    }
    return null;
  }
  const sidebarLoading = () => {
    try {
      const doc = (window.SidebarController?.browser ?? document.getElementById("sidebar"))?.contentDocument;
      return !!doc && doc.readyState !== "complete";
    } catch (e) {
      return false;
    }
  };
  function colorRGB(css) {
    const parsed = parseCssColor(css);
    if (parsed) return parsed;
    if (sidebarLoading()) return colorCache.get(css) || null;
    try {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;background-color:" + css;
      document.documentElement.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const m = c.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        const rgb = m.slice(0, 3).map((n) => Math.round(Number(n)));
        colorCache.set(css, rgb);
        return rgb;
      }
    } catch (e) {}
    return null;
  }
  const accentRGB = () => {
    const own = effectiveAccent();                       // theme or override accent, no DOM needed
    return (own && parseCssColor(own)) || colorRGB("var(--uc-accent-base, AccentColor)") || [0, 120, 215];
  };
  const systemAccentRGB = () => colorRGB("AccentColor");
  const hex = (rgb) => "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");

  // Lowers a colour's HSL luminosity by `amount` on the 0–240 scale (matching the Windows colour picker's Lum field).
  function lowerLuminosity(cssColor, amount = 100) {
    const rgb = parseCssColor(cssColor);
    if (!rgb) return cssColor;
    let [r, g, b] = rgb.map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    l = Math.max(0, l - amount / 240);
    let r1, g1, b1;
    if (s === 0) {
      r1 = g1 = b1 = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue2rgb = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r1 = hue2rgb(h + 1 / 3);
      g1 = hue2rgb(h);
      b1 = hue2rgb(h - 1 / 3);
    }
    return hex([r1, g1, b1].map((v) => Math.round(v * 255)));
  }

  const CLIPBOARD = Ci.nsIClipboard.kGlobalClipboard;
  let eyedropperTimer = null;

  function readClipboardText() {
    try {
      const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
      const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      trans.init(null);
      trans.addDataFlavor("text/plain");
      try { clipboard.getData(trans, CLIPBOARD, window.browsingContext.currentWindowContext); }
      catch (e) { clipboard.getData(trans, CLIPBOARD); }
      let val;
      try { val = trans.getTransferData("text/plain"); }
      catch (e) {
        const d = {}, l = {};
        trans.getTransferData("text/plain", d, l);
        val = d.value;
      }
      return val ? val.QueryInterface(Ci.nsISupportsString).data.trim() : "";
    } catch (e) {
      return "";
    }
  }

  function clearClipboard() {
    try { Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard).emptyClipboard(CLIPBOARD); } catch (e) {}
  }

  function restoreClipboard(text) {
    if (!text) return;
    try { Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text); } catch (e) {}
  }

  function parseClipboardColor(text) {
    if (!text || text.length > 40) return null;
    if (!/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\(.+\))$/i.test(text)) return null;
    return colorRGB(text);
  }

  function startEyedropper(onPick) {
    // 1. Try the native EyeDropper API first (fallback for future compatibility)
    if (window.EyeDropper) {
      try {
        const picker = new window.EyeDropper();
        picker.open().then(result => {
          if (result && result.sRGBHex) {
            onPick(result.sRGBHex.toLowerCase());
          }
        }).catch(e => {});
        return;
      } catch (e) {}
    }

    // 2. Use the new DevTools API (Firefox 160 compatible)
    // 2. Use the DevTools API via a standard async function
    const runDevTools = async () => {
      try {
        const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
        const { CommandsFactory } = require("devtools/shared/commands/commands-factory");

        // Temporarily disable the "allow connection" security prompt
        const promptPref = "devtools.debugger.prompt-connection";
        const wasPrompting = Services.prefs.getBoolPref(promptPref, true);
        if (wasPrompting) Services.prefs.setBoolPref(promptPref, false);

        let commands;
        try {
          commands = await CommandsFactory.forTab(gBrowser.selectedTab);
          await commands.targetCommand.startListening();
          const target = commands.targetCommand.targetFront;
          const inspectorFront = await target.getFront("inspector");

          // Clear the clipboard so we know when DevTools writes to it
          const oldClipboard = readClipboardText();
          clearClipboard();

          let isPicked = false;

          await new Promise((resolve) => {
            const onColorPicked = () => {
              isPicked = true;
              cleanup();
              resolve();
            };
            const onColorCanceled = () => {
              if (isPicked) return; // Ignore the cancel event that fires right after picking
              cleanup();
              resolve();
            };
            const cleanup = () => {
              inspectorFront.off("color-picked", onColorPicked);
              inspectorFront.off("color-pick-canceled", onColorCanceled);
            };

            inspectorFront.on("color-picked", onColorPicked);
            inspectorFront.on("color-pick-canceled", onColorCanceled);

            // Call the API
            inspectorFront.pickColorFromPage({ copyOnSelect: true, fromMenu: false });
          });

          // If the user actually picked a color, read it from the clipboard
          if (isPicked) {
            // Small delay to ensure the OS clipboard has updated
            await new Promise(r => setTimeout(r, 100));
            const colorText = readClipboardText();
            const rgb = parseClipboardColor(colorText);
            
            if (rgb) {
              onPick(hex(rgb));
            } else if (colorText && /^#[0-9a-f]{3,8}$/i.test(colorText)) {
              onPick(colorText);
            } else {
              log("eyedropper: Could not parse picked color from clipboard.", colorText);
            }
          }
          
          // Restore the original clipboard contents
          restoreClipboard(oldClipboard);

        } finally {
          if (commands) commands.destroy();
          if (wasPrompting) Services.prefs.setBoolPref(promptPref, true);
        }
      } catch (e) {
        log("eyedropper: DevTools API failed", e);
      }
    };

    runDevTools();
  }
  
  function readableOn(rgb) {
    const lin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return L > 0.4 ? "#1a1a1a" : "#ffffff";
  }

  function applySelection(mode, persist = true) {
    if (persist) Services.prefs.setIntPref(PREFS.selection.id, mode);
    if (mode === 0) {
      Services.prefs.clearUserPref("ui.highlight");
      Services.prefs.clearUserPref("ui.highlighttext");
      return;
    }
    const accent = accentRGB();
    const bg = mode === 1 ? accent : accent.map((c) => Math.round(c * 0.5 + 255 * 0.5));
    Services.prefs.setStringPref("ui.highlight", hex(bg));
    Services.prefs.setStringPref("ui.highlighttext", readableOn(bg));
  }

  const GLOW_LEVELS = {
    0: { "--uc-split-glow-spread": "0px", "--uc-split-idle-glow-spread": "0px", "--uc-selected-glow-spread": "0px", "--uc-split-idle-glow-blur": "0px" },
    1: { "--uc-split-glow-spread": "2px", "--uc-split-idle-glow-spread": "2px", "--uc-selected-glow-spread": "1px", "--uc-split-idle-glow-blur": "4px" },
    3: { "--uc-split-glow-spread": "5px", "--uc-split-idle-glow-spread": "5px", "--uc-selected-glow-spread": "2px", "--uc-split-idle-glow-blur": "8px" },
  };

  function audioIcons(fill) {
    const f = encodeURIComponent(fill);
    const head = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E";
    const tail = "%3C/svg%3E";
    return {
      "--uc-audio-icon-playing": `url("${head}%3Cpath%20style='fill:${f}'%20d='M5.6%203.7v8.6c0%20.5.5.8.9.5l6-4.3a.6.6%200%200%200%200-1l-6-4.3c-.4-.3-.9%200-.9.5Z'/%3E${tail}")`,
      "--uc-audio-icon-muted": `url("${head}%3Crect%20style='fill:${f}'%20x='3.8'%20y='3'%20width='3.2'%20height='10'%20rx='1.1'/%3E%3Crect%20style='fill:${f}'%20x='9'%20y='3'%20width='3.2'%20height='10'%20rx='1.1'/%3E${tail}")`,
      "--uc-audio-icon-blocked": `url("${head}%3Crect%20style='fill:${f}'%20x='3.5'%20y='3.5'%20width='9'%20height='9'%20rx='1.9'/%3E${tail}")`,
    };
  }

  const HEX = /^#[0-9a-f]{6}$/i;
  const accentOverride = () => {
    const v = Services.prefs.getStringPref(PREFS.accent.id, "");
    return HEX.test(v) ? v.toLowerCase() : "";
  };
  const colorPref = (config) => {
    const v = Services.prefs.getStringPref(config.id, "");
    return HEX.test(v) ? v.toLowerCase() : "";
  };
  const hasUserValue = (id) => {
    try { return Services.prefs.prefHasUserValue(id); } catch (e) { return false; }
  };

  // ---- Firefox theme colours ("Colour source" = Firefox theme) ----
  // Firefox's theme consumer (LightweightThemeConsumer) writes the active theme's colours as INLINE custom properties on :root. 01-tokens.css
  // overrides some of the same names with !important in a stylesheet, which beats the inline value for rendering but not for reading it, so
  // the real theme value is read from root.style here. A default theme sets none of them: then the switch quietly falls back to the
  // Accent / Gradient colour fields. First non-empty name in each list wins; edit the lists if a variable is named differently on your build
  // (Browser Toolbox console: see the snippet in the answer / header notes).
  const THEME_SURFACE_VARS = ["--lwt-accent-color", "--toolbar-bgcolor"];                     // -> Gradient colour (every surface)
  const THEME_ACCENT_VARS = ["--tab-line-color", "--lwt-tab-line-color", "--toolbar-field-focus-border-color", "--focus-outline-color"]; // -> Accent colour
  const themeVar = (names) => {
    const st = document.documentElement.style;
    for (const n of names) {
      const v = st.getPropertyValue(n).trim();
      if (v) return v;
    }
    return "";
  };
  const toHexColor = (css) => {
    if (!css) return "";
    if (HEX.test(css)) return css.toLowerCase();
    const rgb = colorRGB(css);          // any CSS colour (rgb(), rgba(), hsl(), names); alpha is dropped
    return rgb ? hex(rgb) : "";
  };
  // {accent, surface} as #rrggbb while the switch is on AND the theme provides colours, otherwise null
  // Raw theme colours, ignoring the Colour source switch. null = the active theme sets none (Default theme).
  function readThemeColors() {
    const surface = toHexColor(themeVar(THEME_SURFACE_VARS));
    if (!surface) return null;
    return { accent: toHexColor(themeVar(THEME_ACCENT_VARS)) || surface, surface };
  }
  function themeColorsActive() {
    if (Services.prefs.getIntPref(PREFS.themecolors.id, 0) !== 1) return null;
    return readThemeColors();
  }

  // ---- Colour source follows the active theme ----
  //   Default theme            -> Colour source = User Defined
  //   Any other theme          -> theme colours are COPIED into the Accent / Gradient colour fields
  //                               and Colour source = Firefox theme
  // Runs on transitions of extensions.activeThemeID (persisted in uc.theme.lastId, so a change made while
  // Firefox was closed is caught too). While Firefox theme stays selected, the fields keep mirroring the
  // live theme, so light/dark variant switches (about:addons) never leave stale swatches behind.
  const DEFAULT_THEME_ID = "default-theme@mozilla.org";
  const THEME_PREF = "extensions.activeThemeID";
  const LAST_THEME_PREF = "uc.theme.lastId";
  const setStr = (id, v) => { if (Services.prefs.getStringPref(id, "") !== v) Services.prefs.setStringPref(id, v); };
  const setInt = (id, v) => { if (Services.prefs.getIntPref(id, -1) !== v) Services.prefs.setIntPref(id, v); };

  // Enables the built-in Default theme ("Manage your Themes" > Default). No-op when it is already active.
  // Enabling fires AddonManager onEnabled -> themeRefresh() -> syncThemeSource(), which keeps Colour source at 0.
  function enableDefaultTheme() {
    try {
      if (Services.prefs.getStringPref(THEME_PREF, DEFAULT_THEME_ID) === DEFAULT_THEME_ID) return;
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      AddonManager.getAddonByID(DEFAULT_THEME_ID)
        .then((addon) => addon && !addon.isActive ? addon.enable() : null)
        .catch((e) => log("enabling the Default theme failed", e));
    } catch (e) { log("enableDefaultTheme failed", e); }
  }

  function syncThemeSource(final) {
    const id = Services.prefs.getStringPref(THEME_PREF, DEFAULT_THEME_ID) || DEFAULT_THEME_ID;
    const isDefault = id === DEFAULT_THEME_ID;
    const tc = isDefault ? null : readThemeColors();
    const copyColors = () => {
      setStr(PREFS.accent.id, tc.accent);
      setStr(PREFS.gradcolor.id, tc.surface);
      Services.prefs.clearUserPref(PREFS.accent.opacityPref.id);   // theme accents are always solid
    };

    if (id !== Services.prefs.getStringPref(LAST_THEME_PREF, "")) {
      if (isDefault) {
        setInt(PREFS.themecolors.id, 0);
        setStr(LAST_THEME_PREF, id);
      } else if (tc || final) {            // wait for Firefox to write the new variables; give up on the last tick
        if (tc) copyColors();
        setInt(PREFS.themecolors.id, 1);
        setStr(LAST_THEME_PREF, id);
      }
      return;
    }
    if (tc && Services.prefs.getIntPref(PREFS.themecolors.id, 0) === 1) copyColors();   // mirror
  }

  // ---- about:newtab accent ----
  // about:newtab / Appearance is NOT used for theming: its picker activates real Firefox themes and flips the
  // light/dark mode, and that code runs in privileged about: pages, out of reach of userContent.css. userContent.css hides
  // it. Instead the newtab's accent token (--bj-theme-src) is pushed from here as a user sheet,
  // so the newtab buttons / panels follow this panel's Colour source / Accent, and nothing else.
  const NEWTAB_SHEET_PREF = "uc.newtab.sheet";
  function applyNewtabAccent() {
    try {
      const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
      const accent = effectiveAccent();
      let spec = "";
      if (accent) {
        const css = `@-moz-document url-prefix("about:newtab"), url-prefix("about:home") {` +
          ` :root { --bj-theme-src: ${accent} !important; --bj-on-accent: ${readableOn(hexToRgb(accent))} !important; } }`;
        spec = "data:text/css;charset=utf-8," + encodeURIComponent(css);
      }
      const prev = Services.prefs.getStringPref(NEWTAB_SHEET_PREF, "");
      if (prev && prev !== spec) {
        const pu = Services.io.newURI(prev);
        if (sss.sheetRegistered(pu, sss.USER_SHEET)) sss.unregisterSheet(pu, sss.USER_SHEET);
      }
      if (spec) {
        const u = Services.io.newURI(spec);
        if (!sss.sheetRegistered(u, sss.USER_SHEET)) sss.loadAndRegisterSheet(u, sss.USER_SHEET);
      }
      if (prev !== spec) Services.prefs.setStringPref(NEWTAB_SHEET_PREF, spec);
    } catch (e) {
      log("newtab accent sheet failed", e);
    }
  }

  function refreshAll() {
    applyAppearance();
    applySidebarAccent();
    syncSwitches();
  }
  const darkToolbarMql = window.matchMedia("(-moz-toolbar-prefers-color-scheme: dark)");
  const darkPrefersMql = window.matchMedia("(prefers-color-scheme: dark)");
  const isDarkMode = () => {
    const mode = PREFS.themeMode.read();
    if (mode === 1) return true;
    if (mode === 0) return false;
    return darkToolbarMql.matches || darkPrefersMql.matches;
  };
  const shouldDimForDarkMode = () =>
    Services.prefs.getIntPref(PREFS.themecolors.id, 0) === 0 &&
    isDarkMode();

  // The accent actually in use: the theme's, or the Accent colour field's ("" = system accent)
  const effectiveAccent = () => {
    const tc = themeColorsActive();
    return tc ? tc.accent : accentOverride();
  };

  // The gradient colour actually in use: the theme's surface, or the Gradient colour field's.
  // When Colour source is "User Defined" (0) and Theme mode is "Dark" (1), lower luminosity by 100.
  const effectiveGradColor = () => {
    const tc = themeColorsActive();
    if (tc) return tc.surface;
    const base = colorPref(PREFS.gradcolor);
    if (!base) return "";
    return shouldDimForDarkMode() ? lowerLuminosity(base, 100) : base;
  };

  const backgroundImage = () => {
    let v = "";
    try { v = Services.prefs.getStringPref(PREFS.bgimage.id, ""); } catch (e) {}
    return /^(file|chrome|resource):/i.test(v) ? v : "";
  };
  // Fallback for --uc-bg-image when no image is chosen: chrome\1px-transparent.png in the profile (put there by install.ps1).
  // Resolved from the profile's chrome directory, so no chrome:// alias of the loader is needed. Only a successful lookup is cached,
  // so the file can appear later (installer run while Firefox is open) without a restart.
  const DEFAULT_BG_FILE = "1px-transparent.png";
  let defaultBgUrl = "";
  const defaultBackgroundImage = () => {
    if (defaultBgUrl) return defaultBgUrl;
    try {
      let dir;
      try { dir = Services.dirsvc.get("UChrm", Ci.nsIFile); }
      catch (e) { dir = Services.dirsvc.get("ProfD", Ci.nsIFile); dir.append("chrome"); }
      const f = dir.clone();
      f.append(DEFAULT_BG_FILE);
      if (f.exists()) defaultBgUrl = Services.io.newFileURI(f).spec;
    } catch (e) { log("default background image lookup failed", e); }
    return defaultBgUrl;
  };
  const panelTranslucent = () => {
    if (!backgroundImage() || !hasUserValue(PREFS.surface.id)) return false;
    return Services.prefs.getIntPref(PREFS.surface.id, 100) < 100;
  };
  const imageName = () => {
    const v = backgroundImage();
    if (!v) return "None";
    const last = v.split("/").pop();
    try { return decodeURIComponent(last); } catch (e) { return last; }
  };

  let appliedVars = {};

  // Pure: reads prefs only, never touches the DOM. Safe to call from any window's
  // context and reuse for a foreign document via applyAppearanceToDocument().
  function computeAppearanceVars() {
    const vars = {};
    const themeCols = themeColorsActive();

    if (hasUserValue(PREFS.gradient.id)) {
      const g = Math.min(PREFS.gradient.max, Math.max(PREFS.gradient.min, Services.prefs.getIntPref(PREFS.gradient.id, PREFS.gradient.defaultValue)));
      vars["--uc-gradient-amount"] = g + "%";
    }
    if (hasUserValue(PREFS.gradaccent.id)) {
      const g = Math.min(PREFS.gradaccent.max, Math.max(PREFS.gradaccent.min, Services.prefs.getIntPref(PREFS.gradaccent.id, PREFS.gradaccent.defaultValue)));
      vars["--uc-gradient-accent"] = g + "%";
    }

    Object.assign(vars, GLOW_LEVELS[Services.prefs.getIntPref(PREFS.glow.id, 2)] || {});

    const gradColor = effectiveGradColor();
    if (gradColor) vars["--uc-gradient-color"] = gradColor;

    // TWO-COLOUR GRADIENT: every gradient in the theme runs from --uc-gradient-hi (start) to --uc-gradient-lo (end), each mixed into the
    // surface colour by Gradient amount. Normally those are the surface colour lightened / darkened. With this switch on they become the
    // Accent colour (start) and the Gradient colour (end). Gradient amount = how far each end moves toward its colour (100% = pure colours).
    if (Services.prefs.getIntPref(PREFS.gradtwo.id, 0) === 1) {
      const accentHex = effectiveAccent() || hex(systemAccentRGB() || [0, 120, 215]);   // empty accent = system accent
      vars["--uc-gradient-hi"] = accentHex;
      vars["--uc-gradient-lo"] = gradColor || accentHex;                   // no Gradient colour set: both ends are the accent
    }

    if (hasUserValue(PREFS.gradangle.id)) {
      const a = Math.min(PREFS.gradangle.max, Math.max(PREFS.gradangle.min, Services.prefs.getIntPref(PREFS.gradangle.id, PREFS.gradangle.defaultValue)));
      vars["--uc-gradient-angle"] = a + "deg";
    }

    const custom = effectiveAccent();
    if (custom) {
      const rgb = [1, 3, 5].map((i) => parseInt(custom.slice(i, i + 2), 16));
      const text = readableOn(rgb);

      const opacity = themeCols ? 100 : Services.prefs.getIntPref(
        PREFS.accent.opacityPref.id,
        PREFS.accent.opacityPref.defaultValue
      );
      let accentWithAlpha = custom;
      if (opacity < 100) {
        const a = Math.max(0, Math.min(1, opacity / 100));
        accentWithAlpha = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
      }

      vars["--uc-accent-base"] = accentWithAlpha;
      vars["--uc-accent-text"] = text;
      Object.assign(vars, audioIcons(text));
    }

    const pct = (cfg) => Math.min(cfg.max, Math.max(cfg.min, Services.prefs.getIntPref(cfg.id, cfg.defaultValue)));
    const surface = hasUserValue(PREFS.surface.id) ? pct(PREFS.surface) : 100;
    const popup = hasUserValue(PREFS.popup.id) ? pct(PREFS.popup) : 100;
    if (hasUserValue(PREFS.surface.id)) vars["--uc-alpha-chrome"] = surface + "%";
    if (hasUserValue(PREFS.popup.id)) vars["--uc-alpha-popup"] = popup + "%";
    if (isDarkMode()) vars["--uc-bg-scrim"] = "50%";
    else if (hasUserValue(PREFS.dim.id)) vars["--uc-bg-scrim"] = pct(PREFS.dim) + "%";
    const image = backgroundImage();
    // Background image opacity
    const imgOpacity = hasUserValue(PREFS.imageopacity.id) ? pct(PREFS.imageopacity) : 50;
    vars["--uc-bg-image-opacity"] = (imgOpacity / 100).toString();
    // The variable is always defined: the chosen image, else the transparent default. The uc-bg-image flag below
    // still reflects only a user-chosen image, so the translucency logic is unchanged.
    const shownImage = image || defaultBackgroundImage();
    if (shownImage) vars["--uc-bg-image"] = 'url("' + shownImage.replace(/["\\]/g, encodeURIComponent) + '")';
    const tabs = hasUserValue(PREFS.tab.id) ? pct(PREFS.tab) : 100;
    if (hasUserValue(PREFS.tab.id)) vars["--uc-alpha-tab"] = tabs + "%";

    return {
      vars,
      flags: {
        bgImage: !!image,
        translucent: surface < 100,
        popupTranslucent: popup < 100,
        tabTranslucent: tabs < 100,
      },
    };
  }

  function applyAppearance() {
    const { vars, flags } = computeAppearanceVars();
    const rootEl = document.documentElement;
    const style = rootEl.style;
    for (const name of Object.keys(appliedVars)) {
      if (!(name in vars)) style.removeProperty(name);
    }
    for (const name of Object.keys(vars)) {
      if (appliedVars[name] !== vars[name]) style.setProperty(name, vars[name]);
    }
    appliedVars = vars;
    applyNewtabAccent();
    rootEl.toggleAttribute("uc-bg-image", flags.bgImage);
    rootEl.toggleAttribute("uc-translucent", flags.translucent);
    rootEl.toggleAttribute("uc-popup-translucent", flags.popupTranslucent);
    rootEl.toggleAttribute("uc-tab-translucent", flags.tabTranslucent);
  }

  // Apply to a *foreign* document (a new window's chrome document, created from this
  // window's observer). No diffing: fresh document, no previously-set vars.
  function applyAppearanceToDocument(doc) {
    if (!doc?.documentElement) return;
    const { vars, flags } = computeAppearanceVars();
    const rootEl = doc.documentElement;
    for (const name of Object.keys(vars)) {
      rootEl.style.setProperty(name, vars[name]);
    }
    rootEl.toggleAttribute("uc-bg-image", flags.bgImage);
    rootEl.toggleAttribute("uc-translucent", flags.translucent);
    rootEl.toggleAttribute("uc-popup-translucent", flags.popupTranslucent);
    rootEl.toggleAttribute("uc-tab-translucent", flags.tabTranslucent);
  }

  // Window variables the panel document must share, so its surface colours (01-tokens.css: --uc-surface-base)
  // resolve to the same values as the window's. The panel is a separate document: inline variables on the
  // window's :root do not reach it.
  const PANEL_FORWARD = ["--uc-gradient-color", "--uc-gradient-accent", "--uc-gradient-amount", "--uc-gradient-angle", "--uc-gradient-hi", "--uc-gradient-lo"];

  function applySidebarAccent(doc) {
    try {
      const root = (doc || getSidebarBrowser()?.contentDocument)?.documentElement;
      if (!root) return;
      const custom = effectiveAccent();
      if (custom) root.style.setProperty("--uc-accent-base", custom);
      else root.style.removeProperty("--uc-accent-base");

      // appliedVars is filled by applyAppearance(), which always runs before this
      for (const name of PANEL_FORWARD) {
        const v = appliedVars[name];
        if (v) root.style.setProperty(name, v);
        else root.style.removeProperty(name);
      }

      root.toggleAttribute("uc-panel-translucent", panelTranslucent());
    } catch (e) {}
  }

  function panelAccent() {
    const custom = effectiveAccent();
    if (!custom) return { bg: "AccentColor", fg: "AccentColorText" };
    return { bg: custom, fg: readableOn([1, 3, 5].map((i) => parseInt(custom.slice(i, i + 2), 16))) };
  }

  applyAppearance();

  const savedMode = Services.prefs.getIntPref(PREFS.selection.id, 0);
  if (savedMode !== 0) whenLoaded(() => applySelection(savedMode, false));

  function styleButton(btn, selected) {
    const accent = panelAccent();
    Object.assign(btn.style, {
      flex: "1",
      padding: "6px 8px",
      border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
      borderRadius: "6px",
      font: "inherit",
      cursor: "pointer",
      background: selected ? accent.bg : "color-mix(in srgb, currentColor 8%, transparent)",
      color: selected ? accent.fg : "inherit",
    });
    btn.setAttribute("aria-pressed", String(selected));
  }

  function styleInput(input) {
    Object.assign(input.style, {
      width: "7em",
      padding: "6px 8px",
      border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
      borderRadius: "6px",
      font: "inherit",
      background: "color-mix(in srgb, currentColor 8%, transparent)",
      color: "inherit",
    });
  }

  const defaultNumber = (config) => {
    if (config.defaultValue !== undefined) return config.defaultValue;
    try { return Services.prefs.getDefaultBranch("").getIntPref(config.id, 0); }
    catch (e) { return 0; }
  };

  function chooseImage() {
    try {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Background image", Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      fp.open((rv) => {
        if (rv !== Ci.nsIFilePicker.returnOK || !fp.fileURL) return;
        if (!hasUserValue(PREFS.surface.id)) Services.prefs.setIntPref(PREFS.surface.id, 80);
        Services.prefs.setStringPref(PREFS.bgimage.id, fp.fileURL.spec);
      });
    } catch (e) {}
  }

  let currentRoot = null;

  let loadWait = false;
  function afterSidebarLoad(fn) {
    if (loadWait) return;
    loadWait = true;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      loadWait = false;
      fn();
    };
    try {
      const win = (window.SidebarController?.browser ?? document.getElementById("sidebar"))?.contentWindow;
      if (win) win.addEventListener("load", go, { once: true });
    } catch (e) {}
    setTimeout(go, 1500);
  }

  function syncSwitches() {
    if (!currentRoot) return;
    // While the Firefox theme supplies the colours, the Accent and Gradient colour fields are inert (dimmed)
    const themeOn = !!themeColorsActive();
    for (const c of [PREFS.accent, PREFS.gradcolor]) {
      const fs = currentRoot.querySelector("#" + c.fsId);
      if (!fs) continue;
      fs.style.opacity = themeOn ? "0.45" : "";
      fs.style.pointerEvents = themeOn ? "none" : "";
    }
    for (const key in PREFS) {
      const config = PREFS[key];
      if (config.type === "color") {
        const input = currentRoot.querySelector(`.${config.fsId}-input`);
        if (input && input.getRootNode().activeElement !== input) {
          const tc = themeColorsActive();
          const own = config === PREFS.accent ? effectiveAccent() : effectiveGradColor();
          const shown = own || effectiveAccent();
          const sys = shown ? null : systemAccentRGB();
          const value = shown || (sys ? hex(sys) : "");
          if (value) input.value = value;
          else if (sidebarLoading()) afterSidebarLoad(syncSwitches);
        }
        if (config.opacityPref) {
          const opInput = currentRoot.querySelector(`.${config.fsId}-opacity-input`);
          if (opInput && opInput.getRootNode().activeElement !== opInput) {
            opInput.value = String(Services.prefs.getIntPref(config.opacityPref.id, config.opacityPref.defaultValue));
          }
        }
        continue;
      }
      if (config.type === "image") {
        const name = currentRoot.querySelector(`.${config.fsId}-name`);
        if (name) name.textContent = imageName();
        continue;
      }
      if (config.type === "number") {
        const input = currentRoot.querySelector(`.${config.fsId}-input`);
        if (input && input.getRootNode().activeElement !== input) {
          const val = (config === PREFS.dim && isDarkMode())
            ? 50
            : Services.prefs.getIntPref(config.id, defaultNumber(config));
          input.value = String(val);
        }
        continue;
      }
      const currentVal = config.read ? config.read() : Services.prefs.getIntPref(config.id, config.fallback ?? 2);
      const buttons = currentRoot.querySelectorAll(`.${config.fsId}-btn`);
      for (const btn of buttons) {
        styleButton(btn, Number(btn.dataset.value) === currentVal);
      }
    }
  }

  function findPanelRoot(doc) {
    for (const el of doc.querySelectorAll("*")) {
      const sr = el.shadowRoot;
      if (sr && sr.querySelector(".sidebar-panel-scrollable-content, #position")) return sr;
    }
    if (doc.querySelector(".sidebar-panel-scrollable-content, #position")) return doc;
    return null;
  }

  // Controls that are ALREADY in the panel are never rebuilt, so they would keep their old position forever.
  // This moves them into the current PANEL_ORDER instead (listeners and state are kept; nodes are only moved).
  function reorderControls(root) {
    const anchor = root.querySelector("#position")?.closest("moz-fieldset");
    const scroller = root.querySelector(".sidebar-panel-scrollable-content");
    if (!anchor && !scroller) return;
    for (const key of injectionOrder()) {
      const fs = root.querySelector(`#${PREFS[key].fsId}`);
      if (!fs) continue;
      if (anchor) anchor.insertAdjacentElement("afterend", fs);
      else scroller.prepend(fs);
    }
    log("controls already present, reordered to:", PANEL_ORDER.join(", "));
  }

  function injectControls(doc, root) {
    if (root.querySelector(`#${PREFS.density.fsId}`)) {
      reorderControls(root);
      return;
    }

    const anchor = root.querySelector("#position")?.closest("moz-fieldset");
    const scroller = root.querySelector(".sidebar-panel-scrollable-content");
    if (!anchor && !scroller) return;

    for (const key of injectionOrder()) {
      const config = PREFS[key];
      const fs = doc.createElement("moz-fieldset");
      fs.id = config.fsId;
      fs.className = "customize-group medium-top-margin";
      fs.setAttribute("label", config.label);

      const row = doc.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px", marginTop: "4px" });

      if (config.type === "color") {
        const input = doc.createElement("input");
        input.type = "color";
        input.className = `${config.fsId}-input`;
        Object.assign(input.style, {
          width: "3.5em",
          height: "2em",
          padding: "0 2px",
          border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
          borderRadius: "6px",
          background: "transparent",
          cursor: "pointer",
        });
        input.addEventListener("change", () => Services.prefs.setStringPref(config.id, input.value));

        const reset = doc.createElement("button");
        reset.textContent = config.resetLabel || "System";
        styleButton(reset, false);
        reset.style.flex = "none";
        reset.addEventListener("click", () => {
          Services.prefs.clearUserPref(config.id);
          syncSwitches();
        });

        const pick = doc.createElement("button");
        pick.textContent = "Pick";
        pick.title = "Eyedropper: click any pixel on screen (Esc to cancel)";
        styleButton(pick, false);
        pick.style.flex = "none";
        pick.addEventListener("click", () => {
          startEyedropper((color) => Services.prefs.setStringPref(config.id, color));
        });

        row.append(input, pick, reset);
        fs.appendChild(row);

        if (config.opacityPref) {
          const opRow = doc.createElement("div");
          Object.assign(opRow.style, { display: "flex", gap: "6px", marginTop: "6px" });

          const opInput = doc.createElement("input");
          opInput.type = "text";
          opInput.inputMode = "numeric";
          opInput.className = `${config.fsId}-opacity-input`;
          opInput.title = config.opacityPref.label;
          styleInput(opInput);
          opInput.addEventListener("change", () => {
            let v = parseInt(opInput.value, 10);
            if (Number.isNaN(v)) v = Services.prefs.getIntPref(config.opacityPref.id, config.opacityPref.defaultValue);
            v = Math.min(config.opacityPref.max, Math.max(config.opacityPref.min, v));
            opInput.value = String(v);
            Services.prefs.setIntPref(config.opacityPref.id, v);
          });

          const opReset = doc.createElement("button");
          opReset.textContent = "Solid";
          styleButton(opReset, false);
          opReset.style.flex = "none";
          opReset.addEventListener("click", () => {
            Services.prefs.clearUserPref(config.opacityPref.id);
            syncSwitches();
          });

          opRow.append(opInput, opReset);
          fs.appendChild(opRow);
        }

        if (anchor) anchor.insertAdjacentElement("afterend", fs);
        else scroller.prepend(fs);
        continue;
      }

      if (config.type === "image") {
        const name = doc.createElement("span");
        name.className = `${config.fsId}-name`;
        Object.assign(name.style, { flex: "1", minWidth: "0", alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: "0.8" });
        const choose = doc.createElement("button");
        choose.textContent = "Choose\u2026";
        styleButton(choose, false);
        choose.style.flex = "none";
        choose.addEventListener("click", () => chooseImage());
        const clear = doc.createElement("button");
        clear.textContent = "Clear";
        styleButton(clear, false);
        clear.style.flex = "none";
        clear.addEventListener("click", () => {
          Services.prefs.clearUserPref(config.id);
          syncSwitches();
        });
        row.append(name, choose, clear);
        fs.appendChild(row);
        if (anchor) anchor.insertAdjacentElement("afterend", fs);
        else scroller.prepend(fs);
        continue;
      }

      if (config.type === "number") {
        const input = doc.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.className = `${config.fsId}-input`;
        styleInput(input);
        input.addEventListener("change", () => {
          let v = parseInt(input.value, 10);
          if (Number.isNaN(v)) v = Services.prefs.getIntPref(config.id, defaultNumber(config));
          v = Math.min(config.max, Math.max(config.min, v));
          input.value = String(v);
          Services.prefs.setIntPref(config.id, v);
        });
        const reset = doc.createElement("button");
        reset.textContent = "Reset";
        styleButton(reset, false);
        reset.style.flex = "none";
        reset.addEventListener("click", () => {
          Services.prefs.clearUserPref(config.id);
          syncSwitches();
        });
        row.append(input, reset);
        fs.appendChild(row);
        if (anchor) anchor.insertAdjacentElement("afterend", fs);
        else scroller.prepend(fs);
        continue;
      }

      for (const [value, label] of config.options) {
        const btn = doc.createElement("button");
        btn.className = `${config.fsId}-btn`;
        btn.dataset.value = String(value);
        btn.textContent = label;
        btn.addEventListener("click", () => {
          if (config.apply) config.apply(value);
          else Services.prefs.setIntPref(config.id, value);
          // Setting a pref to its current value fires no observer; re-apply explicitly so the window + panel
          // variables are rebuilt, not just the swatches.
          refreshAll();
        });
        row.appendChild(btn);
      }
      fs.appendChild(row);
      if (anchor) anchor.insertAdjacentElement("afterend", fs);
      else scroller.prepend(fs);
    }

    currentRoot = root;
    syncSwitches();
    log("controls injected, PANEL_ORDER:", PANEL_ORDER.join(", "));
  }

  const getSidebarBrowser = () => window.SidebarController?.browser ?? document.getElementById("sidebar");

  let observers = [];
  function stopWaiting() {
    observers.forEach(o => o.disconnect());
    observers = [];
  }

  function tryInject(doc) {
    const root = findPanelRoot(doc);
    if (!root) return false;
    currentRoot = root;
    injectControls(doc, root);
    return true;
  }

  function whenReady(doc) {
    stopWaiting();
    if (tryInject(doc)) return;
    const watch = (target) => {
      const mo = new MutationObserver(() => {
        for (const el of doc.querySelectorAll("*")) {
          if (el.shadowRoot && !el.shadowRoot.__ucWatched) {
            el.shadowRoot.__ucWatched = true;
            watch(el.shadowRoot);
          }
        }
        if (tryInject(doc)) stopWaiting();
      });
      mo.observe(target, { childList: true, subtree: true });
      observers.push(mo);
    };
    watch(doc);
  }

  function onSidebarLoad() {
    const browser = getSidebarBrowser();
    const doc = browser?.contentDocument;
    const href = doc?.location?.href;
    currentRoot = null;
    stopWaiting();
    applySidebarAccent(doc);
    if (href?.startsWith(PANEL_URL)) whenReady(doc);
  }

  // ---- early accent injection for newly-created panel documents ----
  // The panel document is a separate document: vars on the main window's :root do not
  // reach it. onSidebarLoad() fires from DOMContentLoaded, which for the Customize panel
  // can land ~1s after first paint, which is why the accent background flashes there.
  // applySidebarAccentWhenReady runs at DOMWindowCreated time, before the panel parses,
  // so the forwarded vars exist before the panel paints.

  function applySidebarAccentWhenReady(doc) {
    if (!doc) return;
    if (doc.documentElement) {
      applySidebarAccent(doc);
      return;
    }
    let done = false;
    let mo = null;
    const fire = () => {
      if (done) return;
      done = true;
      try { mo?.disconnect(); } catch (e) {}
      applySidebarAccent(doc);
    };
    try {
      mo = new MutationObserver(() => {
        if (doc.documentElement) fire();
      });
      mo.observe(doc, { childList: true });
    } catch (e) {
      fire();
      return;
    }
    try { doc.addEventListener("DOMContentLoaded", fire, { once: true }); } catch (e) {}
    // Safety net: if documentElement never appears (shouldn't happen), still try once.
    setTimeout(fire, 2000);
  }

  function onSidebarWindowCreated(ev) {
    try {
      const target = ev.target;
      const doc = target?.nodeType === 9 ? target : target?.document;
      if (!doc) return;
      if (!Object.keys(appliedVars).length) applyAppearance();
      applySidebarAccentWhenReady(doc);
    } catch (e) {}
  }

  let hookedSidebarBrowser = null;

  function installSidebarBrowserHook() {
    const browser = getSidebarBrowser();
    if (!browser) return;
    if (browser === hookedSidebarBrowser) return;
    if (hookedSidebarBrowser) {
      try { hookedSidebarBrowser.removeEventListener("DOMWindowCreated", onSidebarWindowCreated, true); } catch (e) {}
    }
    hookedSidebarBrowser = browser;
    browser.addEventListener("DOMWindowCreated", onSidebarWindowCreated, true);

    // If a panel is already loaded in this browser element, apply to it now.
    try {
      const doc = browser.contentDocument;
      if (doc?.documentElement) applySidebarAccent(doc);
    } catch (e) {}
  }

  // ---- early appearance injection for newly-created browser windows ----
  // Same root cause for the main chrome window: on Ctrl+N (or session restore) the new
  // window paints once before its UserScript runs, so the first frame is AccentColor
  // instead of the gradient. chrome-document-global-created fires when the new window's
  // chrome document is created, from THIS window's JS context. We write the appearance
  // vars onto the new document's :root before first paint, then the new window's own
  // script instance runs and re-applies (idempotent). The first window is handled by
  // applyAppearance() at init plus @run-at document-start where the loader supports it.

  function isBrowserChromeDocument(doc) {
    const el = doc?.documentElement;
    if (!el) return null;               // documentElement not there yet
    if (el.localName !== "window") return false;
    return el.getAttribute("windowtype") === "navigator:browser";
  }

  const newWindowObserver = {
    observe(subject, topic) {
      if (topic !== "chrome-document-global-created") return;
      try {
        const doc = subject;
        if (!doc || doc.nodeType !== 9) return;

        const tryApply = () => {
          const isBrowser = isBrowserChromeDocument(doc);
          if (isBrowser === null) return false;
          if (isBrowser) applyAppearanceToDocument(doc);
          return true;
        };
        if (tryApply()) return;

        const mo = new MutationObserver(() => {
          if (tryApply()) mo.disconnect();
        });
        mo.observe(doc, { childList: true });
        setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 3000);
      } catch (e) {}
    }
  };

  try {
    Services.obs.addObserver(newWindowObserver, "chrome-document-global-created");
  } catch (e) {
    log("chrome-document-global-created observer failed", e);
  }

  const sidebar = getSidebarBrowser();
  if (sidebar) {
    sidebar.addEventListener("DOMContentLoaded", onSidebarLoad, true);
  }

  onSidebarLoad();
  installSidebarBrowserHook();

  let lastAccent = effectiveAccent();
  const prefObserver = {
    observe() {
      applyAppearance();
      applySidebarAccent();
      installSidebarBrowserHook();
      const accent = effectiveAccent();
      if (accent !== lastAccent) {
        lastAccent = accent;
        invalidateDynamicColors();
        const mode = Services.prefs.getIntPref(PREFS.selection.id, 0);
        if (mode !== 0) whenLoaded(() => applySelection(mode, false));
      }
      syncSwitches();
    }
  };

  const watchedPrefs = [];
  for (const key in PREFS) {
    const c = PREFS[key];
    watchedPrefs.push(c.id);
    if (c.opacityPref) watchedPrefs.push(c.opacityPref.id);
  }
  for (const id of watchedPrefs) Services.prefs.addObserver(id, prefObserver);

  // THEME CHANGES. Must not depend on the Customize panel being open, and must not depend on ONE signal: Firefox rewrites its inline variables
  // on :root a moment after the theme changes, in an order we do not control, and the first run of this script (document-start) is before
  // any theme is applied. So several independent triggers all start the same "refresh burst" (re-read the theme and re-apply at 0 / 150 / 400 /
  // 1000 / 2000 ms; unchanged values write nothing):
  //   1) pref extensions.activeThemeID      (set when the user picks another theme)
  //   2) obs topic lightweight-theme-styling-update (Firefox's own "theme colours changed" notification)
  //   3) AddonManager onEnabled / onDisabled for add-ons of type "theme"
  //   4) the toolbar colour scheme changing (light <-> dark)
  //   5) root's style / lwtheme / lwthemetextcolor attributes, gated by a signature of the theme variables so our own writes are ignored
  const themeSignature = () => {
    const el = document.documentElement;
    return THEME_SURFACE_VARS.concat(THEME_ACCENT_VARS).map((n) => el.style.getPropertyValue(n)).join("|") +
      "|" + el.getAttribute("lwtheme") + "|" + el.getAttribute("lwthemetextcolor");
  };
  let themeSig = themeSignature();
  let themeTimers = [];
  const themeRefresh = () => {
    themeTimers.forEach(clearTimeout);
    themeTimers = [0, 150, 400, 1000, 2000].map((ms) => setTimeout(() => {
      themeSig = themeSignature();
      invalidateDynamicColors();
      try { syncThemeSource(ms === 2000); } catch (e) { log("syncThemeSource failed", e); }
      prefObserver.observe();
    }, ms));
  };
  const themeObserver = new MutationObserver(() => {
    const sig = themeSignature();
    if (sig === themeSig) return;
    themeSig = sig;
    themeRefresh();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "lwtheme", "lwthemetextcolor"] });

  // Prefs after which Firefox rewrites the theme variables (active theme, toolbar/content theme mode, content scheme)
  const THEME_PREFS = [THEME_PREF, "browser.theme.toolbar-theme", "browser.theme.content-theme", PREFS.color.id, PREFS.themeMode.id];
  const themePrefObserver = { observe: themeRefresh };
  for (const id of THEME_PREFS) { try { Services.prefs.addObserver(id, themePrefObserver); } catch (e) {} }

  const THEME_TOPIC = "lightweight-theme-styling-update";
  const themeTopicObserver = { observe: themeRefresh };
  try { Services.obs.addObserver(themeTopicObserver, THEME_TOPIC); } catch (e) {}

  let AddonMgr = null;
  const themeAddonListener = {
    onEnabled(addon) { if (addon && addon.type === "theme") themeRefresh(); },
    onDisabled(addon) { if (addon && addon.type === "theme") themeRefresh(); },
  };
  try {
    ({ AddonManager: AddonMgr } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs"));
    AddonMgr.addAddonListener(themeAddonListener);
  } catch (e) { AddonMgr = null; }

  darkToolbarMql.addEventListener("change", themeRefresh);
  darkPrefersMql.addEventListener("change", themeRefresh);

  // theme could already be applied by the time this runs (script loaded late): catch up once
  themeRefresh();

  window.addEventListener("unload", () => {
    for (const id of watchedPrefs) {
      try { Services.prefs.removeObserver(id, prefObserver); } catch (e) {}
    }
    try { Services.obs.removeObserver(newWindowObserver, "chrome-document-global-created"); } catch (e) {}
    themeObserver.disconnect();
    themeTimers.forEach(clearTimeout);
    for (const id of THEME_PREFS) { try { Services.prefs.removeObserver(id, themePrefObserver); } catch (e) {} }
    try { Services.obs.removeObserver(themeTopicObserver, THEME_TOPIC); } catch (e) {}
    try { AddonMgr && AddonMgr.removeAddonListener(themeAddonListener); } catch (e) {}
    try { darkToolbarMql.removeEventListener("change", themeRefresh); } catch (e) {}
    try { darkPrefersMql.removeEventListener("change", themeRefresh); } catch (e) {}
    if (sidebar) sidebar.removeEventListener("DOMContentLoaded", onSidebarLoad, true);
    if (hookedSidebarBrowser) {
      try { hookedSidebarBrowser.removeEventListener("DOMWindowCreated", onSidebarWindowCreated, true); } catch (e) {}
    }
    stopWaiting();
  }, { once: true });
})();
