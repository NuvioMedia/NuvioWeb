(function () {
  if (typeof globalThis === "object") return;
  Object.defineProperty(Object.prototype, "__magic__", {
    get: function () {
      return this;
    },
    configurable: true
  });
  __magic__.globalThis = __magic__;
  delete Object.prototype.__magic__;
})();

// Number/Math ES2015 statics missing on older TV engines. Defined first because
// other polyfills below (e.g. Array.prototype.flat) rely on Number.isFinite,
// and the profile store touches Number.isFinite / Math.trunc during bootstrap.
if (typeof Number.isNaN !== "function") {
  Number.isNaN = function isNaN(value) {
    return typeof value === "number" && value !== value;
  };
}

if (typeof Number.isFinite !== "function") {
  Number.isFinite = function isFinite(value) {
    return typeof value === "number" && globalThis.isFinite(value);
  };
}

if (typeof Number.isInteger !== "function") {
  Number.isInteger = function isInteger(value) {
    return typeof value === "number" && globalThis.isFinite(value) && Math.floor(value) === value;
  };
}

if (typeof Number.parseInt !== "function") {
  Number.parseInt = globalThis.parseInt;
}

if (typeof Number.parseFloat !== "function") {
  Number.parseFloat = globalThis.parseFloat;
}

if (typeof Number.MAX_SAFE_INTEGER !== "number") {
  Number.MAX_SAFE_INTEGER = 9007199254740991;
}

if (typeof Number.MIN_SAFE_INTEGER !== "number") {
  Number.MIN_SAFE_INTEGER = -9007199254740991;
}

if (typeof Math.trunc !== "function") {
  Math.trunc = function trunc(value) {
    var number = Number(value);
    if (Number.isNaN(number) || number === 0) {
      return number;
    }
    return number < 0 ? Math.ceil(number) : Math.floor(number);
  };
}

// ES2015-2017 builtins missing on older TV engines (webOS 3/4 ship Chromium
// 38/53). The bundle is transpiled for syntax down to "chrome 38", but builtin
// APIs are only available through this file, and Object.entries & friends were
// absent — profile-scoped stores call Object.entries during bootstrap, so the
// app crashed before the UI rendered (issue #195).
function truncToInteger(value) {
  var num = Number(value) || 0;
  return num < 0 ? Math.ceil(num) : Math.floor(num);
}

function isRegExpLike(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (typeof Symbol !== "undefined" && Symbol.match) {
    var matcher = value[Symbol.match];
    if (matcher !== undefined) {
      return Boolean(matcher);
    }
  }
  return Object.prototype.toString.call(value) === "[object RegExp]";
}

if (!Array.from) {
  Array.from = function from(source, mapFn, thisArg) {
    if (source == null) {
      throw new TypeError("Array.from requires an array-like object");
    }
    if (mapFn !== undefined && typeof mapFn !== "function") {
      throw new TypeError("Array.from: when provided, the second argument must be a function");
    }
    var result = [];
    var index = 0;
    var iteratorMethod =
      typeof Symbol !== "undefined" && Symbol.iterator && source[Symbol.iterator];
    if (typeof iteratorMethod === "function") {
      var iterator = iteratorMethod.call(source);
      var step = iterator.next();
      while (!step.done) {
        result.push(mapFn ? mapFn.call(thisArg, step.value, index) : step.value);
        index += 1;
        step = iterator.next();
      }
      return result;
    }
    var arrayLike = Object(source);
    var length = Math.max(0, Math.floor(Number(arrayLike.length) || 0));
    for (; index < length; index += 1) {
      var value = arrayLike[index];
      result.push(mapFn ? mapFn.call(thisArg, value, index) : value);
    }
    return result;
  };
}

if (!Array.prototype.find) {
  Object.defineProperty(Array.prototype, "find", {
    value: function find(predicate, thisArg) {
      if (typeof predicate !== "function") {
        throw new TypeError("predicate must be a function");
      }
      for (var index = 0; index < this.length; index += 1) {
        if (predicate.call(thisArg, this[index], index, this)) {
          return this[index];
        }
      }
      return undefined;
    },
    configurable: true,
    writable: true
  });
}

