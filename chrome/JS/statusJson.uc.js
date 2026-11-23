// ==UserScript==
// @name           statusJson.uc.js
// @description    Vertical tabs only: Firefox's status text (the link under the pointer, "Waiting for...", "Transferring data from...") shown at the
//                 bottom right like a chat room. Every new status is one line, a JSON message object, and the lines stack upwards (newest at the
//                 bottom):
//                     { "type": "status", "text": "Waiting for example.com..." }
//                     { "type": "overlink", "text": "https://example.com/page" }
//                 Overlinks don't stack: only the latest one is shown, a new overlink replaces the one still on screen. Status lines stack as usual.
//                 Each line stays for --uc-status-hold, fades out over --uc-status-fade-out and is then removed (css/01-tokens.css, section 2);
//                 the timing is a CSS animation, this script only adds the lines and removes them when the animation ends.
//                 One line per message: a long text is cut with an ellipsis, the rest of the JSON stays visible.
//                 Why: with vertical tabs the address bar is a floating bar that is invisible until hovered, and the normal status text is drawn
//                 inside it (css/03), so link hovers were never seen. In horizontal-tabs mode nothing changes and this stays hidden.
//                 Looks and position: the --uc-status-* variables in css/01-tokens.css, the rules at the end of css/03-urlbar.css.
//                 To change the shape of a message, edit the one line marked MESSAGE SHAPE below.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  if (window.__ucStatusJson) return;

  const TAG = "statusJson";
  const warn = (msg) => console.warn(`[uc] ${TAG}: ${msg}`);

  const root = document.documentElement;
  const panel = document.getElementById("statuspanel");
  const label = document.getElementById("statuspanel-label");
  if (!panel) { warn("#statuspanel is missing, script not loaded"); return; }
  window.__ucStatusJson = true;

  const HTML = "http://www.w3.org/1999/xhtml";
  const MAX_LINES = 6; // the oldest line is dropped at once when there are more than this

  const feed = document.createElementNS(HTML, "div");
  feed.id = "uc-status-json";
  feed.setAttribute("aria-hidden", "true"); // Firefox's own status panel already reaches screen readers
  root.appendChild(feed);

  const part = (line, cls, text) => {
    const s = document.createElementNS(HTML, "span");
    s.className = cls;
    s.textContent = text;
    line.appendChild(s);
  };

  // JSON.stringify does the quoting and escaping; the quotes are drawn as separate pieces so that only the text inside them is cut by the ellipsis
  const inner = (text) => JSON.stringify(text).slice(1, -1);

  function addLine(type, text) {
    const line = document.createElementNS(HTML, "div");
    line.className = "m";
    line.dataset.type = type;
    line.dataset.text = text;
    // MESSAGE SHAPE: keys and order of a message. Add a key here to extend it.
    part(line, "p", "{ ");
    part(line, "k", '"type"'); part(line, "p", ": "); part(line, "t", JSON.stringify(type)); part(line, "p", ", ");
    part(line, "k", '"text"'); part(line, "p", ": "); part(line, "q", '"'); part(line, "v", inner(text)); part(line, "q", '"');
    part(line, "p", " }");
    // the fade-out is a CSS animation (hold, then fade); when it ends the line is gone
    line.addEventListener("animationend", () => line.remove());
    feed.appendChild(line);
    while (feed.childElementCount > MAX_LINES) feed.firstElementChild.remove();
  }

  const readText = () => String((label && (label.value || label.getAttribute("value") || label.textContent)) || "").trim();
  const railAtEnd = () => {
    const rail = document.getElementById("sidebar-container");
    return root.hasAttribute("sidebar-positionend") || !!(rail && rail.hasAttribute("sidebar-positionend"));
  };

  function update() {
    try {
      const text = readText();
      // Only with vertical tabs; the horizontal layout keeps the status text inside the address bar.
      if (!root.hasAttribute("uc-vertical") || panel.hasAttribute("inactive") || !text) return;
      // Firefox sets the attribute to "overLink" (capital L, link under the pointer), "status" or "defaultStatus"; normalise to "overlink" / "status"
      const type = String(panel.getAttribute("type") || "").toLowerCase() === "overlink" ? "overlink" : "status";
      // the same message that is still on screen is not said twice
      for (const m of feed.children) {
        if (m.dataset.type === type && m.dataset.text === text) return;
      }
      // overlinks don't stack: a new one replaces the one still on screen
      if (type === "overlink") {
        for (const m of [...feed.children]) {
          if (m.dataset.type === "overlink") m.remove();
        }
      }
      feed.toggleAttribute("uc-end", railAtEnd()); // rail on the right: keep clear of it
      addLine(type, text);
    } catch (e) {
      console.error(`${TAG}:`, e);
    }
  }

  const observer = new MutationObserver(update);
  observer.observe(panel, {
    attributes: true,
    attributeFilter: ["inactive", "type", "value"],
    childList: true,
    characterData: true,
    subtree: true,
  });

  // Leaving vertical tabs hides the feed (display: none stops the animations), so drop what is in it instead of showing old lines later.
  const modeObserver = new MutationObserver(() => {
    if (!root.hasAttribute("uc-vertical")) feed.textContent = "";
  });
  modeObserver.observe(root, { attributes: true, attributeFilter: ["uc-vertical"] });

  window.addEventListener("unload", () => {
    observer.disconnect();
    modeObserver.disconnect();
  }, { once: true });

  update();
})();