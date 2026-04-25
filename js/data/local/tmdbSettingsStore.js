import { TMDB_API_KEY } from "../../config.js";
import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "tmdbSettings";

const DEFAULTS = {
  enabled: true,
  apiKey: TMDB_API_KEY,
  language: "en-US",
  useArtwork: true,
  useBasicInfo: true,
  useDetails: true
};

function normalizeTmdbSettings(value = {}) {
  return {
    ...DEFAULTS,
    ...(value || {})
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTmdbSettings
});

export const TmdbSettingsStore = {

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  }

};
