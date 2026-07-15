(function detectLegacyFeatureSupport(window, document) {
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

  try {
    var test = document.createElement("div");
    var child = document.createElement("div");
    test.style.position = "absolute";
    test.style.left = "-9999px";
    test.style.top = "-9999px";
    test.style.display = "flex";
    test.style.flexDirection = "column";
    test.style.rowGap = "1px";
    child.style.height = "1px";
    test.appendChild(child.cloneNode());
    test.appendChild(child.cloneNode());
    root.appendChild(test);
    if (test.scrollHeight === 3) {
      removeClass("no-flex-gap");
    }
    root.removeChild(test);
  } catch (error) {
    removeClass("no-flex-gap");
  }

  if (supports("font-size", "clamp(1px, 2px, 3px)")) removeClass("no-css-math");
  if (supports("aspect-ratio", "1 / 1")) removeClass("no-aspect-ratio");
  if (
    supports("backdrop-filter", "blur(1px)") ||
    supports("-webkit-backdrop-filter", "blur(1px)")
  ) {
    removeClass("no-backdrop-filter");
  }
})(window, document);