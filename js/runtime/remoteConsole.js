import { DEBUG_LOG_ENDPOINT } from "../config.js";

const endpoint = String(DEBUG_LOG_ENDPOINT || "").trim();
const levels = ["debug", "log", "info", "warn", "error"];
const originalConsole = {};
let sequence = 0;
let isSending = false;

function safeStringify(value) {
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message || "",
      stack: value.stack || ""
    };
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

function send(level, args) {
  if (!endpoint || isSending) {
    return;
  }
  isSending = true;
  try {
    const payload = JSON.stringify({
      level,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      platform: globalThis.__NUVIO_PLATFORM__ || "web",
      route: globalThis.location?.hash || globalThis.location?.pathname || "",
      args: Array.from(args || []).map(safeStringify)
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([payload], { type: "text/plain" });
        if (navigator.sendBeacon(endpoint, blob)) {
          return;
        }
      } catch (_) {
        // Fall through to fetch.
      }
    }
    if (typeof fetch === "function") {
      fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: payload
      }).catch(() => {});
    }
  } finally {
    isSending = false;
  }
}

if (endpoint && !globalThis.__NUVIO_REMOTE_CONSOLE__) {
  globalThis.__NUVIO_REMOTE_CONSOLE__ = true;
  levels.forEach((level) => {
    originalConsole[level] = console[level]?.bind(console) || console.log?.bind(console) || (() => {});
    console[level] = function remoteConsoleForwarder(...args) {
      originalConsole[level](...args);
      send(level, args);
    };
  });

  globalThis.addEventListener?.("error", (event) => {
    send("error", [
      "window.error",
      event?.message || "",
      event?.filename || "",
      event?.lineno || 0,
      event?.colno || 0,
      event?.error || null
    ]);
  });

  globalThis.addEventListener?.("unhandledrejection", (event) => {
    send("error", ["unhandledrejection", event?.reason || null]);
  });

  console.info("[remote-console] forwarding console output", endpoint);
}
