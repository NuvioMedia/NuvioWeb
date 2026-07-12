import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "playerSettings";

const DEFAULTS = {
  autoplayNextEpisode: false,
  subtitlesEnabled: true,
  subtitleLanguage: "off",
  secondarySubtitleLanguage: "off",
  preferredAudioLanguage: "system",
  trailerAutoplay: false,
  skipIntroEnabled: true,
  nextEpisodeThresholdMode: "PERCENTAGE",
  nextEpisodeThresholdPercent: 99,
  nextEpisodeThresholdMinutesBeforeEnd: 2,
  stillWatchingEnabled: false,
  stillWatchingEpisodeThreshold: 3,
  subtitleRenderMode: "native",
  subtitleStyle: {
    fontSize: 100,
    textColor: "#FFFFFF",
    bold: false,
    outlineEnabled: true,
    outlineColor: "#000000",
    verticalOffset: 0,
    preferredLanguage: "off",
    secondaryPreferredLanguage: "off",
    useForcedSubtitles: false,
    showOnlyPreferredLanguages: false
  },
  audioAmplificationDb: 0,
  persistAudioAmplification: false,
  // Auto stream selection (matches the Android TV app). When the mode is not
  // MANUAL, pressing play auto-selects a stream and plays it after a countdown.
  streamAutoPlayMode: "MANUAL",
  streamAutoPlaySource: "ALL_SOURCES",
  streamAutoPlayRegex: "",
  streamAutoPlayPreferBingeGroupForNextEpisode: true,
  streamAutoPlayTimeoutSeconds: 3
};

const STREAM_AUTO_PLAY_MODES = ["MANUAL", "FIRST_STREAM", "REGEX_MATCH"];
const STREAM_AUTO_PLAY_SOURCES = ["ALL_SOURCES", "INSTALLED_ADDONS_ONLY", "ENABLED_PLUGINS_ONLY"];
const NEXT_EPISODE_THRESHOLD_MODES = ["PERCENTAGE", "MINUTES_BEFORE_END"];

function normalizeStreamAutoPlayMode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return STREAM_AUTO_PLAY_MODES.includes(normalized) ? normalized : "MANUAL";
}

function normalizeStreamAutoPlaySource(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return STREAM_AUTO_PLAY_SOURCES.includes(normalized) ? normalized : "ALL_SOURCES";
}

function normalizeStreamAutoPlayTimeout(value) {
  const seconds = Math.trunc(Number(value));
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULTS.streamAutoPlayTimeoutSeconds;
  }
  return Math.min(60, seconds);
}

function normalizeNextEpisodeThresholdMode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return NEXT_EPISODE_THRESHOLD_MODES.includes(normalized) ? normalized : DEFAULTS.nextEpisodeThresholdMode;
}

function normalizeHalfStep(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, next)) * 2) / 2;
}

function normalizeStillWatchingThreshold(value) {
  const threshold = Math.trunc(Number(value));
  if (!Number.isFinite(threshold)) {
    return DEFAULTS.stillWatchingEpisodeThreshold;
  }
  return Math.min(6, Math.max(2, threshold));
}

