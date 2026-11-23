// ==UserScript==
// @name           uiLanguage.uc.js
// @description    Tells Firefox which language the interface is in (lang attribute on the window, so the generic sans-serif font follows the user's per-language font settings) and sets uc-lang (for example "tr", "en-us", "zh-tw") for userChrome.css, css/00-fonts.css.
// @include        main
// ==/UserScript==

(() => {
  const root = document.documentElement;
  const update = () => {
    const lang = Services.locale.appLocaleAsBCP47;
    if (!root.getAttribute("lang")) root.setAttribute("lang", lang); // Firefox's own value is left alone if it set one
    root.setAttribute("uc-lang", lang.toLowerCase());
  };
  update();

  // follow the language if it is changed in Settings while Firefox is running
  const TOPIC = "intl:app-locales-changed";
  const onChange = () => {
    root.setAttribute("lang", Services.locale.appLocaleAsBCP47);
    update();
  };
  Services.obs.addObserver(onChange, TOPIC);
  window.addEventListener("unload", () => Services.obs.removeObserver(onChange, TOPIC), { once: true });
})();
