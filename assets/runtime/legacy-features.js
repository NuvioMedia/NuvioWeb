(function detectLegacyCssSupport(window, document) {
  "use strict";

  var root = document.documentElement;

  function removeClass(name) {
    root.className = (" " + root.className + " ")
      .replace(new RegExp(" " + name + " ", "g"), " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function supports(prop, value) {
    var css = window.CSS;
    return Boolean(css && typeof css.supports === "function" && css.supports(prop, value));
  }

  if (supports("display", "grid")) removeClass("no-css-grid");
  if (supports("font-size", "clamp(1px, 2px, 3px)")) removeClass("no-css-math");
})(window, document);
