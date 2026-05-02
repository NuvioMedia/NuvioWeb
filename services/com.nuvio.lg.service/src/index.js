var path = require("path");

var serverHost = require("./serverHost");
var SERVICE_ID = serverHost.SERVICE_ID;
var bootLocalRuntime = serverHost.bootLocalRuntime;
var probeLocalServer = serverHost.probeLocalServer;
var requestActiveServerPath = serverHost.requestActiveServerPath;

var RUNTIME_PATH = path.resolve(__dirname, "..", "runtime", "media-http.cjs");

function createService() {
  try {
    var Service = require("webos-service");
    return new Service(SERVICE_ID);
  } catch (error) {
    console.warn("[" + SERVICE_ID + "] webos-service unavailable, using local mock:", error.message);
    return {
      register: function() {}
    };
  }
}

var service = createService();

var runtimeState = {
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
    console.log("[" + SERVICE_ID + "] local media runtime booted from", RUNTIME_PATH);
  } catch (error) {
    runtimeState.error = {
      message: String(error && error.message ? error.message : error),
      stack: String(error && error.stack ? error.stack : "")
    };
    console.error("[" + SERVICE_ID + "] failed to boot local media runtime:", error);
  }
}

function respond(message, payload) {
  if (message && typeof message.respond === "function") {
    message.respond(payload);
    return;
  }

  console.log("[" + SERVICE_ID + "] response:", JSON.stringify(payload));
}

function buildBasePayload() {
  return {
    returnValue: !runtimeState.error,
    serviceId: SERVICE_ID,
    booted: runtimeState.booted,
    bootTimestamp: runtimeState.bootTimestamp,
    runtimePath: RUNTIME_PATH,
    error: runtimeState.error
  };
}

function buildErrorPayload(error, extras) {
  return Object.assign(buildBasePayload(), {
    returnValue: false,
    errorCode: -1,
    errorText: String(error && error.message ? error.message : error || "Unknown service error")
  }, extras || {});
}

function getMessagePayload(message) {
  if (message && message.payload && typeof message.payload === "object") {
    return message.payload;
  }
  return {};
}

function registerCommand(commandName, includeBody) {
  service.register(commandName, function(message) {
    ensureRuntimeStarted();
    probeLocalServer(function(_, status) {
      respond(message, Object.assign(buildBasePayload(), {
        url: status ? "http://127.0.0.1:" + status.port : null,
        settingsReachable: Boolean(status),
        settingsStatusCode: status ? status.statusCode : null,
        settingsBody: includeBody && status ? status.body : null
      }));
    });
  });
}

function registerTracksCommand() {
  service.register("tracks", function(message) {
    ensureRuntimeStarted();

    if (runtimeState.error) {
      respond(message, buildErrorPayload(runtimeState.error));
      return;
    }

    var mediaUrl = String(getMessagePayload(message).url || "").trim();
    if (!mediaUrl) {
      respond(message, buildErrorPayload("Missing required parameter: url"));
      return;
    }

    var tracksPath = "/tracks/" + encodeURIComponent(mediaUrl);
    requestActiveServerPath(tracksPath, function(error, status) {
      if (error) {
        respond(message, buildErrorPayload(error, {
          proxiedPath: tracksPath
        }));
        return;
      }

      if (!status || status.statusCode < 200 || status.statusCode >= 300) {
        var statusCode = status ? status.statusCode || 0 : 0;
        respond(message, buildErrorPayload("Track request failed with HTTP " + statusCode, {
          proxiedPath: tracksPath,
          statusCode: statusCode,
          rawBody: status ? status.body || "" : ""
        }));
        return;
      }

      try {
        var tracks = JSON.parse(status.body || "[]");
        respond(message, Object.assign(buildBasePayload(), {
          url: "http://127.0.0.1:" + status.port,
          proxiedPath: tracksPath,
          statusCode: status.statusCode,
          tracks: Array.isArray(tracks) ? tracks : []
        }));
      } catch (parseError) {
        respond(message, buildErrorPayload(parseError, {
          proxiedPath: tracksPath,
          statusCode: status.statusCode,
          rawBody: status.body || ""
        }));
      }
    });
  });
}

ensureRuntimeStarted();
registerCommand("ping", false);
registerCommand("status", true);
registerTracksCommand();