function extractLanguageCode(value, fallback = "off") {
  if (value && typeof value === "object") {
    return extractLanguageCode(
      value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode,
      fallback
    );
  }
  const code = String(value ?? "").trim();
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function normalizeSelectableSubtitleLanguageCode(language, fallback = "off") {
  const code = extractLanguageCode(language, fallback).trim().toLowerCase();
  if (!code) {
    return fallback;
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
      return "forced";
    case "none":
    case "off":
      return "off";
    default:
      return code;
  }
}

function normalizePlayerSettings(settings = {}) {
  const { subtitleDelayMs: _ignoredSubtitleDelayMs, ...persistentSettings } = settings || {};
  const subtitleStyle = {
    ...DEFAULTS.subtitleStyle,
    ...(persistentSettings.subtitleStyle || {})
  };
  let preferredLanguage = normalizeSelectableSubtitleLanguageCode(
    subtitleStyle.preferredLanguage ?? persistentSettings.subtitleLanguage,
    DEFAULTS.subtitleStyle.preferredLanguage
  );
  const subtitlesEnabled = persistentSettings.subtitlesEnabled ?? DEFAULTS.subtitlesEnabled;
  let secondaryPreferredLanguage = normalizeSelectableSubtitleLanguageCode(
    subtitleStyle.secondaryPreferredLanguage ?? persistentSettings.secondarySubtitleLanguage,
    DEFAULTS.subtitleStyle.secondaryPreferredLanguage
  );
  let useForcedSubtitles = Boolean(subtitleStyle.useForcedSubtitles ?? persistentSettings.useForcedSubtitles);

  if (preferredLanguage === "forced") {
    useForcedSubtitles = true;
    preferredLanguage =
      secondaryPreferredLanguage &&
      secondaryPreferredLanguage !== "forced" &&
      secondaryPreferredLanguage !== "off"
        ? secondaryPreferredLanguage
        : "en";
    secondaryPreferredLanguage = "off";
  }
  if (secondaryPreferredLanguage === "forced") {
    useForcedSubtitles = true;
    secondaryPreferredLanguage = "off";
  }

  return {
    ...DEFAULTS,
    ...persistentSettings,
    streamAutoPlayMode: normalizeStreamAutoPlayMode(persistentSettings.streamAutoPlayMode ?? DEFAULTS.streamAutoPlayMode),
    streamAutoPlaySource: normalizeStreamAutoPlaySource(persistentSettings.streamAutoPlaySource ?? DEFAULTS.streamAutoPlaySource),
    streamAutoPlayRegex: String(persistentSettings.streamAutoPlayRegex ?? "").slice(0, 500),
    streamAutoPlayPreferBingeGroupForNextEpisode: Boolean(
      persistentSettings.streamAutoPlayPreferBingeGroupForNextEpisode ??
      DEFAULTS.streamAutoPlayPreferBingeGroupForNextEpisode
    ),
    streamAutoPlayTimeoutSeconds: normalizeStreamAutoPlayTimeout(persistentSettings.streamAutoPlayTimeoutSeconds),
    nextEpisodeThresholdMode: normalizeNextEpisodeThresholdMode(
      persistentSettings.nextEpisodeThresholdMode ?? DEFAULTS.nextEpisodeThresholdMode
    ),
    nextEpisodeThresholdPercent: normalizeHalfStep(
      persistentSettings.nextEpisodeThresholdPercent ?? DEFAULTS.nextEpisodeThresholdPercent,
      97,
      100,
      DEFAULTS.nextEpisodeThresholdPercent
    ),
    nextEpisodeThresholdMinutesBeforeEnd: normalizeHalfStep(
      persistentSettings.nextEpisodeThresholdMinutesBeforeEnd ?? DEFAULTS.nextEpisodeThresholdMinutesBeforeEnd,
      0,
      3.5,
      DEFAULTS.nextEpisodeThresholdMinutesBeforeEnd
    ),
    stillWatchingEnabled: Boolean(settings.stillWatchingEnabled ?? DEFAULTS.stillWatchingEnabled),
    stillWatchingEpisodeThreshold: normalizeStillWatchingThreshold(
      settings.stillWatchingEpisodeThreshold ?? DEFAULTS.stillWatchingEpisodeThreshold
    ),
    subtitlesEnabled,
    subtitleLanguage: preferredLanguage,
    secondarySubtitleLanguage: secondaryPreferredLanguage,
    subtitleStyle: {
      ...subtitleStyle,
      preferredLanguage,
      secondaryPreferredLanguage,
      useForcedSubtitles,
      showOnlyPreferredLanguages: Boolean(subtitleStyle.showOnlyPreferredLanguages)
    }
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizePlayerSettings,
  merge(current, partial) {
    const { subtitleDelayMs: _ignoredSubtitleDelayMs, ...persistentPartial } = partial || {};
    return {
      ...current,
      ...persistentPartial,
      subtitleStyle: {
        ...current.subtitleStyle,
        ...(persistentPartial.subtitleStyle || {})
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
