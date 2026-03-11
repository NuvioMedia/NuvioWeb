import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "layoutPreferences";

const DEFAULTS = {
  homeLayout: "classic",
  heroSectionEnabled: true,
  posterLabelsEnabled: true
};

export const LayoutPreferences = {

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
