import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

export const TmdbService = {

  async ensureTmdbId(id, type = "movie") {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey) {
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
  }

};
