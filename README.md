# Firefox userChrome theme (Firefox 160)

A userChrome theme for Firefox 160 built around native vertical tabs and the expand-on-hover sidebar rail: an accent-driven palette, glass transparency, tab glows, split view and tab group styling, Feather icons, and a Customize-panel with live tunables.

---

## Requirements

| Item | Notes |
|---|---|
| Firefox **160** | Tested on 160 only. Much of the theme depends on Firefox internals (sidebar, view transitions, shadow DOM) that change between releases. |
| Windows 11 | Developed and tested on Windows 11. Linux and macOS are untested. |
| [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) | Loads the `.uc.js` scripts. Without it the CSS loads but the theme is only partly working. The Express Install installs it for you. |
| DWMBlurGlass + Windows transparency settings | For the glass/transparent window (see [Transparency](#6-transparency)). |
| Fonts (optional) | See [Fonts](#4-fonts). Nothing is bundled in the repository; the Express Install downloads them. Missing fonts fall back to `sans-serif`. |
| Cascadia Mono or Consolas | Used by the status feed in vertical-tabs mode. Falls back to any monospace. |

---

## Express Install

The installer (`install.ps1`) does the whole setup in one command: theme files, fonts, preferences and the fx-autoconfig loader. Use the [manual installation](#manual-installation) below only if you want to do it step by step.

### How to install

1. **Copy your profile folder path.** In Firefox, open `about:support`, find **Profile Folder** and click **Open Folder**. In the File Explorer window that opens, click the address bar at the top and press `Ctrl+C` to copy the path.
2. **Open PowerShell.** Click the Windows Start button, type `PowerShell`, and press Enter. Do **not** choose "Run as administrator": the script asks for permission itself, once, when it needs it.
3. **Run the installer.** In the blue window, paste the command below, replace `PASTE-THE-COPIED-PATH-HERE` with the path you copied (keep the quotes), then press Enter. Right-click the window to paste.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/veracruze/grandiose/main/install.ps1))) -ProfilePath "PASTE-THE-COPIED-PATH-HERE" -NoBlur
```

`-NoBlur` skips the DWMBlurGlass installation. To install DWMBlurGlass as well (needed for a transparent window background), use `-Blur` instead of `-NoBlur`:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/veracruze/grandiose/main/install.ps1))) -ProfilePath "PASTE-THE-COPIED-PATH-HERE" -Blur
```

If you installed the theme from a fork, replace `veracruze/grandiose` in the address with your own GitHub user name and repository name.

4. **Restart Firefox.** Close every Firefox window (check Task Manager for a leftover `firefox.exe`), start it again, and open the Customize panel (gear icon at the bottom of the rail).
5. **Only if something looks unstyled:** open `about:support`, click **Clear startup cache** and let Firefox restart.

### What the installer does

1. Finds your default Firefox profile. `-ProfilePath` is optional: without it the installer uses the default profile, and the line `Profile: <path>` at the start of its output tells you which one it picked. Check that it matches **Profile Folder** in `about:support`, especially if you also have Nightly or Developer Edition installed.
2. Backs up your existing `chrome` folder (except `chrome\utils`) to `chrome.backup-<date>` in the profile.
3. Downloads this repository and copies its `chrome\` folder into your profile. Your own `css\user-overrides.css` is kept and never overwritten. It also writes `chrome\1px-transparent.png`, the default background image.
4. Downloads the fonts into `chrome\fonts` (Nunito, Noto Sans and the other alphabets, Poppins), plus the large CJK font for your Windows display language. Poppins is also registered for your Windows user only (no admin needed), because the new tab page loads it by name.
5. Adds the theme's `user.js` settings to the `user.js` in your profile, inside a marked block. Re-running the installer replaces only that block; anything else you keep in `user.js` is left alone.
6. Deletes old theme files listed in `removed-files.txt`.
7. Installs the fx-autoconfig loader (`config.js` and `defaults\pref\config-prefs.js`) into Firefox's install folder. This is the only step that needs administrator permission, and Windows asks once. A different existing `config.js` is saved as `config.js.bak-<date>` first.
8. Optional: with `-Blur`, downloads DWMBlurGlass 2.3.2 Beta3 (64-bit only) from its official release, checks its SHA256 and unzips it to `C:\Program Files\DWMBlurGlass`. It is not run and no setting is changed: follow [Transparency](#6-transparency) for what to do next.

Running the installer again updates the theme in place, so use the same command to update.

### Options

| Option | Effect |
|---|---|
| `-ProfilePath "<folder>"` | Use this profile folder instead of the default one. |
| `-Blur` / `-NoBlur` | Download DWMBlurGlass without asking / never ask about it. With neither, an interactive console asks `Download it now? [y/N]`. |
| `-Cjk <auto\|none\|ja\|ko\|zh-cn\|zh-tw>` | Which large CJK font to download. Default `auto` picks it from your Windows display language. |
| `-NoFonts` | Skip all font downloads. |
| `-NoAutoconfig` | Do not touch Firefox's install folder. The `.uc.js` scripts will not run. |
| `-FirefoxDir "<folder>"` | Firefox's install folder, if it is not found automatically (default `C:\Program Files\Mozilla Firefox`). |

Example with several options: `... -ProfilePath "C:\Users\you\AppData\Roaming\Mozilla\Firefox\Profiles\abcd1234.default-release" -NoBlur -Cjk ja`

### If something goes wrong

- **Preferences not applied:** the installer reads `user.js` from the repository root. If it is missing there, you get a `user.js not found in the download` warning. See [Preferences](#preferences).
- **`.uc.js` scripts do nothing:** the loader step was declined or failed. Run the installer again and accept the permission prompt, or pass `-FirefoxDir`.
- **Missing fonts:** the installer prints which ones could not be downloaded. The theme falls back to Firefox's own font.
- **Firefox was running:** the files are still copied. Restart Firefox to apply them.
- **Undo:** the previous `chrome` folder is in `chrome.backup-<date>` in your profile. See also [Uninstall](#uninstall).

---

## Manual installation

### 1. Back up your profile
Open `about:support`, click **Open Folder** next to *Profile Folder*, and copy the `chrome` folder (if you have one) somewhere safe.

### 2. Copy the theme files
Copy everything from this repository's `chrome/` folder into your profile's `chrome/` folder, keeping the structure:

```
chrome/
├─ userChrome.css
├─ userContent.css
├─ thinking-dots.svg
├─ 1px-transparent.png
├─ css/        (00-fonts.css … 19-rail-icons.css)
├─ JS/         (*.uc.js)
└─ fonts/      (optional, you download these yourself, see Fonts)
```

`css/` is imported by `userChrome.css`, so the file names and the order of the `@import` lines must not change. `thinking-dots.svg` is the tab loading indicator (see [Throbber](#throbber)).

### 3. Install fx-autoconfig

Follow the instructions in the [fx-autoconfig repository](https://github.com/MrOtherGuy/fx-autoconfig). After it's installed, your profile should have `chrome/utils/`, `chrome/JS/` and `chrome/resources/`.

### 4. Fonts
Nothing is bundled. All fonts are optional. A missing font falls back to the next one in the stack and finally to `sans-serif`. Download the ones you want and put the `.ttf` files in `chrome/fonts/` (or install them system-wide where the table says so).

| Font | Used for | How it is loaded |
|---|---|---|
| **[Nunito](https://fonts.google.com/specimen/Nunito) Black** | Latin, Latin Extended, Cyrillic, Vietnamese (the main interface look) | `chrome/fonts/Nunito-Black.ttf` (or `chrome/Nunito-Black.ttf`) |
| **[Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) Black** | Greek, and Latin letters when the interface is in a non-Latin-script language | Installed system-wide, or `chrome/fonts/NotoSans-Black.ttf` |
| Noto Sans [Hebrew](https://fonts.google.com/noto/specimen/Noto+Sans+Hebrew) / [Arabic](https://fonts.google.com/noto/specimen/Noto+Sans+Arabic) / [Thai](https://fonts.google.com/noto/specimen/Noto+Sans+Thai) / [Devanagari](https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari) Black | Those scripts | Installed system-wide, or `chrome/fonts/NotoSans<Script>-Black.ttf` |
| Noto Sans [JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) / [SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) / [TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC) / [KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) Black | Japanese / Chinese / Korean (large files, only the one for your interface language is used) | Installed system-wide, or `chrome/fonts/NotoSans<XX>-Black.ttf` |
| **[Poppins](https://fonts.google.com/specimen/Poppins)** (ExtraLight, Light, Regular, Thin) | The `about:newtab` page | Installed system-wide |

All of them are SIL Open Font License fonts from Google Fonts.

### 5. Animations
- Right click the Start button and open "Settings".
- Search "Visual effects" and enable "Animation effects" (also enable "Transparency effects" here if it is not enabled).

### 6. Transparency
1. Download version 2.3.2b3 of [DWMBlurGlass](https://github.com/Maplespe/DWMBlurGlass/releases) (used to set transparency with the release of this theme; a higher version might work as well). Only tested on Windows 11. The Express Install can download it for you with `-Blur`.
   - Unzip the contents of the .zip file somewhere you will keep them and run `DWMBlurGlassGUI.exe`.
   - Toggle on "Override DWMAPI effect (Windows 11)".
   - Set the alpha of "Titlebar blend color (active)" and "Titlebar blend color (inactive)" to the transparency you want, for both "Light Mode colors" and "Dark Mode colors".
     - I use 52 as the last value of RGBA (you have to set the fourth number, the first three are just the colour).
   - Switch to the advanced tab and make sure that:
     - Blur method is "CustomBlur (IComposition)".
     - Effect type is "Blur" and "Blur radius" is set to the amount you want (the blur on the transparent background).
     - I use "Speed Priority" here, since blur can be system intensive at times.
   - Switch to the "Symbol" tab and download the symbols for the last part. It has to say "Valid" afterwards.
2. Open "Personalize" by right clicking the desktop. Select "Colors". Enable "Transparency effects".
   - You can set your accent colour here as well. It applies to this theme if "System" is selected in the Customize sidebar panel inside Firefox.
3. Open Firefox and toggle the sidebar on (you can add the button by right clicking the navbar, outside of the urlbar, and choosing "Customize Toolbar").
   - At the bottom of the sidebar, click the cog icon to open the "Customize Sidebar" panel. A lot of this theme's settings live there.
   - Find "Background image" and click "Choose…". You can set any background you want here.
     - Try to pick something with your desktop resolution. Think of it like a wallpaper; you can set its properties in the panel.
     - Or use a transparent image like the included `1px-transparent.png` for a fully transparent experience, where you can see what is behind your browser's home page, toolbars and panels.

The theme itself makes `#main-window`, `#browser` and `#tabbrowser-tabpanels` transparent (`css/17-glass-transparency.css`) and relies on the pref `browser.tabs.allow_transparent_browser` (see [Preferences](#preferences)).

### 7. Set the preferences
See [Preferences](#preferences). Set them in `about:config`.

## Preferences

This repository does **not** ship a `user.js`, so your own settings are never overwritten. Set these once in `about:config`.

### Required and recommended

| Preference | Type | Value | Why |
|---|---|---|---|
| `toolkit.legacyUserProfileCustomizations.stylesheets` | Boolean | `true` | **Required.** Lets Firefox load `userChrome.css` and `userContent.css`. |
| `browser.toolbars.bookmarks.visibility` | String | `never` | The navbar and toolbox have a fixed height (`css/02`), so a visible bookmarks toolbar gets cut off. |
| `browser.tabs.inTitlebar` | Integer | `1` | Tabs live in the title bar. The window buttons are hidden by the theme, so close windows with Alt+F4 or the taskbar. |
| `browser.tabs.allow_transparent_browser` | Boolean | `true` | Needed for the transparent page frame (`css/17`). |
| `browser.compactmode.show` | Boolean | `true` | Optional. Shows **Compact** in Customize Toolbar > Density. The theme has a layout for it. |

If a pref does not exist yet, create it with the type shown above.

### Preferences the theme manages itself
You do not need to set these. They are written by the scripts or the Customize sidebar panel, and setting them by hand just changes the same values.

| Preference | Set by | Meaning |
|---|---|---|
| `browser.uidensity` | Customize panel | Standard / Compact / Touch |
| `layout.css.prefers-color-scheme.content-override` | Customize panel | Color scheme (Dark / Light / System / Browser) |
| `ui.highlight`, `ui.highlighttext`, `uc.selection-colour.mode` | Customize panel | Selection colour |
| `uc.accent.override`, `uc.accent.opacity` | Customize panel | Accent colour and opacity |
| `uc.gradient.amount`, `uc.gradient.angle`, `uc.gradient.accent`, `uc.gradient.color` | Customize panel | Gradient look |
| `uc.glow.strength` | Customize panel | Tab and split-view glow |
| `uc.background.image`, `uc.background.dim`, `uc.background.image.opacity` | Customize panel | Background image |
| `uc.surface.opacity`, `uc.tab.opacity`, `uc.popup.opacity` | Customize panel | Translucency |
| `uc.theme.colors` | Customize panel | Colour source: Accent (0) or Firefox theme (1). With a non-default theme the accent and gradient colours follow the theme |
| `uc.theme.lastId` | `SidebarToggles.uc.js` | Remembers the last active theme, so a theme change made while Firefox was closed is noticed |
| `uc.newtab.sheet` | `SidebarToggles.uc.js` | Remembers the user sheet that gives `about:newtab` the accent colour |
| `ui.systemUsesDarkTheme` | Customize panel | Theme mode: Light (0), Dark (1) or Device (no value set, same as `about:addons`) |
| `uc.fullscreen.overlay-mode` | Customize panel | Fullscreen bars overlay the page (1) or push it (0) |
| `sidebar.animation.expand-on-hover.delay-duration-ms` | Customize panel | Expand-on-hover delay |
| `uc.sidebar.keepVisible` | Toolbar context menu | Keep the rail visible in *Hide tabs and sidebar* mode |
| `uc.sidebar.savedVisibility` | `vtRememberVisibility.uc.js` | Remembers the sidebar visibility across vertical-tabs toggles |
| `uc.forceScheme.sites` | `forceSchemePerSite.uc.js` | Per-site forced light/dark list |
| `extensions.uc.faviconUpgrader.placesScope` | `FaviconUpgrader.uc.js` panel (*Change favicon…* > *Bookmarks & address bar*) | Which sites get the upgraded icon in bookmarks, history and the address-bar dropdown: `sites` (default, only chosen ones), `all` (every site, the full effect) or `off` |
| `uc.railHold.*` | Optional | Fade timings of the rail's button row and » chevron |
| `uc.overlay.js-rail` | Optional | Set to `false` to use the CSS-only rail slide in overlay mode |
| `browser.urlbar.formatting.enabled` | `urlHostHighlight.uc.js` | Set to `false` by the script (it draws its own domain highlight) |

Debug-only prefs (all default to `false`): `uc.urlbar.keep-visible`, `uc.pushSettle.debug`, `uc.sidebarAutoHide.debug`.

---

### 8. Clear the startup cache and restart
Open `about:support`, click **Clear startup cache**, and let Firefox restart. Do this again after every update of the theme files or of fx-autoconfig.

### 9. Check the settings in the "Customize sidebar" panel and set them as you please.

## Addons
The theme needs no addon. The higher quality favicon replacer and the extension on/off panel are theme scripts: `FaviconUpgrader.uc.js` and `ExtensionToggles.uc.js` (a rail button and a » menu entry, see [Features](#features)). If you installed the standalone *Favicon Upgrader*, *Cache Favicons for Bookmarks* or *Extension Toggles* addon earlier, remove it: two favicon replacers would fight over the tab icon, and the script already does what *Cache Favicons for Bookmarks* did.


## Features
- **Window sizing** It's controlled by dragging sides or edges of the screen. If you want to minimize/maximize or use layout features of Windows, use "Windows Button + Up, Down, Left or Right". Alt + F4 closes the browser, or close all the tabs with Alt + W.
- **3 Density Settings** All available for both horizontal and vertical setups + windowed and fullscreen animations.
- **Overlay Mode** A mode that doesn't move the page when the sidebar expands.
- **Full featured right side rail for vertical tabs** Bug free with every feature available to the left side rail.
- **Eyedropper Tool to select theme colors** Open a video or a picture and pick the colors, edit those colors, customize as you like.
- **Fully customizable real transparency** See behind your browser, blur it, make it opaque or semi-transparent.
- **Higher quality extension icons** JS script for extensions (`extensionIcons.uc.js`).
- **Higher quality website favicons** (`FaviconUpgrader.uc.js`): a tab icon of 32 px or more is left alone (32 to 96 px is sharp); a smaller one is replaced by the best icon the site offers (its declared icon, apple-touch icon, web manifest, `/favicon.ico`, or a bigger `2x` / `3x` / `4x` rendition of a `1x` address), drawn as a sharp PNG of at most 64 px. A bigger icon is always better than a 16 px one. Animated icons (GIF, APNG, animated WebP) are never flattened, and pages that change their own icon (unread badges, spinners) are left alone, except that SVG frames are sharpened. **Change favicon…** in the tab context menu lets you pick a found icon, paste your own image or address, or choose *Site's own* / *Automatic* per site.
  - **Bookmarks, history and the address-bar dropdown** read their icons from Firefox's favicon database, not from the tab, so the script writes its icon there too. This also does what the *Cache Favicons for Bookmarks* extension did: an icon sent with `Cache-Control: no-store` no longer leaves a globe. A site whose own icon is kept still gets one sharp PNG of it there when Firefox would otherwise serve a small copy (under 32 px). Scope: **Bookmarks & address bar** in the panel (*Chosen sites* / *All sites* / *Off*; pref `extensions.uc.faviconUpgrader.placesScope`). The default is **Chosen sites**: set it to **All sites** to be fully active for every bookmarked site. Bookmarked sites are looked up once in the background after startup, and a new bookmark gets its icon at once. *Off* removes what the script wrote.
  - It does nothing in private windows. English labels only.
- **Tabs** They nest the navigation buttons inside the active tab, active tab titles scroll on hover, you can close them with Ctrl + W or the middle mouse button.
- **Vertical Tabs URL Bar** Activate by Ctrl + L or open a new tab with Ctrl + T.
- **Vertical tab rail** Full functionality + improved functionality.
  - Smoother animations with fullscreen and windowed modes.
  - Expand-on-hover + hide-sidebar + always-on, 3 density tiles, and a fade/slide of titles as the rail opens (`css/06`, `07`, `14`).
  - Auto-hide navigation buttons set to display on hover.
  - Sidebar behavior changes on hover on different objects.
  - Title scrolls, if the title is too long to read.
- **Customize sidebar panel** additions: theme mode (Light / Dark / Device), color scheme, selection colour, density, overlay mode, hover delay, colour source (Accent or Firefox theme), accent, gradient, glow, background image, and opacity controls (`SidebarToggles.uc.js`).
- **Colour source and Theme mode** Choose *Accent* (the Accent colour field, or your Windows accent while it is empty) or *Firefox theme*. With a non-default theme the accent and gradient colours are copied from the active theme and follow it when you switch themes or light/dark variants (the two colour fields are dimmed while it is on). The same accent colours the buttons and toggles on `about:newtab`. Theme mode is the same Light / Dark / Device switch as `about:addons` > Themes (`SidebarToggles.uc.js`).
- **Fullscreen overlay mode**: toolbar and rail slide over the page instead of resizing it (`css/11`, `12`, `fullscreenOverlayMode.uc.js`).
- **Sidebar panels over the page** (History, Bookmarks, Customize) so nothing resizes when they open (`css/13`).
- **Hide-sidebar edge reveal** and the *Keep sidebar visible* / *Reveal sidebar* menu items (`sidebarAutoHide.uc.js`). The labels follow the interface language (17 languages, English fallback).
- **Domain highlight** in the address bar, and a **security badge** for `http://` and mixed-content pages (`urlHostHighlight.uc.js`, `css/03`).
- **Status feed** in vertical-tabs mode: link and loading status as a small chat-style list at the bottom right (`statusJson.uc.js`).
- **Back/forward inside the selected tab** (`moveNavToActiveTab.uc.js`).
- **Split view**: tethered tab pairs with a glow, and a divider drag guide that changes color at thirds and quarters (`css/08`, `betterSplitViewSeparator.uc.js`).
- **Tab groups and pinned tabs** styled as one piece, with the group name in the tab preview (`css/15`, `tabPreviewGroup.uc.js`).
- **Picture-in-Picture control**: Ctrl + hover over a tab opens PiP, Ctrl + hover over the PiP window returns the video (`pipControl.uc.js`).
- **Per-site forced color scheme**: tab context menu, Ctrl+Alt+L (light) and Ctrl+Alt+D (dark) (`forceSchemePerSite.uc.js`). The labels follow the interface language (17 languages, English fallback).
- **Extension toggles panel**: a button at the end of the rail's top button group, and an *Extensions* entry in the » overflow menu (directly above *Customize sidebar*), open a panel with a switch for every installed extension, with search and All / On / Off filters (`ExtensionToggles.uc.js`). It uses Firefox's add-on manager, so it needs no policy or extra setup. Extensions Firefox locks or blocks show a dimmed switch. English labels only.
- **Menu bar** (Alt) drops down under the toolbar row, lined up with the address bar (`css/09`).
- **Feather icons** for the context menu, app menu, downloads button and the rail's tool buttons, URL dropdown icons (`css/05`, `19`).
- **Accessibility**: reduced motion and Windows high-contrast support (`css/16`).

### Throbber
The tab loading indicator is drawn from `chrome/thinking-dots.svg` as a mask and coloured with the accent. If the file is missing, the throbber disappears.

### New tab page (`about:newtab`)
`userContent.css` restyles `about:newtab` / `about:home` to a transparent, minimal layout: large thin clocks, a weather block, and a flat shortcuts grid. It needs the **Poppins** font (see [Fonts](#4-fonts)) and was written against the Firefox 160 new tab DOM. Its accent colour follows the Colour source / Accent setting of the Customize panel (pushed by `SidebarToggles.uc.js`).

You will probably want to edit in `userContent.css`: `--bj-left`, `--bj-clock`, `--bj-tile` and `--bj-pitch` at the top of the file control position and sizes.

`userContent.css` also sets `scrollbar-color` for every page (dark, or light when the page is shown in the light scheme). Delete that rule if you do not want it.

---

## Customizing

- **Runtime settings:** open the Customize sidebar panel (the theme adds its controls there).
- **CSS tunables:** section 2 of `chrome/css/01-tokens.css` holds every `--uc-*` variable. Restart Firefox after editing, and clear the startup cache if a change does not show.
- **Density:** Customize Toolbar > Density, or the Density control in the Customize sidebar panel.

---

## Known limitations

- Firefox 160 only. See [`docs/shadow-dom-dependencies.md`](docs/shadow-dom-dependencies.md) for everything the theme depends on and a checklist to run after a Firefox update.
- `FaviconUpgrader.uc.js` and `ExtensionToggles.uc.js` have English labels only. The other scripts that add menu items (`sidebarAutoHide.uc.js`, `forceSchemePerSite.uc.js`) are localized in 17 languages with an English fallback; `sidebarAutoHide` finds the vertical-tabs menu item by its Fluent id.
- `pipControl.uc.js` imports `moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs`, a new scheme that may change.
- The eyedropper (the **Pick** button) uses Firefox DevTools internals and may break in a future release.
- `ExtensionToggles.uc.js` adds its button to the rail's top button group and an entry to the » overflow menu, and uses Firefox's `AddonManager`. If either changes, it logs a `[uc] ExtensionToggles:` warning and stops, or falls back to a button in the toolbar. Set `PLACE.rail` or `PLACE.overflow` to `false` at the top of the script to keep only one of the two.
- `FaviconUpgrader.uc.js` wraps `gBrowser.setIcon` (`extensionIcons.uc.js` only calls it, so the two do not conflict). Its tab context-menu item is kept out of `#tabContextMenu` while Firefox arranges the menu (Firefox 160 throws a `MenuSectionLayout` error for unknown children). It reads a page's icon links from the live DOM with a one-shot frame script and falls back to fetching the page's HTML, which some sites refuse (WhatsApp Web answers HTTP 400). The `2x` / `3x` / `4x` upgrade only works on servers that serve those sizes, and a variant is used only if it is bigger than the original.
- `FaviconUpgrader.uc.js` also replaces the `PlacesUtils.favicons` property with a thin proxy, to drop Firefox's own small icon write for a site it replaces, and reads Places with read-only SQL. It relies on `getFaviconForPage` reporting an icon `width`; without it the script falls back to writing. The icon addresses it stores in Places (`<site>/.uc-favicon-upgrader/<hash>.png`) are keys, not files: opening one is a 404 and adds a junk history entry. If a Firefox member it needs is missing it logs a `[uc] FaviconUpgrader:` warning and does nothing.
- **First run with *All sites*:** each bookmarked site with no verdict gets a network lookup and then a write to Places. That is capped at 400 lookups per start with a 1.5 s pause between them. A large collection can take several restarts, and the worst case is about 10 minutes of background fetching per start. You might need to be patient with it if you have a large archive. With the default *Chosen sites* only the sites you chose are looked up.
- Several scripts patch `SidebarController` and `FullScreen`. If one of them logs a warning, it switches only its own part off.

---

## Troubleshooting

1. Open the Browser Console (`Ctrl+Shift+J`) and filter for `[uc]`. Each script logs one line if a Firefox member it needs is missing.
2. Nothing styled at all: check `toolkit.legacyUserProfileCustomizations.stylesheets` and clear the startup cache.
3. CSS works but scripts do nothing: fx-autoconfig is not loading. Check its setup and the Browser Console.
4. Missing throbber or fonts: check that `thinking-dots.svg` and your font files are in the paths listed above.
5. A site's tab icon is not upgraded: filter the Browser Console for `[uc] FaviconUpgrader:`. The lines are off by default; turn them on with `__ucFaviconUpgraderDebug.CONFIG.debug = true` in the Browser Console (or `debug: true` at the top of the script) and reload the tab. `declared icons via live DOM` lists what the page offers, `shown icon:` is the one Firefox picked, `keep` means it is already good enough (32 px or more) or nothing better was found, and `page swaps its icon itself, passing through` means the page animates its own icon.
6. Bookmarks or the address-bar dropdown show a small or blurry icon: in the Browser Console run `await __ucFaviconUpgraderDebug.getFav(Services.io.newURI("https://example.com/"))` for a page of that site. A `.uri.spec` containing `/.uc-favicon-upgrader/` is the script's icon, and `.width` is its size. Nothing is written if the panel's *Bookmarks & address bar* is *Off*, or *Chosen sites* (the default) without the site: set it to *All sites* or use *Include this site*. Opening the site in a tab and waiting a few seconds, or *Refresh this site* in the panel, redoes it.

---

## Uninstall

1. If you used the bookmarks and address-bar part of `FaviconUpgrader.uc.js`: open *Change favicon…* on any web page, set *Bookmarks & address bar* to *Off* and wait a minute. That removes the icons the script wrote there (Firefox stores its own again on the next visit).
2. Delete the theme files from `chrome/` (`userChrome.css`, `userContent.css`, `thinking-dots.svg`, `1px-transparent.png`, `css/`, and the theme's `JS/*.uc.js` files).
3. Reset any preferences you set in `about:config` (right-click > Reset), including `extensions.uc.faviconUpgrader.placesScope`. If you used the Express Install, also delete the block between `// >>> userchrome-theme` and `// <<< userchrome-theme <<<` in the `user.js` of your profile.
4. Delete `favicon-upgrader-cache.json` and `favicon-upgrader-overrides.json` from your profile folder (the folder `about:support` opens, not `chrome/`). The second one holds your manual per-site icon choices.
5. Clear the startup cache and restart.

---

## License

Copyright (C) 2026 YOUR NAME

This project is free software under the GNU General Public License v3.0, see [`LICENSE`](LICENSE). You may use it, change it, fork it and share it, but copies and modified versions must stay under the same license, keep this notice, and include the source. There is no warranty of any kind: you use it at your own risk, including the installer, which changes files in your Firefox profile and in Firefox's install folder. Third-party components keep their own licenses, see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Support

If you like the theme, you can send a tip on Solana: `AHmQLeeQebQo1et4nkCo4XLMN2ZzMNsSXbjNe8jHhhi4`

## Credits

- [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) by MrOtherGuy (MPL 2.0) loads the scripts. Unmodified copies are included in `program/` and `chrome/utils/`.
- [Feather icons](https://github.com/feathericons/feather) v4.29.2, MIT, © Cole Bemis. Embedded in the CSS as inline SVG masks. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- [Nunito](https://fonts.google.com/specimen/Nunito), [Noto Sans](https://fonts.google.com/noto) and [Poppins](https://fonts.google.com/specimen/Poppins) are SIL Open Font License fonts. They are not stored in this repository; the installer downloads them from this repository's `fonts-v1` release.
- [DWMBlurGlass](https://github.com/Maplespe/DWMBlurGlass) by Maplespe is optional and not included; the installer can download it from its official release.
