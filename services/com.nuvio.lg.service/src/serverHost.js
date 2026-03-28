const fs = require("fs");
const http = require("http");
const path = require("path");
const Module = require("module");

const SERVICE_ID = "com.nuvio.lg.service";
const { PORT_CANDIDATES } = require("./constants");
const REQUEST_TIMEOUT_MS = 5000;

function loadCommonJsScript(filename) {
  const code = fs.readFileSync(filename, "utf8");
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(code, filename);
  return mod.exports;
}

function bootLocalRuntime(runtimePath) {
  loadCommonJsScript(runtimePath);
}

function requestLocalPath(port, pathname, callback) {
  const req = http.get(
    {
      host: "127.0.0.1",
      port,
      path: pathname
    },
    (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        callback(null, {
          port,
          statusCode: res.statusCode || 0,
          body
        });
      });
    }
  );

  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    req.destroy(new Error(`Local media request timed out after ${REQUEST_TIMEOUT_MS}ms`));
  });

  req.on("error", (error) => {
    callback(error);
  });
}

function probeLocalServer(callback, index = 0) {
  if (index >= PORT_CANDIDATES.length) {
    callback(null, null);
    return;
  }

  const port = PORT_CANDIDATES[index];
  requestLocalPath(port, "/settings", (error, result) => {
    if (!error && result && result.statusCode >= 200 && result.statusCode < 500) {
      callback(null, result);
      return;
    }
    probeLocalServer(callback, index + 1);
  });
}

function requestActiveServerPath(pathname, callback) {
  probeLocalServer((error, status) => {
    if (error) {
      callback(error);
      return;
    }

    if (!status?.port) {
      callback(new Error("Local media server unavailable"));
      return;
    }

    requestLocalPath(status.port, pathname, callback);
  });
}

module.exports = {
  SERVICE_ID,
  PORT_CANDIDATES,
  bootLocalRuntime,
  probeLocalServer,
  requestActiveServerPath
};
