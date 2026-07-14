import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { MetaApi } from "../remote/api/metaApi.js";

function normalizeDisplayText(value) {
  return String(value ?? "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
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

      // Prefer addons whose explicit idPrefixes identify them as the owner.
      // This also safely recovers `tv` when a secondary catalog forwarded a
      // broader row type such as `channel`.
      addons.forEach((addon) => {
        const hasMatchingPrefix = (addon?.resources || []).some((resource) => {
          if (String(resource?.name || "").toLowerCase() !== "meta") {
            return false;
          }
          return (
            addonRepository.getResourceIdPrefixes(addon, resource).length > 0 &&
            addonRepository.resourceSupportsId(addon, resource, id, {
              caseInsensitive: true
            })
          );
        });
        if (!hasMatchingPrefix) {
          return;
        }
        const ownerType = addonRepository.resolveResourceRequestType(
          addon,
          "meta",
          requestedType,
          id,
          { allowIdTypeFallback: true, caseInsensitive: true }
        );
        if (ownerType) {
          addCandidate(addon, ownerType);
        }
      });

      addons.forEach((addon) => {
        const candidateType = addonRepository.resolveResourceRequestType(
          addon,
          "meta",
          requestedType,
          id,
          { caseInsensitive: true }
        );
        if (candidateType) {
          addCandidate(addon, candidateType);
        }
      });
      if (inferredType.toLowerCase() !== requestedType.toLowerCase()) {
        addons.forEach((addon) => {
          const candidateType = addonRepository.resolveResourceRequestType(
            addon,
            "meta",
            inferredType,
            id,
            { caseInsensitive: true }
          );
          if (candidateType) {
            addCandidate(addon, candidateType);
          }
        });
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
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/meta/${this.encode(type)}/${this.encode(id)}.json${baseQuery}`;
  }

  inferCanonicalType(type, id) {
    const normalizedType = String(type || "").trim();
    const lowerType = normalizedType.toLowerCase();
    const known = new Set(["movie", "series", "channel", "tv", "anime"]);
    if (known.has(lowerType)) {
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
      genres: Array.isArray(meta.genres)
        ? meta.genres.map((genre) => normalizeDisplayText(genre))
        : [],
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
