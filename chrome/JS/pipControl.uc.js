// ==UserScript==
// @name           pipControl.uc.js
// @description    Ctrl + Hover over a tab to open PiP. Ctrl + Hover over the PiP window to return the video to its originating tab without switching tabs.
// @include        main
// ==/UserScript==

(() => {
  if (window.__ucPipControl) return;
  window.__ucPipControl = true;

  const { PictureInPicture } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs"
  );

  /* ==========================================================================
     PART 1 — Ctrl + Hover over a tab → open a floating PiP window
     ========================================================================== */
  let hoveredTab = null;
  let lastTriggeredTab = null;
  let triggerCooldownUntil = 0;   // blocks all triggers briefly after a successful one
  let returnCooldownUntil = 0;    // blocks re-opening right after returning from PiP

  const pipExistsForBrowser = (browser) => {
    const e = Services.wm.getEnumerator("Toolkit:PictureInPicture");
    while (e.hasMoreElements()) {
      const w = e.getNext();
      if (PictureInPicture.weakWinToBrowser.get(w) === browser) return true;
    }
    return false;
  };

  const triggerPiP = (e) => {
    if (!e.ctrlKey || !hoveredTab) return;
    if (lastTriggeredTab === hoveredTab) return;

    const now = Date.now();
    if (now < triggerCooldownUntil) return;
    if (now < returnCooldownUntil) return;

    const browser = hoveredTab.linkedBrowser;
    if (!browser) return;

    // Don't open a second PiP for a tab that already has one.
    if (pipExistsForBrowser(browser)) {
      lastTriggeredTab = hoveredTab;
      return;
    }

    try {
      const actor = browser.browsingContext
        .currentWindowGlobal.getActor("PictureInPictureLauncher");
      actor.sendAsyncMessage("PictureInPicture:AutoToggle");
      lastTriggeredTab = hoveredTab;
      // Hard cooldown: ignore any further triggers for the next 1s,
      // long enough for the PiP window to actually appear.
      triggerCooldownUntil = now + 1000;
    } catch (err) {
      console.warn("[uc-pip] Could not trigger PiP:", err);
    }
  };

  gBrowser.tabContainer.addEventListener("mouseover", (e) => {
    hoveredTab = e.target.closest(".tabbrowser-tab");
    triggerPiP(e);
  });

  gBrowser.tabContainer.addEventListener("mouseout", (e) => {
    const related = e.relatedTarget;
    const stillInTab =
      related &&
      related.nodeType === 1 &&
      typeof related.closest === "function" &&
      related.closest(".tabbrowser-tab");

    if (!stillInTab) {
      hoveredTab = null;
      // Reset lastTriggeredTab only when leaving the tab strip entirely.
      // The hard cooldown above still protects against fast re-entry.
      if (!related || (related.nodeType === 1 && related.closest && related.closest(".tabbrowser-tabs"))) {
        // moving to another tab: allow a new trigger after the cooldown
        // (do not reset here — the cooldown + lastTriggeredTab handle it)
      } else {
        lastTriggeredTab = null;
      }
    }
  });

  window.addEventListener("keydown", triggerPiP);

  /* ==========================================================================
     PART 2 — Ctrl + Hover over a PiP window → return video to its tab
     ========================================================================== */
  const windowListener = {
    onOpenWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow;
      domWindow.addEventListener(
        "load",
        () => {
          if (
            domWindow.document.documentElement.getAttribute("windowtype") ===
            "Toolkit:PictureInPicture"
          ) {
            attachReturnListener(domWindow);
          }
        },
        { once: true }
      );
    },
    onCloseWindow() {},
    onWindowTitleChange() {},
  };

  Services.wm.addListener(windowListener);

  function attachReturnListener(pipWin) {
    if (pipWin.__ucPipReturnListener) return;
    pipWin.__ucPipReturnListener = true;

    let returning = false;

    pipWin.document.addEventListener("mouseover", (e) => {
      if (!e.ctrlKey || returning) return;
      returning = true;

      try {
        const browser = PictureInPicture.weakWinToBrowser.get(pipWin);
        if (!browser) {
          console.warn("[uc-pip] No originating browser found for this PiP window.");
          returning = false;
          return;
        }

        const gBrowser = browser.getTabBrowser();
        const tab = gBrowser.getTabForBrowser(browser);
        if (!tab) {
          console.warn("[uc-pip] Could not find the originating tab.");
        }

        PictureInPicture.closePipWindow(pipWin)
          .then(() => {
            // Suppress any immediate re-open (e.g. cursor now over tab strip).
            returnCooldownUntil = Date.now() + 500;
            lastTriggeredTab = null;
          })
          .catch((err) => {
            console.error("[uc-pip] closePipWindow failed:", err);
            returning = false;
          });
      } catch (err) {
        console.error("[uc-pip] Return-to-tab failed:", err);
        returning = false;
      }
    });
  }
})();