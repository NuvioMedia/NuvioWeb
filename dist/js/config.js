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
export const ADDON_REMOTE_BASE_URL = String(runtimeEnv.ADDON_REMOTE_BASE_URL || "").trim();
export const ENABLE_REMOTE_WRAPPER_MODE = Boolean(runtimeEnv.ENABLE_REMOTE_WRAPPER_MODE);
export const PREFERRED_PLAYBACK_ORDER = normalizePlaybackOrder(runtimeEnv.PREFERRED_PLAYBACK_ORDER);
export const TMDB_API_KEY = String(runtimeEnv.TMDB_API_KEY || "").trim();
