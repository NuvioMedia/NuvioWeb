import { safeApiCall } from "../../core/network/safeApiCall.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { AddonApi } from "../remote/api/addonApi.js";

const ADDON_URLS_KEY = "installedAddonUrls";
const DEFAULT_ADDON_URLS = [
  "https://v3-cinemeta.strem.io",
  "https://opensubtitles-v3.strem.io"
];

class AddonRepository {

  constructor() {
    this.manifestCache = new Map();
    this.changeListeners = new Set();
  }

  canonicalizeUrl(url) {
    const trimmed = String(url || "").trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/manifest.json")) {
      return trimmed.slice(0, -"/manifest.json".length);
    }
    return trimmed;
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

  async fetchAddon(baseUrl) {
    const cleanBaseUrl = this.canonicalizeUrl(baseUrl);

    const result = await safeApiCall(() => AddonApi.getManifest(cleanBaseUrl));
    if (result.status === "success") {
      const addon = this.mapManifest(result.data, cleanBaseUrl);
      this.manifestCache.set(cleanBaseUrl, addon);
      return { status: "success", data: addon };
    }

    const cached = this.manifestCache.get(cleanBaseUrl);
    if (cached) {
      return { status: "success", data: cached };
    }

    const fallback = this.getBuiltinFallbackManifest(cleanBaseUrl);
    if (fallback) {
      this.manifestCache.set(cleanBaseUrl, fallback);
      return { status: "success", data: fallback };
    }

    return result;
  }

  async getInstalledAddons() {
    const urls = this.getInstalledAddonUrls();
    const fetched = await Promise.all(urls.map((url) => this.fetchAddon(url)));

    const addons = fetched
      .filter((result) => result.status === "success")
      .map((result) => result.data);

    return this.applyDisplayNames(addons);
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
    this.notifyAddonsChanged("remove");
    return true;
  }

  async setAddonOrder(urls, options = {}) {
    const silent = Boolean(options?.silent);
    const normalized = (urls || []).map((url) => this.canonicalizeUrl(url)).filter(Boolean);
    const current = this.getInstalledAddonUrls();
    const changed = JSON.stringify(current) !== JSON.stringify(normalized);
    LocalStore.set(ADDON_URLS_KEY, normalized);
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
    this.changeListeners.forEach((listener) => {
      try {
        listener(reason);
      } catch (error) {
        console.warn("Addon change listener failed", error);
      }
    });
  }

  applyDisplayNames(addons) {
    const nameCount = {};
    addons.forEach((addon) => {
      nameCount[addon.name] = (nameCount[addon.name] || 0) + 1;
    });

    const counters = {};
    return addons.map((addon) => {
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
      logo: manifest.logo || null,
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
