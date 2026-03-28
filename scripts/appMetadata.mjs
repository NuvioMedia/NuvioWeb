import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const versionManagedJsonPaths = [
  path.join(rootDir, "appinfo.json"),
  path.join(rootDir, "services", "com.nuvio.lg.service", "package.json"),
  path.join(rootDir, "services", "com.nuvio.tizen.service", "package.json")
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readAppMetadata() {
  const packageJson = await readJson(packageJsonPath);
  return {
    name: String(packageJson?.name || "").trim(),
    version: String(packageJson?.version || "0.0.0").trim() || "0.0.0"
  };
}

export async function syncVersionFiles() {
  const { version } = await readAppMetadata();

  await Promise.all(versionManagedJsonPaths.map(async (filePath) => {
    const parsed = await readJson(filePath);
    if (String(parsed?.version || "").trim() === version) {
      return;
    }
    parsed.version = version;
    await writeJson(filePath, parsed);
  }));

  return version;
}
