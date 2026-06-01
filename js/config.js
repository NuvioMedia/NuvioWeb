const runtimeEnv = globalThis.__NUVIO_ENV__ || {};

function normalizePlaybackOrder(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

export const SUPABASE_URL = String(runtimeEnv.SUPABASE_URL || "").trim();
export const SUPABASE_ANON_KEY = String(runtimeEnv.SUPABASE_ANON_KEY || "").trim();
export const TV_LOGIN_REDIRECT_BASE_URL = String(runtimeEnv.TV_LOGIN_REDIRECT_BASE_URL || "").trim();
export const PUBLIC_APP_URL = String(runtimeEnv.PUBLIC_APP_URL || "").trim();
export const YOUTUBE_PROXY_URL = String(runtimeEnv.YOUTUBE_PROXY_URL || "").trim();
export const PARENTAL_GUIDE_API_URL = String(runtimeEnv.PARENTAL_GUIDE_API_URL || "").trim();
export const INTRODB_API_URL = String(runtimeEnv.INTRODB_API_URL || "").trim();
export const IMDB_RATINGS_API_BASE_URL = String(runtimeEnv.IMDB_RATINGS_API_BASE_URL || "").trim();
export const AVATAR_PUBLIC_BASE_URL = String(runtimeEnv.AVATAR_PUBLIC_BASE_URL || "").trim();
export const CONTRIBUTIONS_URL = String(runtimeEnv.CONTRIBUTIONS_URL || "").trim();
export const DONATIONS_BASE_URL = String(runtimeEnv.DONATIONS_BASE_URL || "").trim();
export const DONATIONS_DONATE_URL = String(runtimeEnv.DONATIONS_DONATE_URL || "").trim();
export const ADDON_REMOTE_BASE_URL = String(runtimeEnv.ADDON_REMOTE_BASE_URL || "").trim();
export const WEBOS_SERVICE_ID = String(runtimeEnv.WEBOS_SERVICE_ID || "").trim();
export const ENABLE_REMOTE_WRAPPER_MODE = Boolean(runtimeEnv.ENABLE_REMOTE_WRAPPER_MODE);
export const PREFERRED_PLAYBACK_ORDER = normalizePlaybackOrder(runtimeEnv.PREFERRED_PLAYBACK_ORDER);
export const TMDB_API_KEY = String(runtimeEnv.TMDB_API_KEY || "").trim();
export const TRAKT_CLIENT_ID = String(runtimeEnv.TRAKT_CLIENT_ID || "").trim();
export const TRAKT_CLIENT_SECRET = String(runtimeEnv.TRAKT_CLIENT_SECRET || "").trim();
export const TRAKT_API_URL = String(runtimeEnv.TRAKT_API_URL || "https://api.trakt.tv").trim();
export const TRAKT_REDIRECT_URI = String(runtimeEnv.TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob").trim();
