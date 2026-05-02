import { INTRODB_API_URL } from "../../config.js";

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

function toSkipInterval(segment, type) {
  if (!segment || typeof segment !== "object") {
    return null;
  }
  const start = Number.isFinite(Number(segment.start_sec))
    ? Number(segment.start_sec)
    : (Number.isFinite(Number(segment.start_ms)) ? Number(segment.start_ms) / 1000 : NaN);
  const end = Number.isFinite(Number(segment.end_sec))
    ? Number(segment.end_sec)
    : (Number.isFinite(Number(segment.end_ms)) ? Number(segment.end_ms) / 1000 : NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    startTime: start,
    endTime: end,
    type,
    provider: "introdb"
  };
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

export const skipIntroRepository = {

  async getSkipIntervals(imdbId, season, episode) {
    const baseUrl = normalizeBaseUrl(INTRODB_API_URL);
    const normalizedImdbId = normalizeImdbId(imdbId);
    const seasonNumber = Number(season || 0);
    const episodeNumber = Number(episode || 0);
    if (!baseUrl || !normalizedImdbId || seasonNumber <= 0 || episodeNumber <= 0) {
      return [];
    }

    const cacheKey = `${normalizedImdbId}:${seasonNumber}:${episodeNumber}`;
    if (CACHE.has(cacheKey)) {
      return CACHE.get(cacheKey);
    }

    const url = new URL("segments", baseUrl);
    url.searchParams.set("imdb_id", normalizedImdbId);
    url.searchParams.set("season", String(seasonNumber));
    url.searchParams.set("episode", String(episodeNumber));

    const data = await fetchJson(url.toString());
    const intervals = [
      toSkipInterval(data?.intro, "intro"),
      toSkipInterval(data?.recap, "recap"),
      toSkipInterval(data?.outro, "outro")
    ].filter(Boolean).sort((left, right) => left.startTime - right.startTime);

    CACHE.set(cacheKey, intervals);
    return intervals;
  }

};
