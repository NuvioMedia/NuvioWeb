/* global module, require, process */
"use strict";

var SERVICE_TAG = "[Nuvio Tizen EngineFS]";
var started = false;

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.log.apply(console, args);
}

function warn() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.warn.apply(console, args);
}

function probeNodeRuntime() {
  var requiredModules = [
    "fs",
    "http",
    "net",
    "dgram",
    "stream",
    "events",
    "path",
    "url",
    "crypto",
    "buffer"
  ];
  var missing = [];
  requiredModules.forEach(function (moduleName) {
    try {
      require(moduleName);
    } catch (error) {
      missing.push(moduleName + ": " + (error && error.message ? error.message : String(error)));
    }
  });
  if (missing.length) {
    throw new Error("Missing Node-compatible modules: " + missing.join("; "));
  }

  var http = require("http");
  var net = require("net");
  var dgram = require("dgram");
  if (typeof http.createServer !== "function") {
    throw new Error("http.createServer is unavailable");
  }
  if (typeof net.createServer !== "function") {
    throw new Error("net.createServer is unavailable");
  }
  if (typeof dgram.createSocket !== "function") {
    throw new Error("dgram.createSocket is unavailable");
  }
}

function configureRuntimeEnv() {
  process.argv = Array.isArray(process.argv)
    ? process.argv
    : ["nuvio-enginefs-service", "runtime/media-http.cjs"];
  process.env = process.env || {};
  if (!process.env.HOME) {
    try {
      process.env.HOME = process.cwd ? process.cwd() : ".";
    } catch (_) {
      process.env.HOME = ".";
    }
  }
  try {
    if (!process.execPath) {
      process.execPath = process.env.HOME;
    }
  } catch (_) {
    // Some runtimes may expose process.execPath as read-only.
  }
  process.env.PORT = process.env.PORT || "2710";
  process.env.NO_CORS = "1";
  process.env.NO_HTTPS_SERVER = "1";
  process.env.HLS_V2_DISABLED = "1";
  process.env.CASTING_DISABLED = "1";
  process.env.LOCAL_ADDON_DISABLED = "1";
  process.env.NO_NETWORK_INTERFACES = process.env.NO_NETWORK_INTERFACES || "";
}

function startEngineFsRuntime() {
  if (started) {
    log("start ignored; runtime already requested");
    return;
  }
  probeNodeRuntime();
  configureRuntimeEnv();
  started = true;
  log("starting local EngineFS runtime", {
    port: process.env.PORT,
    expectedBaseUrl: "http://127.0.0.1:" + process.env.PORT
  });
  require("./runtime/media-http.cjs");
}

function requestRemoveAll() {
  try {
    var http = require("http");
    var port = Number(process.env.PORT || 2710) || 2710;
    http
      .get("http://127.0.0.1:" + port + "/removeAll", function (response) {
        response.resume();
      })
      .on("error", function () {});
  } catch (_) {
    // Service shutdown cleanup is best-effort.
  }
}

module.exports.onStart = function () {
  try {
    startEngineFsRuntime();
  } catch (error) {
    started = false;
    warn("local EngineFS runtime failed to start", error && error.stack ? error.stack : error);
  }
};

module.exports.onStop = function () {
  log("stopping local EngineFS runtime");
  requestRemoveAll();
};
