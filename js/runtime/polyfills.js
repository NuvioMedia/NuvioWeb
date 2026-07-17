import "core-js/stable/global-this";
import "core-js/stable/object/from-entries";
import "core-js/stable/object/entries";
import "core-js/stable/object/values";
import "core-js/stable/object/get-own-property-descriptors";
import "core-js/stable/array/flat";
import "core-js/stable/array/flat-map";
import "core-js/stable/promise/all-settled";
import "core-js/stable/promise/finally";
import "core-js/stable/string/replace-all";
import "core-js/stable/string/pad-start";
import "core-js/stable/string/pad-end";
import "core-js/stable/string/trim-start";
import "core-js/stable/string/trim-end";
import "core-js/stable/queue-microtask";
import "core-js/stable/url";
import "core-js/stable/url-search-params";

// DOM helpers that core-js does not cover and Chromium 53 may lack.

function installElementScrollToPolyfill(target) {
  if (!target || typeof target.scrollTo === "function") {
    return;
  }
  Object.defineProperty(target, "scrollTo", {
    value: function scrollToPolyfill(leftOrOptions, top) {
      if (leftOrOptions && typeof leftOrOptions === "object") {
        if (Object.prototype.hasOwnProperty.call(leftOrOptions, "left")) {
          this.scrollLeft = Number(leftOrOptions.left || 0);
        }
        if (Object.prototype.hasOwnProperty.call(leftOrOptions, "top")) {
          this.scrollTop = Number(leftOrOptions.top || 0);
        }
        return;
      }
      if (typeof leftOrOptions === "number") {
        this.scrollLeft = leftOrOptions;
      }
      if (typeof top === "number") {
        this.scrollTop = top;
      }
    },
    configurable: true,
    writable: true
  });
}

installElementScrollToPolyfill(globalThis.Element && globalThis.Element.prototype);
installElementScrollToPolyfill(globalThis.HTMLElement && globalThis.HTMLElement.prototype);
installElementScrollToPolyfill(globalThis.window);

if (globalThis.Element && !Element.prototype.remove) {
  Object.defineProperty(Element.prototype, "remove", {
    value: function removePolyfill() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    },
    configurable: true,
    writable: true
  });
}

if (globalThis.Node && !("isConnected" in Node.prototype)) {
  Object.defineProperty(Node.prototype, "isConnected", {
    get: function isConnectedPolyfill() {
      var root = globalThis.document && globalThis.document.documentElement;
      return Boolean(root && root.contains(this));
    },
    configurable: true
  });
}

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

// IntersectionObserver exists on Chromium 53, but entry.isIntersecting is Chrome 58+.
if (globalThis.IntersectionObserverEntry && !("isIntersecting" in IntersectionObserverEntry.prototype)) {
  Object.defineProperty(IntersectionObserverEntry.prototype, "isIntersecting", {
    get: function isIntersectingPolyfill() {
      return this.intersectionRatio > 0;
    },
    configurable: true
  });
}