if (!Array.prototype.findIndex) {
  Object.defineProperty(Array.prototype, "findIndex", {
    value: function findIndex(predicate, thisArg) {
      if (typeof predicate !== "function") {
        throw new TypeError("predicate must be a function");
      }
      for (var index = 0; index < this.length; index += 1) {
        if (predicate.call(thisArg, this[index], index, this)) {
          return index;
        }
      }
      return -1;
    },
    configurable: true,
    writable: true
  });
}

if (!Array.prototype.includes) {
  Object.defineProperty(Array.prototype, "includes", {
    value: function includes(searchElement, fromIndex) {
      var list = Object(this);
      var length = Math.max(truncToInteger(list.length), 0);
      var start = truncToInteger(fromIndex);
      if (start < 0) {
        start = Math.max(length + start, 0);
      }
      for (var index = start; index < length; index += 1) {
        var value = list[index];
        if (
          value === searchElement ||
          (typeof value === "number" &&
            typeof searchElement === "number" &&
            isNaN(value) &&
            isNaN(searchElement))
        ) {
          return true;
        }
      }
      return false;
    },
    configurable: true,
    writable: true
  });
}

if (!Array.prototype.fill) {
  Object.defineProperty(Array.prototype, "fill", {
    value: function fill(value, start, end) {
      var length = this.length;
      var from = Number(start) || 0;
      var to = end === undefined ? length : Number(end) || 0;
      from = from < 0 ? Math.max(length + from, 0) : Math.min(from, length);
      to = to < 0 ? Math.max(length + to, 0) : Math.min(to, length);
      for (var index = from; index < to; index += 1) {
        this[index] = value;
      }
      return this;
    },
    configurable: true,
    writable: true
  });
}

if (!Object.assign) {
  Object.assign = function assign(target) {
    if (target == null) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    var to = Object(target);
    for (var argIndex = 1; argIndex < arguments.length; argIndex += 1) {
      var source = arguments[argIndex];
      if (source == null) {
        continue;
      }
      var from = Object(source);
      for (var key in from) {
        if (Object.prototype.hasOwnProperty.call(from, key)) {
          to[key] = from[key];
        }
      }
    }
    return to;
  };
}

if (!Object.entries) {
  Object.entries = function entries(source) {
    if (source == null) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    var target = Object(source);
    var result = [];
    for (var key in target) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        result.push([key, target[key]]);
      }
    }
    return result;
  };
}

if (!Object.values) {
  Object.values = function values(source) {
    if (source == null) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    var target = Object(source);
    var result = [];
    for (var key in target) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        result.push(target[key]);
      }
    }
    return result;
  };
}

