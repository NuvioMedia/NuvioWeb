var fs = require("fs");
var http = require("http");
var path = require("path");
var Module = require("module");

var SERVICE_ID = "com.nuvio.lg.service";
var PORT_CANDIDATES = require("./constants").PORT_CANDIDATES;
var REQUEST_TIMEOUT_MS = 5000;

function loadCommonJsScript(filename) {
  var code = fs.readFileSync(filename, "utf8");
  var mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(code, filename);
  return mod.exports;
}

function bootLocalRuntime(runtimePath) {
  loadCommonJsScript(runtimePath);
}

function requestLocalPath(port, pathname, callback) {
  var req = http.get(
    {
      host: "127.0.0.1",
      port: port,
      path: pathname
    },
    function(res) {
      var body = "";
      res.setEncoding("utf8");
      res.on("data", function(chunk) {
        body += chunk;
      });
      res.on("end", function() {
        callback(null, {
          port: port,
          statusCode: res.statusCode || 0,
          body: body
        });
      });
    }
  );

  req.setTimeout(REQUEST_TIMEOUT_MS, function() {
    req.destroy(new Error("Local media request timed out after " + REQUEST_TIMEOUT_MS + "ms"));
  });

  req.on("error", function(error) {
    callback(error);
  });
}

function probeLocalServer(callback, index) {
  var candidateIndex = typeof index === "number" ? index : 0;
  if (candidateIndex >= PORT_CANDIDATES.length) {
    callback(null, null);
    return;
  }

  var port = PORT_CANDIDATES[candidateIndex];
  requestLocalPath(port, "/settings", function(error, result) {
    if (!error && result && result.statusCode >= 200 && result.statusCode < 500) {
      callback(null, result);
      return;
    }
    probeLocalServer(callback, candidateIndex + 1);
  });
}

function requestActiveServerPath(pathname, callback) {
  probeLocalServer(function(error, status) {
    if (error) {
      callback(error);
      return;
    }

    if (!status || !status.port) {
      callback(new Error("Local media server unavailable"));
      return;
    }

    requestLocalPath(status.port, pathname, callback);
  });
}

module.exports = {
  SERVICE_ID: SERVICE_ID,
  PORT_CANDIDATES: PORT_CANDIDATES,
  bootLocalRuntime: bootLocalRuntime,
  probeLocalServer: probeLocalServer,
  requestActiveServerPath: requestActiveServerPath
};
