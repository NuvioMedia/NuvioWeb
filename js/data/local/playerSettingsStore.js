import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "playerSettings";

const DEFAULTS = {
  autoplayNextEpisode: true,
  subtitlesEnabled: true,
  subtitleLanguage: "it",
  preferredQuality: "auto"
};

export const PlayerSettingsStore = {

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
