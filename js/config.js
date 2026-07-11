const runtimeEnv = globalThis.__NUVIO_ENV__ || {};

export const SUPABASE_URL = String(runtimeEnv.SUPABASE_URL || "").trim();
export const SUPABASE_ANON_KEY = String(runtimeEnv.SUPABASE_ANON_KEY || "").trim();
export const TV_LOGIN_REDIRECT_BASE_URL = String(
  runtimeEnv.TV_LOGIN_REDIRECT_BASE_URL || ""
).trim();
export const YOUTUBE_PROXY_URL = String(
  runtimeEnv.YOUTUBE_PROXY_URL || "youtube-proxy.html"
).trim();
export const PARENTAL_GUIDE_API_URL = String(runtimeEnv.PARENTAL_GUIDE_API_URL || "").trim();
export const INTRODB_API_URL = String(
  runtimeEnv.INTRODB_API_URL || "https://api.introdb.app/"
).trim();
export const IMDB_RATINGS_API_BASE_URL = String(runtimeEnv.IMDB_RATINGS_API_BASE_URL || "").trim();
export const MDBLIST_API_BASE_URL = String(
  runtimeEnv.MDBLIST_API_BASE_URL || "https://api.mdblist.com/"
).trim();
export const AVATAR_PUBLIC_BASE_URL = String(runtimeEnv.AVATAR_PUBLIC_BASE_URL || "").trim();
export const DONATIONS_BASE_URL = String(runtimeEnv.DONATIONS_BASE_URL || "").trim();
export const DONATIONS_DONATE_URL = String(runtimeEnv.DONATIONS_DONATE_URL || "").trim();
export const TMDB_API_KEY = String(runtimeEnv.TMDB_API_KEY || "").trim();
export const TRAKT_CLIENT_ID = String(runtimeEnv.TRAKT_CLIENT_ID || "").trim();
export const TRAKT_CLIENT_SECRET = String(runtimeEnv.TRAKT_CLIENT_SECRET || "").trim();
export const TRAKT_API_URL = String(runtimeEnv.TRAKT_API_URL || "https://api.trakt.tv").trim();
export const TRAKT_REDIRECT_URI = String(
  runtimeEnv.TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob"
).trim();