if (!String.prototype.includes) {
  Object.defineProperty(String.prototype, "includes", {
    value: function includes(search, start) {
      if (isRegExpLike(search)) {
        throw new TypeError("First argument must not be a regular expression");
      }
      return String(this).indexOf(search, Number(start) || 0) !== -1;
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.startsWith) {
  Object.defineProperty(String.prototype, "startsWith", {
    value: function startsWith(search, position) {
      if (isRegExpLike(search)) {
        throw new TypeError("First argument must not be a regular expression");
      }
      var source = String(this);
      var from = Math.min(Math.max(truncToInteger(position), 0), source.length);
      return source.slice(from, from + String(search).length) === String(search);
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.endsWith) {
  Object.defineProperty(String.prototype, "endsWith", {
    value: function endsWith(search, endPosition) {
      if (isRegExpLike(search)) {
        throw new TypeError("First argument must not be a regular expression");
      }
      var source = String(this);
      var end = endPosition === undefined ? source.length : truncToInteger(endPosition);
      end = Math.min(Math.max(end, 0), source.length);
      var needle = String(search);
      return source.slice(Math.max(0, end - needle.length), end) === needle;
    },
    configurable: true,
    writable: true
  });
}

function buildStringPad(current, targetLength, padString) {
  var length = Math.floor(Number(targetLength) || 0);
  var pad = padString === undefined ? " " : String(padString);
  if (current.length >= length || pad === "") {
    return "";
  }
  var missing = length - current.length;
  var filler = "";
  while (filler.length < missing) {
    filler += pad;
  }
  return filler.slice(0, missing);
}

if (!String.prototype.padStart) {
  Object.defineProperty(String.prototype, "padStart", {
    value: function padStart(targetLength, padString) {
      var source = String(this);
      return buildStringPad(source, targetLength, padString) + source;
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.padEnd) {
  Object.defineProperty(String.prototype, "padEnd", {
    value: function padEnd(targetLength, padString) {
      var source = String(this);
      return source + buildStringPad(source, targetLength, padString);
    },
    configurable: true,
    writable: true
  });
}

// polyfills for older browsers
if (!Element.prototype.matches) {
  Element.prototype.matches =
    Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
}

if (!Element.prototype.closest) {
  Element.prototype.closest = function (s) {
    var el = this;
    do {
      if (Element.prototype.matches.call(el, s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

// polyfill for Object.fromEntries
if (!Object.fromEntries) {
  Object.fromEntries = function fromEntries(entries) {
    var result = {};
    if (!entries) return result;

    var arr = Array.isArray(entries) ? entries : Array.from(entries);
    for (var i = 0; i < arr.length; i++) {
      var entry = arr[i];
      if (entry && entry.length >= 2) {
        result[entry[0]] = entry[1];
      }
    }
    return result;
  };
}

if (!Promise.prototype.finally) {
  Object.defineProperty(Promise.prototype, "finally", {
    value: function finallyPolyfill(onFinally) {
      var callback = typeof onFinally === "function" ? onFinally : function identity() {};
      var P = this.constructor || Promise;
      return this.then(
        function onResolved(value) {
          return P.resolve(callback()).then(function returnValue() {
            return value;
          });
        },
        function onRejected(reason) {
          return P.resolve(callback()).then(function throwReason() {
            throw reason;
          });
        }
      );
    },
    configurable: true,
    writable: true
  });
}

if (!Promise.allSettled) {
  Promise.allSettled = function allSettled(iterable) {
    return Promise.all(
      Array.from(iterable || [], function mapPromise(entry) {
        return Promise.resolve(entry).then(
          function onFulfilled(value) {
            return {
              status: "fulfilled",
              value: value
            };
          },
          function onRejected(reason) {
            return {
              status: "rejected",
              reason: reason
            };
          }
        );
      })
    );
  };
}

if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, "flat", {
    value: function flat(depth) {
      var maxDepth = depth === undefined ? 1 : Number(depth);
      if (!Number.isFinite(maxDepth) || maxDepth < 0) {
        maxDepth = 0;
      }
      var flattenInto = function flattenInto(source, target, currentDepth) {
        for (var index = 0; index < source.length; index += 1) {
          if (!(index in source)) {
            continue;
          }
          var value = source[index];
          if (Array.isArray(value) && currentDepth > 0) {
            flattenInto(value, target, currentDepth - 1);
          } else {
            target.push(value);
          }
        }
        return target;
      };
      return flattenInto(this, [], Math.floor(maxDepth));
    },
    configurable: true,
    writable: true
  });
}

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, "flatMap", {
    value: function flatMap(callback, thisArg) {
      var mapped = [];
      for (var index = 0; index < this.length; index += 1) {
        if (!(index in this)) {
          continue;
        }
        var item = callback.call(thisArg, this[index], index, this);
        if (Array.isArray(item)) {
          mapped.push.apply(mapped, item);
        } else {
          mapped.push(item);
        }
      }
      return mapped;
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    value: function replaceAll(searchValue, replaceValue) {
      var source = String(this);
      if (searchValue instanceof RegExp) {
        return source.replace(
          new RegExp(
            searchValue.source,
            searchValue.flags.includes("g") ? searchValue.flags : searchValue.flags + "g"
          ),
          replaceValue
        );
      }
      return source.split(String(searchValue)).join(String(replaceValue));
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.trimStart) {
  Object.defineProperty(String.prototype, "trimStart", {
    value: function trimStartPolyfill() {
      return String(this).replace(/^\s+/, "");
    },
    configurable: true,
    writable: true
  });
}

if (!String.prototype.trimEnd) {
  Object.defineProperty(String.prototype, "trimEnd", {
    value: function trimEndPolyfill() {
      return String(this).replace(/\s+$/, "");
    },
    configurable: true,
    writable: true
  });
}

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
