// ==UserScript==
// @name           tabPreviewGroup.uc.js
// @description    Shows the name of a tab's group (a dot in the group's colour and the name) above the title in the tab hover preview, when the tab is
//                 in a group that has a name. Tabs outside a group, and groups without a name, show the preview as Firefox draws it.
//                 The group's own name is hidden on the tab strip while the group is open (css/15-pinned-groups.css).
//                 Firefox-internal: #tab-preview-panel and its .tab-preview-title, the panel's anchorNode, tab.group and tabGroup.label.
//                 If one of them is gone after an update, the preview stays as Firefox draws it and ONE warning line is logged.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  if (window.__ucTabPreviewGroup) return;

  const TAG = "tabPreviewGroup";
  const warned = new Set();
  const warnOnce = (msg) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[uc] ${TAG}: ${msg}`);
  };

  const panel = document.getElementById("tab-preview-panel");
  if (!panel) { warnOnce("#tab-preview-panel is missing, script not loaded"); return; }
  window.__ucTabPreviewGroup = true;

  const HTML = "http://www.w3.org/1999/xhtml";
  const tabOf = (node) => (node && node.closest ? node.closest(".tabbrowser-tab") : null);

  // the pointer / keyboard focus is the fallback when the panel does not say which tab it belongs to
  let hovered = null;
  const remember = (e) => {
    const t = tabOf(e.composedTarget || e.target);
    if (t) hovered = t;
  };
  document.addEventListener("mouseover", remember, true);
  document.addEventListener("focusin", remember, true);

  let observer = null;
  let scheduled = 0;

  function update() {
    scheduled = 0;
    try {
      if (observer) observer.disconnect(); // our own change must not trigger another update
      for (const old of panel.querySelectorAll(".uc-tab-preview-group")) old.remove();

      const tab = tabOf(panel.anchorNode) || hovered;
      const group = tab && tab.group;
      const name = group && String(group.label || "").trim();
      if (!name) return;

      const title = panel.querySelector(".tab-preview-title");
      const host = (title && title.parentNode) || panel.querySelector(".tab-preview-text-container");
      if (!host) { warnOnce(".tab-preview-title / .tab-preview-text-container are missing, no group name in the preview"); return; }

      const row = document.createElementNS(HTML, "div");
      row.className = "uc-tab-preview-group";
      const dot = document.createElementNS(HTML, "span");
      dot.className = "uc-tab-preview-dot";
      const text = document.createElementNS(HTML, "span");
      text.textContent = name;
      row.append(dot, text);
      const color = getComputedStyle(group).getPropertyValue("--tab-group-color").trim();
      if (color) row.style.setProperty("--uc-group-color", color);
      host.prepend(row);
    } catch (e) {
      console.error(`${TAG}:`, e);
    } finally {
      if (observer) observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }
  }

  const schedule = () => {
    if (!scheduled) scheduled = requestAnimationFrame(update);
  };

  // Firefox rewrites the preview in place while it stays open and the pointer moves from tab to tab
  observer = new MutationObserver(schedule);
  observer.observe(panel, { childList: true, subtree: true, characterData: true });
  panel.addEventListener("popupshowing", update);
  panel.addEventListener("popupshown", update);

  window.addEventListener("unload", () => {
    observer.disconnect();
    cancelAnimationFrame(scheduled);
    document.removeEventListener("mouseover", remember, true);
    document.removeEventListener("focusin", remember, true);
  }, { once: true });

  // one check later that the members this script reads exist
  setTimeout(() => {
    const t = gBrowser && gBrowser.tabs && gBrowser.tabs[0];
    if (t && !("group" in t)) warnOnce("tab.group is missing, no group name in the preview");
  }, 5000);
})();
