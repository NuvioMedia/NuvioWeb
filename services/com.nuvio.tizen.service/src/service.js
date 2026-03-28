const path = require("path");

const {
  SERVICE_LABEL,
  bootLocalRuntime,
  probeLocalServer
} = require("./runtimeHost");

const RUNTIME_PATH = path.resolve(__dirname, "..", "runtime", "media-http.cjs");

const runtimeState = {
  booted: false,
  bootTimestamp: null,
  error: null
};

function ensureRuntimeStarted() {
  if (runtimeState.booted || runtimeState.error) {
    return;
  }

  runtimeState.bootTimestamp = new Date().toISOString();

  try {
    bootLocalRuntime(RUNTIME_PATH);
    runtimeState.booted = true;
    console.log(`[${SERVICE_LABEL}] local media runtime booted from`, RUNTIME_PATH);
  } catch (error) {
    runtimeState.error = {
      message: String(error?.message || error || "Unknown runtime error"),
      stack: String(error?.stack || "")
    };
    console.error(`[${SERVICE_LABEL}] failed to boot local media runtime:`, error);
  }
}

function logResolvedEndpoint() {
  probeLocalServer((_, status) => {
    if (!status?.port) {
      return;
    }
    console.log(`[${SERVICE_LABEL}] local media endpoint available at http://127.0.0.1:${status.port}`);
  });
}

module.exports.onStart = function onStart() {
  ensureRuntimeStarted();
  logResolvedEndpoint();
};

module.exports.onStop = function onStop() {
  console.log(`[${SERVICE_LABEL}] service stopped`);
};
