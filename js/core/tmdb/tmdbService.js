import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

export const TmdbService = {
  async ensureTmdbId(id, type = "movie", options = {}) {
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = String(TMDB_API_KEY || "").trim();
    if ((requireEnabled && !settings.enabled) || !apiKey) {
      return null;
    }

    const rawId = String(id || "").trim();
    if (!rawId) {
      return null;
    }

    const idPart = rawId
      .replace(/^tmdb:/i, "")
      .replace(/^movie:/i, "")
      .replace(/^series:/i, "")
      .trim();
    const normalizedIdPart = idPart.split(":")[0]?.split("/")[0]?.trim() || "";

    if (/^\d+$/.test(normalizedIdPart)) {
      return normalizedIdPart;
    }

    if (!normalizedIdPart.startsWith("tt")) {
      return null;
    }

    const contentType = getContentType(type);
    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(normalizedIdPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const list = contentType === "tv" ? data.tv_results : data.movie_results;
    const first = Array.isArray(list) ? list[0] : null;
    if (!first?.id) {
      return null;
    }

    return String(first.id);
  },

  async tmdbToImdb(tmdbId, type = "movie") {
    const apiKey = String(TMDB_API_KEY || "").trim();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return null;
    }

    const contentType = getContentType(type);
    const url = `${TMDB_BASE_URL}/${contentType}/${encodeURIComponent(numericId)}/external_ids?api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const imdbId = String(data?.imdb_id || "").trim();
    return /^tt\d+$/i.test(imdbId) ? imdbId : null;
  }
};
