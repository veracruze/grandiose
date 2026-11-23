// user.js for the userChrome theme
//
// WHAT THIS IS
//   The about:config settings the theme needs, in one file. Firefox reads user.js every time it starts and
//   applies every line, so you do not have to set them by hand.
//
// HOW TO USE IT
//   1. In Firefox open about:support, find "Profile Folder" and click "Open Folder".
//   2. Copy this file into that folder, next to prefs.js (the file must be called exactly user.js).
//   3. Restart Firefox.
//
// GOOD TO KNOW
//   * A line here wins over about:config on every start, so a setting you change in about:config and that
//     is also listed here will be reset the next time Firefox starts. Delete the line to stop that.
//   * Settings that the theme's Customize sidebar panel controls (Density, Color Scheme, Selection colour)
//     are deliberately NOT in this file, or they would be reset at every start.
//   * To undo everything: delete this file and restart. Values Firefox already saved stay until you reset
//     them in about:config (right-click a setting > Reset).

// ---- Required ----

// Lets Firefox load chrome/userChrome.css (and the css/ folder it imports). Without this the theme does nothing.
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// ---- Window and toolbars ----

// "never" keeps the bookmarks toolbar hidden (a minimal look). It is safe to change: JS/bookmarksToolbarHeight.uc.js
// publishes the toolbar's height as --uc-bm-h and css/02-base-layout.css (section 6) makes room for it at every density.
user_pref("browser.toolbars.bookmarks.visibility", "never");

// Tabs live in the title bar (Customize Toolbar > "Title Bar" unticked). The theme also hides the window
// buttons (minimise / maximise / close) with .titlebar-buttonbox-container, so close windows with
// Alt+F4 or the taskbar. Delete the rule in css/02-base-layout.css if you want the buttons back.
user_pref("browser.tabs.inTitlebar", 1);

// Lets the page area be see-through, which the theme's transparent page frame (#browser in
// css/02-base-layout.css) relies on. Leave it out if you do not use see-through page backgrounds.
user_pref("browser.tabs.allow_transparent_browser", true);

// ---- Sidebar ----

// The sidebar rail shrinks to icons and opens when the mouse touches it. The theme's rail animation and
// layout are built around this mode.
// Other values: "always-show" (rail always open) or "hide-sidebar" (the "Hide tabs and sidebar" option).
// This line only sets the value Firefox starts with. JS/vtRememberVisibility.uc.js keeps the last mode you chose while
// vertical tabs were on (pref uc.sidebar.savedVisibility) and puts it back about 1 s after startup, so a mode you pick
// later wins over this line. To force this value, delete uc.sidebar.savedVisibility in about:config.
// If this line does not seem to do anything, open the Customize sidebar panel, switch the option you want,
// and copy the value you then see for sidebar.visibility in about:config.
user_pref("sidebar.visibility", "expand-on-hover");

// How long the mouse has to rest on the rail before it opens, in milliseconds. 0 = immediately.
// (This is also editable in the Customize sidebar panel; delete this line if you would rather use that.)
// user_pref("sidebar.animation.expand-on-hover.delay-duration-ms", 500);

// Not set here on purpose: sidebar.verticalTabs. Forcing it from user.js turned expand-on-hover off.
// Turn vertical tabs on or off with the normal Firefox setting instead (Customize sidebar > Vertical tabs).

// ---- Address bar ----

// Firefox greys out the non-domain part of the address by itself. The theme's JS/urlHostHighlight.uc.js
// draws its own two-colour address text instead, so Firefox's version is switched off.
// (The script also sets this itself; the line is here so the two never disagree.)
user_pref("browser.urlbar.formatting.enabled", false);

// ---- Density ----

// Shows "Compact" in Customize Toolbar > Density. The theme has a layout for it. (Standard, Compact and Touch
// can also be switched from the Customize sidebar panel.)
user_pref("browser.compactmode.show", true);

// ---- New tab page ----

// The theme restyles the new tab page's clock and weather widgets (chrome/userContent.css). The styling expects
// them in Firefox's widgets row, which is where they appear when their size is "large". At the default size the
// weather stays a small box in the top-right corner and the new tab layout looks broken.
// These lines run at every start, so changing the widget size from the new tab page does not stick.
user_pref("browser.newtabpage.activity-stream.widgets.weather.size", "large");
user_pref("browser.newtabpage.activity-stream.widgets.clocks.size", "large");

// Keeps the widgets row open instead of collapsed (the theme hides the button that would reopen it).
user_pref("browser.newtabpage.activity-stream.widgets.maximized", true);

// Optional: show the clocks in 24-hour format. Remove the two slashes to turn it on.
user_pref("browser.newtabpage.activity-stream.widgets.clocks.hourFormat", "24");

// ---- Optional: fixed text-selection colour ----
// The Customize sidebar panel has a "Selection colour" option that follows your Windows accent colour. Use
// these instead only if you want one fixed colour (it also colours selections on web pages). Remove the
// two slashes to turn them on, and do not use both this and the panel option.
// user_pref("ui.highlight", "#7f5af0");
// user_pref("ui.highlighttext", "#ffffff");
