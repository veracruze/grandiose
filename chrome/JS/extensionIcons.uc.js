// ==UserScript==
// @name           extensionIcons.uc.js
// @description    Tabs showing an extension's own page (moz-extension://) get the sharpest icon found
//                 anywhere inside that extension's package (.xpi / folder), not just the manifest's small one.
// @include        main
// ==/UserScript==
//
// Companion to Favicon Upgrader. A WebExtension can't do this part itself: content scripts never run
// on moz-extension:// pages and there is no API to set a tab's icon. Privileged browser code can.
//
// Firefox-internal hooks used (all guarded; if one is missing the script logs one warning and stops):
//   WebExtensionPolicy.getByHostname(host).extension.rootURI, nsIZipReader, gBrowser.setIcon

(() => {
  "use strict";

  if (location.href !== "chrome://browser/content/browser.xhtml") return;
  if (window.__ucExtensionIcons) return;
  window.__ucExtensionIcons = true;

  const CONFIG = {
    outputSize: 64,            // px. Max edge of the icon given to the tab (never upscaled), as in Favicon Upgrader
    maxCandidates: 40,         // image files examined per extension
    minSize: 32,               // px. Smaller files are not worth switching to
  };

  const warn = (...a) => console.warn("[extensionIcons]", ...a);

  for (const [name, ok] of [
    ["gBrowser", typeof gBrowser !== "undefined" && typeof gBrowser.setIcon === "function"],
    ["WebExtensionPolicy", typeof WebExtensionPolicy !== "undefined"],
    ["Cc/Ci", typeof Cc !== "undefined" && typeof Ci !== "undefined"],
  ]) {
    if (!ok) return warn("missing " + name + ", feature disabled (Firefox changed?)");
  }

  // ---- Listing the files in an extension package ----------------------------
  function listPackageFiles(rootURI) {
    const out = [];
    if (rootURI.schemeIs("jar")) {
      const jar = rootURI.QueryInterface(Ci.nsIJARURI);
      const file = jar.JARFile.QueryInterface(Ci.nsIFileURL).file;
      const zr = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
      zr.open(file);
      try {
        const it = zr.findEntries("*");
        while (it.hasMore()) {
          const name = it.getNext();
          if (!name.endsWith("/")) out.push(name);
        }
      } finally {
        zr.close();
      }
    } else if (rootURI.schemeIs("file")) {
      // Unpacked / temporary add-on loaded from a folder.
      const walk = (dir, prefix) => {
        const it = dir.directoryEntries;
        while (it.hasMoreElements()) {
          const f = it.getNext().QueryInterface(Ci.nsIFile);
          if (f.isDirectory()) walk(f, prefix + f.leafName + "/");
          else out.push(prefix + f.leafName);
        }
      };
      walk(rootURI.QueryInterface(Ci.nsIFileURL).file, "");
    }
    return out;
  }

  // ---- Measuring and rendering ----------------------------------------------
  async function load(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  function toPng(img, isSvg) {
    const natW = img.naturalWidth || 0;
    const natH = img.naturalHeight || 0;
    const longest = isSvg || !natW ? CONFIG.outputSize : Math.max(natW, natH);
    const edge = Math.min(CONFIG.outputSize, longest);
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    let w = edge;
    let h = edge;
    if (!isSvg && natW && natH) {
      const s = edge / Math.max(natW, natH);
      w = Math.max(1, Math.round(natW * s));
      h = Math.max(1, Math.round(natH * s));
    }
    ctx.drawImage(img, Math.round((edge - w) / 2), Math.round((edge - h) / 2), w, h);
    return canvas.toDataURL("image/png"); // chrome code: the canvas is not tainted by moz-extension images
  }

  // ---- Which files count as "the extension's icon" -----------------------------
  // Only files that belong to the same icon family as one the manifest declares. Picking the biggest
  // image in the package is wrong: extensions ship other artwork (a translate logo, a banner...).
  // Firefox hands us the manifest's icon paths as full URLs (moz-extension://<uuid>/icons/a.png);
  // package listings use plain relative paths ("icons/a.png"). Reduce both to the relative form.
  const normPath = (p) => {
    let s = String(p || "").replace(/\\/g, "/");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        s = new URL(s).pathname;
      } catch {
        /* keep as is */
      }
    }
    s = s.split(/[?#]/)[0];
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep as is */
    }
    return s.replace(/^(\.?\/)+/, "");
  };

  // Groups of declared icon paths, most authoritative first (the manifest's own "icons" is what
  // Firefox uses for the tab).
  function declaredGroups(manifest) {
    const groups = [];
    if (!manifest) return groups;
    const walk = (x, out) => {
      if (typeof x === "string") out.push(normPath(x));
      else if (x && typeof x === "object") Object.values(x).forEach((v) => walk(v, out));
    };
    for (const v of [
      manifest.icons,
      manifest.action && manifest.action.default_icon,
      manifest.browser_action && manifest.browser_action.default_icon,
      manifest.page_action && manifest.page_action.default_icon,
      manifest.sidebar_action && manifest.sidebar_action.default_icon,
    ]) {
      const out = [];
      walk(v, out);
      if (out.length) groups.push(out);
    }
    return groups;
  }

  // "icons/icon-48.png", "icons/icon128.png" and "icons/icon.svg" all become "icons/icon".
  function familyKey(path) {
    const i = path.lastIndexOf("/");
    const base = path
      .slice(i + 1)
      .replace(/\.[^.]+$/, "")
      .replace(/[-_. @]?\d+(x\d+)?(px|x)?/gi, "");
    return path.slice(0, i + 1) + base;
  }

  async function getManifest(policy) {
    try {
      if (policy.extension && policy.extension.manifest) return policy.extension.manifest;
    } catch {
      /* fall through to reading the file */
    }
    try {
      return await (await fetch(policy.getURL("manifest.json"))).json();
    } catch {
      return null;
    }
  }

  // Same approach as Favicon Upgrader's own SVG handling: give the SVG an explicit pixel size equal to
  // what we draw, so Firefox renders the vector at that size instead of at its tiny intrinsic size
  // (an icon declared as width="16" height="16" would otherwise be drawn small and scaled up).
  async function svgToPng(url, size) {
    const text = await (await fetch(url)).text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.localName !== "svg" || doc.querySelector("parsererror")) throw new Error("Not a valid SVG");
    const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    let w;
    let h;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = vb[2];
      h = vb[3];
    } else {
      w = parseFloat(root.getAttribute("width"));
      h = parseFloat(root.getAttribute("height"));
      if (!(w > 0 && h > 0)) w = h = 100;
      root.setAttribute("viewBox", "0 0 " + w + " " + h);
    }
    const scale = size / Math.max(w, h);
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));
    root.setAttribute("width", String(outW));
    root.setAttribute("height", String(outH));
    const xml = new XMLSerializer().serializeToString(root);
    const img = await load("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml));
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, Math.round((size - outW) / 2), Math.round((size - outH) / 2), outW, outH);
    return canvas.toDataURL("image/png");
  }

  // The icon an extension page links, read from the page's HTML inside the package. (Firefox does not
  // pass moz-extension: icons to the tab as URLs, so the tab's own image can't tell us.) Static
  // <link rel="icon"> only; icons a page script adds later are not seen.
  async function pageIconPath(pageSpec) {
    try {
      const pageUrl = new URL(pageSpec);
      pageUrl.search = "";
      pageUrl.hash = "";
      const text = await (await fetch(pageUrl.href)).text();
      const doc = new DOMParser().parseFromString(text, "text/html");
      const link = [...doc.querySelectorAll("link[rel][href]")].find((l) =>
        l.rel.toLowerCase().split(/\s+/).includes("icon")
      );
      return link ? normPath(new URL(link.getAttribute("href"), pageUrl).href) : null;
    } catch {
      return null;
    }
  }

  // Returns a data URL, or null (leave Firefox's own icon alone).
  async function bestIconFor(host, pageSpec) {
    const policy = WebExtensionPolicy.getByHostname(host);
    const rootURI = policy && policy.extension && policy.extension.rootURI;
    if (!rootURI) return null;

    const files = listPackageFiles(rootURI).filter((p) => /\.(png|svg|webp|jpe?g|gif)$/i.test(p));
    const groups = declaredGroups(await getManifest(policy));
    // Fallback for extensions whose manifest declares no icon (or none we can match): the icon the
    // extension's own page links.
    const linked = pageSpec ? await pageIconPath(pageSpec) : null;
    if (linked) groups.push([linked]);
    let family = null;
    for (const group of groups) {
      const keys = new Set(group.map(familyKey));
      const members = files.filter((f) => keys.has(familyKey(f)));
      if (members.length) {
        family = members;
        break;
      }
    }
    if (!family) return null; // nothing in the package is tied to an icon the extension uses: leave Firefox's icon

    let best = null;
    for (const path of family.slice(0, CONFIG.maxCandidates)) {
      const isSvg = /\.svg$/i.test(path);
      try {
        const img = await load(policy.getURL(path));
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!isSvg && Math.max(w, h) < CONFIG.minSize) continue;
        // Biggest wins; an SVG beats any bitmap.
        const score = isSvg ? 1e6 : Math.max(w, h);
        if (!best || score > best.score) best = { score, path, img, isSvg };
      } catch {
        /* not decodable: ignore */
      }
    }
    if (!best) return null; // every family file was below minSize or undecodable
    try {
      let dataUrl = null;
      if (best.isSvg) {
        try {
          dataUrl = await svgToPng(policy.getURL(best.path), CONFIG.outputSize);
        } catch (err) {
          warn("explicit-size SVG render failed, drawing the image directly:", err);
        }
      }
      if (!dataUrl) dataUrl = toPng(best.img, best.isSvg);
      return dataUrl;
    } catch (err) {
      // Only a data: URL is ever used: Firefox's icon store rejects moz-extension: URLs.
      warn("could not rasterise, leaving the icon alone:", err);
      return null;
    }
  }

  // ---- Applying it to tabs ---------------------------------------------------
  const cache = new Map(); // host + page path -> Promise<string|null>
  function iconFor(host, pageSpec) {
    let key = host;
    try {
      key += "|" + new URL(pageSpec).pathname;
    } catch {
      /* host alone */
    }
    if (!cache.has(key)) {
      cache.set(key, bestIconFor(host, pageSpec).catch((err) => {
        warn("failed for", host, err);
        return null;
      }));
    }
    return cache.get(key);
  }

  async function apply(tab) {
    let uri;
    try {
      uri = tab && tab.linkedBrowser && tab.linkedBrowser.currentURI;
    } catch {
      return;
    }
    if (!uri || !uri.schemeIs("moz-extension")) return;
    const url = await iconFor(uri.host, uri.spec);
    if (!url || !tab.isConnected) return;
    // Already showing our icon: nothing to do. This is also what stops the loop, since setting the
    // icon fires TabAttrModified, which calls us again. (No time window here: Firefox resets the
    // icon a moment after a load starts, and that reset must always be answered.)
    if (tab.getAttribute("image") === url) return;
    // setIcon (not a bare attribute) so the browser's own icon state matches what the tab shows.
    // A data: URL is allowed without a loading principal and never goes to the history database.
    gBrowser.setIcon(tab, url);
  }

  gBrowser.tabContainer.addEventListener("TabAttrModified", (e) => {
    if (e.detail && e.detail.changed && e.detail.changed.includes("image")) apply(e.target);
  });

  gBrowser.addTabsProgressListener({
    onLocationChange(browser, _webProgress, _request, location) {
      if (location && location.schemeIs && location.schemeIs("moz-extension")) {
        const tab = gBrowser.getTabForBrowser(browser);
        if (tab) apply(tab);
      }
    },
  });

  for (const tab of gBrowser.tabs) apply(tab);
})();
