import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "homeCatalogPrefs";

const DEFAULTS = {
  order: [],
  disabled: []
};

function unique(array) {
  return Array.from(new Set(array || []));
}

export const HomeCatalogStore = {

  get() {
    const stored = LocalStore.get(KEY, {}) || {};
    return {
      order: unique(Array.isArray(stored.order) ? stored.order : []),
      disabled: unique(Array.isArray(stored.disabled) ? stored.disabled : [])
    };
  },

  set(partial) {
    LocalStore.set(KEY, { ...this.get(), ...(partial || {}) });
  },

  isDisabled(key) {
    return this.get().disabled.includes(key);
  },

  toggleDisabled(key) {
    const current = this.get();
    const disabled = current.disabled.includes(key)
      ? current.disabled.filter((item) => item !== key)
      : [...current.disabled, key];
    this.set({ disabled });
  },

  setOrder(order) {
    this.set({ order: unique(order || []) });
  },

  ensureOrderKeys(keys) {
    const current = this.get();
    const valid = current.order.filter((key) => keys.includes(key));
    const missing = keys.filter((key) => !valid.includes(key));
    const next = [...valid, ...missing];
    this.set({ order: next });
    return next;
  },

  reset() {
    LocalStore.set(KEY, DEFAULTS);
  }

};
