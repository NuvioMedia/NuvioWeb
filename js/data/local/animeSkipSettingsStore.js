import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "animeSkipSettings";

const DEFAULTS = {
  enabled: false,
  clientId: ""
};

function normalizeAnimeSkipSettings(value = {}) {
  return {
    ...DEFAULTS,
    ...(value || {})
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeAnimeSkipSettings
});

export const AnimeSkipSettingsStore = {

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
