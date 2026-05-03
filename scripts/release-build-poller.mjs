import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const stateDir = path.join(rootDir, ".cache");
const defaultStateFile = path.join(stateDir, "release-build-poller.json");
const defaultRepo = process.env.RELEASE_POLL_REPO || "NuvioMedia/NuvioWeb";
const defaultIntervalMs = Number(process.env.RELEASE_POLL_INTERVAL_MS || 30 * 60 * 1000);
const includePrereleases = String(process.env.RELEASE_POLL_INCLUDE_PRERELEASES || "true").toLowerCase() !== "false";
const deployDirRaw = String(process.env.RELEASE_POLL_DEPLOY_DIR || "").trim();
const deployEnabled = Boolean(deployDirRaw);
const deployDir = deployEnabled ? path.resolve(deployDirRaw) : "";
const stateFile = process.env.RELEASE_POLL_STATE_FILE || defaultStateFile;
const githubApiUrl = `https://api.github.com/repos/${defaultRepo}/releases?per_page=20`;

function validateDeployDir(targetDir) {
  if (!targetDir) {
    return;
  }

  if (!path.isAbsolute(targetDir)) {
    throw new Error(`RELEASE_POLL_DEPLOY_DIR must be an absolute path. Received: ${targetDir}`);
  }

  if (targetDir === "/") {
    throw new Error("Refusing to deploy into '/'. Set RELEASE_POLL_DEPLOY_DIR to a dedicated web root.");
  }
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function readState() {
  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { lastSeenReleaseId: "", lastSeenTag: "" };
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function fetchLatestRelease() {
  const response = await fetch(githubApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "nuvio-release-build-poller"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with ${response.status} ${response.statusText}`);
  }

  const releases = await response.json();
  if (!Array.isArray(releases)) {
    throw new Error("GitHub API release response was not an array.");
  }

  const latestRelease = releases
    .filter((release) => !release?.draft)
    .filter((release) => includePrereleases || !release?.prerelease)
    .sort((a, b) => new Date(b?.published_at || 0).getTime() - new Date(a?.published_at || 0).getTime())[0];

  if (!latestRelease) {
    throw new Error(`No published${includePrereleases ? "" : " stable"} releases found for ${defaultRepo}.`);
  }

  return {
    id: String(latestRelease?.id || "").trim(),
    tag: String(latestRelease?.tag_name || "").trim(),
    name: String(latestRelease?.name || "").trim(),
    publishedAt: String(latestRelease?.published_at || "").trim(),
    prerelease: Boolean(latestRelease?.prerelease)
  };
}

function runBuild() {
  return runCommand("npm", ["run", "build"]);
}

async function assertDistExists() {
  try {
    await access(path.join(rootDir, "dist"), fsConstants.R_OK);
  } catch {
    throw new Error("Build output missing at dist/. Build must complete before deploy.");
  }
}

async function clearDirectoryContents(targetDir) {
  const entries = await readdir(targetDir, { withFileTypes: true });
  await Promise.all(entries.map((entry) => rm(path.join(targetDir, entry.name), { recursive: true, force: true })));
}

async function deployBuild() {
  if (!deployEnabled) {
    return;
  }

  await assertDistExists();
  await mkdir(deployDir, { recursive: true });
  await clearDirectoryContents(deployDir);
  await cp(path.join(rootDir, "dist"), deployDir, { recursive: true });
  log(`Deployed dist/ to ${deployDir}.`);
}

async function syncRepoToReleaseTag(tagName) {
  log(`Syncing local checkout to release tag ${tagName} before build.`);
  await runCommand("git", ["fetch", "--force", "origin", "tag", tagName]);
  await runCommand("git", ["reset", "--hard", tagName]);
}

function releaseLabel(release) {
  const label = release.name || release.tag;
  return release.prerelease ? `${label} (prerelease)` : label;
}

async function checkOnce() {
  const state = await readState();
  const latestRelease = await fetchLatestRelease();

  if (!latestRelease.id || !latestRelease.tag) {
    throw new Error("Latest release response did not include an ID and tag.");
  }

  if (!state.lastSeenReleaseId) {
    const initialState = {
      lastSeenReleaseId: latestRelease.id,
      lastSeenTag: latestRelease.tag,
      lastBuiltReleaseId: "",
      lastBuiltTag: "",
      lastDeployedReleaseId: "",
      lastDeployedTag: "",
      publishedAt: latestRelease.publishedAt
    };

    if (deployEnabled) {
      log(`No poller state found. Building and deploying current release ${releaseLabel(latestRelease)}.`);
      await syncRepoToReleaseTag(latestRelease.tag);
      await runBuild();
      await deployBuild();
      initialState.lastBuiltReleaseId = latestRelease.id;
      initialState.lastBuiltTag = latestRelease.tag;
      initialState.lastDeployedReleaseId = latestRelease.id;
      initialState.lastDeployedTag = latestRelease.tag;
    }

    await writeState(initialState);
    log(`Initialized poller state with release ${releaseLabel(latestRelease)}.`);
    return;
  }

  if (state.lastSeenReleaseId === latestRelease.id) {
    if (deployEnabled && state.lastDeployedReleaseId !== latestRelease.id) {
      log(`No new release, but deploy state is stale. Redeploying ${releaseLabel(latestRelease)}.`);
      await syncRepoToReleaseTag(latestRelease.tag);
      await runBuild();
      await deployBuild();
      await writeState({
        ...state,
        lastBuiltReleaseId: latestRelease.id,
        lastBuiltTag: latestRelease.tag,
        lastDeployedReleaseId: latestRelease.id,
        lastDeployedTag: latestRelease.tag,
        publishedAt: latestRelease.publishedAt
      });
      log(`Redeploy completed for release ${releaseLabel(latestRelease)}.`);
      return;
    }

    log(`No new release. Latest remains ${releaseLabel(latestRelease)}.`);
    return;
  }

  log(`New release detected: ${state.lastSeenTag || state.lastSeenReleaseId} -> ${releaseLabel(latestRelease)}.`);
  await syncRepoToReleaseTag(latestRelease.tag);
  await runBuild();
  await deployBuild();
  await writeState({
    lastSeenReleaseId: latestRelease.id,
    lastSeenTag: latestRelease.tag,
    lastBuiltReleaseId: latestRelease.id,
    lastBuiltTag: latestRelease.tag,
    lastDeployedReleaseId: deployEnabled ? latestRelease.id : state.lastDeployedReleaseId || "",
    lastDeployedTag: deployEnabled ? latestRelease.tag : state.lastDeployedTag || "",
    publishedAt: latestRelease.publishedAt
  });
  log(`Build${deployEnabled ? " and deploy" : ""} completed for release ${releaseLabel(latestRelease)}.`);
}

async function main() {
  if (!Number.isFinite(defaultIntervalMs) || defaultIntervalMs <= 0) {
    throw new Error(`Invalid RELEASE_POLL_INTERVAL_MS value: ${process.env.RELEASE_POLL_INTERVAL_MS || ""}`);
  }

  validateDeployDir(deployDir);

  log(`Watching ${defaultRepo} for new releases every ${defaultIntervalMs}ms.`);
  log(`Prerelease builds are ${includePrereleases ? "included" : "excluded"}.`);
  if (deployEnabled) {
    log(`Automatic deploy enabled. Target directory: ${deployDir}`);
  }

  while (true) {
    try {
      await checkOnce();
    } catch (error) {
      log(`Release poll failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, defaultIntervalMs));
  }
}

await main();
