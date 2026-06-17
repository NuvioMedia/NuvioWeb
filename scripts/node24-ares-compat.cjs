"use strict";

const Module = require("module");
const util = require("util");

if (typeof util.isDate !== "function") {
  util.isDate = function isDate(value) {
    return value instanceof Date;
  };
}

const originalLoad = Module._load;
const rimrafWrappers = new WeakMap();

function createLegacyRimraf(rimrafModule) {
  if (rimrafWrappers.has(rimrafModule)) {
    return rimrafWrappers.get(rimrafModule);
  }

  const rimraf = rimrafModule.rimraf;
  const legacyRimraf = function legacyRimraf(path, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const normalizedOptions = typeof options === "function" ? undefined : options;
    const promise = rimraf(path, normalizedOptions);

    if (typeof done === "function") {
      promise.then(() => done(null), done);
    }

    return promise;
  };

  Object.assign(legacyRimraf, rimrafModule);
  legacyRimraf.rimraf = legacyRimraf;
  legacyRimraf.sync = rimrafModule.sync || rimrafModule.rimrafSync;
  legacyRimraf.rimrafSync = rimrafModule.rimrafSync || rimrafModule.sync;

  rimrafWrappers.set(rimrafModule, legacyRimraf);
  return legacyRimraf;
}

Module._load = function loadWithAresCompat(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (
    request === "rimraf" &&
    typeof loaded !== "function" &&
    typeof loaded?.rimraf === "function"
  ) {
    return createLegacyRimraf(loaded);
  }
  return loaded;
};
