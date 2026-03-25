import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appName = "Nuvio TV";
const defaultEnvFileContents = `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = Object.assign({}, root.__NUVIO_ENV__ || {}, {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    TV_LOGIN_REDIRECT_BASE_URL: "",
    YOUTUBE_PROXY_URL: "",
    ADDON_REMOTE_BASE_URL: "",
    ENABLE_REMOTE_WRAPPER_MODE: false,
    PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
    TMDB_API_KEY: ""
  });
}());
`;
const wrapperIconFiles = {
  webosIcon: {
    source: path.join(rootDir, "assets", "images", "icon.png"),
    target: "icon.png"
  },
  webosLargeIcon: {
    source: path.join(rootDir, "assets", "images", "largeIcon.png"),
    target: "largeIcon.png"
  },
  tizenIcon: {
    source: path.join(rootDir, "assets", "images", "tizenIcon.png"),
    target: "icon.png"
  }
};

function fail(message) {
  throw new Error(`${message}\n\nUsage: node ./scripts/sync-wrapper.mjs --webos|--tizen --path /absolute/path/to/project`);
}

function parseArgs(argv) {
  let platform = "";
  let targetPath = "";
  const positionalArgs = [];
  const npmConfigPath = process.env.npm_config_path;
  const npmProvidedPath = npmConfigPath && npmConfigPath !== "true" ? npmConfigPath : "";

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

    if (!arg.startsWith("--")) {
      positionalArgs.push(arg);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!platform) {
    if (process.env.npm_config_webos) {
      platform = "webos";
    } else if (process.env.npm_config_tizen) {
      platform = "tizen";
    }
  }

  if (!targetPath) {
    targetPath = positionalArgs[0] || npmProvidedPath || "";
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
    syncFolder(targetDir, "js"),
    syncFolder(targetDir, "res")
  ]);

  await cp(path.join(distDir, "app.bundle.js"), path.join(targetDir, "app.bundle.js"));
  try {
    await cp(path.join(distDir, "nuvio.env.js"), path.join(targetDir, "nuvio.env.js"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        await cp(path.join(rootDir, "nuvio.env.example.js"), path.join(targetDir, "nuvio.env.js"));
      } catch (fallbackError) {
        if (fallbackError?.code !== "ENOENT") {
          throw fallbackError;
        }
        await writeFile(path.join(targetDir, "nuvio.env.js"), defaultEnvFileContents, "utf8");
      }
      return;
    }
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

}

function buildWebOsIndexHtml({ webOsScriptPath = "" } = {}) {
  const webOsScriptTag = webOsScriptPath
    ? `  <script src="${webOsScriptPath}"></script>\n`
    : "";

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
  <script>window.__NUVIO_PLATFORM__ = "webos";</script>
  <script src="nuvio.env.js"></script>
  <script src="js/runtime/polyfills.js"></script>
  <script src="js/runtime/env.js"></script>
  <script src="assets/libs/qrcode-generator.js"></script>
${webOsScriptTag}  <script defer src="app.bundle.js"></script>
</body>
</html>
`;
}

function buildTizenIndexHtml() {
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

function buildTizenMainJs() {
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

loadScript("nuvio.env.js");
loadScript("js/runtime/polyfills.js");
loadScript("js/runtime/env.js");
loadScript("assets/libs/qrcode-generator.js");
loadScript("app.bundle.js");
`;
}

async function readTextFile(filePath, missingMessage) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(missingMessage);
    }
    throw error;
  }
}

async function writeTextFile(filePath, contents) {
  await writeFile(filePath, contents, "utf8");
}

async function syncWrapperIcons(targetDir, { includeLargeIcon }) {
  const iconTasks = [wrapperIconFiles.webosIcon];
  if (includeLargeIcon) {
    iconTasks.push(wrapperIconFiles.webosLargeIcon);
  }

  await Promise.all(iconTasks.map(({ source, target }) => cp(source, path.join(targetDir, target))));
}

async function syncTizenIcon(targetDir) {
  await cp(wrapperIconFiles.tizenIcon.source, path.join(targetDir, wrapperIconFiles.tizenIcon.target));
}

async function resolveWebOsScriptPath(targetDir) {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const webOsDir = entries
    .filter((entry) => entry.isDirectory() && /^webOSTVjs/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))[0];

  return webOsDir ? `${webOsDir}/webOSTV.js` : "";
}

async function updateWebOsMetadata(targetDir) {
  const appInfoPath = path.join(targetDir, "appinfo.json");
  const appInfoRaw = await readTextFile(
    appInfoPath,
    `webOS wrapper metadata not found at ${appInfoPath}. Expected appinfo.json in the wrapper root.`
  );
  const appInfo = JSON.parse(appInfoRaw);

  appInfo.title = appName;
  appInfo.icon = wrapperIconFiles.webosIcon.target;
  appInfo.largeIcon = wrapperIconFiles.webosLargeIcon.target;

  await writeTextFile(appInfoPath, `${JSON.stringify(appInfo, null, 2)}\n`);
  await syncWrapperIcons(targetDir, { includeLargeIcon: true });

  const webOsScriptPath = await resolveWebOsScriptPath(targetDir);
  await writeTextFile(path.join(targetDir, "index.html"), buildWebOsIndexHtml({ webOsScriptPath }));
}

function upsertXmlTag(xml, tagName, innerText) {
  const tagPattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
  if (tagPattern.test(xml)) {
    return xml.replace(tagPattern, `<${tagName}>${innerText}</${tagName}>`);
  }

  return insertIntoWidget(xml, `<${tagName}>${innerText}</${tagName}>`);
}

function upsertTizenIcon(xml, iconSrc) {
  const iconPattern = /<icon\b[^>]*src="[^"]*"[^>]*>([\s\S]*?)<\/icon>|<icon\b[^>]*src="[^"]*"[^>]*\/>/;
  if (iconPattern.test(xml)) {
    let replaced = false;
    return xml.replace(iconPattern, () => {
      if (replaced) {
        return "";
      }
      replaced = true;
      return `<icon src="${iconSrc}"/>`;
    });
  }

  return insertIntoWidget(xml, `<icon src="${iconSrc}"/>`);
}

function insertIntoWidget(xml, snippet) {
  const widgetOpenTagPattern = /<widget\b[^>]*>/;
  if (!widgetOpenTagPattern.test(xml)) {
    throw new Error("Invalid Tizen config.xml: missing <widget> root tag.");
  }

  return xml.replace(widgetOpenTagPattern, (match) => `${match}\n    ${snippet}`);
}

async function updateTizenMetadata(targetDir) {
  const configPath = path.join(targetDir, "config.xml");
  const configRaw = await readTextFile(
    configPath,
    `Tizen wrapper metadata not found at ${configPath}. Expected config.xml in the wrapper root.`
  );
  let configXml = configRaw;

  configXml = upsertTizenIcon(configXml, wrapperIconFiles.tizenIcon.target);
  configXml = upsertXmlTag(configXml, "name", appName);

  await writeTextFile(configPath, configXml);
  await syncTizenIcon(targetDir);
  await writeTextFile(path.join(targetDir, "index.html"), buildTizenIndexHtml());
  await writeTextFile(path.join(targetDir, "main.js"), buildTizenMainJs());
}

const { platform, targetDir } = parseArgs(process.argv.slice(2));
await assertDistExists();
await syncBuild(targetDir);

if (platform === "webos") {
  await updateWebOsMetadata(targetDir);
}

if (platform === "tizen") {
  await updateTizenMetadata(targetDir);
}

console.log(`Synced ${platform} wrapper assets to ${targetDir}`);
