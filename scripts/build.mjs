import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const bundleFileName = "app.bundle.js";
const rootBundlePath = path.join(rootDir, bundleFileName);
const defaultEnvFileContents = `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = Object.assign({}, root.__NUVIO_ENV__ || {}, {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    TV_LOGIN_REDIRECT_BASE_URL: "",
    YOUTUBE_PROXY_URL: "youtube-proxy.html",
    ADDON_REMOTE_BASE_URL: "",
    ENABLE_REMOTE_WRAPPER_MODE: false,
    PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
    TMDB_API_KEY: ""
  });
}());
`;

async function copyEntry(relativePath) {
  await cp(path.join(rootDir, relativePath), path.join(distDir, relativePath), {
    recursive: true
  });
}

async function copyOptionalRootFile(fileName, { fallback = null, defaultContents = defaultEnvFileContents } = {}) {
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

  try {
    await cp(path.join(rootDir, fallback), targetPath);
    return fallback;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(targetPath, defaultContents, "utf8");
  return "generated-default";
}

async function buildBundle() {
  await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: rootBundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2015"],
    logLevel: "silent"
  });

  await cp(rootBundlePath, path.join(distDir, bundleFileName));
}

async function writeDistIndex() {
  const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
  await writeFile(path.join(distDir, "index.html"), sourceIndex, "utf8");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Promise.all([
  copyEntry("assets"),
  copyEntry("css"),
  cp(path.join(rootDir, "docs", "youtube-proxy.html"), path.join(distDir, "youtube-proxy.html")),
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
} else if (copiedEnvSource === "generated-default") {
  console.warn("Generated a default dist/nuvio.env.js because no local nuvio.env.js or nuvio.env.example.js was found.");
}

console.log(`Built shared app into ${distDir}`);
