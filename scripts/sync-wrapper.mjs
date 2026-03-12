import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function fail(message) {
  throw new Error(`${message}\n\nUsage: node ./scripts/sync-wrapper.mjs --webos|--tizen --path /absolute/path/to/project`);
}

function parseArgs(argv) {
  let platform = "";
  let targetPath = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--webos" || arg === "--tizen") {
      if (platform) {
        fail("Choose exactly one platform flag.");
      }
      platform = arg.slice(2);
      continue;
    }

    if (arg === "--path") {
      targetPath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!platform) {
    fail("Missing platform flag.");
  }

  if (!targetPath) {
    fail("Missing --path.");
  }

  if (!path.isAbsolute(targetPath)) {
    fail(`Target path must be absolute: ${targetPath}`);
  }

  return {
    platform,
    targetDir: targetPath
  };
}

async function assertDistExists() {
  try {
    await access(distDir, fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

async function syncFolder(targetDir, folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(distDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

async function syncBuild(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    syncFolder(targetDir, "assets"),
    syncFolder(targetDir, "css"),
    syncFolder(targetDir, "js")
  ]);

  await cp(path.join(distDir, "app.bundle.js"), path.join(targetDir, "app.bundle.js"));
  try {
    await cp(path.join(distDir, "nuvio.env.js"), path.join(targetDir, "nuvio.env.js"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const { platform, targetDir } = parseArgs(process.argv.slice(2));
await assertDistExists();
await syncBuild(targetDir);

console.log(`Synced ${platform} wrapper assets to ${targetDir}`);
