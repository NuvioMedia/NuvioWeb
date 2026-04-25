import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "mdbListSettings";

const DEFAULTS = {
  enabled: false,
  apiKey: ""
};

function normalizeMdbListSettings(value = {}) {
  return {
    ...DEFAULTS,
    ...(value || {})
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeMdbListSettings
});

export const MdbListSettingsStore = {

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
