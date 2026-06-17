import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const compatPath = path.join(__dirname, "node24-ares-compat.cjs");

export function findExecutable(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8"
  });
  const executablePath = String(result.stdout || "").trim();
  if (result.status !== 0 || !executablePath) {
    throw new Error(`Unable to find ${command} on PATH.`);
  }
  return executablePath;
}

export function resolveWebOsToolsBinary(binaryName) {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@webos-tools/cli/package.json");
  const packageJson = JSON.parse(require("fs").readFileSync(packageJsonPath, "utf8"));
  const binPath = packageJson.bin?.[binaryName];
  if (!binPath) {
    throw new Error(`Binary ${binaryName} not found in @webos-tools/cli`);
  }
  return path.join(path.dirname(packageJsonPath), binPath);
}

export function runCommand(
  command,
  args,
  { cwd = rootDir, stdio = "inherit", shell = false } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio,
      shell
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export function runAresCli(command, args, { pipeStdout = false, pipeStderr = false } = {}) {
  return new Promise((resolve, reject) => {
    const executablePath = findExecutable(command);
    const child = spawn(process.execPath, ["--require", compatPath, executablePath, ...args], {
      cwd: rootDir,
      stdio: ["inherit", pipeStdout ? "pipe" : "inherit", pipeStderr ? "pipe" : "inherit"]
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      if (pipeStdout) {
        process.exitCode = code;
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });

    if (pipeStdout) {
      resolve(child);
    }
  });
}
