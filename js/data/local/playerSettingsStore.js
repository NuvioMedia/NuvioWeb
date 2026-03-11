import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "playerSettings";

const DEFAULTS = {
  autoplayNextEpisode: true,
  subtitlesEnabled: true,
  subtitleLanguage: "system",
  preferredAudioLanguage: "system",
  preferredQuality: "auto",
  preferredPlayer: "auto",
  trailerAutoplay: false,
  subtitleRenderMode: "native"
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
