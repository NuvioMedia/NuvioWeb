import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "homeCatalogPrefs";

const DEFAULTS = {
  order: [],
  disabled: []
};

function unique(array) {
  return Array.from(new Set(array || []));
}

function sameArray(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

function normalizeHomeCatalogPrefs(value = {}) {
  return {
    order: unique(Array.isArray(value.order) ? value.order : []),
    disabled: unique(Array.isArray(value.disabled) ? value.disabled : [])
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeHomeCatalogPrefs
});

export const HomeCatalogStore = {

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  setForProfile(profileId, partial, options = {}) {
    const current = this.getForProfile(profileId);
    const next = normalizeHomeCatalogPrefs({
      ...current,
      ...(partial || {})
    });
    if (sameArray(current.order, next.order) && sameArray(current.disabled, next.disabled)) {
      return;
    }
    store.replaceForProfile(profileId, next, options);
  },

  set(partial, { silentSync = false, profileId = null } = {}) {
    this.setForProfile(profileId, partial, { silentSync });
  },

  isDisabled(key) {
    return this.get().disabled.includes(key);
  },

  toggleDisabled(key, options = {}) {
    const current = this.get();
    const disabled = current.disabled.includes(key)
      ? current.disabled.filter((item) => item !== key)
      : [...current.disabled, key];
    this.set({ disabled }, options);
  },

  setOrder(order, options = {}) {
    this.set({ order: unique(order || []) }, options);
  },

  ensureOrderKeys(keys) {
    const current = this.get();
    const valid = current.order.filter((key) => keys.includes(key));
    const missing = keys.filter((key) => !valid.includes(key));
    const next = [...valid, ...missing];
    this.set({ order: next }, { silentSync: true });
    return next;
  },

  reset(options = {}) {
    store.replaceForProfile(options.profileId || null, DEFAULTS, {
      silentSync: Boolean(options.silentSync)
    });
  }

};
