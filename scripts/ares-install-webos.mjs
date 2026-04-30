import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppMetadata } from "./appMetadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const compatPath = path.join(__dirname, "node24-ares-compat.cjs");

function hasPackageArg(args) {
  return args.some((arg) => !arg.startsWith("-") && arg.endsWith(".ipk"));
}

async function resolveDefaultPackagePath() {
  const { version } = await readAppMetadata();
  const packagePath = path.join(rootDir, `com.nuvio.lg_${version}_all.ipk`);
  try {
    await access(packagePath, fsConstants.R_OK);
  } catch {
    throw new Error(`Package not found at ${packagePath}. Run "npm run package:webos" first.`);
  }
  return packagePath;
}

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

function runAresInstall(args) {
  return new Promise((resolve, reject) => {
    const aresInstallPath = findExecutable("ares-install");
    const child = spawn(process.execPath, ["--require", compatPath, aresInstallPath, ...args], {
      cwd: rootDir,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ares-install exited with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const installArgs = hasPackageArg(args)
    ? args
    : [await resolveDefaultPackagePath(), ...args];

  await runAresInstall(installArgs);
}

try {
  await main();
} catch (error) {
  console.error("\nwebOS install failed:");
  console.error(error);
  process.exit(1);
}
