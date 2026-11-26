# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [1.0.2]
### Added
- Firefox 161 introduced colored Urlbar drop down menu icons. Colored them properly in dark/light modes.

## [1.0.1]
### Added
- Default settings for someone installing on a fresh install. 
  - Setting the transparent background png as default.
  - A better Toolbar Button placement on install. Cleaned clutter.
  
### Fixed
- Favicon clipping outside of the tab, while tab close animation plays. (Horizontal Tabs).
- Hamburger button alignment.
- Extensions toggles button placing itself on the navbar on a fresh install. Now it lands on sidebar as intended.
- Some errors/false errors thrown by the installer.
- Light mode having white text on white button on white background on popup messages/notifications.
- Sidepanel opening caused snapshot duplication via document.startViewTransition.

## [1.0.0] - 2026-11-24
### Added
- Initial release: vertical tab rail, audio badge, tab glows, userscripts.
- Tested on Firefox 160.x.
