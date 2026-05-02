import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const compatPath = path.join(__dirname, "node24-ares-compat.cjs");
const defaultAppId = "com.nuvio.lg";

function findExecutable(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8"
  });
  const executablePath = String(result.stdout || "").trim();
  if (result.status !== 0 || !executablePath) {
    throw new Error(`Unable to find ${command} on PATH.`);
  }
  return executablePath;
}

function hasAppOrServiceArg(args) {
  return args.some((arg, index) => {
    if (arg === "-s" || arg === "--service" || arg === "-a" || arg === "--app") {
      return true;
    }
    const previous = args[index - 1] || "";
    return !arg.startsWith("-") && previous !== "-d" && previous !== "--device" && previous !== "-P" && previous !== "--host-port";
  });
}

function runAresInspect(args) {
  return new Promise((resolve, reject) => {
    const aresInspectPath = findExecutable("ares-inspect");
    const child = spawn(process.execPath, ["--require", compatPath, aresInspectPath, ...args], {
      cwd: rootDir,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ares-inspect exited with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const inspectArgs = hasAppOrServiceArg(args)
    ? args
    : [defaultAppId, ...args];

  await runAresInspect(inspectArgs);
}

try {
  await main();
} catch (error) {
  console.error("\nwebOS inspect failed:");
  console.error(error);
  process.exit(1);
}
