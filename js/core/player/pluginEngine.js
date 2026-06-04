import { GENERATED_PROVIDERS } from "./providers.generated.js";
import { CheerioShim } from "./cheerioShim.js";
import { CryptoJS, UrlShim, AxiosShim, WsShim } from "./pluginShims.js";
import { LocalStore } from "../storage/localStore.js";

// Runtime engine that executes the pre-transpiled scraper providers
// (built by scripts/build-plugins.mjs, chrome-47 compatible). Each provider is a
// CommonJS module exporting getStreams(tmdbId, mediaType, season, episode).
// Cross-origin fetch works because the packaged Tizen app does not enforce CORS.
//
// Providers come from two sources, newest-wins:
//   1. GENERATED_PROVIDERS  — baked into the app at build time (offline fallback).
//   2. A daily-rebuilt public bundle fetched at runtime, so new plugin repos appear
//      without rebuilding/redeploying the app. Kept in memory only — NOT cached in
//      localStorage: the bundle is ~3 MB and Tizen's ~5 MB localStorage quota would
//      overflow and break other writes at boot (black screen). Re-fetched per launch.
const REMOTE_PROVIDERS_URL = "https://raw.githubusercontent.com/fvaha/nuvio-tizen-providers/main/providers.json";
const REMOTE_CACHE_KEY = "remoteProviders";

const PROVIDER_TIMEOUT_MS = 15000;
const fnCache = new Map();

// One-time cleanup: free the large bundle that older builds persisted to localStorage
// (it could fill the quota and crash boot). Safe no-op once the key is gone.
try {
  if (LocalStore.get(REMOTE_CACHE_KEY, null)) {
    LocalStore.set(REMOTE_CACHE_KEY, null);
  }
} catch (_) {
}

// Active provider list. Starts as the baked bundle so app boot pays no cost.
// refreshFromRemote() swaps in the freshly-downloaded bundle in the background.
let activeProviders = GENERATED_PROVIDERS;

function getProviders() {
  return Array.isArray(activeProviders) && activeProviders.length ? activeProviders : GENERATED_PROVIDERS;
}

function makeRequire(provider) {
  return function require(name) {
    const mod = String(name || "").toLowerCase();
    if (/cheerio/.test(mod)) return CheerioShim;
    if (mod === "crypto-js") return CryptoJS;
    if (mod === "url") return UrlShim;
    if (mod === "axios") return AxiosShim;
    if (mod === "ws") return WsShim;
    throw new Error("[plugin:" + provider.id + "] unsupported require: " + name);
  };
}

// Providers occasionally start with a "#!/usr/bin/env node" shebang. That is a
// syntax error inside `new Function(...)`, so strip a leading shebang line before
// compiling (covers both baked and remote bundles).
function stripShebang(code) {
  const str = String(code || "");
  return str.charCodeAt(0) === 0x23 && str.charCodeAt(1) === 0x21
    ? str.replace(/^#![^\n]*\n?/, "")
    : str;
}

function loadGetStreams(provider) {
  if (fnCache.has(provider.id)) return fnCache.get(provider.id);
  let gs = null;
  try {
    const module = { exports: {} };
    // Body runs in global scope, so fetch/atob/JSON/Promise/etc. are available.
    const factory = new Function("module", "exports", "require", stripShebang(provider.code));
    factory(module, module.exports, makeRequire(provider));
    gs = module.exports && module.exports.getStreams;
    if (typeof gs !== "function") gs = null;
  } catch (e) {
    if (globalThis.console) console.log("[plugin:" + provider.id + "] load error: " + e.message);
    gs = null;
  }
  fnCache.set(provider.id, gs);
  return gs;
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    Promise.resolve(promise).then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(null); } }
    );
  });
}

function normalizeStreams(raw, provider) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && (s.url || s.externalUrl))
    .map((s) => ({
      name: s.name || provider.name,
      title: s.title || s.name || provider.name,
      url: s.url || s.externalUrl || null,
      quality: s.quality || null,
      qualityValue: parseQuality(s.quality),
      headers: s.headers || null,
      // The player reads request headers from behaviorHints.proxyHeaders.request
      // (Stremio convention) — provider streams expose them as `headers`.
      behaviorHints: mergeProxyHeaders(s.behaviorHints, s.headers),
      size: s.size || null,
      subtitles: Array.isArray(s.subtitles) ? s.subtitles : [],
      provider: provider.id,
      isPluginStream: true
    }));
}

