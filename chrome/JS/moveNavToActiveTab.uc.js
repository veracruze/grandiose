// ==UserScript==
// @name           moveNavToActiveTab.uc.js
// @description    Moves the back/forward buttons into the selected tab (just before its title).
// @include        main
// ==/UserScript==

(function () {
  function moveNavButtons() {
    const tab = gBrowser.selectedTab;
    if (!tab) return;

    const backBtn = document.getElementById('back-button');
    const fwdBtn = document.getElementById('forward-button');
    if (!backBtn || !fwdBtn) return;

    // Insert before the label container, outside the favicon stack
    const labelContainer = tab.querySelector('.tab-label-container');
    if (!labelContainer) return;

    // Already in place (back, forward, label)? Skip the DOM work.
    if (fwdBtn.nextElementSibling === labelContainer &&
        backBtn.nextElementSibling === fwdBtn) return;

    labelContainer.before(fwdBtn);
    fwdBtn.before(backBtn);
  }

  // Only location changes matter; onStateChange fires constantly while loading.
  const progressListener = { onLocationChange: moveNavButtons };

  gBrowser.tabContainer.addEventListener('TabSelect', moveNavButtons);
  gBrowser.addTabsProgressListener(progressListener);

  // Clean up when this window closes
  window.addEventListener('unload', () => {
    gBrowser.tabContainer.removeEventListener('TabSelect', moveNavButtons);
    gBrowser.removeTabsProgressListener(progressListener);
  }, { once: true });

  // Scripts run after the window has loaded, so DOMContentLoaded would never fire.
  moveNavButtons();
  setTimeout(moveNavButtons, 300);
})();
