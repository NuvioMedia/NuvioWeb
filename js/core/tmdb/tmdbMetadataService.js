import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { TMDB_API_KEY } from "../../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/original";
const TMDB_TRAILER_FALLBACK_LANGUAGE = "en-US";

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

function normalizeTmdbTrailerLanguage(language = "") {
  const normalized = String(language || "").trim().replace(/_/g, "-");
  if (!normalized) {
    return TMDB_TRAILER_FALLBACK_LANGUAGE;
  }
  if (normalized.includes("-")) {
    const [locale, region] = normalized.split("-", 2);
    return region ? `${locale.toLowerCase()}-${region.toUpperCase()}` : locale.toLowerCase();
  }
  if (normalized.toLowerCase() === "en") {
    return TMDB_TRAILER_FALLBACK_LANGUAGE;
  }
  return normalized.toLowerCase();
}

function videoTypePriority(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "trailer") return 0;
  if (normalized === "teaser") return 1;
  return 2;
}

function parsePublishedAtEpoch(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function rankTmdbVideoCandidates(results = []) {
  return (Array.isArray(results) ? results : [])
    .filter((entry) => String(entry?.site || "").toLowerCase() === "youtube")
    .filter((entry) => Boolean(String(entry?.key || "").trim()))
    .filter((entry) => {
      const normalizedType = String(entry?.type || "").trim().toLowerCase();
      return normalizedType === "trailer" || normalizedType === "teaser";
    })
    .sort((left, right) => {
      const typeDiff = videoTypePriority(left?.type) - videoTypePriority(right?.type);
      if (typeDiff !== 0) return typeDiff;
      const officialDiff = Number(Boolean(right?.official)) - Number(Boolean(left?.official));
      if (officialDiff !== 0) return officialDiff;
      const sizeDiff = Number(right?.size || 0) - Number(left?.size || 0);
      if (sizeDiff !== 0) return sizeDiff;
      return parsePublishedAtEpoch(right?.published_at) - parsePublishedAtEpoch(left?.published_at);
    });
}

async function fetchTmdbVideos({ type, tmdbId, apiKey, language }) {
  const url = `${TMDB_BASE_URL}/${type}/${encodeURIComponent(String(tmdbId))}/videos?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function resolveTrailerCandidates({ type, tmdbId, apiKey, language, initialResults = [] }) {
  const preferredLanguage = normalizeTmdbTrailerLanguage(language);
  const preferred = rankTmdbVideoCandidates(initialResults);
  if (preferred.length || preferredLanguage === TMDB_TRAILER_FALLBACK_LANGUAGE) {
    return preferred;
  }
  const fallback = await fetchTmdbVideos({
    type,
    tmdbId,
    apiKey,
    language: TMDB_TRAILER_FALLBACK_LANGUAGE
  });
  return rankTmdbVideoCandidates(fallback);
}

function mapTrailerCandidates(items = []) {
  return (Array.isArray(items) ? items : []).map((entry) => {
    const key = String(entry?.key || "").trim();
    return {
      ytId: key,
      youtubeId: key,
      source: key ? `https://www.youtube.com/watch?v=${key}` : "",
      type: entry?.type || "Trailer",
      name: entry?.name || "Trailer",
      official: Boolean(entry?.official),
      publishedAt: entry?.published_at || "",
      size: Number(entry?.size || 0) || 0
    };
  }).filter((entry) => entry.ytId);
}

function mapCompanies(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((company) => ({
      name: company?.name || "",
      logo: toImageUrl(company?.logo_path || company?.logo || null)
    }))
    .filter((company) => company.name || company.logo);
}

export const TmdbMetadataService = {

  async fetchEnrichment({ tmdbId, contentType, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !tmdbId) {
      return null;
    }

    const type = resolveType(contentType);
    const lang = language || settings.language || "en-US";
    const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,credits,release_dates,content_ratings,videos&include_image_language=${encodeURIComponent(lang)},null`;
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
    const companies = mapCompanies(data?.production_companies);
    const networks = mapCompanies(data?.networks);
    const spokenLanguage = Array.isArray(data?.spoken_languages) ? data.spoken_languages[0] : null;
    const countryValue = Array.isArray(data?.origin_country) && data.origin_country.length
      ? data.origin_country.join(", ")
      : (Array.isArray(data?.production_countries) ? data.production_countries.map((item) => item?.iso_3166_1 || item?.name || "").filter(Boolean).join(", ") : "");
    const runtimeValue = type === "tv"
      ? Number((Array.isArray(data?.episode_run_time) ? data.episode_run_time[0] : 0) || 0)
      : Number(data?.runtime || 0);
    const trailerCandidates = await resolveTrailerCandidates({
      type,
      tmdbId,
      apiKey,
      language: lang,
      initialResults: Array.isArray(data?.videos?.results) ? data.videos.results : []
    });
    const trailers = mapTrailerCandidates(trailerCandidates);

    return {
      localizedTitle: data.title || data.name || null,
      description: data.overview || null,
      backdrop: toImageUrl(data.backdrop_path),
      poster: toImageUrl(data.poster_path),
      logo: toImageUrl(logoPath),
      genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).filter(Boolean) : [],
      rating: typeof data.vote_average === "number" ? data.vote_average : null,
      releaseInfo: releaseYear || null,
      runtime: Number.isFinite(runtimeValue) && runtimeValue > 0 ? `${runtimeValue} min` : null,
      country: countryValue || null,
      language: spokenLanguage?.iso_639_1 || spokenLanguage?.english_name || null,
      credits: data.credits || null,
      companies,
      productionCompanies: companies,
      networks,
      trailers,
      trailerYtIds: trailers.map((entry) => entry.ytId).filter(Boolean),
      collectionId: data?.belongs_to_collection?.id ? String(data.belongs_to_collection.id) : null,
      collectionName: data?.belongs_to_collection?.name || null
    };
  },

  async fetchSeasonRatings({ tmdbId, seasonNumber, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || TMDB_API_KEY || "").trim();
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
  },

  async fetchMovieCollection({ collectionId, language = null } = {}) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || TMDB_API_KEY || "").trim();
    if (!settings.enabled || !apiKey || !collectionId) {
      return [];
    }

    const lang = language || settings.language || "en-US";
    const url = `${TMDB_BASE_URL}/collection/${encodeURIComponent(String(collectionId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (Array.isArray(data?.parts) ? data.parts : []).map((item) => ({
      id: item?.id ? String(item.id) : "",
      type: "movie",
      name: item?.title || item?.name || "Untitled",
      poster: toImageUrl(item?.poster_path || null),
      background: toImageUrl(item?.backdrop_path || null),
      landscapePoster: toImageUrl(item?.backdrop_path || null),
      releaseInfo: String(item?.release_date || "").slice(0, 4) || ""
    })).filter((item) => item.id);
  }

};
