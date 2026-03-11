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
