(function bootstrapNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var existing = root.__NUVIO_ENV__ || {};

  function normalizePlaybackOrder(value) {
    if (Array.isArray(value)) {
      return value.map(function(entry) {
        return String(entry || "").trim();
      }).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map(function(entry) {
        return entry.trim();
      }).filter(Boolean);
    }
    return [];
  }

  root.__NUVIO_ENV__ = {
    SUPABASE_URL: typeof existing.SUPABASE_URL === "undefined" ? "" : existing.SUPABASE_URL,
    SUPABASE_ANON_KEY: typeof existing.SUPABASE_ANON_KEY === "undefined" ? "" : existing.SUPABASE_ANON_KEY,
    TV_LOGIN_REDIRECT_BASE_URL: typeof existing.TV_LOGIN_REDIRECT_BASE_URL === "undefined" ? "" : existing.TV_LOGIN_REDIRECT_BASE_URL,
    PUBLIC_APP_URL: typeof existing.PUBLIC_APP_URL === "undefined" ? "" : existing.PUBLIC_APP_URL,
    YOUTUBE_PROXY_URL: typeof existing.YOUTUBE_PROXY_URL === "undefined" ? "" : existing.YOUTUBE_PROXY_URL,
    PARENTAL_GUIDE_API_URL: typeof existing.PARENTAL_GUIDE_API_URL === "undefined" ? "" : existing.PARENTAL_GUIDE_API_URL,
    INTRODB_API_URL: typeof existing.INTRODB_API_URL === "undefined" ? "" : existing.INTRODB_API_URL,
    IMDB_RATINGS_API_BASE_URL: typeof existing.IMDB_RATINGS_API_BASE_URL === "undefined" ? "" : existing.IMDB_RATINGS_API_BASE_URL,
    AVATAR_PUBLIC_BASE_URL: typeof existing.AVATAR_PUBLIC_BASE_URL === "undefined" ? "" : existing.AVATAR_PUBLIC_BASE_URL,
    ADDON_REMOTE_BASE_URL: typeof existing.ADDON_REMOTE_BASE_URL === "undefined" ? "" : existing.ADDON_REMOTE_BASE_URL,
    ENABLE_REMOTE_WRAPPER_MODE: typeof existing.ENABLE_REMOTE_WRAPPER_MODE === "undefined" ? false : Boolean(existing.ENABLE_REMOTE_WRAPPER_MODE),
    PREFERRED_PLAYBACK_ORDER: normalizePlaybackOrder(existing.PREFERRED_PLAYBACK_ORDER),
    TMDB_API_KEY: typeof existing.TMDB_API_KEY === "undefined" ? "" : existing.TMDB_API_KEY
  };
}());
