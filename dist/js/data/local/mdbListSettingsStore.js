import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "mdbListSettings";

const DEFAULTS = {
  enabled: false,
  apiKey: ""
};

export const MdbListSettingsStore = {

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
