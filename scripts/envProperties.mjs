import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export const ENV_PROPERTY_KEYS = [
  "NUVIO_SUPABASE_URL",
  "NUVIO_SUPABASE_ANON_KEY",
  "TV_LOGIN_WEB_BASE_URL",
  "YOUTUBE_PROXY_URL",
  "PARENTAL_GUIDE_API_URL",
  "INTRODB_API_URL",
  "IMDB_RATINGS_API_BASE_URL",
  "AVATAR_PUBLIC_BASE_URL",
  "UNIQUE_CONTRIBUTIONS_BASE_URL",
  "DONATIONS_BASE_URL",
  "DONATIONS_DONATE_URL",
  "SPONSOR_NAMES",
  "TMDB_API_KEY",
  "TRAKT_CLIENT_ID",
  "TRAKT_CLIENT_SECRET",
  "TRAKT_API_URL",
  "TRAKT_REDIRECT_URI"
];

const DEFAULT_ENV_VALUES = {
  NUVIO_SUPABASE_URL: "",
  NUVIO_SUPABASE_ANON_KEY: "",
  TV_LOGIN_WEB_BASE_URL: "",
  YOUTUBE_PROXY_URL: "youtube-proxy.html",
  PARENTAL_GUIDE_API_URL: "",
  INTRODB_API_URL: "https://api.introdb.app/",
  IMDB_RATINGS_API_BASE_URL: "",
  AVATAR_PUBLIC_BASE_URL: "",
  UNIQUE_CONTRIBUTIONS_BASE_URL: "",
  DONATIONS_BASE_URL: "",
  DONATIONS_DONATE_URL: "",
  SPONSOR_NAMES: "ragmehos.",
  TMDB_API_KEY: "",
  TRAKT_CLIENT_ID: "",
  TRAKT_CLIENT_SECRET: "",
  TRAKT_API_URL: "https://api.trakt.tv",
  TRAKT_REDIRECT_URI: "urn:ietf:wg:oauth:2.0:oob"
};

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function unescapePropertyValue(value = "") {
  return String(value)
    .replace(/\\:/g, ":")
    .replace(/\\=/g, "=")
    .replace(/\\#/g, "#")
    .replace(/\\!/g, "!")
    .replace(/\\\\/g, "\\");
}

export function parseProperties(source = "") {
  const properties = {};
  String(source || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
        return;
      }
      const separatorIndex = trimmed.search(/[:=]/);
      if (separatorIndex < 0) {
        properties[trimmed] = "";
        return;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key) {
        properties[key] = unescapePropertyValue(value);
      }
    });
  return properties;
}

export function normalizeEnvProperties(properties = {}) {
  const env = {};
  ENV_PROPERTY_KEYS.forEach((key) => {
    const rawValue = Object.prototype.hasOwnProperty.call(properties, key)
      ? properties[key]
      : DEFAULT_ENV_VALUES[key];
    const normalizedValue = String(rawValue ?? "");
    const shouldUseDefault =
      (key === "INTRODB_API_URL" || key === "SPONSOR_NAMES") && !normalizedValue.trim();
    env[key] = shouldUseDefault ? DEFAULT_ENV_VALUES[key] : normalizedValue;
  });
  return env;
}

export async function resolveLocalPropertiesSource({ rootDir, sourcePath = "" } = {}) {
  const candidates = [];
  if (sourcePath) {
    candidates.push(path.resolve(sourcePath));
  } else if (process.env.NUVIO_LOCAL_PROPERTIES) {
    candidates.push(path.resolve(process.env.NUVIO_LOCAL_PROPERTIES));
  } else {
    candidates.push(path.join(rootDir, "local.properties"));
    candidates.push(path.join(rootDir, "local.example.properties"));
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return "";
}

export async function readEnvProperties({ rootDir, sourcePath = "" } = {}) {
  const resolvedSourcePath = await resolveLocalPropertiesSource({ rootDir, sourcePath });
  if (!resolvedSourcePath) {
    return {
      sourcePath: "",
      env: normalizeEnvProperties({})
    };
  }
  if (/\.js$/i.test(resolvedSourcePath)) {
    throw new Error(
      `Runtime env JavaScript files are no longer supported as config sources. Use local.properties instead: ${resolvedSourcePath}`
    );
  }
  const properties = parseProperties(await readFile(resolvedSourcePath, "utf8"));
  return {
    sourcePath: resolvedSourcePath,
    env: normalizeEnvProperties(properties)
  };
}

export function buildRuntimeEnvScript(env = {}) {
  const values = normalizeEnvProperties(env);
  return `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var env = root.__NUVIO_ENV__ || {};
  var values = ${JSON.stringify(values, null, 2)};
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      env[key] = values[key];
    }
  }
  root.__NUVIO_ENV__ = env;
}());
`;
}

export async function writeRuntimeEnvScriptFile(targetPath, { rootDir, sourcePath = "" } = {}) {
  const result = await readEnvProperties({ rootDir, sourcePath });
  await writeFile(targetPath, buildRuntimeEnvScript(result.env), "utf8");
  return result;
}
