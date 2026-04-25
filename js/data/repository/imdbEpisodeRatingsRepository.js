import { IMDB_RATINGS_API_BASE_URL } from "../../config.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE = new Map();

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

async function fetchJson(url, timeoutMs = 4500) {
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

function mapRatingsPayload(payload = []) {
  const seasons = {};
  (Array.isArray(payload) ? payload : []).forEach((seasonEntry) => {
    const episodes = Array.isArray(seasonEntry?.episodes) ? seasonEntry.episodes : [];
    episodes.forEach((episodeEntry) => {
      const seasonNumber = Number(episodeEntry?.season_number || 0);
      const episodeNumber = Number(episodeEntry?.episode_number || 0);
      const ratingValue = Number(episodeEntry?.vote_average);
      if (seasonNumber <= 0 || episodeNumber <= 0 || !Number.isFinite(ratingValue)) {
        return;
      }
      if (!Array.isArray(seasons[seasonNumber])) {
        seasons[seasonNumber] = [];
      }
      seasons[seasonNumber].push({
        episode: episodeNumber,
        rating: Number(ratingValue.toFixed(1))
      });
    });
  });

  Object.keys(seasons).forEach((seasonNumber) => {
    seasons[seasonNumber] = seasons[seasonNumber].sort((left, right) => left.episode - right.episode);
  });
  return seasons;
}

export const imdbEpisodeRatingsRepository = {

  async getSeasonRatingsByTmdbId(tmdbId) {
    const normalizedBaseUrl = normalizeBaseUrl(IMDB_RATINGS_API_BASE_URL);
    const normalizedTmdbId = Number(tmdbId || 0);
    if (!normalizedBaseUrl || normalizedTmdbId <= 0) {
      return {};
    }

    const cacheKey = String(normalizedTmdbId);
    const now = Date.now();
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const url = `${normalizedBaseUrl}api/shows/${encodeURIComponent(String(normalizedTmdbId))}/season-ratings`;
    const payload = await fetchJson(url);
    const mapped = payload ? mapRatingsPayload(payload) : {};
    CACHE.set(cacheKey, {
      value: mapped,
      expiresAt: now + CACHE_TTL_MS
    });
    return mapped;
  }

};
