import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "mdbListSettings";

const DEFAULTS = {
  enabled: false,
  apiKey: "",
  showTrakt: true,
  showImdb: true,
  showTmdb: true,
  showLetterboxd: true,
  showTomatoes: true,
  showAudience: true,
  showMetacritic: true
};

function normalizeMdbListSettings(value = {}) {
  return {
    ...DEFAULTS,
    ...(value || {}),
    enabled: Boolean(value?.enabled),
    apiKey: String(value?.apiKey || "").trim(),
    showTrakt: value?.showTrakt !== false,
    showImdb: value?.showImdb !== false,
    showTmdb: value?.showTmdb !== false,
    showLetterboxd: value?.showLetterboxd !== false,
    showTomatoes: value?.showTomatoes !== false,
    showAudience: value?.showAudience !== false,
    showMetacritic: value?.showMetacritic !== false
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
