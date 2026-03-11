import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/original";
const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

function resolveType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

function toImageUrl(path) {
  if (!path) {
    return null;
  }
  return `${IMAGE_BASE_URL}${path}`;
}

export const TmdbMetadataService = {

  async fetchEnrichment({ tmdbId, contentType, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !tmdbId) {
      return null;
    }

    const type = resolveType(contentType);
    const lang = language || settings.language || "en-US";
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,credits&include_image_language=${encodeURIComponent(lang)},null`;
    const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const logoPath = Array.isArray(data?.images?.logos) ? data.images.logos[0]?.file_path : null;
    const releaseYear = type === "tv"
      ? String(data.first_air_date || "").slice(0, 4)
      : String(data.release_date || "").slice(0, 4);
    const companies = Array.isArray(data?.production_companies)
      ? data.production_companies.map((company) => ({
        name: company?.name || "",
        logo: toImageUrl(company?.logo_path || null)
      })).filter((company) => company.name || company.logo)
      : [];

    return {
      localizedTitle: data.title || data.name || null,
      description: data.overview || null,
      backdrop: toImageUrl(data.backdrop_path),
      poster: toImageUrl(data.poster_path),
      logo: toImageUrl(logoPath),
      genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).filter(Boolean) : [],
      rating: typeof data.vote_average === "number" ? data.vote_average : null,
      releaseInfo: releaseYear || null,
      credits: data.credits || null,
      companies
    };
  },

  async fetchSeasonRatings({ tmdbId, seasonNumber, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !tmdbId || !Number.isFinite(Number(seasonNumber))) {
      return [];
    }

    const lang = language || settings.language || "en-US";
    const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    return episodes.map((episode) => ({
      episode: Number(episode?.episode_number || 0),
      rating: typeof episode?.vote_average === "number" ? Number(episode.vote_average.toFixed(1)) : null
    })).filter((item) => item.episode > 0);
  }

};
