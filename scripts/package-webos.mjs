import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const cacheDir = path.join(rootDir, ".cache");
const stagingDir = path.join(cacheDir, "webos-package");
const appStageDir = path.join(stagingDir, "app");
const serviceStageDir = path.join(stagingDir, "com.nuvio.lg.service");
const serviceTempBundlePath = path.join(stagingDir, "__webos-service.bundle.js");

const appName = "Nuvio TV";
const webOsServiceId = "com.nuvio.lg.service";
const webOsServiceSourceDir = path.join(rootDir, "services", webOsServiceId);

async function assertDistExists() {
  try {
    await access(path.join(distDir, "app.bundle.js"), fsConstants.R_OK);
    await access(path.join(distDir, "appinfo.json"), fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveWebOsScriptPath(targetDir) {
  const webOsDirName = "webOSTVjs-1.2.12";
  const webOsDir = path.join(rootDir, webOsDirName);
  if (!(await pathExists(webOsDir))) {
    return "";
  }

  await cp(webOsDir, path.join(targetDir, webOsDirName), { recursive: true });
  return `${webOsDirName}/webOSTV.js`;
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
  <script src="assets/libs/qrcode-generator.js"></script>
${webOsScriptTag}  <script defer src="app.bundle.js"></script>
</body>
</html>
`;
}

async function injectWebOsRuntimeEnv(targetDir) {
  const endpoint = String(process.env.NUVIO_DEBUG_LOG_ENDPOINT || "").trim();
  const values = {
    WEBOS_SERVICE_ID: webOsServiceId
  };
  if (endpoint) {
    values.DEBUG_LOG_ENDPOINT = endpoint;
  }
  const envPath = path.join(targetDir, "nuvio.env.js");
  const injection = `
(function configureNuvioWebOsRuntimeEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = Object.assign({}, root.__NUVIO_ENV__ || {}, ${JSON.stringify(values, null, 2)});
}());
`;
  const existing = await readFile(envPath, "utf8").catch(() => "");
  await writeFile(envPath, `${existing.trim()}\n${injection}`, "utf8");
  if (endpoint) {
    console.log(`remote console endpoint: ${endpoint}`);
  }
}

async function stageApp() {
  const { version } = await readAppMetadata();
  await cp(distDir, appStageDir, { recursive: true });

  const appInfoPath = path.join(appStageDir, "appinfo.json");
  const appInfo = JSON.parse(await readFile(appInfoPath, "utf8"));
  appInfo.title = appName;
  appInfo.version = version;
  appInfo.icon = "icon.png";
  appInfo.largeIcon = "largeIcon.png";
  appInfo.services = [webOsServiceId];
  await writeFile(appInfoPath, `${JSON.stringify(appInfo, null, 2)}\n`, "utf8");

  await Promise.all([
    cp(path.join(rootDir, "assets", "images", "icon.png"), path.join(appStageDir, "icon.png")),
    cp(path.join(rootDir, "assets", "images", "largeIcon.png"), path.join(appStageDir, "largeIcon.png"))
  ]);

  const webOsScriptPath = await resolveWebOsScriptPath(appStageDir);
  await writeFile(path.join(appStageDir, "index.html"), buildWebOsIndexHtml({ webOsScriptPath }), "utf8");
  await injectWebOsRuntimeEnv(appStageDir);
}

async function stageService() {
  const { version } = await readAppMetadata();
  const packageJsonPath = path.join(webOsServiceSourceDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.version = version;

  await mkdir(path.join(serviceStageDir, "src"), { recursive: true });
  await mkdir(path.join(serviceStageDir, "runtime"), { recursive: true });

  await Promise.all([
    writeFile(path.join(serviceStageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    cp(path.join(webOsServiceSourceDir, "services.json"), path.join(serviceStageDir, "services.json")),
    cp(
      path.join(webOsServiceSourceDir, "runtime", "media-http.cjs"),
      path.join(serviceStageDir, "runtime", "media-http.cjs")
    )
  ]);

  await build({
    entryPoints: [path.join(webOsServiceSourceDir, "src", "index.js")],
    outfile: serviceTempBundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["es2015"],
    external: ["webos-service"],
    logLevel: "silent"
  });

  const bundledCode = await readFile(serviceTempBundlePath, "utf8");
  const babelResult = await transformAsync(bundledCode, {
    presets: [["@babel/preset-env", { targets: "ie 11" }]],
    comments: false,
    compact: false
  });

  await writeFile(path.join(serviceStageDir, "src", "index.js"), babelResult.code, "utf8");
  await rm(serviceTempBundlePath, { force: true });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function packageWebOs() {
  await syncVersionFiles();
  await assertDistExists();

  console.log("staging webOS package files...");
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await Promise.all([stageApp(), stageService()]);

  console.log("creating webOS IPK...");
  await runCommand("ares-package", [appStageDir, serviceStageDir, "--outdir", rootDir]);
}

try {
  await packageWebOs();
} catch (error) {
  console.error("\nwebOS packaging failed:");
  console.error(error);
  process.exit(1);
}