function parseQuality(q) {
  const m = String(q || "").match(/(\d{3,4})\s*p/i);
  return m ? Number(m[1]) : -1;
}

function mergeProxyHeaders(behaviorHints, headers) {
  if (!headers || typeof headers !== "object") return behaviorHints || null;
  const bh = behaviorHints && typeof behaviorHints === "object" ? Object.assign({}, behaviorHints) : {};
  const proxy = bh.proxyHeaders && typeof bh.proxyHeaders === "object" ? Object.assign({}, bh.proxyHeaders) : {};
  proxy.request = Object.assign({}, proxy.request || {}, headers);
  bh.proxyHeaders = proxy;
  return bh;
}

export const PluginEngine = {
  hasProviders() {
    return getProviders().length > 0;
  },

  // Fetch the daily-rebuilt public bundle and swap it in (memory only). Safe to call
  // fire-and-forget; on any failure the current/baked list stays in use. Not cached in
  // localStorage on purpose — the ~3 MB bundle would overflow Tizen's quota.
  async refreshFromRemote() {
    try {
      const res = await fetch(REMOTE_PROVIDERS_URL + "?t=" + Date.now());
      if (!res.ok) return false;
      const providers = await res.json();
      if (!Array.isArray(providers) || !providers.length
        || !providers.every((p) => p && p.id && typeof p.code === "string")) {
        return false;
      }
      activeProviders = providers;
      fnCache.clear();
      return true;
    } catch (e) {
      if (globalThis.console) console.log("[plugins] remote refresh failed: " + e.message);
      return false;
    }
  },

  // List the installed plugin repos (each repo bundles several scraper providers).
  // [{ repoId, repoName, count }] — used by the settings Plugins screen.
  listRepos() {
    const map = new Map();
    for (const provider of getProviders()) {
      const repoId = String(provider.repoId || provider.repoName || "unknown");
      const entry = map.get(repoId) || { repoId, repoName: provider.repoName || repoId, count: 0 };
      entry.count += 1;
      map.set(repoId, entry);
    }
    return Array.from(map.values());
  },

  // Run every provider matching mediaType, aggregate into [{sourceId, sourceName, streams}].
  // disabledRepoIds skips whole repos the user turned off in settings.
  async execute({ tmdbId, mediaType, season = null, episode = null, disabledRepoIds = [] } = {}) {
    if (!tmdbId) return [];
    const type = mediaType === "series" ? "tv" : mediaType;
    const disabled = new Set((disabledRepoIds || []).map((id) => String(id)));
    const providers = getProviders().filter((p) => (p.types || []).indexOf(type) !== -1
      && !disabled.has(String(p.repoId || p.repoName || "unknown")));

    const runOne = (provider) => {
      const gs = loadGetStreams(provider);
      if (!gs) return Promise.resolve(null);
      let call;
      try { call = gs(tmdbId, type, season, episode); }
      catch (e) { return Promise.resolve(null); }
      return withTimeout(call, PROVIDER_TIMEOUT_MS).then((raw) => {
        const streams = normalizeStreams(raw, provider);
        if (!streams.length) return null;
        return { sourceId: provider.id, sourceName: provider.name + " (" + provider.repoName + ")", streams };
      });
    };

    const results = await runPool(providers, runOne, CONCURRENCY);
    return results.filter(Boolean);
  },

  // Debug helper: run a single provider by id.
  async runProvider(id, { tmdbId, mediaType = "movie", season = null, episode = null } = {}) {
    const provider = getProviders().find((p) => p.id === id);
    if (!provider) return { error: "no such provider: " + id };
    const gs = loadGetStreams(provider);
    if (!gs) return { error: "load failed" };
    const raw = await withTimeout(Promise.resolve().then(() => gs(tmdbId, mediaType === "series" ? "tv" : mediaType, season, episode)), PROVIDER_TIMEOUT_MS);
    return { provider: provider.id, streams: normalizeStreams(raw, provider) };
  }
};

const CONCURRENCY = 6;
async function runPool(items, worker, limit) {
  const out = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]);
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(next());
  await Promise.all(runners);
  return out;
}

if (typeof globalThis !== "undefined") globalThis.__PluginEngine = PluginEngine;
