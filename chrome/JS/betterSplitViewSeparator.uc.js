// ==UserScript==
// @name           betterSplitViewSeparator.uc.js
// @description    Drag the split view divider with a guide line that snaps to thirds (text colour) and quarters (amber).
// @include        main
// ==/UserScript==

(() => {
  const SPLITTER = ".split-view-splitter";
  const PANEL_PROPS = ["flex", "width", "min-width", "max-width"];
  const LOCK_PX = 15;
  const THIRDS = [1 / 3, 1 / 2, 2 / 3];   // existing points, shown in the text colour
  const QUARTERS = [1 / 4, 3 / 4];         // new points, shown in amber
  const MIN_PANE = 100;

  let drag = null;
  // Panes this script has resized, so only those get reset
  const managedPanes = new Set();

  function isVisible(splitter) {
    return !!splitter && !splitter.hidden && splitter.getBoundingClientRect().width > 0;
  }

  // The pane a splitter resizes (aria-controls, falling back to the previous sibling)
  function paneFor(splitter) {
    const id = splitter.getAttribute("aria-controls");
    return (id && document.getElementById(id)) || splitter.previousElementSibling;
  }

  function cancelDrag() {
    if (!drag) return;
    drag.guide.remove();
    drag = null;
  }

  // Release a pane only when Firefox no longer treats it as part of a split.
  // A split that is merely off-screen (e.g. after switching to another tab) keeps its class.
  function releaseEndedPanes() {
    for (const pane of managedPanes) {
      const stillSplit = pane.isConnected && pane.classList.contains("split-view-panel");
      if (!stillSplit) {
        PANEL_PROPS.forEach((prop) => pane.style.removeProperty(prop));
        managedPanes.delete(pane);
      }
    }

    if (drag && !(drag.pane.isConnected && drag.pane.classList.contains("split-view-panel"))) {
      cancelDrag();
    }
  }

  // Runs on changes to the tab panels. Only touches panes this script resized, and does nothing at all
  // while there are none (the common case) or no drag is running.
  function startWatching() {
    const panels = document.getElementById("tabbrowser-tabpanels");
    if (!panels) return;
    const observer = new MutationObserver(() => {
      if (!managedPanes.size && !drag) return;
      releaseEndedPanes();
    });
    observer.observe(panels, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],   // releaseEndedPanes only looks at isConnected and the split-view-panel class
    });
    releaseEndedPanes();
  }

  function moveGuide(clientX) {
    const { guide, containerLeft, containerWidth } = drag;

    const width = Math.min(
      Math.max(clientX - containerLeft, MIN_PANE),
      containerWidth - MIN_PANE
    );

    const near = (points) =>
      points.some((f) => Math.abs(clientX - (containerLeft + containerWidth * f)) <= LOCK_PX);

    // Thirds take priority, then quarters, otherwise the normal accent colour
    let color = "var(--uc-accent-base, AccentColor)";
    if (near(THIRDS)) color = "CanvasText";
    else if (near(QUARTERS)) color = "#e0a000";

    drag.width = width;
    guide.style.left = containerLeft + width + "px";
    guide.style.background = color;
  }
  
  function endDrag() {
    if (!drag) return;
    const { pane, splitter, width, guide, containerWidth } = drag;

    if (splitter.isConnected && isVisible(splitter)) {
      pane.style.setProperty("flex", `0 0 ${width}px`, "important");
      pane.style.setProperty("width", `${width}px`, "important");
      pane.style.removeProperty("min-width");
      pane.style.removeProperty("max-width");
      managedPanes.add(pane);

      splitter.setAttribute("aria-valuenow", Math.round(width));
      splitter.setAttribute("aria-valuemax", Math.round(containerWidth - MIN_PANE));
    }

    guide.remove();
    drag = null;
    window.dispatchEvent(new Event("resize"));
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const splitter = e.target.closest?.(SPLITTER);
    if (!splitter || !isVisible(splitter)) return;

    const pane = paneFor(splitter);
    const container = splitter.parentElement;
    if (!pane || !container) {
      console.error("split-resize: pane or container not found", splitter.getAttribute("aria-controls"));
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const paneBox = pane.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();

    const guide = document.createElement("div");
    guide.id = "split-resize-guide";
    guide.style.cssText =
      `position:fixed;top:${containerBox.top}px;height:${containerBox.height}px;` +
      "width:2px;background:var(--uc-accent-base, AccentColor);pointer-events:none;z-index:2147483647;";
    document.documentElement.appendChild(guide);

    drag = {
      pane,
      splitter,
      guide,
      containerLeft: containerBox.left,
      containerWidth: containerBox.width,
      width: paneBox.width,
    };
    moveGuide(e.clientX);
  }

  function onMouseMove(e) {
    if (!drag) return;
    if (e.buttons === 0) {
      endDrag();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    moveGuide(e.clientX);
  }

  function onMouseUp(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }

  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("blur", endDrag);
  // The loader may run this after the window has loaded, when "load" never fires again
  if (document.readyState === "complete") startWatching();
  else window.addEventListener("load", startWatching, { once: true });
})();