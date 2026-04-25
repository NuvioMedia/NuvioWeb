import { PARENTAL_GUIDE_API_URL } from "../../config.js";

const CACHE = new Map();

function normalizeImdbId(value = "") {
  const candidate = String(value || "").trim().split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

async function fetchJson(url, timeoutMs = 3500) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller?.signal
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const parentalGuideRepository = {

  async getMovieGuide(imdbId) {
    const baseUrl = normalizeBaseUrl(PARENTAL_GUIDE_API_URL);
    const normalizedImdbId = normalizeImdbId(imdbId);
    if (!baseUrl || !normalizedImdbId) {
      return null;
    }
    const cacheKey = `movie:${normalizedImdbId}`;
    if (CACHE.has(cacheKey)) {
      return CACHE.get(cacheKey);
    }
    const result = await fetchJson(`${baseUrl}movie/${encodeURIComponent(normalizedImdbId)}`);
    const payload = result?.hasData && result?.parentalGuide ? result : null;
    CACHE.set(cacheKey, payload);
    return payload;
  },

  async getTvGuide(imdbId, season, episode) {
    const baseUrl = normalizeBaseUrl(PARENTAL_GUIDE_API_URL);
    const normalizedImdbId = normalizeImdbId(imdbId);
    const seasonNumber = Number(season || 0);
    const episodeNumber = Number(episode || 0);
    if (!baseUrl || !normalizedImdbId || seasonNumber <= 0 || episodeNumber <= 0) {
      return null;
    }
    const cacheKey = `tv:${normalizedImdbId}:${seasonNumber}:${episodeNumber}`;
    if (CACHE.has(cacheKey)) {
      return CACHE.get(cacheKey);
    }
    const result = await fetchJson(`${baseUrl}tv/${encodeURIComponent(normalizedImdbId)}/${seasonNumber}/${episodeNumber}`);
    const payload = result?.hasData && result?.parentalGuide ? result : null;
    CACHE.set(cacheKey, payload);
    return payload;
  }

};
