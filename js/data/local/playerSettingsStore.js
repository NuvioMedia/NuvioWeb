import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "playerSettings";

const DEFAULTS = {
  autoplayNextEpisode: true,
  subtitlesEnabled: true,
  subtitleLanguage: "off",
  secondarySubtitleLanguage: "off",
  preferredAudioLanguage: "system",
  preferredQuality: "auto",
  trailerAutoplay: false,
  skipIntroEnabled: true,
  subtitleRenderMode: "native",
  subtitleDelayMs: 0,
  subtitleStyle: {
    fontSize: 100,
    textColor: "#FFFFFF",
    bold: false,
    outlineEnabled: true,
    outlineColor: "#000000",
    verticalOffset: 0,
    preferredLanguage: "off",
    secondaryPreferredLanguage: "off"
  },
  audioAmplificationDb: 0,
  persistAudioAmplification: false
};

function normalizeSelectableSubtitleLanguageCode(language) {
  const code = String(language ?? "").trim().toLowerCase();
  if (!code) {
      return "off";
  }
  switch (code) {
    case "pt-br":
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt-pt":
    case "pt_pt":
    case "por":
      return "pt";
    case "forced":
    case "force":
    case "forc":
      return "off";
    case "none":
    case "off":
      return "off";
    default:
      return code;
  }
}

function normalizePlayerSettings(settings = {}) {
  const subtitleStyle = {
    ...DEFAULTS.subtitleStyle,
    ...(settings.subtitleStyle || {})
  };
  return {
    ...DEFAULTS,
    ...settings,
    subtitleLanguage: normalizeSelectableSubtitleLanguageCode(settings.subtitleLanguage ?? DEFAULTS.subtitleLanguage),
    secondarySubtitleLanguage: normalizeSelectableSubtitleLanguageCode(settings.secondarySubtitleLanguage ?? DEFAULTS.secondarySubtitleLanguage),
    subtitleStyle: {
      ...subtitleStyle,
      preferredLanguage: normalizeSelectableSubtitleLanguageCode(subtitleStyle.preferredLanguage ?? DEFAULTS.subtitleStyle.preferredLanguage),
      secondaryPreferredLanguage: normalizeSelectableSubtitleLanguageCode(subtitleStyle.secondaryPreferredLanguage ?? DEFAULTS.subtitleStyle.secondaryPreferredLanguage)
    }
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizePlayerSettings,
  merge(current, partial) {
    return {
      ...current,
      ...(partial || {}),
      subtitleStyle: {
        ...current.subtitleStyle,
        ...((partial || {}).subtitleStyle || {})
      }
    };
  }
});

export const PlayerSettingsStore = {

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  }

};
