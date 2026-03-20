if (typeof globalThis === "undefined") {
  Object.defineProperty(Object.prototype, "__nuvio_global__", {
    get: function getGlobal() {
      return this;
    },
    configurable: true
  });
  __nuvio_global__.globalThis = __nuvio_global__;
  delete Object.prototype.__nuvio_global__;
}

if (!Object.fromEntries) {
  Object.fromEntries = function fromEntries(entries) {
    var result = {};
    if (!entries || typeof entries[Symbol.iterator] !== "function") {
      return result;
    }
    for (const entry of entries) {
      if (!entry || entry.length < 2) {
        continue;
      }
      result[entry[0]] = entry[1];
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
    return Promise.all(Array.from(iterable || [], function mapPromise(entry) {
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
    }));
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
        return source.replace(new RegExp(searchValue.source, searchValue.flags.includes("g") ? searchValue.flags : searchValue.flags + "g"), replaceValue);
      }
      return source.split(String(searchValue)).join(String(replaceValue));
    },
    configurable: true,
    writable: true
  });
}
