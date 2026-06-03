import { LocalStore } from "../../core/storage/localStore.js";
import { queueProfileSettingsCloudSync } from "./profileScopedStore.js";

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

export const HomeCatalogStore = {

  get() {
    const stored = LocalStore.get(KEY, {}) || {};
    return {
      order: unique(Array.isArray(stored.order) ? stored.order : []),
      disabled: unique(Array.isArray(stored.disabled) ? stored.disabled : [])
    };
  },

  set(partial, { silentSync = false, profileId = null } = {}) {
    const current = this.get();
    const next = {
      ...current,
      ...(partial || {})
    };
    next.order = unique(Array.isArray(next.order) ? next.order : []);
    next.disabled = unique(Array.isArray(next.disabled) ? next.disabled : []);
    if (sameArray(current.order, next.order) && sameArray(current.disabled, next.disabled)) {
      return;
    }
    LocalStore.set(KEY, next);
    if (!silentSync) {
      queueProfileSettingsCloudSync(profileId);
    }
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
    LocalStore.set(KEY, DEFAULTS);
    if (!options.silentSync) {
      queueProfileSettingsCloudSync(options.profileId || null);
    }
  }

};
