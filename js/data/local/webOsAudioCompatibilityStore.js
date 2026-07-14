import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "webOsAudioCompatibilitySettings";
const DEFAULTS = Object.freeze({
  forceDtsAudio: false,
  forceTrueHdAudio: false
});

function normalize(value = {}) {
  return {
    forceDtsAudio: Boolean(value?.forceDtsAudio),
    forceTrueHdAudio: Boolean(value?.forceTrueHdAudio)
  };
}

export const WebOsAudioCompatibilityStore = {
  get({ legacyForceAll = false } = {}) {
    const stored = LocalStore.get(KEY, null);
    if (stored && typeof stored === "object") {
      return normalize(stored);
    }
    if (legacyForceAll) {
      const migrated = {
        forceDtsAudio: true,
        forceTrueHdAudio: true
      };
      LocalStore.set(KEY, migrated);
      return migrated;
    }
    return { ...DEFAULTS };
  },

  set(partial = {}, { legacyForceAll = false } = {}) {
    const next = normalize({
      ...this.get({ legacyForceAll }),
      ...(partial && typeof partial === "object" ? partial : {})
    });
    LocalStore.set(KEY, next);
    return next;
  }
};
