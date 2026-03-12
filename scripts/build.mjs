import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

async function copyEntry(relativePath) {
  await cp(path.join(rootDir, relativePath), path.join(distDir, relativePath), {
    recursive: true
  });
}

async function copyOptionalRootFile(fileName, { fallback = null } = {}) {
  const targetPath = path.join(distDir, fileName);
  try {
    await cp(path.join(rootDir, fileName), targetPath);
    return fileName;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!fallback) {
    return "";
  }

  await cp(path.join(rootDir, fallback), targetPath);
  return fallback;
}

async function buildBundle() {
  await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: path.join(distDir, "app.bundle.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2018"],
    logLevel: "silent"
  });
}

async function writeDistIndex() {
  const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
  const output = sourceIndex.replace(
    '<script type="module" src="js/app.js"></script>',
    '<script defer src="app.bundle.js"></script>'
  );
  await writeFile(path.join(distDir, "index.html"), output, "utf8");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Promise.all([
  copyEntry("assets"),
  copyEntry("css"),
  copyEntry("js"),
  copyEntry("res")
]);

await buildBundle();
await writeDistIndex();

const copiedEnvSource = await copyOptionalRootFile("nuvio.env.js", {
  fallback: "nuvio.env.example.js"
});

if (copiedEnvSource === "nuvio.env.example.js") {
  console.warn("Using nuvio.env.example.js as dist/nuvio.env.js because no local nuvio.env.js was found.");
}

console.log(`Built shared app into ${distDir}`);
