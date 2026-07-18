import "core-js/stable/object/from-entries";
import "core-js/stable/object/entries";
import "core-js/stable/object/values";
import "core-js/stable/array/flat";
import "core-js/stable/array/flat-map";
import "core-js/stable/promise/all-settled";
import "core-js/stable/promise/finally";
import "core-js/stable/string/replace-all";
import "core-js/stable/string/pad-start";
import "core-js/stable/string/pad-end";
import "core-js/stable/string/trim-start";
import "core-js/stable/string/trim-end";
import "core-js/stable/url-search-params";

// Chromium 53 accepts only a boolean for scrollIntoView; object options throw.
if (globalThis.Element && Element.prototype.scrollIntoView) {
  (function installScrollIntoViewOptionsFallback() {
    var nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewPolyfill(arg) {
      try {
        return nativeScrollIntoView.call(this, arg);
      } catch (error) {
        if (arg && typeof arg === "object") {
          return nativeScrollIntoView.call(this, arg.block !== "nearest");
        }
        throw error;
      }
    };
  })();
}
