import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { MetaApi } from "../remote/api/metaApi.js";

function normalizeDisplayText(value) {
  return String(value ?? "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, "\"");
}

class MetaRepository {

  constructor() {
    this.metaCache = new Map();
    this.inFlightMeta = new Map();
    this.inFlightMetaAll = new Map();
  }

  async getMeta(addonBaseUrl, type, id) {
    const normalizedType = String(type || "").trim();
    const normalizedId = String(id || "").trim();
    const cacheKey = `${addonRepository.canonicalizeUrl(addonBaseUrl)}:${normalizedType}:${normalizedId}`;
    if (this.metaCache.has(cacheKey)) {
      return { status: "success", data: this.metaCache.get(cacheKey) };
    }

    if (this.inFlightMeta.has(cacheKey)) {
      return this.inFlightMeta.get(cacheKey);
    }

    const request = (async () => {
      const url = this.buildMetaUrl(addonBaseUrl, normalizedType, normalizedId);
      const result = await safeApiCall(() => MetaApi.getMeta(url));
      if (result.status !== "success") {
        return result;
      }

      const meta = this.mapMeta(result.data?.meta || null);
      if (!meta) {
        return { status: "error", message: "Meta not found", code: 404 };
      }

      this.metaCache.set(cacheKey, meta);
      return { status: "success", data: meta };
    })();

    this.inFlightMeta.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlightMeta.delete(cacheKey);
    }
  }

  async getMetaFromAllAddons(type, id) {
    const requestedType = String(type || "").trim();
    const inferredType = this.inferCanonicalType(requestedType, id);
    const cacheKey = `all:${requestedType}:${inferredType}:${String(id || "").trim()}`;
    if (this.metaCache.has(cacheKey)) {
      return { status: "success", data: this.metaCache.get(cacheKey) };
    }

    if (this.inFlightMetaAll.has(cacheKey)) {
      return this.inFlightMetaAll.get(cacheKey);
    }

    const request = (async () => {
      const addons = await addonRepository.getInstalledAddons();
      const metaAddons = addons.filter((addon) => (addon.resources || []).some((resource) => resource?.name === "meta"));
      const candidates = [];
      const seenCandidates = new Set();
      const addCandidate = (addon, candidateType) => {
        const cleanType = String(candidateType || "").trim();
        if (!addon || !cleanType) {
          return;
        }
        const key = `${addon.baseUrl}::${cleanType}`;
        if (seenCandidates.has(key)) {
          return;
        }
        seenCandidates.add(key);
        candidates.push({ addon, type: cleanType });
      };

      addons.forEach((addon) => {
        if (this.supportsMetaType(addon, requestedType)) {
          addCandidate(addon, requestedType);
        }
      });
      if (inferredType.toLowerCase() !== requestedType.toLowerCase()) {
        addons.forEach((addon) => {
          if (this.supportsMetaType(addon, inferredType)) {
            addCandidate(addon, inferredType);
          }
        });
      }
      const topMetaAddon = metaAddons[0];
      if (topMetaAddon) {
        const fallbackType = this.supportsMetaType(topMetaAddon, requestedType)
          ? requestedType
          : this.supportsMetaType(topMetaAddon, inferredType)
            ? inferredType
            : (inferredType || requestedType);
        addCandidate(topMetaAddon, fallbackType);
      }

      for (const { addon, type: candidateType } of candidates) {
        const result = await this.getMeta(addon.baseUrl, candidateType, id);
        if (result.status === "success") {
          this.metaCache.set(cacheKey, result.data);
          return result;
        }
      }

      return { status: "error", message: "Meta not found in installed addons", code: 404 };
    })();

    this.inFlightMetaAll.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlightMetaAll.delete(cacheKey);
    }
  }

  buildMetaUrl(baseUrl, type, id) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath = queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/meta/${this.encode(type)}/${this.encode(id)}.json${baseQuery}`;
  }

  supportsMetaType(addon, type) {
    const targetType = String(type || "").trim().toLowerCase();
    if (!targetType) {
      return false;
    }
    return (addon?.resources || []).some((resource) => {
      if (resource?.name !== "meta") {
        return false;
      }
      const types = Array.isArray(resource.types)
        ? resource.types.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : [];
      return !types.length || types.includes(targetType);
    });
  }

  inferCanonicalType(type, id) {
    const normalizedType = String(type || "").trim();
    const known = new Set(["movie", "series", "tv", "channel", "anime"]);
    if (known.has(normalizedType.toLowerCase())) {
      return normalizedType;
    }
    const normalizedId = String(id || "").toLowerCase();
    if (normalizedId.includes(":movie:")) return "movie";
    if (normalizedId.includes(":series:")) return "series";
    if (normalizedId.includes(":tv:")) return "tv";
    if (normalizedId.includes(":anime:")) return "anime";
    return normalizedType;
  }

  encode(value) {
    return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
  }

  mapMeta(meta) {
    if (!meta) {
      return null;
    }

    return {
      ...meta,
      id: meta.id || "",
      type: meta.type || "",
      name: normalizeDisplayText(meta.name || "Untitled"),
      poster: meta.poster || null,
      background: meta.background || null,
      logo: meta.logo || null,
      description: normalizeDisplayText(meta.description || ""),
      genres: Array.isArray(meta.genres) ? meta.genres.map((genre) => normalizeDisplayText(genre)) : [],
      videos: Array.isArray(meta.videos) ? meta.videos : [],
      releaseInfo: normalizeDisplayText(meta.releaseInfo || "")
    };
  }

  clearCache() {
    this.metaCache.clear();
    this.inFlightMeta.clear();
    this.inFlightMetaAll.clear();
  }

}

export const metaRepository = new MetaRepository();
