import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const wrapperName = process.argv[2];

const wrapperTargets = {
  webos: "/Users/edin/Documents/NuvioTV-WebOS",
  tizen: "/Users/edin/workspace/NuvioTVTizenOS"
};

if (!wrapperTargets[wrapperName]) {
  throw new Error(`Unknown wrapper target: ${wrapperName}`);
}

const targetDir = wrapperTargets[wrapperName];

if (wrapperName === "webos") {
  console.log(`Skipped sync for ${targetDir} because webOS now runs as a hosted wrapper`);
  process.exit(0);
}

async function syncFolder(folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(distDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

await mkdir(targetDir, { recursive: true });
await Promise.all([
  syncFolder("assets"),
  syncFolder("css"),
  syncFolder("js")
]);

await cp(path.join(distDir, "app.bundle.js"), path.join(targetDir, "app.bundle.js"));

const runtimeEnv = await readFile(path.join(distDir, "js/runtime/env.js"), "utf8");
await writeFile(path.join(targetDir, "js/runtime/env.js"), runtimeEnv, "utf8");

console.log(`Synced shared app to ${targetDir}`);
