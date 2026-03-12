import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const ENV_DEFAULTS = {
  SUPABASE_URL: "https://dpyhjjcoabcglfmgecug.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRweWhqamNvYWJjZ2xmbWdlY3VnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3ODYyNDcsImV4cCI6MjA4NjM2MjI0N30.U-3QSNDdpsnvRk_7ZL419AFTOtggHJJcmkodxeXjbkg",
  TV_LOGIN_REDIRECT_BASE_URL: "https://nuvioapp.space/tv-login",
  PUBLIC_APP_URL: "",
  ENABLE_REMOTE_WRAPPER_MODE: false,
  PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"]
};

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  return String(value).toLowerCase() === "true";
}

function parsePlaybackOrder(value, fallback) {
  if (!value) {
    return fallback;
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || ENV_DEFAULTS.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ENV_DEFAULTS.SUPABASE_ANON_KEY,
    TV_LOGIN_REDIRECT_BASE_URL: process.env.TV_LOGIN_REDIRECT_BASE_URL || ENV_DEFAULTS.TV_LOGIN_REDIRECT_BASE_URL,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || ENV_DEFAULTS.PUBLIC_APP_URL,
    ENABLE_REMOTE_WRAPPER_MODE: parseBoolean(process.env.ENABLE_REMOTE_WRAPPER_MODE, ENV_DEFAULTS.ENABLE_REMOTE_WRAPPER_MODE),
    PREFERRED_PLAYBACK_ORDER: parsePlaybackOrder(process.env.PREFERRED_PLAYBACK_ORDER, ENV_DEFAULTS.PREFERRED_PLAYBACK_ORDER)
  };
}

async function copyEntry(relativePath) {
  await cp(path.join(rootDir, relativePath), path.join(distDir, relativePath), {
    recursive: true
  });
}

async function writeEnvFile(env) {
  const envFile = path.join(distDir, "js/runtime/env.js");
  const source = `(function bootstrapNuvioEnv(){var root=typeof globalThis!=="undefined"?globalThis:window;var existing=root.__NUVIO_ENV__||{};root.__NUVIO_ENV__={SUPABASE_URL:typeof existing.SUPABASE_URL==="undefined"?${JSON.stringify(env.SUPABASE_URL)}:existing.SUPABASE_URL,SUPABASE_ANON_KEY:typeof existing.SUPABASE_ANON_KEY==="undefined"?${JSON.stringify(env.SUPABASE_ANON_KEY)}:existing.SUPABASE_ANON_KEY,TV_LOGIN_REDIRECT_BASE_URL:typeof existing.TV_LOGIN_REDIRECT_BASE_URL==="undefined"?${JSON.stringify(env.TV_LOGIN_REDIRECT_BASE_URL)}:existing.TV_LOGIN_REDIRECT_BASE_URL,PUBLIC_APP_URL:typeof existing.PUBLIC_APP_URL==="undefined"?${JSON.stringify(env.PUBLIC_APP_URL)}:existing.PUBLIC_APP_URL,ENABLE_REMOTE_WRAPPER_MODE:typeof existing.ENABLE_REMOTE_WRAPPER_MODE==="undefined"?${JSON.stringify(env.ENABLE_REMOTE_WRAPPER_MODE)}:existing.ENABLE_REMOTE_WRAPPER_MODE,PREFERRED_PLAYBACK_ORDER:typeof existing.PREFERRED_PLAYBACK_ORDER==="undefined"?${JSON.stringify(env.PREFERRED_PLAYBACK_ORDER)}:existing.PREFERRED_PLAYBACK_ORDER};}());\n`;
  await mkdir(path.dirname(envFile), { recursive: true });
  await writeFile(envFile, source, "utf8");
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
await writeEnvFile(buildEnv());

console.log(`Built shared app into ${distDir}`);
