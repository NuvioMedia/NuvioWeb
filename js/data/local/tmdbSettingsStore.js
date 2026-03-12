import { LocalStore } from "../../core/storage/localStore.js";
import { TMDB_API_KEY } from "../../config.js";

const KEY = "tmdbSettings";

const DEFAULTS = {
  enabled: true,
  apiKey: TMDB_API_KEY,
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
