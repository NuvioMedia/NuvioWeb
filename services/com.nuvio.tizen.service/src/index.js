const path = require("path");

const {
  SERVICE_LABEL,
  bootLocalRuntime,
  probeLocalServer
} = require("./runtimeHost");

const RUNTIME_PATH = path.resolve(__dirname, "..", "runtime", "media-http.cjs");

try {
  bootLocalRuntime(RUNTIME_PATH);
  console.log(`[${SERVICE_LABEL}] local media runtime booted from`, RUNTIME_PATH);
  probeLocalServer((error, status) => {
    if (error) {
      console.error(`[${SERVICE_LABEL}] failed to probe local media runtime:`, error);
      return;
    }
    if (!status?.port) {
      console.warn(`[${SERVICE_LABEL}] local media runtime started but no HTTP endpoint was detected`);
      return;
    }
    console.log(`[${SERVICE_LABEL}] local media endpoint available at http://127.0.0.1:${status.port}`);
  });
} catch (error) {
  console.error(`[${SERVICE_LABEL}] failed to boot local media runtime:`, error);
  process.exitCode = 1;
}
