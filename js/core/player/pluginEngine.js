import { GENERATED_PROVIDERS } from "./providers.generated.js";
import { CheerioShim } from "./cheerioShim.js";

// Runtime engine that executes the pre-transpiled scraper providers
// (built by scripts/build-plugins.mjs, chrome-47 compatible). Each provider is a
// CommonJS module exporting getStreams(tmdbId, mediaType, season, episode).
// Cross-origin fetch works because the packaged Tizen app does not enforce CORS.

const PROVIDER_TIMEOUT_MS = 15000;
const fnCache = new Map();

function makeRequire(provider) {
  return function require(name) {
    if (/cheerio/i.test(name)) return CheerioShim;
    throw new Error("[plugin:" + provider.id + "] unsupported require: " + name);
  };
}

function loadGetStreams(provider) {
  if (fnCache.has(provider.id)) return fnCache.get(provider.id);
  let gs = null;
  try {
    const module = { exports: {} };
    // Body runs in global scope, so fetch/atob/JSON/Promise/etc. are available.
    const factory = new Function("module", "exports", "require", provider.code);
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
    return GENERATED_PROVIDERS.length > 0;
  },

  // List the installed plugin repos (each repo bundles several scraper providers).
  // [{ repoId, repoName, count }] — used by the settings Plugins screen.
  listRepos() {
    const map = new Map();
    for (const provider of GENERATED_PROVIDERS) {
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
    const providers = GENERATED_PROVIDERS.filter((p) => (p.types || []).indexOf(type) !== -1
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
    const provider = GENERATED_PROVIDERS.find((p) => p.id === id);
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
