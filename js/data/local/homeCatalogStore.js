import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "homeCatalogPrefs";

const DEFAULTS = {
  order: [],
  disabled: [],
  customTitles: {}
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

function normalizeCustomTitles(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((accumulator, [key, title]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedTitle = String(title || "").trim();
    if (normalizedKey && normalizedTitle) {
      accumulator[normalizedKey] = normalizedTitle;
    }
    return accumulator;
  }, {});
}

function sameObject(left = {}, right = {}) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (!sameArray(leftKeys, rightKeys)) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function normalizeHomeCatalogPrefs(value = {}) {
  return {
    order: unique(Array.isArray(value.order) ? value.order : []),
    disabled: unique(Array.isArray(value.disabled) ? value.disabled : []),
    customTitles: normalizeCustomTitles(value.customTitles || value.custom_titles)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeHomeCatalogPrefs
});

function queueHomeCatalogSettingsSync(profileId = null) {
  import("../../core/profile/homeCatalogSettingsSyncService.js")
    .then(({ HomeCatalogSettingsSyncService }) =>
      HomeCatalogSettingsSyncService.triggerPush(profileId)
    )
    .catch((error) => {
      console.warn("Home catalog settings sync enqueue failed", error);
    });
}

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
    if (
      sameArray(current.order, next.order) &&
      sameArray(current.disabled, next.disabled) &&
      sameObject(current.customTitles, next.customTitles)
    ) {
      return;
    }
    store.replaceForProfile(profileId, next, options);
    if (!options.silentSync) {
      queueHomeCatalogSettingsSync(profileId);
    }
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

  setCustomTitles(customTitles, options = {}) {
    this.set({ customTitles: normalizeCustomTitles(customTitles) }, options);
  },

  ensureOrderKeys(keys) {
    const current = this.get();
    const saved = unique(current.order || []).filter(Boolean);
    const savedSet = new Set(saved);
    const missing = unique(keys || []).filter((key) => key && !savedSet.has(key));
    const next = [...saved, ...missing];
    if (!sameArray(current.order, next)) {
      this.set({ order: next }, { silentSync: true });
    }
    return next;
  },

  reset(options = {}) {
    store.replaceForProfile(options.profileId || null, DEFAULTS, {
      silentSync: Boolean(options.silentSync)
    });
  }
};
