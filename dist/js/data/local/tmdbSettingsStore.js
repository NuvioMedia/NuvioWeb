import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "tmdbSettings";
const ANDROID_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const DEFAULTS = {
  enabled: true,
  apiKey: ANDROID_TMDB_API_KEY,
  language: "it-IT",
  useArtwork: true,
  useBasicInfo: true,
  useDetails: true
};

export const TmdbSettingsStore = {

  get() {
    return {
      ...DEFAULTS,
      ...(LocalStore.get(KEY, {}) || {})
    };
  },

  set(partial) {
    LocalStore.set(KEY, { ...this.get(), ...(partial || {}) });
  }

};
