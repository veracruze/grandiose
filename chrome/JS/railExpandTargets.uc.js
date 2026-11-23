// ==UserScript==
// @name           railExpandTargets.uc.js
// @description    Expand-on-hover: decides WHERE on the collapsed rail the pointer may start the expansion.
//                 MODE "block" (default): hovering a sidebar button, the new tab button or a tab does not expand the rail (only the rest does).
//                 MODE "only": the reverse, the rail expands only over those.
//                 Never arms a second expansion while one is already pending. Firefox's own onMouseEnter builds a NEW DeferredTask on every call and
//                 keeps only the last one in SidebarController.mouseEnterTask, so a second call inside the hover delay leaves the first task armed
//                 but unreachable: both fire, debouncedMouseEnter runs twice, and the second slide animation cancels the first (recorded on Firefox
//                 159.0.1: the rail snapped open in ~19ms instead of sliding for 400ms; see sidebarContextMenuHold.uc.js for the second line of defence).
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  const TAG = "railExpandTargets";
  const MODE = "block";      // "block" | "only"
  const BUTTONS = true;      // sidebar buttons (tools, extensions, customize, the » overflow button)
  const NEWTAB = true;       // the new tab button
  const TABS = true;         // tabs (and tab group labels)
  const DEBUG = false;        // logs "[uc] expand ..." lines to the Browser Console (Ctrl+Shift+J); set to false when it behaves

  if (window.__ucRailExpandTargets) return;
  const SC = window.SidebarController;
  if (!SC || typeof SC.onMouseEnter !== "function" || typeof window.MousePosTracker === "undefined") {
    console.warn(`[uc] ${TAG}: SidebarController / MousePosTracker not found, script not loaded`);
    return;
  }
  window.__ucRailExpandTargets = true;

  const log = (msg) => { if (DEBUG) console.log(`[uc] expand ${msg}`); };

  // What is under the point: "button" (sidebar-main's shadow DOM), "new-tab" or "tab" (light DOM, slotted into the rail) or "".
  // elementFromPoint stops at the shadow host, so it is asked again on sidebar-main's shadow root (openOrClosedShadowRoot).
  const kindAt = (x, y) => {
    try {
      const top = document.elementFromPoint(x, y);
      if (!top) return "";
      if (NEWTAB && top.closest("#vertical-tabs-newtab-button, #tabs-newtab-button")) return "new-tab";
      if (TABS && top.closest("tab, tab-group")) return "tab";
      if (BUTTONS) {
        const host = top.localName === "sidebar-main" ? top : top.closest("sidebar-main");
        const sr = host && host.openOrClosedShadowRoot;
        const inner = sr && sr.elementFromPoint(x, y);
        if (inner && (inner.localName === "moz-button" || inner.closest("moz-button"))) return "button";
      }
    } catch (e) {}
    return "";
  };

  // true: the pointer must NOT start the expansion here
  const vetoed = (x, y) => {
    const kind = kindAt(x, y);
    return MODE === "only" ? !kind : !!kind;
  };

  const armed = () => !!(SC.mouseEnterTask && SC.mouseEnterTask.isArmed);
  const original = SC.onMouseEnter;

  // The pointer enters the rail: Firefox arms a short delay, then expands. Over a vetoed spot it is not armed at all.
  SC.onMouseEnter = function () {
    try {
      if (vetoed(MousePosTracker._x, MousePosTracker._y)) {
        log(`enter over ${kindAt(MousePosTracker._x, MousePosTracker._y) || "other"}: not expanding`);
        return undefined;
      }
    } catch (e) {}
    // one pending expansion is enough: a second task would fire as well and cancel the slide the first one starts (see the header)
    if (armed()) {
      log("enter while an expansion is already pending: not arming a second one");
      return undefined;
    }
    return original.apply(this, arguments);
  };

  // Firefox only calls onMouseEnter when the pointer comes IN from outside the rail. Moving inside the rail, from a button to a tab or the
  // other way round, needs this: arm the expansion on a spot that is allowed, cancel a pending one on a vetoed spot.
  const rectHas = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const onMove = (e) => {
    try {
      if (!document.documentElement.hasAttribute("sidebar-expand-on-hover")) return;
      if (SC._openPopupsCount > 0) return;                         // a menu is open: Firefox has stopped tracking the pointer
      if (!SC._state || SC._state.launcherExpanded) return;        // already expanded: leave it
      const x = e.clientX, y = e.clientY;
      if (!rectHas(SC.getMouseTargetRect(), x, y)) return;         // not on the rail
      if (vetoed(x, y)) {
        if (armed()) {
          SC.mouseEnterTask.disarm();
          log(`move over ${kindAt(x, y) || "other"}: pending expansion cancelled`);
        }
      } else if (!armed() && !SC._box.hasAttribute("sidebar-launcher-hovered")) {
        log(`move over ${kindAt(x, y) || "other"}: expansion armed`);
        original.call(SC);
      }
    } catch (err) {}
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("unload", () => {
    window.removeEventListener("mousemove", onMove, true);
    SC.onMouseEnter = original;
  }, { once: true });
})();