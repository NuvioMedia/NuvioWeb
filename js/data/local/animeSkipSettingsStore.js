import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "animeSkipSettings";

const DEFAULTS = {
  enabled: false,
  clientId: ""
};

export const AnimeSkipSettingsStore = {

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
