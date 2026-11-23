// ==UserScript==
// @name            FaviconUpgrader.uc.js
// @description     Port of the Favicon Upgrader extension (0.7.2) + fixes: animated icons are never flattened, pages that swap icons
//                  themselves are passed through, no 48h 'keep' verdicts from a failed HTML fetch, menu item no longer trips MenuSectionLayout (Fx 160). Replaces a site's small tab icon with the best one it offers
//                  (apple-touch icon, web manifest, /favicon.ico ...), rendered to a sharp <=64px PNG. Per-site manual override
//                  from the tab context menu ("Change favicon…"): pick a found icon, paste your own, "Site's own", "Automatic".
//                  Runs with chrome privileges: no CORS limits, no content script, tab icon set through gBrowser.setIcon.
//                  Bookmarks, history and the address-bar dropdown: the same icon is written into Firefox's favicon database
//                  (Places). This also replaces the "Cache Favicons for Bookmarks" extension: Cache-Control: no-store icons no longer
//                  leave a globe. Scope (panel, "Bookmarks & address bar"): chosen sites only / all sites / off.
//                  Pref: extensions.uc.faviconUpgrader.placesScope (all | sites | off).
// @include         main
// ==/UserScript==

(() => {
  "use strict";

  if (location.href !== "chrome://browser/content/browser.xhtml") return;
  if (window.__ucFaviconUpgrader) return; // one instance per window
  window.__ucFaviconUpgrader = true;

  const ID = "uc-fav-upgrader";
  const XHTML = "http://www.w3.org/1999/xhtml";
  const warn = (...a) => console.warn("[uc] FaviconUpgrader:", ...a);
  const debug = (...a) => CONFIG.debug && console.debug("[uc] FaviconUpgrader:", ...a);

  // ---- Tunables (same meaning as CONFIG in the extension's background.js) -------------------
  const CONFIG = {
    goodEnough: 32,            // px. An icon this big (or an SVG) is left alone: 32-96 px is sharp in the tab, bookmarks and address bar. Only smaller
                               // ones (16/24 px) get replaced, and only if a bigger candidate exists; a bigger one is always better than 16 px.
    outputSize: 64,            // px. Max edge of the rasterised replacement (never upscaled).
    fetchTimeoutMs: 6000,
    maxBytes: 3 * 1024 * 1024, // ignore icon files larger than this
    maxHtmlBytes: 512 * 1024,  // how much of the page's HTML is read to find its <link> icons
    rasterizeSvg: true,        // true: SVGs are drawn to a PNG at svgRasterSize px; false: passed through as vectors
    svgRasterSize: 64,
    maxSvgBytes: 40 * 1024,    // vector pass-through only
    maxCandidates: 16,
    densityUpgrade: true,      // an icon address with a "1x" path segment (WhatsApp: /favicon/1x/f01/v4/) is also tried as 4x, 3x and 2x; the biggest that answers wins
    replaceTtlMs: 14 * 24 * 3600e3,
    keepTtlMs: 2 * 24 * 3600e3,
    respectTransparency: false, // false: biggest icon wins; true: prefer icons with real transparency
    maxCacheEntries: 2500,
    maxCacheBytes: 6 * 1024 * 1024,
    pruneEveryWrites: 50,
    autoWindowMs: 8000,        // after a page load, an automatic pick replaces EVERY icon Firefox sets for this long. Afterwards the page's static icon
                               // (an address it declares, or one it showed while loading) is replaced by our pick, and dynamic ones (badges, loading / done)
                               // are only sharpened when they are SVGs (see tryUpgrade). Set to Infinity to replace every icon with our pick instead.
    flushDelayMs: 3000,        // debounce for writing the cache file
    dynamicAfterIcons: 3,      // a page that sets more than this many DISTINCT icon addresses in one page load is animating / badging
                               // its icon itself: we stop replacing and only sharpen SVG frames (tryUpgrade).
    incompleteTtlMs: 10 * 60e3, // a verdict reached from incomplete data (no HTML at all, or a page that declares neither an apple-touch icon nor a manifest yet) is only trusted this long
    settleReads: 6,            // live-DOM reads while waiting for the page to finish declaring its icons (WhatsApp Web injects them late)
    settleDelayMs: 700,        // pause between those reads; a lookup stops early once two reads in a row agree and the document is complete
    debug: false,
    // ---- Bookmarks, history and the address-bar dropdown (Places favicon database) ------------------
    placesScope: "sites",      // "sites": only sites you picked / uploaded an icon for or switched on in the panel | "all": every site, written in the
                               // background (up to sweepMaxLookups network lookups per start until every bookmarked site is done) | "off".
                               // The pref extensions.uc.faviconUpgrader.placesScope (the panel's buttons) wins over this default.
    blockFirefoxIcons: true,   // drop Firefox's own non-rich setFaviconForPage write for a site we replace (LinkHandlerParent), so its small icon never
                               // lands next to ours. false: leave Firefox alone; the 1.2 s / 5 s re-check then puts ours back.
    sharpenOwn: true,          // a site whose own icon is kept (it is already good enough for the tab) still gives Places ONE sharp PNG of it.
                               // Firefox stores its own copy of an icon in several sizes and serves the 16px one to a 16px slot (address-bar
                               // dropdown, bookmarks): blurry on a scaled display, and the smallest frame of a multi-size .ico is no better.
    sharpenOwnMin: 32,         // only when the icon itself is at least this many px (a 16px icon has nothing to give)
    placesExpiryMs: 14 * 24 * 3600e3, // how long Places treats a stored icon as fresh (Firefox may cap it lower; harmless)
    placesHistoryPages: 150,   // per site: history pages (besides every bookmark) that get the icon when the site is first written
    placesSyncDelaysMs: [1200, 5000], // after a tab's icon event: write that page's icon, then check once more
    sweep: true,               // background pass over bookmarked sites this script has not looked up yet (once per site)
    sweepStartDelayMs: 20000,
    sweepDelayMs: 1500,        // pause after every site that needs a network lookup
    sweepMaxLookups: 400,      // lookups per start; the rest waits for the next start
  };
  const CACHE_VERSION = 9; // bump when decision logic or CONFIG policy changes
  const KEEP = { action: "keep" };
  const DEFAULT_PATHS = ["/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"];
  const MAX_OVERRIDE_DATAURL = 150 * 1024;
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
  const MAX_UPLOAD_SVG_BYTES = 40 * 1024;

  // ---- Private windows: do nothing (the extension is off there by default too) ---------------
  let PBU = null;
  try {
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    PBU = PrivateBrowsingUtils;
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return;
  } catch (e) {
    warn("PrivateBrowsingUtils unavailable:", e);
  }

  // ---- Small DOM helper (no innerHTML in chrome) ---------------------------------------------
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

  // =============================================================================================
  // Persistence: two small JSON files in the profile folder (shared by all windows, merged on write)
  //   favicon-upgrader-cache.json      automatic verdicts per origin (expire)
  //   favicon-upgrader-overrides.json  manual choices per origin (never pruned; "auto" = tombstone)
  // =============================================================================================
  const CACHE_PATH = PathUtils.join(PathUtils.profileDir, "favicon-upgrader-cache.json");
  const OVERRIDES_PATH = PathUtils.join(PathUtils.profileDir, "favicon-upgrader-overrides.json");
  const TOMBSTONE_TTL = 30 * 24 * 3600e3;

  const cache = new Map();     // origin -> { v, expires, result }
  const overrides = new Map(); // origin -> { type, ..., t }   ("places:<origin>" -> { type: "places", on, t } = "Include this site")
  const placed = new Map();    // origin -> icon hash last written to Places ("F" replacement, "E" site's own, "N<day>" lookup failed); lives in the cache file
  let cacheDirty = false;
  let writesSincePrune = 0;
  let flushTimer = null;
  let ioChain = Promise.resolve(); // serialise file access so two flushes never interleave

  const readJSON = async (path) => {
    try { return await IOUtils.readJSON(path); } catch { return null; }
  };
  const writeJSON = async (path, obj) => {
    try { await IOUtils.writeJSON(path, obj, { tmpPath: path + ".tmp" }); } catch (e) { warn("write failed:", path, e); }
  };
  const queueIO = (fn) => (ioChain = ioChain.then(fn, fn).catch((e) => warn("io:", e)));

  const entryLive = (e) => e && e.v === CACHE_VERSION && typeof e.expires === "number" && e.expires > Date.now() && e.result;
  const entryBytes = (e) => ((e && e.result && typeof e.result.dataUrl === "string" && e.result.dataUrl.length) || 0) + 200;

  // `any`: also accept an entry a background lookup made without a live page. A tab visit does not (it redoes that lookup).
  function cacheGet(origin, any = false) {
    const e = cache.get(origin);
    if (!entryLive(e)) return null;
    if (e.result && e.result.action === "keep" && e.result.sharp !== 2) return null; // made by an older version of the Places logic: redo it
    if (!any && e.sweep && e.thin) return null;
    return e;
  }

  function cachePut(origin, entry) {
    cache.set(origin, entry);
    cacheDirty = true;
    if (++writesSincePrune >= CONFIG.pruneEveryWrites) { writesSincePrune = 0; pruneCache(); }
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushCache, CONFIG.flushDelayMs);
  }

  // Expired entries are ignored on read but only deleted here. Enforces the entry cap and the byte budget
  // (soonest-to-expire first; "keep" records free nothing, so only entries that hold an icon are evicted for bytes).
  function pruneCache() {
    const drop = new Set();
    for (const [k, e] of cache) if (!entryLive(e)) drop.add(k);
    const live = [...cache].filter(([k]) => !drop.has(k)).sort((a, b) => a[1].expires - b[1].expires);
    const excess = live.length - CONFIG.maxCacheEntries;
    if (excess > 0) live.splice(0, excess).forEach(([k]) => drop.add(k));
    let bytes = live.reduce((n, [k, e]) => (drop.has(k) ? n : n + entryBytes(e)), 0);
    for (const [k, e] of live) {
      if (bytes <= CONFIG.maxCacheBytes) break;
      if (drop.has(k) || !(e.result && e.result.dataUrl)) continue;
      drop.add(k);
      bytes -= entryBytes(e);
    }
    for (const k of drop) cache.delete(k);
    if (drop.size) { cacheDirty = true; debug("pruned", drop.size); }
  }

  function flushCache() {
    clearTimeout(flushTimer);
    if (!cacheDirty) return Promise.resolve();
    return queueIO(async () => {
      const disk = await readJSON(CACHE_PATH);
      if (disk && disk.v === CACHE_VERSION && disk.entries) {
        for (const [k, e] of Object.entries(disk.entries)) {
          const mine = cache.get(k);
          if (entryLive(e) && (!mine || e.expires > mine.expires)) cache.set(k, e);
        }
      }
      if (disk && disk.v === CACHE_VERSION && disk.placed) {
        for (const [k, v] of Object.entries(disk.placed)) if (typeof v === "string" && !placed.has(k) && !placedGone.has(k)) placed.set(k, v);
      }
      pruneCache();
      cacheDirty = false;
      await writeJSON(CACHE_PATH, { v: CACHE_VERSION, entries: Object.fromEntries(cache), placed: Object.fromEntries(placed) });
    });
  }

  const overrideGet = (origin) => {
    const o = overrides.get(origin);
    return o && (o.type === "pick" || o.type === "upload" || o.type === "off") ? o : null;
  };

  // Newest "t" wins per origin. Returns the origins whose effective override changed.
  function mergeOverrides(entries) {
    const changed = [];
    for (const [k, o] of Object.entries(entries || {})) {
      if (!o || typeof o !== "object") continue;
      const mine = overrides.get(k);
      if ((o.t || 0) > ((mine && mine.t) || 0)) { overrides.set(k, o); changed.push(k); }
    }
    return changed;
  }

  function flushOverrides() {
    return queueIO(async () => {
      const disk = await readJSON(OVERRIDES_PATH);
      mergeOverrides(disk && disk.entries);
      const now = Date.now();
      for (const [k, o] of overrides) if ((o.type === "auto" || (o.type === "places" && !o.on)) && now - (o.t || 0) > TOMBSTONE_TTL) overrides.delete(k);
      await writeJSON(OVERRIDES_PATH, { entries: Object.fromEntries(overrides) });
    });
  }

  function setOverride(origin, ov) {
    overrides.set(origin, { ...ov, t: Date.now() });
    return flushOverrides();
  }

  async function refreshOverrides() {
    const disk = await readJSON(OVERRIDES_PATH);
    return mergeOverrides(disk && disk.entries);
  }

  // =============================================================================================
  // Image helpers (ported from shared.js + background.js; canvases are OffscreenCanvas in this window)
  // =============================================================================================
  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function canvasToPngDataUrl(canvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return "data:image/png;base64," + toBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  // Renders SVG bytes to a PNG data URL at a fixed pixel size, so the tab always gets a sharp bitmap.
  async function svgBytesToPngDataUrl(bytes, size) {
    const text = new TextDecoder().decode(bytes);
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.localName !== "svg" || doc.querySelector("parsererror")) throw new Error("Not a valid SVG");

    const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    let w;
    let hh;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = vb[2];
      hh = vb[3];
    } else {
      w = parseFloat(root.getAttribute("width"));
      hh = parseFloat(root.getAttribute("height"));
      if (!(w > 0 && hh > 0)) w = hh = 100;
      root.setAttribute("viewBox", "0 0 " + w + " " + hh);
    }
    const scale = size / Math.max(w, hh);
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(hh * scale));
    root.setAttribute("width", String(outW));
    root.setAttribute("height", String(outH));

    const img = document.createElementNS(XHTML, "img");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(root));
    await img.decode();

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, Math.round((size - outW) / 2), Math.round((size - outH) / 2), outW, outH);
    return canvasToPngDataUrl(canvas);
  }

  const isPng = (u, o = 0) => u[o] === 0x89 && u[o + 1] === 0x50 && u[o + 2] === 0x4e && u[o + 3] === 0x47;

  // True for APNG, looping GIF and animated WebP: rasterising those would freeze them on their first frame.
  const isAnimated = (u) => {
    try {
      if (isPng(u)) { // APNG: an acTL chunk appears before the first IDAT
        for (let o = 8; o + 8 <= u.length;) {
          const len = ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
          const type = String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]);
          if (type === "acTL") return true;
          if (type === "IDAT") return false;
          o += 12 + len;
        }
        return false;
      }
      if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) { // GIF: NETSCAPE2.0 loop extension
        return new TextDecoder("latin1").decode(u.subarray(0, Math.min(u.length, 2048))).includes("NETSCAPE2.0");
      }
      if (u.length > 21 && String.fromCharCode(...u.subarray(8, 12)) === "WEBP") { // WebP: VP8X animation flag
        return String.fromCharCode(...u.subarray(12, 16)) === "VP8X" && (u[20] & 0x02) !== 0;
      }
    } catch { /* treat as static */ }
    return false;
  };

  // Returns { mime, w, h, data, animated, tooBig? } or null if it isn't a usable image.
  async function sniff(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length > 24 && isPng(bytes)) return { mime: "image/png", w: dv.getUint32(16), h: dv.getUint32(20), data: bytes, animated: isAnimated(bytes) };

    if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return { mime: "image/gif", w: dv.getUint16(6, true), h: dv.getUint16(8, true), data: bytes, animated: isAnimated(bytes) };
    }

    // ICO: 00 00 01 00, then <count> 16-byte directory entries.
    if (bytes.length > 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
      const count = dv.getUint16(4, true);
      let best = null;
      for (let i = 0; i < count && 6 + 16 * (i + 1) <= bytes.length; i++) {
        const o = 6 + 16 * i;
        let w = bytes[o] || 256; // the directory says 0 for 256 ...
        let hh = bytes[o + 1] || 256;
        const size = dv.getUint32(o + 8, true);
        const offset = dv.getUint32(o + 12, true);
        // ... but some generators write 0 for EVERY frame (16, 32 and 48 px all "256"), which made a 16px icon look huge and the
        // script keep it. The frame's own header tells the truth: PNG IHDR, or the BITMAPINFOHEADER of a BMP frame.
        if ((!bytes[o] || !bytes[o + 1]) && offset + 24 <= bytes.length) {
          if (isPng(bytes, offset)) { w = dv.getUint32(offset + 16); hh = dv.getUint32(offset + 20); }
          else if (dv.getUint32(offset, true) >= 40) { w = Math.abs(dv.getInt32(offset + 4, true)); hh = Math.abs(dv.getInt32(offset + 8, true)) / 2; }
        }
        if (!best || w * hh > best.w * best.h) best = { w, h: hh, size, offset, i };
      }
      if (!best) return null;
      if (isPng(bytes, best.offset)) {
        return { mime: "image/png", w: best.w, h: best.h, data: bytes.slice(best.offset, best.offset + best.size), ico: count };
      }
      // BMP frame: hand the decoder an ICO that holds ONLY the biggest frame, so it cannot pick a smaller one.
      if (best.offset + best.size <= bytes.length) {
        const one = new Uint8Array(22 + best.size);
        one.set([0, 0, 1, 0, 1, 0]);
        one.set(bytes.subarray(6 + 16 * best.i, 6 + 16 * best.i + 16), 6);
        new DataView(one.buffer).setUint32(18, 22, true);
        one.set(bytes.subarray(best.offset, best.offset + best.size), 22);
        return { mime: "image/x-icon", w: best.w, h: best.h, data: one, ico: count };
      }
      return { mime: "image/x-icon", w: best.w, h: best.h, data: bytes, ico: count };
    }

    // SVG (text). Check the head first so we don't decode huge non-text files.
    const head = new TextDecoder().decode(bytes.subarray(0, 1024));
    if (/<svg[\s>]/i.test(head) || (/<\?xml|<!DOCTYPE svg/i.test(head) && /<svg[\s>]/i.test(new TextDecoder().decode(bytes)))) {
      return { mime: "image/svg+xml", w: 0, h: 0, data: bytes, tooBig: !CONFIG.rasterizeSvg && bytes.length > CONFIG.maxSvgBytes };
    }

    // JPEG / WebP: let the browser tell us the dimensions.
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp =
      bytes.length > 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
    if (isJpeg || isWebp) {
      const mime = isJpeg ? "image/jpeg" : "image/webp";
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      const info = { mime, w: bmp.width, h: bmp.height, data: bytes, animated: isWebp && isAnimated(bytes) };
      bmp.close();
      return info;
    }
    return null; // HTML error pages, unknown formats, etc.
  }

  // Decode a raster candidate and draw it, centred and never upscaled, onto a transparent square canvas.
  async function rasterize(p, maxEdge) {
    const bmp = await createImageBitmap(new Blob([p.data], { type: p.mime }));
    const longest = Math.max(bmp.width, bmp.height);
    const edge = Math.min(maxEdge, longest);
    const scale = edge / longest;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hh = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(edge, edge);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, edge, edge);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const x = Math.round((edge - w) / 2);
    const y = Math.round((edge - hh) / 2);
    ctx.drawImage(bmp, x, y, w, hh);
    bmp.close();
    return { canvas, ctx, edge, rect: { x, y, w, h: hh } };
  }

  async function render(best) {
    if (best.mime === "image/svg+xml") {
      if (CONFIG.rasterizeSvg) {
        try {
          return { mime: "image/png", dataUrl: await svgBytesToPngDataUrl(best.data, CONFIG.svgRasterSize) };
        } catch (err) {
          debug("SVG rasterising failed:", err);
          if (best.data.length > CONFIG.maxSvgBytes) throw err;
        }
      }
      return { mime: best.mime, dataUrl: "data:image/svg+xml;base64," + toBase64(best.data) };
    }
    const { canvas } = await rasterize(best, CONFIG.outputSize);
    return { mime: "image/png", dataUrl: await canvasToPngDataUrl(canvas) };
  }

  // True if the image has any meaningfully transparent pixel (decoded pixels, not file headers).
  async function detectAlpha(p) {
    if (p.mime === "image/svg+xml") return true;
    try {
      const { ctx, rect } = await rasterize(p, 64);
      const px = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
      return false;
    } catch {
      return true;
    }
  }

  // =============================================================================================
  // Network (privileged fetch: no CORS, no host permissions)
  // =============================================================================================
  async function fetchBytes(url, maxBytes = CONFIG.maxBytes) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.fetchTimeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, credentials: "omit", redirect: "follow", cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (Number(res.headers.get("content-length")) > maxBytes) throw new Error("too large");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxBytes || bytes.length === 0) throw new Error("bad size");
      return { bytes };
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads at most maxHtmlBytes of the page, then stops the download.
  // Only the <head> links matter, so scripts are cut out before parsing: the parsed document is never run, but Firefox still logs
  // "'src' attribute of <script> element is not a valid URI" for every relative <script src> (hundreds of lines during the
  // background bookmark pass, which has no live DOM and parses each site's HTML).
  const stripScripts = (html) => html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[\s\S]*$/i, ""); // an unclosed one (the download is cut at maxHtmlBytes)

  async function fetchHtml(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctl.signal, credentials: "omit", redirect: "follow", cache: "force-cache",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const reader = res.body.getReader();
      const chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
        if (n >= CONFIG.maxHtmlBytes) { ctl.abort(); break; }
      }
      const all = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      return new TextDecoder().decode(all);
    } finally {
      clearTimeout(timer);
    }
  }

  // A fetch() that is blocked or fails at the network level rejects with a TypeError; an HTTP 404 or a
  // non-image answer does not. That lets us avoid caching "no icons here" when nothing could be downloaded.
  async function probe(candidate) {
    try {
      const { bytes } = await fetchBytes(candidate.href);
      const info = await sniff(bytes);
      return info ? { ...candidate, ...info } : null;
    } catch (err) {
      if (err && err.name === "TypeError") candidate.blocked = true;
      return null;
    }
  }
  const allBlocked = (candidates) => candidates.length > 0 && candidates.every((c) => c.blocked);

  // =============================================================================================
  // Discovery and decision
  // =============================================================================================
  // Reads <link> tags from the tab's LIVE DOM through a one-shot frame script (the page's own JS may inject its icons
  // after load, and some servers answer our privileged HTML fetch with an error, e.g. WhatsApp Web: HTTP 400).
  let liveSeq = 0;
  function liveLinks(browser, pageUrl) {
    return new Promise((resolve) => {
      const mm = browser && browser.messageManager;
      if (!mm) return resolve(null);
      const msg = `${ID}:links:${++liveSeq}`;
      let timer = null;
      const finish = (data) => {
        clearTimeout(timer);
        try { mm.removeMessageListener(msg, onMsg); } catch { /* gone */ }
        resolve(data);
      };
      const onMsg = (m) => {
        const d = m.data;
        try { finish(d && Array.isArray(d.links) && new URL(d.url).origin === new URL(pageUrl).origin ? d : null); } catch { finish(null); }
      };
      timer = setTimeout(() => finish(null), 2000);
      mm.addMessageListener(msg, onMsg);
      const code = `(function(){var M=${JSON.stringify(msg)};try{var d=content.document;sendAsyncMessage(M,{url:content.location.href,base:d.baseURI,ready:d.readyState,` +
        `links:Array.from(d.querySelectorAll("link[rel][href]"),function(l){return{rel:l.getAttribute("rel"),href:l.href,sizes:l.getAttribute("sizes")||""}})})}` +
        `catch(e){sendAsyncMessage(M,null)}})();`;
      try {
        mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(code), false);
      } catch (e) {
        debug("frame script failed:", e);
        finish(null);
      }
    });
  }

  // Icon <link>s and the manifest: first from the live DOM, then (if that gave nothing) from the page's HTML, plus the icon
  // Firefox itself picked (the "original URL" it passes to setIcon).
  async function pageDeclared(pageUrl, hintUrl, browser) {
    const info = { declared: [], manifest: null, htmlFailed: false, thin: false };
    let via = "none";
    const ingest = (list, base) => {
      for (const l of list) {
        const tokens = String(l.rel || "").toLowerCase().split(/\s+/);
        let href;
        try { href = new URL(l.href, base).href; } catch { continue; }
        const sizes = l.sizes || "";
        if (tokens.includes("icon")) info.declared.push({ rel: "icon", href, sizes });
        else if (tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed")) info.declared.push({ rel: "apple", href, sizes });
        else if (tokens.includes("manifest") && !info.manifest) info.manifest = href;
      }
    };

    // Read the live DOM until it stops changing: the first read right after the first icon event often sees only a
    // placeholder (WhatsApp Web: a 16px data: PNG) while the real icons, apple-touch icon and manifest arrive seconds later.
    let live = null;
    let prevSig = null;
    for (let i = 0; i < CONFIG.settleReads; i++) {
      const cur = await liveLinks(browser, pageUrl);
      if (!cur) break;
      live = cur;
      const sig = cur.links.map((l) => `${l.rel}|${l.href}`).join("\n");
      if (cur.ready === "complete" && sig === prevSig) break;
      prevSig = sig;
      await new Promise((r) => setTimeout(r, CONFIG.settleDelayMs));
    }
    if (live) { ingest(live.links, live.base || pageUrl); via = "live DOM"; }

    if (!info.declared.length && !info.manifest) {
      try {
        const doc = new DOMParser().parseFromString(stripScripts(await fetchHtml(pageUrl)), "text/html");
        let base = pageUrl;
        try {
          const b = doc.querySelector("base[href]");
          if (b) base = new URL(b.getAttribute("href"), pageUrl).href;
        } catch { /* keep pageUrl */ }
        ingest(Array.from(doc.querySelectorAll("link[rel][href]"), (l) => ({ rel: l.getAttribute("rel"), href: l.getAttribute("href"), sizes: l.getAttribute("sizes") || "" })), base);
        via = live ? "live DOM + HTML" : "HTML";
      } catch (err) {
        // Only a failure if the live DOM was not available either: the verdict then rests on incomplete data (see autoVerdict).
        if (!live) info.htmlFailed = true;
        debug("page HTML unavailable:", pageUrl, err);
      }
    }
    info.thin = !info.manifest && !info.declared.some((d) => d.rel === "apple"); // nothing better than plain icons declared (yet)
    info.shown = hintUrl && /^(https?|data):/i.test(hintUrl) ? hintUrl : ""; // the icon Firefox picked for the tab
    if (hintUrl && /^(https?|data):/i.test(hintUrl) && !info.declared.some((d) => d.href === hintUrl)) {
      info.declared.push({ rel: "icon", href: hintUrl, sizes: "" });
    }
    debug("declared icons via", via, pageUrl, info.declared.map((d) => `${d.rel} ${d.sizes || "-"} ${d.href.slice(0, 90)}`), "manifest:", info.manifest);
    return info;
  }

  async function collectCandidates(info, pageUrl) {
    const found = new Map();
    const add = (href, isDeclaredIcon, kind) => {
      let url;
      try { url = new URL(href, pageUrl); } catch { return; }
      if (!["http:", "https:", "data:"].includes(url.protocol)) return;
      const prev = found.get(url.href);
      if (prev) prev.isDeclaredIcon = prev.isDeclaredIcon || isDeclaredIcon;
      else found.set(url.href, { href: url.href, isDeclaredIcon, kind });
    };

    for (const d of info.declared) add(d.href, d.rel === "icon", d.rel === "icon" ? "page icon" : "apple-touch icon");
    for (const d of info.declared) for (const v of densityVariants(d.href)) add(v, false, "density variant");

    if (typeof info.manifest === "string") {
      try {
        const { bytes } = await fetchBytes(info.manifest);
        const json = JSON.parse(new TextDecoder().decode(bytes));
        for (const icon of Array.isArray(json.icons) ? json.icons : []) {
          if (icon && typeof icon.src === "string") add(new URL(icon.src, info.manifest).href, false, "web manifest");
        }
      } catch { /* manifest is optional */ }
    }
    for (const path of DEFAULT_PATHS) add(path, false, "default path");
    return [...found.values()].slice(0, CONFIG.maxCandidates);
  }

  // "…/1x/…", "…_1x.png", "…@1x…": servers that render icons per density usually answer for 2x, 3x, 4x too.
  const DENSITY_RE = /(^|[\/_.@-])1x(?=$|[\/_.?#-])/;
  const densityVariants = (url) => (CONFIG.densityUpgrade && /^https?:/i.test(url) && DENSITY_RE.test(url)
    ? [4, 3, 2].map((n) => url.replace(DENSITY_RE, (m, pre) => pre + n + "x"))
    : []);

  const score = (p) => (p.mime === "image/svg+xml" ? 1e6 : Math.max(p.w, p.h));

  // The icon the SITE itself offers (the one the tab shows, else the best one it declares). Kept with every verdict so bookmarks and
  // the address bar can be given it when Firefox could not store it (Cache-Control: no-store). Only the address is kept, not the bytes.
  function ownSource(shown, declaredIcons) {
    const usable = (p) => p && !p.tooBig && (!/^data:/i.test(p.href) || p.href.length <= 4000);
    if (usable(shown)) return shown.href;
    const best = declaredIcons.filter(usable).sort((a, b) => score(b) - score(a))[0];
    return best ? best.href : null;
  }
  const keepWith = (own, ownPng) => ({ action: "keep", own: own || null, ownPng: ownPng || null, sharp: 2 }); // sharp: logic version of the Places part (older entries are redone)

  async function decide(info, pageUrl) {
    const candidates = await collectCandidates(info, pageUrl);
    const probed = (await Promise.all(candidates.map(probe))).filter(Boolean);
    // Nothing could be downloaded at all: an error, not a verdict. Throwing keeps it out of the cache.
    if (allBlocked(candidates)) throw new Error("every icon download was blocked or failed");

    const declaredIcons = probed.filter((p) => p.isDeclaredIcon);
    // The tab shows the icon FIREFOX picked (info.shown), which is not necessarily the best one the page declares: Firefox goes by
    // the sizes attribute and shows a 16x16 even when a bigger icon without sizes, or an apple-touch icon, exists (stocktwits.com).
    // So "good enough" is judged on the shown icon; only when it is unknown do we fall back to the best declared one.
    let shownHref = "";
    try { shownHref = info.shown ? new URL(info.shown).href : ""; } catch { /* unusable hint */ }
    const shown = shownHref ? probed.find((p) => p.href === shownHref) || null : null;
    const ownHref = ownSource(shown, declaredIcons);
    const ownProbe = ownHref ? probed.find((p) => p.href === ownHref) : null;
    let ownPng = null; // Places gets one sharp PNG of the site's own icon (the tab keeps Firefox's own icon)
    if (CONFIG.sharpenOwn && ownProbe && !ownProbe.animated && ownProbe.mime !== "image/svg+xml" && Math.max(ownProbe.w, ownProbe.h) >= CONFIG.sharpenOwnMin) {
      try { ownPng = (await render(ownProbe)).dataUrl; debug("own icon kept for the tab, Places gets one sharp PNG:", ownHref, ownProbe.ico ? `${ownProbe.ico} frames, biggest ${ownProbe.w}x${ownProbe.h}` : `${ownProbe.w}x${ownProbe.h}`); } catch { /* keep Firefox's copy */ }
    }
    const keep = keepWith(ownHref, ownPng);
    // An animated icon the page declares itself is never flattened into a static PNG.
    if (declaredIcons.some((p) => p.animated)) { debug("animated declared icon, keeping:", pageUrl); return keep; }
    const bestDeclared = Math.max(0, ...declaredIcons.map(score));
    const declaresSvg = declaredIcons.some((p) => p.mime === "image/svg+xml");
    const shownGood = (shown ? score(shown) : bestDeclared) >= CONFIG.goodEnough;
    debug("shown icon:", shown ? `${shown.href.slice(0, 90)} ${shown.mime === "image/svg+xml" ? "svg" : shown.w + "x" + shown.h}` : "unknown", "| best declared:", bestDeclared);
    if (shownGood && !(CONFIG.rasterizeSvg && declaresSvg)) return keep;

    const usable = probed.filter((p) => !p.tooBig && !p.animated && score(p) >= CONFIG.goodEnough);
    if (CONFIG.respectTransparency) {
      await Promise.all(usable.map(async (p) => { p.hasAlpha = await detectAlpha(p); }));
      await Promise.all(declaredIcons.map(async (p) => { p.hasAlpha = await detectAlpha(p); }));
    }
    usable.sort(
      (a, b) =>
        (CONFIG.respectTransparency ? Number(b.hasAlpha) - Number(a.hasAlpha) : 0) ||
        score(b) - score(a) ||
        Number(b.isDeclaredIcon) - Number(a.isDeclaredIcon)
    );
    const best = usable[0];
    if (!best) return keep;
    if (shown && best.mime !== "image/svg+xml" && score(best) <= score(shown)) return keep; // nothing bigger than what the tab already shows
    debug("best candidate:", best.href.slice(0, 90), best.mime === "image/svg+xml" ? "svg" : `${best.w}x${best.h}`);
    if (CONFIG.respectTransparency && !best.hasAlpha && declaredIcons.some((p) => p.hasAlpha)) return keep;

    const rendered = await render(best);
    if (CONFIG.rasterizeSvg && best.mime === "image/svg+xml" && rendered.mime === "image/svg+xml") return keep;
    return { action: "replace", source: best.href, ...rendered, own: keep.own || null };
  }

  const resolving = new Map(); // origin -> Promise<verdict>, so one page load never starts two lookups

  // Cached verdict, else look the site up (and cache the answer; errors are never cached).
  // opts.sweep: a background lookup (no tab, so no live DOM): trusted for the normal times, but a tab visit redoes it if it was thin.
  function autoVerdict(pageUrl, origin, hintUrl, browser, opts) {
    const sweep = !!(opts && opts.sweep);
    const cached = cacheGet(origin, sweep);
    if (cached) return Promise.resolve(cached.result);
    if (resolving.has(origin)) return resolving.get(origin);
    const p = (async () => {
      const info = await pageDeclared(pageUrl, hintUrl, browser);
      const result = await decide(info, pageUrl);
      const ttl = sweep
        ? (result.action === "replace" ? CONFIG.replaceTtlMs : CONFIG.keepTtlMs)
        : info.thin ? CONFIG.incompleteTtlMs : result.action === "replace" ? CONFIG.replaceTtlMs : info.htmlFailed ? CONFIG.incompleteTtlMs : CONFIG.keepTtlMs;
      // "declared" = every icon address the page itself declares (plus the one Firefox picked). Later icon events
      // whose address is in this list are the page's static icon coming back, so they get our icon again.
      cachePut(origin, {
        v: CACHE_VERSION, expires: Date.now() + ttl, result, declared: info.declared.map((d) => d.href).slice(0, 20),
        ...(sweep ? { sweep: true, thin: !!(info.thin || info.htmlFailed) } : {}),
      });
      debug(origin, result.action, result.source || "");
      if (eligible(origin)) queueBackfill(origin, false); // bookmarks and history of this site, once
      return result;
    })().finally(() => resolving.delete(origin));
    resolving.set(origin, p);
    return p;
  }

  // Everything the site offers (small sizes included) so the user can choose.
  async function listCandidates(pageUrl, hintUrl, browser) {
    const info = await pageDeclared(pageUrl, hintUrl, browser);
    const candidates = await collectCandidates(info, pageUrl);
    const probed = (await Promise.all(candidates.map(probe))).filter((p) => p && !p.tooBig);
    const rendered = await Promise.all(
      probed.map(async (p) => {
        try {
          const r = await render(p);
          return { href: p.href, kind: p.kind, format: p.mime, w: p.w, h: p.h, mime: r.mime, dataUrl: r.dataUrl };
        } catch { return null; }
      })
    );
    const list = rendered.filter(Boolean).sort(
      (a, b) => (b.format === "image/svg+xml") - (a.format === "image/svg+xml") || Math.max(b.w, b.h) - Math.max(a.w, a.h)
    );
    const seenIcons = new Set(); // 3x / 4x answers that are just the default icon again show up as identical renders
    const unique = list.filter((c) => !seenIcons.has(c.dataUrl) && seenIcons.add(c.dataUrl));
    return { candidates: unique, blocked: allBlocked(candidates) };
  }

  async function iconFromUrl(raw) {
    let url;
    try { url = new URL(raw); } catch { throw new Error("That doesn't look like a web address."); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http or https address.");
    let info;
    try {
      const { bytes } = await fetchBytes(url.href);
      info = await sniff(bytes);
    } catch { throw new Error("Couldn't download an image from that address."); }
    if (!info) throw new Error("That address isn't a PNG, ICO, GIF, JPEG, WebP or SVG image.");
    const r = await render(info);
    return { mime: r.mime, dataUrl: r.dataUrl };
  }

  async function fileToIconDataUrl(file) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is over 2 MB. Pick a smaller image.");
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name || "")) {
      if (file.size > MAX_UPLOAD_SVG_BYTES) throw new Error("That SVG is over 40 KB. Pick a smaller one.");
      try { return await svgBytesToPngDataUrl(new Uint8Array(await file.arrayBuffer()), CONFIG.outputSize); }
      catch { throw new Error("Firefox couldn't draw that SVG. Try a PNG instead."); }
    }
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch { throw new Error("Firefox couldn't read that image. Try a PNG, ICO, JPEG, WebP or SVG."); }
    const longest = Math.max(bmp.width, bmp.height);
    const edge = Math.min(CONFIG.outputSize, longest); // never upscale
    const scale = edge / longest;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hh = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(edge, edge);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, Math.round((edge - w) / 2), Math.round((edge - hh) / 2), w, hh);
    bmp.close();
    return canvasToPngDataUrl(canvas);
  }

  function cleanOverride(o) {
    if (!o || typeof o !== "object") throw new Error("Bad override");
    if (o.type === "off") return { type: "off" };
    if (o.type !== "pick" && o.type !== "upload") throw new Error("Bad override type");
    if (typeof o.dataUrl !== "string" || !/^data:image\/(png|svg\+xml);base64,/.test(o.dataUrl)) throw new Error("Icon must be a PNG or SVG data URL");
    if (o.dataUrl.length > MAX_OVERRIDE_DATAURL) throw new Error("Icon is too large");
    const out = { type: o.type, mime: o.dataUrl.startsWith("data:image/svg") ? "image/svg+xml" : "image/png", dataUrl: o.dataUrl };
    if (o.type === "pick" && typeof o.source === "string") out.source = o.source.slice(0, 2000);
    return out;
  }

  // =============================================================================================
  // Places: the same icons for bookmarks, history and the address-bar dropdown
  // (this also replaces the "Cache Favicons for Bookmarks" extension)
  //
  // Everything outside the tab strip (bookmarks toolbar / menu / sidebar / Library, address-bar results) reads icons from Firefox's
  // favicon database, not from the tab. That database only keeps what Firefox downloaded itself: an icon sent with
  // "Cache-Control: no-store" is refused (globe in bookmarks), and a site's 16px icon stays 16px. This section writes our icons into
  // it with PlacesUtils.favicons.setFaviconForPage, so no response-header rewriting is needed.
  //   "force"   a replacement we chose (automatic upgrade, picked or uploaded image). Stored under a private icon address
  //             <origin>/.uc-favicon-upgrader/<hash>.png, and the page's other icon associations are dropped first: Places serves
  //             the association closest to the requested size, which for a 16px bookmark would still be the site's own 16px icon.
  //   "ensure"  the site's own icon (verdict "keep", or "Site's own"). Stored under its real address, and only when Places holds no
  //             icon for the page at all: this is the no-store fix and nothing more.
  // What was written is remembered per site in `placed` (an icon hash, kept in the cache file), so a site is backfilled once and
  // not on every start. Scope (pref extensions.uc.faviconUpgrader.placesScope, buttons in the panel):
  //   "sites"   only sites you picked / uploaded an icon for, or switched on with "Include this site" (the extension's model)
  //   "all"     every site, automatically
  //   "off"     Firefox's own behaviour; everything we wrote is removed again
  // =============================================================================================
  const PREF_SCOPE = "extensions.uc.faviconUpgrader.placesScope";
  const SYNTH_DIR = "/.uc-favicon-upgrader/";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PU = () => (typeof PlacesUtils !== "undefined" ? PlacesUtils : ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils);

  const placedGone = new Set();  // origins dropped from `placed` here, so merging with the file does not bring them back
  const sessionDone = new Set(); // "page|hash" written this session (only consulted when Places cannot be asked what it holds)
  const ownMemo = new Map();     // site icon address -> Promise<data URL | null>
  const hashMemo = new Map();

  const placesScope = () => {
    try {
      const v = Services.prefs.getStringPref(PREF_SCOPE, "");
      if (v === "all" || v === "sites" || v === "off") return v;
    } catch { /* default */ }
    return CONFIG.placesScope;
  };
  const setPlacesScope = (v) => Services.prefs.setStringPref(PREF_SCOPE, v);

  // "Include this site" switches live in the overrides file under their own key, so they merge between windows like every override.
  const placesApproved = (origin) => {
    const e = overrides.get("places:" + origin);
    return !!(e && e.type === "places" && e.on);
  };
  const setPlacesApproved = (origin, on) => {
    overrides.set("places:" + origin, { type: "places", on: !!on, t: Date.now() });
    return flushOverrides();
  };

  function hashOf(s) { // FNV-1a: enough to tell two icons apart and to build a stable icon address
    let x = hashMemo.get(s);
    if (x) return x;
    let n = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { n ^= s.charCodeAt(i); n = Math.imul(n, 0x01000193) >>> 0; }
    x = n.toString(16).padStart(8, "0");
    hashMemo.set(s, x);
    if (hashMemo.size > 400) hashMemo.delete(hashMemo.keys().next().value);
    return x;
  }
  const synthUrl = (origin, hash) => origin + SYNTH_DIR + hash.slice(1) + ".png";

  function touchPlaced() {
    while (placed.size > 5000) placed.delete(placed.keys().next().value);
    cacheDirty = true;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushCache, CONFIG.flushDelayMs);
  }

  function isLeader() { // the first non-private window runs the background work, so two windows never do it twice
    try {
      for (const w of Services.wm.getEnumerator("navigator:browser")) {
        if (w.closed || (PBU && PBU.isWindowPrivate(w))) continue;
        return w === window;
      }
    } catch { /* assume yes */ }
    return true;
  }

  function eligible(origin) {
    const scope = placesScope();
    if (scope === "off") return false;
    if (scope === "all") return true;
    const ov = overrideGet(origin);
    return placesApproved(origin) || !!(ov && ov.type !== "off");
  }

  // What should Places hold for this site? null = nothing to write (not eligible, or no verdict yet).
  function placesPlan(origin) {
    if (!eligible(origin)) return null;
    const ov = overrideGet(origin);
    if (ov && ov.type !== "off") return { mode: "force", origin, dataUrl: ov.dataUrl, hash: "F" + hashOf(ov.dataUrl) };
    const c = cacheGet(origin, true);
    const r = c && c.result;
    if (!r) return null;
    if (r.action === "replace" && !ov) return { mode: "force", origin, dataUrl: r.dataUrl, hash: "F" + hashOf(r.dataUrl) };
    if (r.ownPng) return { mode: "force", soft: true, origin, dataUrl: r.ownPng, hash: "F" + hashOf(r.ownPng) }; // soft: only if Places serves a small icon
    if (r.own) return { mode: "ensure", origin, own: r.own, hash: "E" + hashOf(r.own) };
    return null;
  }

  // The icon Places would serve for a bookmark-sized request. null = none, undefined = this Firefox cannot be asked.
  async function getFav(pageURI) {
    const svc = PU().favicons;
    if (typeof svc.getFaviconForPage !== "function") return undefined;
    try { return (await svc.getFaviconForPage(pageURI, 16)) || null; } catch { return undefined; }
  }

  // The site's own icon as a <=64px PNG data URL (fetched once per session and address).
  function ownData(href) {
    let p = ownMemo.get(href);
    if (!p) {
      p = (async () => {
        try {
          if (/^data:/i.test(href)) return href;
          const { bytes } = await fetchBytes(href);
          const info = await sniff(bytes);
          return info && !info.tooBig ? (await render(info)).dataUrl : null;
        } catch { return null; }
      })();
      ownMemo.set(href, p);
      if (ownMemo.size > 200) ownMemo.delete(ownMemo.keys().next().value);
    }
    return p;
  }

  // Writes the plan for one page. true = Places was changed. Idempotent: asks Places first.
  async function placesApply(pageUrl, plan) {
    let pageURI;
    try { pageURI = Services.io.newURI(pageUrl); } catch { return false; }
    const svc = PU().favicons;
    const expiry = (Date.now() + CONFIG.placesExpiryMs) * 1000; // PRTime: microseconds
    const key = pageUrl + "|" + plan.hash;
    try {
      const cur = await getFav(pageURI);
      if (plan.mode === "force") {
        const iconSpec = synthUrl(plan.origin, plan.hash);
        if (cur !== undefined ? !!cur && cur.uri.spec === iconSpec : sessionDone.has(key)) return false;
        // A "soft" plan (the site's own icon is kept) only helps when Places would serve a small one: leave a good size alone.
        if (plan.soft && cur && cur.width >= CONFIG.goodEnough) return false;
        if (typeof svc.expireFaviconsForPage === "function") await svc.expireFaviconsForPage(pageURI);
        await svc.setFaviconForPage(pageURI, Services.io.newURI(iconSpec), Services.io.newURI(plan.dataUrl), expiry, false);
        sessionDone.add(key);
        return true;
      }
      if (cur || (cur === undefined && sessionDone.has(key))) return false; // Places already has an icon for this page
      const data = await ownData(plan.own);
      if (!data) { plan.failed = true; return false; }
      await svc.setFaviconForPage(pageURI, Services.io.newURI(plan.own), Services.io.newURI(data), expiry, false);
      sessionDone.add(key);
      return true;
    } catch (err) {
      plan.failed = true;
      debug("places write failed:", pageUrl, err);
      return false;
    }
  }

  // Every bookmarked page of a site (any depth) plus its most frecent history pages. Read-only SQL on moz_places / moz_origins.
  async function pagesOfOrigin(origin) {
    const out = new Set();
    try {
      const conn = await PU().promiseDBConnection();
      const from = "FROM moz_places p JOIN moz_origins o ON o.id = p.origin_id WHERE (o.prefix || o.host) = :origin";
      const q = async (sql, params) => { for (const r of await conn.executeCached(sql, params)) out.add(r.getResultByName("url")); };
      await q(`SELECT p.url AS url ${from} AND p.foreign_count > 0 LIMIT 2000`, { origin });
      await q(`SELECT p.url AS url ${from} AND p.visit_count > 0 ORDER BY p.frecency DESC LIMIT :n`, { origin, n: CONFIG.placesHistoryPages });
    } catch (err) {
      debug("pagesOfOrigin failed:", origin, err);
    }
    return [...out].filter((u) => /^https?:/i.test(u));
  }

  async function bookmarkedOrigins() {
    try {
      const conn = await PU().promiseDBConnection();
      const rows = await conn.executeCached(
        `SELECT (o.prefix || o.host) AS origin, COUNT(*) AS n
           FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk JOIN moz_origins o ON o.id = p.origin_id
          WHERE b.type = 1 AND o.prefix IN ('https://', 'http://')
          GROUP BY o.id ORDER BY n DESC`);
      return rows.map((r) => ({ origin: r.getResultByName("origin") }));
    } catch (err) {
      debug("bookmarkedOrigins failed:", err);
      return [];
    }
  }

  // Takes our icon away again (back to what Firefox stores itself, which it re-adds on the next visit).
  async function releaseOrigin(origin) {
    const svc = PU().favicons;
    if (typeof svc.expireFaviconsForPage !== "function") { warn("expireFaviconsForPage missing: cannot take icons out of Places."); return; }
    const prefix = origin + SYNTH_DIR;
    let n = 0;
    for (const url of await pagesOfOrigin(origin)) {
      try {
        const uri = Services.io.newURI(url);
        const cur = await getFav(uri);
        if (cur && cur.uri.spec.startsWith(prefix)) await svc.expireFaviconsForPage(uri);
      } catch { /* page gone */ }
      if (++n % 8 === 0) await sleep(40);
    }
  }

  async function backfillOrigin(origin, force) {
    const plan = placesPlan(origin);
    const prev = placed.get(origin) || "";
    if (!plan) {
      // Only an opt-out (scope, "Include", switching to "Site's own") takes icons out. A missing / expired verdict never does.
      if (!eligible(origin) && prev.startsWith("F")) {
        await releaseOrigin(origin);
        placed.delete(origin);
        placedGone.add(origin);
        touchPlaced();
      }
      return;
    }
    if (!force && prev === plan.hash) return;
    if (plan.mode === "ensure" && prev.startsWith("F")) await releaseOrigin(origin);
    let n = 0;
    for (const url of await pagesOfOrigin(origin)) {
      await placesApply(url, plan);
      if (++n % 8 === 0) await sleep(40); // keep the UI thread free
    }
    if (!plan.failed) {
      placed.set(origin, plan.hash);
      placedGone.delete(origin);
      touchPlaced();
    }
    debug("places backfill", origin, plan.mode, n, "pages", plan.failed ? "(incomplete)" : "");
  }

  // One site at a time, in order. Returns a promise that resolves when that site has been handled.
  let backfillChain = Promise.resolve();
  const backfillPending = new Map(); // origin -> { force, promise }
  function queueBackfill(origin, force = false) {
    const hit = backfillPending.get(origin);
    if (hit) { hit.force = hit.force || force; return hit.promise; }
    const item = { force };
    item.promise = backfillChain.then(async () => {
      backfillPending.delete(origin);
      try { await backfillOrigin(origin, item.force); } catch (err) { warn("backfill:", origin, err); }
    });
    backfillPending.set(origin, item);
    backfillChain = item.promise;
    return item.promise;
  }

  async function syncPage(pageUrl, origin) {
    const plan = placesPlan(origin);
    return plan ? placesApply(pageUrl, plan) : false;
  }

  // After a tab's icon event: write that page's icon, then check once more. Firefox saves its own icon for the page at about the
  // same time; if its small icon lands after ours it is the nearer match for a 16px bookmark, so the second pass puts ours back.
  const placesTimers = new WeakMap(); // <browser> -> timer ids
  function schedulePlaces(tab) {
    const browser = tab && tab.linkedBrowser;
    const page = pageOf(browser);
    if (!page || placesScope() === "off") return;
    (placesTimers.get(browser) || []).forEach(clearTimeout);
    const run = async () => {
      const now = pageOf(browser);
      if (!now || now.origin !== page.origin) return;
      const pending = resolving.get(now.origin); // first visit: wait for the lookup
      if (pending) { try { await pending; } catch { return; } }
      await syncPage(now.url, now.origin);
    };
    placesTimers.set(browser, CONFIG.placesSyncDelaysMs.map((ms) => setTimeout(() => run().catch((e) => debug("places sync:", e)), ms)));
  }

  // Background pass over bookmarked sites this script has not seen yet (once per site: `placed` remembers it, failures wait a week).
  let sweeping = false;
  async function sweepBookmarks() {
    if (sweeping || placesScope() === "off" || !isLeader()) return;
    sweeping = true;
    try {
      let lookups = 0;
      for (const { origin } of await bookmarkedOrigins()) {
        if (placesScope() === "off") break;
        if (!eligible(origin)) continue;
        const prev = placed.get(origin) || "";
        const ce = cache.get(origin);
        const stale = !!(ce && entryLive(ce) && ce.result && ce.result.action === "keep" && ce.result.sharp !== 2); // verdict from an older version
        if (prev.startsWith("N")) { if (Date.now() / 864e5 - Number(prev.slice(1)) < 7) continue; } // failed recently
        else if (prev && !stale) { // handled before: only act when the plan changed (new override, new verdict)
          const plan = placesPlan(origin);
          if (!plan || plan.hash === prev) continue;
        } else if (stale || (!overrideGet(origin) && !cacheGet(origin, true))) {
          if (lookups >= CONFIG.sweepMaxLookups) continue;
          lookups++;
          try {
            await autoVerdict(origin + "/", origin, "", null, { sweep: true });
          } catch (err) {
            debug("sweep lookup failed:", origin, err);
            placed.set(origin, "N" + Math.floor(Date.now() / 864e5));
            placedGone.delete(origin);
            touchPlaced();
          }
          await sleep(CONFIG.sweepDelayMs);
        }
        await queueBackfill(origin, false);
      }
    } finally {
      sweeping = false;
    }
  }

  function onScopeChanged() {
    for (const tab of gBrowser.tabs) schedulePlaces(tab);
    if (!isLeader()) return;
    for (const [origin, hash] of [...placed]) if (hash.startsWith("F") && !eligible(origin)) queueBackfill(origin, true); // takes icons out
    if (placesScope() !== "off") sweepBookmarks().catch((e) => warn("sweep:", e));
  }
  const scopeObserver = { observe() { onScopeChanged(); } };

  // A bookmark added later (also a bulk import) gets the site's icon without any network work.
  const onBookmarksAdded = (events) => {
    for (const ev of events) {
      if (ev.type !== "bookmark-added" || !/^https?:/i.test(ev.url || "")) continue;
      let origin;
      try { origin = new URL(ev.url).origin; } catch { continue; }
      setTimeout(() => syncPage(ev.url, origin).catch(() => {}), 1500);
    }
  };

  // ---- Guard: keep Firefox's own write from putting its small icon back --------------------------------------------------
  // LinkHandlerParent.setIconFromLink (parent process) calls PlacesUtils.favicons.setFaviconForPage(page, originalIconURL, data,
  // expiration, isRichIcon) for every page that allows it, and only then gBrowser.setIcon. It reads `PlacesUtils.favicons` on every
  // call, so a thin proxy on that property can drop the non-rich write for a site whose plan is "force". Rich (apple-touch) writes,
  // "ensure" sites, every other site and every other method pass straight through to the real service.
  // Each window layers its own proxy on the ORIGINAL service (never on another window's proxy), so a closed window's layer can
  // never be left in the call path of a live one; stop() puts the original back when it is still the top layer.
  let guardProxy = null;
  let guardActive = false;
  function installGuard() {
    if (!CONFIG.blockFirefoxIcons) return;
    try {
      const P = PU();
      const cur = P.favicons;
      const root = cur.__ucRoot || cur;
      const guarded = (...a) => {
        try {
          const [pageURI, iconURI, , , isRich] = a;
          if (guardActive && !isRich && pageURI && iconURI && /^https?:/i.test(pageURI.spec)) {
            const origin = new URL(pageURI.spec).origin;
            const plan = placesPlan(origin);
            if (plan && plan.mode === "force" && !plan.soft && !iconURI.spec.startsWith(origin + SYNTH_DIR)) {
              debug("guard: dropped Firefox's own icon write for", pageURI.spec);
              return Promise.resolve();
            }
          }
        } catch { /* fall through to the real call */ }
        return root.setFaviconForPage(...a);
      };
      guardProxy = new Proxy(root, {
        get(t, k) {
          if (k === "__ucRoot") return root;
          if (k === "setFaviconForPage" && guardActive) return guarded;
          const v = root[k];
          return typeof v === "function" ? v.bind(root) : v;
        },
      });
      Object.defineProperty(P, "favicons", { value: guardProxy, writable: true, configurable: true, enumerable: true });
      if (P.favicons !== guardProxy) throw new Error("PlacesUtils.favicons could not be replaced");
      guardActive = true;
    } catch (e) {
      guardProxy = null;
      warn("cannot guard Firefox's own icon writes (the 1.2 s / 5 s re-check still applies):", e);
    }
  }
  function removeGuard() {
    guardActive = false;
    try {
      const P = PU();
      if (guardProxy && P.favicons === guardProxy) Object.defineProperty(P, "favicons", { value: guardProxy.__ucRoot, writable: true, configurable: true, enumerable: true });
    } catch { /* window is going away */ }
    guardProxy = null;
  }


  // =============================================================================================
  // Tabs: hook gBrowser.setIcon (every icon Firefox sets for a tab goes through it)
  // =============================================================================================
  // Firefox 160: tabbrowser.setIcon(tab, iconURL, originalURL, loadingPrincipal, clearImageFirst) only accepts
  // chrome:, about:, resource: and data: URLs for iconURL (it logs "Attempt to set a remote URL" otherwise), so
  // our PNG data URLs are fine. originalURL is the icon's real address, which we reuse as the "declared" hint.
  const tabState = new WeakMap(); // <browser> -> { page, autoUntil, token }
  const state = (browser) => {
    let s = tabState.get(browser);
    if (!s) {
      s = { page: null, autoUntil: Date.now() + CONFIG.autoWindowMs, token: 0, baseline: new Set(), seen: new Set(), dynamic: false };
      tabState.set(browser, s);
    }
    return s;
  };

  function pageOf(browser) {
    try {
      const uri = browser && browser.currentURI;
      if (!uri || !(uri.schemeIs("http") || uri.schemeIs("https"))) return null;
      return { url: uri.spec, origin: new URL(uri.spec).origin };
    } catch {
      return null;
    }
  }

  let origSetIcon = null; // set in start()

  // Our icon on the tab. Calls the ORIGINAL setIcon, so the hook never sees its own calls.
  function showOurs(tab, dataUrl, s) {
    origSetIcon(tab, dataUrl, (s.page && s.page.originalURL) || dataUrl);
  }

  // Put the page's own icon back (the last one Firefox set for this page).
  function restorePage(tab, s) {
    if (s.page) origSetIcon(tab, s.page.iconURL, s.page.originalURL, ...s.page.rest);
  }

  function resolveFor(tab, browser, page, hintUrl) {
    const s = state(browser);
    const token = ++s.token;
    autoVerdict(page.url, page.origin, hintUrl, browser)
      .then((verdict) => {
        const now = pageOf(browser);
        if (token !== s.token || !now || now.origin !== page.origin) return; // navigated away, or a newer icon event took over
        schedulePlaces(tab);
        if (overrideGet(page.origin)) return; // the user chose while we were looking
        if (verdict.action === "replace") showOurs(tab, verdict.dataUrl, s);
      })
      .catch((err) => debug("lookup failed:", page.origin, err));
  }

  // Dynamic icons (unread badge, loading / done state ...) are the page's own business, but if the icon is an SVG
  // Firefox draws it blurry, so those get the same sharp PNG render as everything else. Raster icons cannot be improved
  // (we never upscale), so they pass through. Results are kept per icon address, so the 2nd and later swaps are instant;
  // the very first time the page's own icon shows for a moment while the SVG is fetched.
  const upgrades = new Map(); // source -> data URL | null (nothing to gain) | Promise (fetching)

  function tryUpgrade(tab, s, iconStr, origStr) {
    if (!CONFIG.rasterizeSvg && !CONFIG.densityUpgrade) return false;
    // data: frames are only worth a look when they are SVGs (animations via raster data URLs would just churn the fetch + cache).
    const src = /^https?:/i.test(origStr) ? origStr : /^data:image\/svg/i.test(origStr) ? origStr : /^data:image\/svg/i.test(iconStr) ? iconStr : "";
    if (!src) return false;
    const hit = upgrades.get(src);
    if (typeof hit === "string") { showOurs(tab, hit, s); return true; }
    if (hit !== undefined) return false; // null, or still fetching
    const job = (async () => {
      const { bytes } = await fetchBytes(src);
      const orig = await sniff(bytes);
      if (!orig || orig.animated) return null;                       // not an image, or animated: never touched
      if (orig.mime === "image/svg+xml") {                           // vector: sharpen it
        return CONFIG.rasterizeSvg ? svgBytesToPngDataUrl(orig.data, CONFIG.svgRasterSize) : null;
      }
      // Raster: a bigger rendition of the same icon (…/1x/… -> 4x, 3x, 2x), biggest first. Some servers answer an unknown
      // density with their DEFAULT icon (WhatsApp: 3x / 4x return the plain 1x logo, not the requested badge), so a variant
      // only counts if it is really bigger than the original.
      const base = Math.max(orig.w, orig.h);
      for (const u of densityVariants(src)) {
        try {
          const r = await fetchBytes(u);
          const info = await sniff(r.bytes);
          if (!info || info.animated || info.tooBig) continue;
          const size = info.mime === "image/svg+xml" ? Infinity : Math.max(info.w, info.h);
          if (size <= base) { debug("density variant not bigger, skipped", u, `${info.w}x${info.h}`, "vs", base); continue; }
          debug("density variant", u, info.mime === "image/svg+xml" ? "svg" : `${info.w}x${info.h}`, "replaces", base);
          return (await render(info)).dataUrl;
        } catch { /* variant not offered: try the next one */ }
      }
      return null;
    })().catch(() => null);
    upgrades.set(src, job);
    job.then((dataUrl) => {
      upgrades.set(src, dataUrl);
      if (upgrades.size > 150) upgrades.delete(upgrades.keys().next().value);
      debug("dynamic icon", dataUrl ? "upgraded" : "left alone", src.slice(0, 120));
      // Only swap if this icon is still the one the tab is showing (the page may have moved on) and the user did not opt out.
      const page = pageOf(tab.linkedBrowser);
      if (dataUrl && s.page && s.page.originalURL === origStr && page && !overrideGet(page.origin)) showOurs(tab, dataUrl, s);
    });
    return false;
  }

  // Returns true when it set the tab icon itself (so the original call must be skipped).
  function onPageIcon(tab, iconURL, originalURL, rest) {
    const iconStr = String((iconURL && iconURL.spec) || iconURL || "");
    const origStr = String((originalURL && originalURL.spec) || originalURL || iconStr);
    if (!iconStr) return false; // Firefox is clearing the icon
    const browser = tab.linkedBrowser;
    const page = pageOf(browser);
    if (!page) return false;
    const s = state(browser);
    s.page = { iconURL: iconStr, originalURL: origStr, rest }; // the page's own icon, kept so "Site's own" / "Automatic" can restore it
    s.seen.add(origStr);
    if (!s.dynamic && s.seen.size > CONFIG.dynamicAfterIcons) {
      s.dynamic = true; // spinner / badge / frame animation: the page owns its icon from now on
      debug("page swaps its icon itself, passing through:", page.origin, "distinct icons:", s.seen.size);
    }
    // Icons the page shows while loading = its static icon(s). Animation frames must never end up in here.
    if (!s.dynamic && Date.now() < s.autoUntil && s.baseline.size < 10) s.baseline.add(origStr);

    schedulePlaces(tab);
    const ov = overrideGet(page.origin);
    if (ov) {
      if (ov.type === "off") return false;
      showOurs(tab, ov.dataUrl, s); // manual choices are enforced for as long as the page keeps setting icons
      return true;
    }
    if (s.dynamic) return tryUpgrade(tab, s, iconStr, origStr); // manual picks above still win; everything else: only SVG frames are sharpened
    const cached = cacheGet(page.origin);
    if (cached) {
      // A density-family icon the page does NOT declare (a badge / state frame): never swap it for our static pick.
      if (densityVariants(origStr).length && !(cached.declared && cached.declared.includes(origStr))) return tryUpgrade(tab, s, iconStr, origStr);
      const isStatic = Date.now() < s.autoUntil || (cached.declared && cached.declared.includes(origStr)) || s.baseline.has(origStr);
      if (cached.result.action === "replace" && isStatic) {
        showOurs(tab, cached.result.dataUrl, s);
        return true;
      }
      return tryUpgrade(tab, s, iconStr, origStr); // "keep", or a dynamic icon the page set after loading: only SVGs get sharpened
    }
    resolveFor(tab, browser, page, origStr); // first visit: let Firefox show the page's icon, swap when the lookup is done
    return false;
  }

  // Apply the current choice for an origin to every tab of this window that shows it.
  function applyOrigin(origin) {
    for (const tab of gBrowser.tabs) {
      const browser = tab.linkedBrowser;
      const page = pageOf(browser);
      if (!page || page.origin !== origin) continue;
      const s = state(browser);
      schedulePlaces(tab);
      const ov = overrideGet(origin);
      if (ov && ov.type !== "off") showOurs(tab, ov.dataUrl, s);
      else if (ov) restorePage(tab, s);
      else {
        const token = ++s.token;
        autoVerdict(page.url, origin, s.page && s.page.originalURL, browser)
          .then((v) => {
            if (token !== s.token) return;
            if (v.action === "replace") showOurs(tab, v.dataUrl, s);
            else restorePage(tab, s);
          })
          .catch(() => restorePage(tab, s));
      }
    }
  }

  const progressListener = {
    // New top-level page (not pushState): forget the previous page's icon and open a new automatic window.
    onLocationChange(browser, webProgress, request, location, flags) {
      if (!webProgress.isTopLevel) return;
      if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) return;
      const s = state(browser);
      s.token++;
      s.page = null;
      s.baseline.clear();
      s.seen.clear();
      s.dynamic = false;
      s.autoUntil = Date.now() + CONFIG.autoWindowMs;
    },
  };

  // =============================================================================================
  // Panel (port of the toolbar popup), opened from the tab context menu
  // =============================================================================================
  const CSS = `
    #${ID}-panel {
      --fu-fg: var(--arrowpanel-color, light-dark(#36454F, #DCDCDC));
      --fu-accent: AccentColor;
      --fu-accent-fg: AccentColorText;
      --fu-line: color-mix(in srgb, var(--fu-fg) 18%, transparent);
      --fu-muted: color-mix(in srgb, var(--fu-fg) 62%, transparent);
      --fu-hover: color-mix(in srgb, var(--fu-fg) 8%, transparent);
      --fu-check-a: light-dark(#ffffff, #222b29);
      --fu-check-b: light-dark(#e3e7e5, #2c3735);
      --arrowpanel-padding: 12px;
      min-width: 0;
    }
    #${ID}-panel .fu-root { width: 340px; display: flex; flex-direction: column; gap: 10px; color: var(--fu-fg); font: inherit; }
    #${ID}-panel .fu-scope { margin: 0; color: var(--fu-muted); font-size: .92em; }
    #${ID}-panel .fu-scope strong { color: var(--fu-fg); font-weight: 600; }
    #${ID}-panel .fu-prev { display: flex; align-items: center; gap: 8px; }
    #${ID}-panel .fu-prev img { width: 16px; height: 16px; flex: none; }
    #${ID}-panel .fu-modes, #${ID}-panel .fu-urlrow { display: flex; gap: 6px; }
    #${ID}-panel .fu-btn {
      appearance: none; flex: 1 1 auto; margin: 0; padding: 6px 10px; font: inherit; color: inherit; white-space: nowrap;
      background: transparent; border: 1px solid var(--fu-line); border-radius: 8px; cursor: pointer;
    }
    #${ID}-panel .fu-btn:hover { background: var(--fu-hover); }
    #${ID}-panel .fu-btn[aria-pressed="true"] { background: var(--fu-accent); border-color: var(--fu-accent); color: var(--fu-accent-fg); }
    #${ID}-panel .fu-urlrow .fu-btn { flex: none; }
    #${ID}-panel .fu-input {
      appearance: none; flex: 1; min-width: 0; margin: 0; padding: 6px 8px; font: inherit; color: inherit;
      background: var(--fu-hover); border: 1px solid transparent; border-radius: 8px; outline: none;
    }
    #${ID}-panel .fu-input:focus { border-color: var(--fu-accent); }
    #${ID}-panel h2 { margin: 0 0 4px; font-size: 1em; font-weight: 600; }
    #${ID}-panel .fu-note { margin: 0; color: var(--fu-muted); font-size: .92em; }
    #${ID}-panel .fu-status { margin: 0; min-height: 1.4em; color: var(--fu-muted); font-size: .92em; }
    #${ID}-panel .fu-list {
      list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 300px; overflow-y: auto; overscroll-behavior: contain;
      scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--fu-fg) 35%, transparent) transparent;
    }
    #${ID}-panel .fu-row {
      appearance: none; display: flex; align-items: center; gap: 10px; width: 100%; margin: 0; padding: 6px 8px 6px 6px;
      font: inherit; text-align: start; color: inherit; background: transparent; border: 1px solid var(--fu-line); border-radius: 8px; cursor: pointer;
    }
    #${ID}-panel .fu-row:hover { background: var(--fu-hover); }
    #${ID}-panel .fu-row[aria-pressed="true"] { border-color: var(--fu-accent); box-shadow: inset 0 0 0 1px var(--fu-accent); }
    #${ID}-panel .fu-tile {
      flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 4px;
      background: conic-gradient(var(--fu-check-b) 25%, var(--fu-check-a) 0 50%, var(--fu-check-b) 0 75%, var(--fu-check-a) 0) 0 0 / 10px 10px;
    }
    #${ID}-panel .fu-tile img { max-width: 40px; max-height: 40px; }
    #${ID}-panel .fu-meta { display: grid; min-width: 0; flex: 1; }
    #${ID}-panel .fu-size { font-weight: 600; }
    #${ID}-panel .fu-kind { color: var(--fu-muted); font-size: .92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${ID}-panel .fu-badge { flex: none; color: var(--fu-accent); font-size: .92em; font-weight: 600; }
    #${ID}-panel .fu-places { display: grid; gap: 6px; }
  `;

  const ui = { tab: null, page: null, hint: "", candidates: [], override: null, loaded: false, touched: false, seq: 0 };
  const el = {};

  function buildPanel() {
    el.preview = h("img", { alt: "", width: "16", height: "16" });
    el.host = h("strong");
    el.modeAuto = h("button", { class: "fu-btn", type: "button", text: "Automatic", onclick: () => run(chooseAuto) });
    el.modeOff = h("button", { class: "fu-btn", type: "button", text: "Site's own", onclick: () => run(chooseOff) });
    el.url = h("input", {
      class: "fu-input", type: "text", placeholder: "Ctrl+V to paste an image or address", autocomplete: "off", spellcheck: "false",
      "aria-label": "Pasted image or image address",
      onkeydown: (e) => { if (e.key === "Enter") run(chooseUrl); },
    });
    el.use = h("button", { class: "fu-btn", type: "button", text: "Use", onclick: () => run(chooseUrl) });
    el.list = h("ul", { class: "fu-list" });
    el.listTitle = h("h2", { text: "Icons found on this site" });
    el.loading = h("p", { class: "fu-note", text: "Looking for icons…" });
    el.empty = h("p", { class: "fu-note", text: "No icons found for this site. You can still add your own above." });
    el.status = h("p", { class: "fu-status", role: "status", "aria-live": "polite" });
    el.scopeSites = h("button", { class: "fu-btn", type: "button", text: "Chosen sites", onclick: () => run(() => chooseScope("sites")) });
    el.scopeAll = h("button", { class: "fu-btn", type: "button", text: "All sites", onclick: () => run(() => chooseScope("all")) });
    el.scopeOff = h("button", { class: "fu-btn", type: "button", text: "Off", onclick: () => run(() => chooseScope("off")) });
    el.include = h("button", { class: "fu-btn", type: "button", text: "Include this site", onclick: () => run(toggleInclude) });
    el.refresh = h("button", { class: "fu-btn", type: "button", text: "Refresh this site", onclick: () => run(refreshPlaces) });
    el.placesNote = h("p", { class: "fu-note" });

    const panel = document.createXULElement("panel");
    panel.id = `${ID}-panel`;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("orient", "vertical");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Favicon Upgrader");
    panel.append(
      h("style", { text: CSS }),
      h("div", { class: "fu-root" },
        h("div", { class: "fu-prev" }, el.preview, h("p", { class: "fu-scope" }, "Applies to every page on ", el.host, ".")),
        h("div", { class: "fu-modes" }, el.modeAuto, el.modeOff),
        h("section", {},
          h("h2", { text: "Your own image" }),
          h("div", { class: "fu-urlrow" }, el.url, el.use),
          h("p", { class: "fu-note", text: "Copy the icon you want (right-click an image, then Copy Image), open this panel and press Ctrl+V." })),
        el.listTitle, el.list, el.loading, el.empty, el.status,
        h("section", { class: "fu-places" },
          h("h2", { text: "Bookmarks & address bar" }),
          h("div", { class: "fu-modes" }, el.scopeSites, el.scopeAll, el.scopeOff),
          h("div", { class: "fu-modes" }, el.include, el.refresh),
          el.placesNote))
    );
    // Pasted image (Ctrl+V): the DataTransfer carries the file; plain text goes into the box as usual.
    panel.addEventListener("paste", (e) => {
      const file = [...((e.clipboardData && e.clipboardData.files) || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      run(() => chooseUpload(file));
    });
    panel.addEventListener("popupshown", () => el.url.focus());
    panel.addEventListener("popuphidden", () => { ui.seq++; el.url.value = ""; });
    (document.getElementById("mainPopupSet") || document.documentElement).append(panel);
    return panel;
  }

  const setStatus = (t) => { el.status.textContent = t || ""; };
  const setPressed = (b, on) => b.setAttribute("aria-pressed", String(on));
  const run = async (fn) => {
    try { await fn(); } catch (err) { setStatus((err && err.message) || String(err)); }
  };
  const ownIcon = () => (ui.tab && ui.tab.getAttribute("image")) || "";

  function renderPanel() {
    const ov = ui.override;
    setPressed(el.modeAuto, ui.loaded && !ov);
    setPressed(el.modeOff, ui.loaded && !!ov && ov.type === "off");
    el.list.replaceChildren();
    if (ov && ov.type === "upload") el.list.append(row({ dataUrl: ov.dataUrl, title: "Your image", sub: "Added by you", active: true }));
    for (const c of ui.candidates) {
      el.list.append(row({
        dataUrl: c.dataUrl,
        title: c.format === "image/svg+xml" ? "SVG (vector source)" : c.w + " × " + c.h,
        sub: c.kind + " · " + c.format.replace("image/", "").replace("x-icon", "ico").replace("svg+xml", "svg"),
        active: !!ov && ov.type === "pick" && ov.source === c.href,
        onClick: () => run(() => choosePick(c)),
      }));
    }
    el.loading.hidden = ui.loaded;
    el.empty.hidden = !ui.loaded || ui.candidates.length > 0 || (!!ov && ov.type === "upload");
    el.listTitle.hidden = ui.candidates.length === 0;
    const src = ownIcon();
    if (src) el.preview.src = src; else el.preview.removeAttribute("src");
    const scope = placesScope();
    setPressed(el.scopeSites, scope === "sites");
    setPressed(el.scopeAll, scope === "all");
    setPressed(el.scopeOff, scope === "off");
    el.include.hidden = scope !== "sites";
    el.refresh.hidden = scope === "off";
    setPressed(el.include, !!ui.page && placesApproved(ui.page.origin));
    el.placesNote.textContent =
      scope === "all" ? "Every site's icon is saved for bookmarks, history and the address-bar dropdown."
      : scope === "sites" ? "Only sites you picked or uploaded an icon for, or switched on here, are saved there."
      : "Bookmarks and the address bar use Firefox's own icons.";
  }

  function row({ dataUrl, title, sub, active, onClick }) {
    const btn = h("button", { class: "fu-row", type: "button", "aria-pressed": String(!!active) },
      h("span", { class: "fu-tile" }, h("img", { alt: "", src: dataUrl })),
      h("span", { class: "fu-meta" }, h("span", { class: "fu-size", text: title }), h("span", { class: "fu-kind", text: sub })));
    if (onClick) btn.addEventListener("click", onClick);
    if (active) btn.append(h("span", { class: "fu-badge", text: "In use" }));
    return h("li", {}, btn);
  }

  async function saveChoice(ov, message) {
    const clean = cleanOverride(ov);
    await setOverride(ui.page.origin, clean);
    ui.touched = true;
    ui.override = overrideGet(ui.page.origin);
    applyOrigin(ui.page.origin);
    queueBackfill(ui.page.origin, true); // an explicit choice is also what bookmarks and the address bar show
    setStatus(message);
    renderPanel();
  }

  const choosePick = (c) => saveChoice({ type: "pick", source: c.href, dataUrl: c.dataUrl }, "Saved for " + ui.page.origin.replace(/^https?:\/\//, "") + ".");
  const chooseOff = () => saveChoice({ type: "off" }, "Leaving the site's own icon alone.");

  async function chooseUrl() {
    const raw = el.url.value.trim();
    if (!raw) throw new Error("Paste an image address first.");
    setStatus("Downloading…");
    const icon = await iconFromUrl(raw);
    el.url.value = "";
    await saveChoice({ type: "upload", dataUrl: icon.dataUrl }, "Your image is now the icon for this site.");
  }

  async function chooseUpload(file) {
    const dataUrl = await fileToIconDataUrl(file);
    await saveChoice({ type: "upload", dataUrl }, "Your image is now the icon for this site.");
  }

  async function chooseScope(v) {
    setPlacesScope(v); // every window's pref observer picks it up from here
    setStatus(v === "off" ? "Bookmarks and the address bar use Firefox's own icons again."
      : v === "all" ? "Every site's icon is now saved for bookmarks and the address bar."
      : "Only chosen sites are saved for bookmarks and the address bar.");
    renderPanel();
  }

  async function toggleInclude() {
    const origin = ui.page.origin;
    const on = !placesApproved(origin);
    await setPlacesApproved(origin, on);
    queueBackfill(origin, true);
    setStatus(on ? "This site is saved for bookmarks and the address bar." : "This site is left out again.");
    renderPanel();
  }

  // Looks the site up again and rewrites its bookmarks / history icons.
  async function refreshPlaces() {
    const origin = ui.page.origin;
    cache.delete(origin);
    cacheDirty = true;
    placed.delete(origin);
    placedGone.add(origin);
    setStatus("Looking the site up again…");
    applyOrigin(origin);       // new verdict -> autoVerdict queues the backfill
    await queueBackfill(origin, true); // covers sites with an override (no verdict needed)
    setStatus("Updated.");
  }

  async function chooseAuto() {
    await setOverride(ui.page.origin, { type: "auto" }); // tombstone, so other windows drop the override too
    ui.touched = true;
    ui.override = null;
    applyOrigin(ui.page.origin);
    queueBackfill(ui.page.origin, true);
    setStatus("Back to automatic.");
    renderPanel();
  }

  async function loadPanel() {
    const seq = ++ui.seq;
    ui.candidates = [];
    ui.override = overrideGet(ui.page.origin);
    ui.loaded = false;
    ui.touched = false;
    setStatus("");
    el.host.textContent = new URL(ui.page.url).host;
    renderPanel();
    try {
      const found = await listCandidates(ui.page.url, ui.hint, ui.tab && ui.tab.linkedBrowser);
      if (seq !== ui.seq) return; // panel was closed or reopened meanwhile
      ui.candidates = found.candidates;
      if (!ui.touched) ui.override = overrideGet(ui.page.origin);
      if (found.blocked) setStatus("Every icon download failed. See the Browser Console for [uc] FaviconUpgrader messages.");
    } catch (err) {
      if (seq === ui.seq) setStatus((err && err.message) || String(err));
    }
    if (seq !== ui.seq) return;
    ui.loaded = true;
    renderPanel();
  }

  let panel = null;
  function openPanel(tab) {
    const browser = tab && tab.linkedBrowser;
    const page = pageOf(browser);
    if (!page) return;
    panel ??= buildPanel();
    ui.tab = tab;
    ui.page = page;
    ui.hint = (state(browser).page && state(browser).page.originalURL) || "";
    loadPanel();
    // Horizontal tab strip: drop down from the tab. Vertical tabs: open towards the page, away from the rail.
    const vertical = gBrowser.tabContainer.getAttribute("orient") === "vertical";
    let pos = "after_start";
    if (vertical) {
      const r = tab.getBoundingClientRect();
      pos = r.left + r.width / 2 < window.innerWidth / 2 ? "end_before" : "start_before";
    }
    panel.openPopup(tab, pos, 0, 0, false, false);
  }

  // ---- Tab context menu entry ----------------------------------------------------------------
  let menuItem = null;
  let ctxTab = null;
  let ctxMenu = null;
  // Firefox 160 arranges #tabContextMenu into sections on every popupshowing (MenuSectionLayout) and throws for any child it
  // does not know. So the item lives OUTSIDE the menu while that runs: a capture listener (fires before the menu's own
  // onpopupshowing -> updateContextMenu) pulls it out, and it is re-inserted once the popup is shown. It stays in the DOM
  // after closing so the "command" event, which can fire after the popup is hidden, still reaches it.
  const onCtxShowingCapture = (e) => {
    if (e.target !== ctxMenu) return; // popupshowing bubbles up from sub-menus
    menuItem.remove();
  };
  const onCtxShown = (e) => {
    if (e.target !== ctxMenu) return;
    ctxTab = (window.TabContextMenu && TabContextMenu.contextTab) || null;
    if (!(ctxTab && pageOf(ctxTab.linkedBrowser))) return;
    const anchor = document.getElementById("context_duplicateTab");
    if (anchor && anchor.parentNode === ctxMenu) anchor.after(menuItem); else ctxMenu.append(menuItem);
  };
  function addMenuItem() {
    ctxMenu = document.getElementById("tabContextMenu");
    if (!ctxMenu) { warn("#tabContextMenu not found: the panel cannot be opened (script still applies icons)."); return; }
    menuItem = document.createXULElement("menuitem");
    menuItem.id = `${ID}-menuitem`;
    menuItem.setAttribute("label", "Change favicon…");
    menuItem.addEventListener("command", () => openPanel(ctxTab));
    window.addEventListener("popupshowing", onCtxShowingCapture, true);
    ctxMenu.addEventListener("popupshown", onCtxShown);
  }

  // =============================================================================================
  // Start / stop
  // =============================================================================================
  let lastRefresh = 0;
  const onFocus = async () => {
    if (Date.now() - lastRefresh < 2000) return;
    lastRefresh = Date.now();
    for (const key of await refreshOverrides()) { // a choice made in another window
      if (key.startsWith("places:")) queueBackfill(key.slice(7), true);
      else { applyOrigin(key); queueBackfill(key, false); }
    }
  };

  async function start() {
    if (typeof gBrowser?.setIcon !== "function" || typeof gBrowser?.addTabsProgressListener !== "function") {
      warn("gBrowser.setIcon / addTabsProgressListener missing, script disabled.");
      return;
    }
    // Load the stored state BEFORE hooking, so the very first icon of a restored tab already sees it.
    const [diskCache, diskOv] = await Promise.all([readJSON(CACHE_PATH), readJSON(OVERRIDES_PATH)]);
    if (diskCache && diskCache.v === CACHE_VERSION && diskCache.entries) {
      for (const [k, e] of Object.entries(diskCache.entries)) if (entryLive(e)) cache.set(k, e);
    }
    mergeOverrides(diskOv && diskOv.entries);
    if (diskCache && diskCache.v === CACHE_VERSION && diskCache.placed) {
      for (const [k, v] of Object.entries(diskCache.placed)) if (typeof v === "string") placed.set(k, v);
    }

    origSetIcon = gBrowser.setIcon.bind(gBrowser);
    gBrowser.setIcon = function (tab, iconURL = "", originalURL = iconURL, ...rest) {
      try {
        if (onPageIcon(tab, iconURL, originalURL, rest)) return undefined;
      } catch (e) {
        warn("setIcon hook:", e); // never block Firefox's own icon
      }
      return origSetIcon(tab, iconURL, originalURL, ...rest);
    };
    gBrowser.addTabsProgressListener(progressListener);
    addMenuItem();
    window.addEventListener("focus", onFocus);
    window.addEventListener("unload", stop, { once: true });
    try { Services.prefs.addObserver(PREF_SCOPE, scopeObserver); } catch (e) { warn("scope pref observer:", e); }
    try { PU().observers.addListener(["bookmark-added"], onBookmarksAdded); } catch (e) { warn("bookmark events unavailable:", e); }
    installGuard();
    if (CONFIG.sweep) setTimeout(() => sweepBookmarks().catch((e) => warn("sweep:", e)), CONFIG.sweepStartDelayMs);

    // Tabs that already have an icon (script loaded after startup, or session-restored): nothing to do until
    // their next icon event. Debug handle for the Browser Toolbox:
    window.__ucFaviconUpgraderDebug = {
      CONFIG, cache, overrides, placed, state, pageOf, autoVerdict, listCandidates, flushCache, flushOverrides,
      installGuard, removeGuard, placesPlan, getFav, syncPage, backfillOrigin, queueBackfill, releaseOrigin, sweepBookmarks, pagesOfOrigin,
    };
  }

  function stop() {
    try { gBrowser.removeTabsProgressListener(progressListener); } catch {}
    try { window.removeEventListener("focus", onFocus); } catch {}
    removeGuard();
    try { Services.prefs.removeObserver(PREF_SCOPE, scopeObserver); } catch {}
    try { PU().observers.removeListener(["bookmark-added"], onBookmarksAdded); } catch {}
    try { window.removeEventListener("popupshowing", onCtxShowingCapture, true); } catch {}
    try { ctxMenu && ctxMenu.removeEventListener("popupshown", onCtxShown); } catch {}
    menuItem && menuItem.remove();
    panel && panel.remove();
    flushCache(); // fire-and-forget: IOUtils finishes the write after the window is gone
  }

  if (window.gBrowserInit && gBrowserInit.delayedStartupFinished) {
    start();
  } else {
    const obs = (subject) => {
      if (subject !== window) return;
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      start();
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }
})();
