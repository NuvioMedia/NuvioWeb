import { safeApiCall } from "../../core/network/safeApiCall.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { AddonApi } from "../remote/api/addonApi.js";

const ADDON_URLS_KEY = "installedAddonUrls";
const ADDON_DISPLAY_NAMES_KEY = "installedAddonDisplayNames";
const MANIFEST_SUFFIX = "/manifest.json";
const DEFAULT_ADDON_URLS = [
  "https://v3-cinemeta.strem.io",
  "https://opensubtitles-v3.strem.io"
];

class AddonRepository {

  constructor() {
    this.manifestCache = new Map();
    this.manifestErrorCache = new Map();
    this.manifestRequests = new Map();
    this.installedAddonsCache = null;
    this.installedAddonsCacheKey = "";
    this.installedAddonsPromise = null;
    this.installedAddonsPromiseKey = "";
    this.changeListeners = new Set();
  }

  canonicalizeUrl(url) {
    const trimmed = String(url || "").trim().replace(/\/+$/, "");
    const queryStart = trimmed.indexOf("?");
    const path = queryStart >= 0 ? trimmed.slice(0, queryStart) : trimmed;
    const query = queryStart >= 0 ? trimmed.slice(queryStart) : "";
    const cleanPath = path.toLowerCase().endsWith(MANIFEST_SUFFIX)
      ? path.slice(0, -MANIFEST_SUFFIX.length).replace(/\/+$/, "")
      : path.replace(/\/+$/, "");
    return `${cleanPath}${query}`;
  }

