import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { SubtitleApi } from "../remote/api/subtitleApi.js";

const PER_ADDON_TIMEOUT_MS = 8000;

class SubtitleRepository {

  async getSubtitles(type, id, videoId = null, options = {}) {
    const normalizedType = this.canonicalSubtitleType(type);
    const rawId = String(id || "").trim();
    const normalizedId = this.normalizeIdForLookup(rawId);
    const idCandidates = this.uniqueNonEmpty([normalizedId, rawId]);
    const addons = await addonRepository.getInstalledAddons();

    const subtitleAddons = addons.filter((addon) => (addon.resources || []).some((resource) => {
      if (!this.isSubtitleResource(resource?.name)) {
        return false;
      }
      return this.supportsType(resource, normalizedType, normalizedId);
    }));

    const allResults = await Promise.all(subtitleAddons.map((addon) =>
      this.fetchSubtitlesFromAddon(addon, normalizedType, idCandidates, videoId, options)
    ));

    const mergedResults = [];
    allResults.forEach((items) => {
      if (Array.isArray(items) && items.length) {
        mergedResults.push(...items);
      }
    });
    return mergedResults;
  }

  async fetchSubtitlesFromAddon(addon, type, idCandidates = [], videoId, options = {}) {
    const candidateIds = this.buildActualIdCandidates(type, idCandidates, videoId);
    if (!candidateIds.length) {
      return [];
    }

    const merged = [];
    const seen = new Set();
    for (const actualId of candidateIds) {
      const url = this.buildSubtitlesUrl(addon.baseUrl, type, actualId, options);
      const result = await this.withTimeout(
        safeApiCall(() => SubtitleApi.getSubtitles(url)),
        PER_ADDON_TIMEOUT_MS
      );
      if (!result || result.status !== "success") {
        continue;
      }

      const subtitles = (result.data?.subtitles || []).map((subtitle) => ({
        id: subtitle.id || `${subtitle.lang || "unk"}-${this.makeDeterministicId(subtitle.url || "")}`,
        url: subtitle.url,
        lang: subtitle.lang || "unknown",
        addonName: addon.displayName,
        addonLogo: addon.logo
      })).filter((subtitle) => Boolean(subtitle.url));

      subtitles.forEach((subtitle) => {
        const key = `${subtitle.url}::${String(subtitle.lang || "").toLowerCase()}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push(subtitle);
      });

    }

    return merged;
  }

  isSubtitleResource(name) {
    const resourceName = String(name || "").toLowerCase();
    return resourceName === "subtitles" || resourceName === "subtitle";
  }

  canonicalSubtitleType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "tv" ? "series" : normalized;
  }

  supportsType(resource, type, id) {
    const supportedTypes = Array.isArray(resource?.types)
      ? resource.types.map((value) => String(value || "").toLowerCase()).filter(Boolean)
      : [];
    const compatibleTypes = this.compatibleTypes(type);
    if (supportedTypes.length > 0 && !compatibleTypes.some((candidateType) => supportedTypes.includes(candidateType))) {
      return false;
    }

    const idPrefixes = Array.isArray(resource?.idPrefixes)
      ? resource.idPrefixes.map((value) => String(value || "")).filter(Boolean)
      : [];
    if (!idPrefixes.length) {
      return true;
    }
    return idPrefixes.some((prefix) => String(id || "").startsWith(prefix));
  }

  normalizeIdForLookup(id) {
    const raw = String(id || "").trim();
    if (!raw) {
      return "";
    }
    return String(raw.split(":")[0] || "").trim() || raw;
  }

  compatibleTypes(type) {
    const normalized = this.canonicalSubtitleType(type);
    if (normalized === "series" || normalized === "tv") {
      return ["series", "tv"];
    }
    return [normalized];
  }

  uniqueNonEmpty(values = []) {
    const unique = [];
    const seen = new Set();
    (values || []).forEach((value) => {
      const normalized = String(value || "").trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      unique.push(normalized);
    });
    return unique;
  }

  buildActualIdCandidates(type, ids = [], videoId = null) {
    const candidates = [];
    const push = (value) => {
      const normalized = String(value || "").trim();
      if (!normalized || candidates.includes(normalized)) {
        return;
      }
      candidates.push(normalized);
    };

    if (String(type || "").toLowerCase() === "series") {
      push(videoId);
    }
    (ids || []).forEach(push);
    return candidates;
  }

  async withTimeout(promise, timeoutMs) {
    let timeoutId = null;
    try {
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ status: "timeout" });
        }, Math.max(500, Number(timeoutMs || 0)));
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  buildSubtitlesUrl(baseUrl, type, id, options = {}) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath = queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    const extraParams = this.buildExtraParams(options);
    const suffix = extraParams ? `/${extraParams}` : "";
    return `${basePath}/subtitles/${this.encode(type)}/${this.encodeSubtitleId(id)}${suffix}.json${baseQuery}`;
  }

  encode(value) {
    return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
  }

  encodeSubtitleId(value) {
    return encodeURIComponent(String(value || ""))
      .replace(/\+/g, "%20")
      .replace(/%3A/gi, ":");
  }

  makeDeterministicId(value) {
    let hash = 0;
    const str = String(value || "");
    for (let index = 0; index < str.length; index += 1) {
      hash = ((hash << 5) - hash) + str.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  buildExtraParams(options = {}) {
    const params = [];
    const push = (key, value) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) {
        return;
      }
      params.push(`${key}=${encodeURIComponent(normalized).replace(/\+/g, "%20")}`);
    };
    push("videoHash", options.videoHash);
    const videoSize = Number(options.videoSize || 0);
    if (Number.isFinite(videoSize) && videoSize > 0) {
      push("videoSize", Math.trunc(videoSize));
    }
    push("filename", options.filename);
    return params.join("&");
  }

}

export const subtitleRepository = new SubtitleRepository();
