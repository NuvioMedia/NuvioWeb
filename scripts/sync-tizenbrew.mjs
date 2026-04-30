import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appName = "Nuvio TV";
const defaultHostedEnvUrl = "https://nuvioapp.space/nuvio.env.js";
const defaultEnvFileContents = `(function bootstrapTizenEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var finished = false;

  function normalizeUrl(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function applyDefaults() {
    root.__NUVIO_ENV__ = Object.assign({
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      TV_LOGIN_REDIRECT_BASE_URL: "",
      PUBLIC_APP_URL: "",
      YOUTUBE_PROXY_URL: "",
      ADDON_REMOTE_BASE_URL: "",
      DEBUG_LOG_ENDPOINT: "",
      ENABLE_REMOTE_WRAPPER_MODE: false,
      PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
      TMDB_API_KEY: ""
    }, root.__NUVIO_ENV__ || {});
  }

  function finish() {
    if (finished) {
      return;
    }
    finished = true;
    applyDefaults();
    if (typeof root.__NUVIO_TIZEN_BOOTSTRAP_APP__ === "function") {
      root.__NUVIO_TIZEN_BOOTSTRAP_APP__();
    }
  }

  var hostedEnvUrl = normalizeUrl(root.__NUVIO_TIZEN_ENV_URL__) || ${JSON.stringify(defaultHostedEnvUrl)};
  if (!hostedEnvUrl || typeof document === "undefined") {
    finish();
    return;
  }

  var script = document.createElement("script");
  script.src = hostedEnvUrl;
  script.async = false;
  script.onload = finish;
  script.onerror = finish;
  document.head.appendChild(script);
  setTimeout(finish, 3000);
}());
`;
const tizenIconSource = path.join(rootDir, "assets", "images", "tizenIcon.png");

function fail(message) {
  throw new Error(`${message}\n\nUsage: node ./scripts/sync-tizenbrew.mjs --path /absolute/path/to/module`);
}

function parseArgs(argv) {
  let targetPath = "";
  let envSourcePath = "";
  const positionalArgs = [];
  const npmConfigPath = process.env.npm_config_path;
  const npmProvidedPath = npmConfigPath && npmConfigPath !== "true" ? npmConfigPath : "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--path") {
      targetPath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--env-source") {
      envSourcePath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      positionalArgs.push(arg);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!targetPath) {
    targetPath = positionalArgs[0] || npmProvidedPath || "";
  }

  if (!targetPath) {
    fail("Missing --path.");
  }

  if (!path.isAbsolute(targetPath)) {
    fail(`Target path must be absolute: ${targetPath}`);
  }

  if (envSourcePath && !path.isAbsolute(envSourcePath)) {
    fail(`Env source path must be absolute: ${envSourcePath}`);
  }

  return {
    targetDir: targetPath,
    envSourcePath
  };
}

async function assertDistExists() {
  try {
    await access(distDir, fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run \"npm run build\" first.`);
  }
}

async function syncFolder(targetDir, folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(distDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

async function syncBuild(targetAppDir, envSourcePath) {
  await mkdir(targetAppDir, { recursive: true });
  await Promise.all([
    syncFolder(targetAppDir, "assets"),
    syncFolder(targetAppDir, "css"),
    syncFolder(targetAppDir, "js"),
    syncFolder(targetAppDir, "res")
  ]);

  await cp(path.join(distDir, "app.bundle.js"), path.join(targetAppDir, "app.bundle.js"));
  if (envSourcePath) {
    await cp(envSourcePath, path.join(targetAppDir, "nuvio.env.js"));
  } else {
    await writeFile(path.join(targetAppDir, "nuvio.env.js"), defaultEnvFileContents, "utf8");
  }
}

function buildIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/themes.css" />
</head>
<body>
  <script defer src="main.js"></script>
</body>
</html>
`;
}

function buildMainJs() {
  return `window.__NUVIO_PLATFORM__ = "tizen";

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaFastForward", "MediaRewind"].forEach(function registerKey(keyName) {
    try {
      tvInput.registerKey(keyName);
    } catch (_) {}
  });
}

function loadScript(src) {
  var script = document.createElement("script");
  script.src = src;
  script.defer = false;
  document.body.appendChild(script);
}

window.__NUVIO_TIZEN_BOOTSTRAP_APP__ = function bootstrapApp() {
  if (window.__NUVIO_TIZEN_APP_BOOTSTRAPPED__) {
    return;
  }

  window.__NUVIO_TIZEN_APP_BOOTSTRAPPED__ = true;
  loadScript("js/runtime/polyfills.js");
  loadScript("js/runtime/env.js");
  loadScript("assets/libs/qrcode-generator.js");
  loadScript("app.bundle.js");
};

loadScript("nuvio.env.js");
`;
}

async function syncModule(targetDir, envSourcePath) {
  const appDir = path.join(targetDir, "app");
  await mkdir(targetDir, { recursive: true });
  await syncBuild(appDir, envSourcePath);
  await cp(tizenIconSource, path.join(targetDir, "icon.png"));
  await writeFile(path.join(appDir, "index.html"), buildIndexHtml(), "utf8");
  await writeFile(path.join(appDir, "main.js"), buildMainJs(), "utf8");
}

const { targetDir, envSourcePath } = parseArgs(process.argv.slice(2));
await assertDistExists();
await syncModule(targetDir, envSourcePath);

console.log(`Synced TizenBrew module assets to ${targetDir}`);