  buildManifestUrl(baseUrl) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath = queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/manifest.json${baseQuery}`;
  }

  normalizeManifestAssetUrl(value, baseUrl) {
    const raw = String(value || "").trim();
    if (!raw) {
      return null;
    }
    if (/^\/\//.test(raw)) {
      return `https:${raw}`;
    }
    if (/^(?:https?:|data:|blob:)/i.test(raw)) {
      return raw;
    }
    try {
      const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
      const queryStart = cleanBaseUrl.indexOf("?");
      const basePath = queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
      return new URL(raw, `${basePath}/`).href;
    } catch (_) {
      return raw;
    }
  }

  getInstalledAddonUrls() {
    const fromStorage = LocalStore.get(ADDON_URLS_KEY, null);
    if (Array.isArray(fromStorage)) {
      const normalized = Array.from(new Set(fromStorage.map((url) => this.canonicalizeUrl(url)).filter(Boolean)));
      if (JSON.stringify(normalized) !== JSON.stringify(fromStorage)) {
        LocalStore.set(ADDON_URLS_KEY, normalized);
      }
      return normalized;
    }

    LocalStore.set(ADDON_URLS_KEY, DEFAULT_ADDON_URLS);
    return [...DEFAULT_ADDON_URLS];
  }

  getAddonDisplayNameOverrides() {
    const stored = LocalStore.get(ADDON_DISPLAY_NAMES_KEY, {}) || {};
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return {};
    }
    return Object.entries(stored).reduce((accumulator, [url, name]) => {
      const cleanUrl = this.canonicalizeUrl(url);
      const cleanName = String(name || "").trim();
      if (cleanUrl && cleanName) {
        accumulator[cleanUrl] = cleanName;
      }
      return accumulator;
    }, {});
  }

  getAddonDisplayNameOverride(url) {
    const cleanUrl = this.canonicalizeUrl(url);
    return cleanUrl ? this.getAddonDisplayNameOverrides()[cleanUrl] || "" : "";
  }

  setAddonDisplayNameOverrides(entries = [], options = {}) {
    const replace = options?.replace !== false;
    const current = replace ? {} : this.getAddonDisplayNameOverrides();
    const next = { ...current };
    (entries || []).forEach((entry) => {
      const cleanUrl = this.canonicalizeUrl(entry?.url || entry?.baseUrl || entry?.base_url || "");
      if (!cleanUrl) {
        return;
      }
      const displayName = String(entry?.name || "").trim();
      if (displayName) {
        next[cleanUrl] = displayName;
      } else if (replace) {
        delete next[cleanUrl];
      }
    });
    const changed = JSON.stringify(this.getAddonDisplayNameOverrides()) !== JSON.stringify(next);
    if (changed) {
      LocalStore.set(ADDON_DISPLAY_NAMES_KEY, next);
      this.invalidateInstalledAddonsCache();
    }
    return changed;
  }

  withDisplayNameOverride(addon = {}) {
    const override = this.getAddonDisplayNameOverride(addon.baseUrl);
    return override && override !== addon.name ? { ...addon, displayName: override } : addon;
  }

  async fetchAddon(baseUrl, options = {}) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
    const manifestUrl = this.buildManifestUrl(cleanBaseUrl);
    const force = Boolean(options?.force);
    const preferCache = Boolean(options?.preferCache);

    if (!force && preferCache) {
      const cached = this.manifestCache.get(cleanBaseUrl);
      if (cached) {
        return { status: "success", data: this.withDisplayNameOverride(cached) };
      }
      const cachedError = this.manifestErrorCache.get(cleanBaseUrl);
      if (cachedError) {
        return cachedError;
      }
    }

    if (!force && this.manifestRequests.has(cleanBaseUrl)) {
      return this.manifestRequests.get(cleanBaseUrl);
    }

    const request = (async () => {
      const result = await safeApiCall(() => AddonApi.getManifest(manifestUrl));
      if (result.status === "success") {
        const addon = this.mapManifest(result.data, cleanBaseUrl);
        this.manifestCache.set(cleanBaseUrl, addon);
        this.manifestErrorCache.delete(cleanBaseUrl);
        return { status: "success", data: this.withDisplayNameOverride(addon) };
      }

      const cached = this.manifestCache.get(cleanBaseUrl);
      if (cached) {
        return { status: "success", data: this.withDisplayNameOverride(cached) };
      }

      const fallback = this.getBuiltinFallbackManifest(cleanBaseUrl);
      if (fallback) {
        this.manifestCache.set(cleanBaseUrl, fallback);
        this.manifestErrorCache.delete(cleanBaseUrl);
        return { status: "success", data: this.withDisplayNameOverride(fallback) };
      }

      this.manifestErrorCache.set(cleanBaseUrl, result);
      return result;
    })();

    this.manifestRequests.set(cleanBaseUrl, request);
    try {
      return await request;
    } finally {
      if (this.manifestRequests.get(cleanBaseUrl) === request) {
        this.manifestRequests.delete(cleanBaseUrl);
      }
    }
  }

  invalidateInstalledAddonsCache() {
    this.installedAddonsCache = null;
    this.installedAddonsCacheKey = "";
    this.installedAddonsPromise = null;
    this.installedAddonsPromiseKey = "";
  }

  getCachedInstalledAddons(urls = this.getInstalledAddonUrls()) {
    const normalizedUrls = Array.isArray(urls) ? urls : [];
    const addons = normalizedUrls
      .map((url) => this.manifestCache.get(this.canonicalizeUrl(url)))
      .filter(Boolean);
    return this.applyDisplayNames(addons);
  }

  async getInstalledAddons(options = {}) {
    const urls = this.getInstalledAddonUrls();
    const cacheKey = JSON.stringify(urls);
    const force = Boolean(options?.force);
    const cacheOnly = Boolean(options?.cacheOnly);
    if (!force && this.installedAddonsCache && this.installedAddonsCacheKey === cacheKey) {
      return [...this.installedAddonsCache];
    }

    if (cacheOnly) {
      return this.getCachedInstalledAddons(urls);
    }

    if (!force && this.installedAddonsPromise && this.installedAddonsPromiseKey === cacheKey) {
      return this.installedAddonsPromise;
    }

    const request = (async () => {
      const fetched = await Promise.all(urls.map((url) => this.fetchAddon(url, {
        force,
        preferCache: !force
      })));

      const addons = fetched
        .filter((result) => result.status === "success")
        .map((result) => result.data);

      const displayAddons = this.applyDisplayNames(addons);
      if (JSON.stringify(this.getInstalledAddonUrls()) === cacheKey) {
        this.installedAddonsCache = displayAddons;
        this.installedAddonsCacheKey = cacheKey;
      }
      return [...displayAddons];
    })();

    this.installedAddonsPromise = request;
    this.installedAddonsPromiseKey = cacheKey;
    try {
      return await request;
    } finally {
      if (this.installedAddonsPromise === request) {
        this.installedAddonsPromise = null;
        this.installedAddonsPromiseKey = "";
      }
    }
  }

  async addAddon(url) {
    const clean = this.canonicalizeUrl(url);
    if (!clean) {
      return;
    }

    const current = this.getInstalledAddonUrls();
    if (current.includes(clean)) {
      return false;
    }

    LocalStore.set(ADDON_URLS_KEY, [...current, clean]);
    this.manifestErrorCache.delete(clean);
    this.invalidateInstalledAddonsCache();
    this.notifyAddonsChanged("add");
    return true;
  }

  async removeAddon(url) {
    const clean = this.canonicalizeUrl(url);
    const current = this.getInstalledAddonUrls();
    const next = current.filter((value) => this.canonicalizeUrl(value) !== clean);
    if (next.length === current.length) {
      return false;
    }
    LocalStore.set(ADDON_URLS_KEY, next);
    this.manifestCache.delete(clean);
    this.manifestErrorCache.delete(clean);
    this.invalidateInstalledAddonsCache();
    this.notifyAddonsChanged("remove");
    return true;
  }

  async refreshAddon(url) {
    const clean = this.canonicalizeUrl(url);
    if (!clean) {
      return { status: "error", message: "Invalid addon URL" };
    }

    this.manifestCache.delete(clean);
    this.manifestErrorCache.delete(clean);
    this.invalidateInstalledAddonsCache();
    const result = await this.fetchAddon(clean, { force: true });
    if (result.status === "success") {
      this.notifyAddonsChanged("refresh");
    }
    return result;
  }

  async setAddonOrder(urls, options = {}) {
    const silent = Boolean(options?.silent);
    const normalized = (urls || []).map((url) => this.canonicalizeUrl(url)).filter(Boolean);
    const current = this.getInstalledAddonUrls();
    const changed = JSON.stringify(current) !== JSON.stringify(normalized);
    LocalStore.set(ADDON_URLS_KEY, normalized);
    if (changed) {
      const normalizedSet = new Set(normalized);
      current
        .filter((url) => !normalizedSet.has(url))
        .forEach((url) => {
          this.manifestCache.delete(url);
          this.manifestErrorCache.delete(url);
        });
      this.invalidateInstalledAddonsCache();
    }
    if (changed && !silent) {
      this.notifyAddonsChanged("reorder");
    }
    return changed;
  }

  onInstalledAddonsChanged(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  notifyAddonsChanged(reason = "unknown") {
    this.invalidateInstalledAddonsCache();
    this.changeListeners.forEach((listener) => {
      try {
        listener(reason);
      } catch (error) {
        console.warn("Addon change listener failed", error);
      }
    });
  }

  applyDisplayNames(addons) {
    const decoratedAddons = (addons || []).map((addon) => this.withDisplayNameOverride(addon));
    const unrenamed = decoratedAddons.filter((addon) => addon.displayName === addon.name);
    const nameCount = {};
    unrenamed.forEach((addon) => {
      nameCount[addon.name] = (nameCount[addon.name] || 0) + 1;
    });

    const counters = {};
    return decoratedAddons.map((addon) => {
      if (addon.displayName !== addon.name) {
        return addon;
      }
      if ((nameCount[addon.name] || 0) <= 1) {
        return addon;
      }

      counters[addon.name] = (counters[addon.name] || 0) + 1;
      const occurrence = counters[addon.name];
      return {
        ...addon,
        displayName: occurrence === 1 ? addon.name : `${addon.name} (${occurrence})`
      };
    });
  }

  mapManifest(manifest = {}, baseUrl) {
    const types = (manifest.types || []).map((value) => String(value).trim()).filter(Boolean);
    const catalogs = (manifest.catalogs || []).map((catalog) => ({
      id: catalog.id,
      name: catalog.name || catalog.id,
      apiType: (catalog.type || "").trim(),
      extra: Array.isArray(catalog.extra)
        ? catalog.extra.map((entry) => ({
          name: entry.name,
          isRequired: Boolean(entry.isRequired),
          options: Array.isArray(entry.options) ? entry.options : null
        }))
        : []
    }));

    return {
      id: manifest.id || baseUrl,
      name: manifest.name || "Unknown Addon",
      displayName: manifest.name || "Unknown Addon",
      version: manifest.version || "0.0.0",
      description: manifest.description || null,
      logo: this.normalizeManifestAssetUrl(manifest.logo, baseUrl),
      baseUrl,
      types,
      rawTypes: types,
      catalogs,
      resources: this.parseResources(manifest.resources || [], types)
    };
  }

  parseResources(resources, defaultTypes) {
    return resources.map((resource) => {
      if (typeof resource === "string") {
        return {
          name: resource,
          types: [...defaultTypes],
          idPrefixes: null
        };
      }

      if (resource && typeof resource === "object") {
        return {
          name: resource.name || "",
          types: Array.isArray(resource.types) ? resource.types : [...defaultTypes],
          idPrefixes: Array.isArray(resource.idPrefixes) ? resource.idPrefixes : null
        };
      }

      return null;
    }).filter(Boolean);
  }

  getBuiltinFallbackManifest(baseUrl) {
    if (this.canonicalizeUrl(baseUrl) !== "https://v3-cinemeta.strem.io") {
      return null;
    }

    return {
      id: "org.cinemeta",
      name: "Cinemeta",
      displayName: "Cinemeta",
      version: "fallback",
      description: "Fallback Cinemeta manifest",
      logo: null,
      baseUrl: "https://v3-cinemeta.strem.io",
      types: ["movie", "series"],
      rawTypes: ["movie", "series"],
      resources: [
        { name: "catalog", types: ["movie", "series"], idPrefixes: null },
        { name: "meta", types: ["movie", "series"], idPrefixes: null }
      ],
      catalogs: [
        { id: "top", name: "Top Movies", apiType: "movie", extra: [] },
        { id: "top", name: "Top Series", apiType: "series", extra: [] }
      ]
    };
  }

}

export const addonRepository = new AddonRepository();
