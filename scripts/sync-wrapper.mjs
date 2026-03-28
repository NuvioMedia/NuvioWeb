import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appName = "Nuvio TV";
const webOsServiceId = "com.nuvio.lg.service";
const webOsServiceDirName = "com.nuvio.lg.service";
const tizenServiceDirName = "com.nuvio.tizen.service";
const tizenServiceIdSuffix = ".NuvioMediaService";
const tizenServiceEntryPath = `services/${tizenServiceDirName}/src/service.js`;
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

async function syncRootFolder(targetDir, folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(rootDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

async function syncServiceFolder(targetDir, serviceDirName) {
  const targetServicesDir = path.join(targetDir, "services");
  await mkdir(targetServicesDir, { recursive: true });
  await rm(path.join(targetServicesDir, webOsServiceDirName), { recursive: true, force: true });
  await rm(path.join(targetServicesDir, tizenServiceDirName), { recursive: true, force: true });
  await cp(
    path.join(rootDir, "services", serviceDirName),
    path.join(targetServicesDir, serviceDirName),
    { recursive: true }
  );
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
  <script type="module" defer src="main.js"></script>
</body>
</html>
`;
}

function buildTizenMainJs() {
  return `import * as wrtService from "wrt:service";

window.__NUVIO_PLATFORM__ = "tizen";

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaFastForward", "MediaRewind"].forEach(function registerKey(keyName) {
    try {
      tvInput.registerKey(keyName);
    } catch (_) {}
  });
}

function getTizenPackageId() {
  try {
    return String(window.tizen?.application?.getCurrentApplication?.().appInfo?.packageId || "").trim();
  } catch (_) {
    return "";
  }
}

function startLocalMediaService() {
  var packageId = getTizenPackageId();
  if (!packageId || typeof wrtService.startService !== "function") {
    return Promise.resolve(false);
  }

  var serviceId = packageId + "${tizenServiceIdSuffix}";
  return new Promise(function(resolve) {
    var settled = false;

    function finish(value) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Boolean(value));
    }

    try {
      wrtService.startService(
        serviceId,
        function() {
          finish(true);
        },
        function(error) {
          console.warn("[tizen-service] Failed to start local media service", serviceId, error);
          finish(false);
        }
      );
    } catch (error) {
      console.warn("[tizen-service] Failed to request local media service", serviceId, error);
      finish(false);
    }

    setTimeout(function() {
      finish(false);
    }, 2500);
  });
}

function loadScript(src) {
  var script = document.createElement("script");
  script.src = src;
  script.defer = false;
  document.body.appendChild(script);
}

window.__NUVIO_TIZEN_MEDIA_SERVICE_READY__ = startLocalMediaService();

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
  const { version: appVersion } = await readAppMetadata();
  const appInfoPath = path.join(targetDir, "appinfo.json");
  const appInfoRaw = await readTextFile(
    appInfoPath,
    `webOS wrapper metadata not found at ${appInfoPath}. Expected appinfo.json in the wrapper root.`
  );
  const appInfo = JSON.parse(appInfoRaw);

  appInfo.title = appName;
  appInfo.version = appVersion;
  appInfo.icon = wrapperIconFiles.webosIcon.target;
  appInfo.largeIcon = wrapperIconFiles.webosLargeIcon.target;
  appInfo.services = [webOsServiceId];

  await writeTextFile(appInfoPath, `${JSON.stringify(appInfo, null, 2)}\n`);
  await syncWrapperIcons(targetDir, { includeLargeIcon: true });

  const webOsScriptPath = await resolveWebOsScriptPath(targetDir);
  await writeTextFile(path.join(targetDir, "index.html"), buildWebOsIndexHtml({ webOsScriptPath }));
}

async function syncWebOsCompanionFiles(targetDir) {
  await syncServiceFolder(targetDir, webOsServiceDirName);
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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertTizenFeature(xml, featureName) {
  const escapedFeatureName = escapeRegExp(featureName);
  const featurePattern = new RegExp(`<feature\\b[^>]*name="${escapedFeatureName}"[^>]*/>`);
  if (featurePattern.test(xml)) {
    return xml;
  }
  return insertIntoWidget(xml, `<feature name="${featureName}"/>`);
}

function extractTizenPackageId(xml) {
  const match = xml.match(/<tizen:application\b[^>]*package="([^"]+)"/);
  return String(match?.[1] || "").trim();
}

function upsertTizenWidgetVersion(xml, version) {
  const widgetPattern = /<widget\b([^>]*?)\bversion="[^"]*"([^>]*)>/;
  if (widgetPattern.test(xml)) {
    return xml.replace(widgetPattern, `<widget$1version="${version}"$2>`);
  }
  return xml;
}

function upsertTizenService(xml, { serviceId, contentSrc, name, description }) {
  const contentPattern = escapeRegExp(contentSrc);
  const servicePattern = new RegExp(
    `\\s*<tizen:service\\b[^>]*>[\\s\\S]*?<tizen:content\\s+src="${contentPattern}"\\s*/>[\\s\\S]*?<\\/tizen:service>`,
    "m"
  );
  const snippet = `<tizen:service id="${serviceId}" type="ui">
      <tizen:content src="${contentSrc}"/>
      <tizen:name>${name}</tizen:name>
      <tizen:description>${description}</tizen:description>
    </tizen:service>`;
  if (servicePattern.test(xml)) {
    return xml.replace(servicePattern, `\n    ${snippet}`);
  }
  return insertIntoWidget(xml, snippet);
}

async function updateTizenMetadata(targetDir) {
  const { version: appVersion } = await readAppMetadata();
  const configPath = path.join(targetDir, "config.xml");
  const configRaw = await readTextFile(
    configPath,
    `Tizen wrapper metadata not found at ${configPath}. Expected config.xml in the wrapper root.`
  );
  let configXml = configRaw;
  const packageId = extractTizenPackageId(configXml);
  if (!packageId) {
    throw new Error(`Unable to resolve Tizen package ID from ${configPath}.`);
  }

  configXml = upsertTizenIcon(configXml, wrapperIconFiles.tizenIcon.target);
  configXml = upsertXmlTag(configXml, "name", appName);
  configXml = upsertTizenWidgetVersion(configXml, appVersion);
  configXml = upsertTizenFeature(configXml, "http://tizen.org/feature/web.service");
  configXml = upsertTizenService(configXml, {
    serviceId: `${packageId}${tizenServiceIdSuffix}`,
    contentSrc: tizenServiceEntryPath,
    name: `${appName} Media Service`,
    description: "Local media helper service for Tizen playback"
  });

  await writeTextFile(configPath, configXml);
  await syncTizenIcon(targetDir);
  await syncServiceFolder(targetDir, tizenServiceDirName);
  await writeTextFile(path.join(targetDir, "index.html"), buildTizenIndexHtml());
  await writeTextFile(path.join(targetDir, "main.js"), buildTizenMainJs());
}

const { platform, targetDir } = parseArgs(process.argv.slice(2));
await syncVersionFiles();
await assertDistExists();
await syncBuild(targetDir);

if (platform === "webos") {
  await updateWebOsMetadata(targetDir);
  await syncWebOsCompanionFiles(targetDir);
}

if (platform === "tizen") {
  await updateTizenMetadata(targetDir);
}

console.log(`Synced ${platform} wrapper assets to ${targetDir}`);
