import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "debridSettings";
const LEGACY_STREAM_DESCRIPTION_TEMPLATE = "{stream.title::exists[\"{stream.title::title} \"||\"\"]}{stream.year::exists[\"({stream.year})\"||\"\"]}\n{stream.quality::exists[\"{stream.quality} \"||\"\"]}{stream.visualTags::exists[\"{stream.visualTags::join(' | ')} \"||\"\"]}{stream.encode::exists[\"{stream.encode} \"||\"\"]}\n{stream.audioTags::exists[\"{stream.audioTags::join(' | ')}\"||\"\"]}{stream.audioTags::exists::and::stream.audioChannels::exists[\" | \"||\"\"]}{stream.audioChannels::exists[\"{stream.audioChannels::join(' | ')}\"||\"\"]}\n{stream.size::>0[\"{stream.size::bytes} \"||\"\"]}{stream.releaseGroup::exists[\"{stream.releaseGroup} \"||\"\"]}{stream.indexer::exists[\"{stream.indexer}\"||\"\"]}\n{service.cached::istrue[\"Ready\"||\"Not Ready\"]}{service.shortName::exists[\" ({service.shortName})\"||\"\"]}{stream.filename::exists[\"\n{stream.filename}\"||\"\"]}";
export const ANDROID_DEBRID_STREAM_DESCRIPTION_TEMPLATE = LEGACY_STREAM_DESCRIPTION_TEMPLATE;

export const DEBRID_SETTINGS_DEFAULTS = {
  enabled: false,
  cloudLibraryEnabled: true,
  torboxApiKey: "",
  premiumizeApiKey: "",
  realDebridApiKey: "",
  preferredResolverProviderId: "",
  instantPlaybackPreparationLimit: 0,
  streamMaxResults: 0,
  streamSortMode: "DEFAULT",
  streamMinimumQuality: "ANY",
  streamDolbyVisionFilter: "ANY",
  streamHdrFilter: "ANY",
  streamCodecFilter: "ANY",
  streamPreferences: null,
  streamNameTemplate: "{stream.resolution::=2160p[\"4K \"||\"\"]}{stream.resolution::=1440p[\"QHD \"||\"\"]}{stream.resolution::=1080p[\"FHD \"||\"\"]}{stream.resolution::=720p[\"HD \"||\"\"]}{stream.resolution::exists[\"\"||\"Direct \"]}{service.shortName::exists[\"{service.shortName} \"||\"Debrid \"]}Instant",
  streamDescriptionTemplate: ""
};

const ENUMS = {
  streamSortMode: new Set(["DEFAULT", "QUALITY_DESC", "SIZE_DESC", "SIZE_ASC"]),
  streamMinimumQuality: new Set(["ANY", "P720", "P1080", "P2160"]),
  streamDolbyVisionFilter: new Set(["ANY", "EXCLUDE", "ONLY"]),
  streamHdrFilter: new Set(["ANY", "EXCLUDE", "ONLY"]),
  streamCodecFilter: new Set(["ANY", "H264", "HEVC", "AV1"])
};

function normalizeEnum(value, key) {
  const normalized = String(value || "").trim().toUpperCase();
  return ENUMS[key]?.has(normalized) ? normalized : DEBRID_SETTINGS_DEFAULTS[key];
}

function normalizeStreamPreferences(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value : null;
}

function normalizeStreamDescriptionTemplate(value) {
  const template = String(value || "");
  return template.trim() === LEGACY_STREAM_DESCRIPTION_TEMPLATE.trim() ? "" : template;
}

function normalizeDebridSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
    return {
    ...DEBRID_SETTINGS_DEFAULTS,
    enabled: Boolean(source.enabled),
    cloudLibraryEnabled: source.cloudLibraryEnabled !== false,
    torboxApiKey: String(source.torboxApiKey || "").trim(),
    premiumizeApiKey: String(source.premiumizeApiKey || "").trim(),
    realDebridApiKey: String(source.realDebridApiKey || "").trim(),
    preferredResolverProviderId: String(source.preferredResolverProviderId || "").trim().toLowerCase(),
    instantPlaybackPreparationLimit: Math.max(0, Math.min(5, Math.trunc(Number(source.instantPlaybackPreparationLimit || 0)))),
    streamMaxResults: Math.max(0, Math.min(100, Math.trunc(Number(source.streamMaxResults || 0)))),
    streamSortMode: normalizeEnum(source.streamSortMode, "streamSortMode"),
    streamMinimumQuality: normalizeEnum(source.streamMinimumQuality, "streamMinimumQuality"),
    streamDolbyVisionFilter: normalizeEnum(source.streamDolbyVisionFilter, "streamDolbyVisionFilter"),
    streamHdrFilter: normalizeEnum(source.streamHdrFilter, "streamHdrFilter"),
    streamCodecFilter: normalizeEnum(source.streamCodecFilter, "streamCodecFilter"),
    streamPreferences: normalizeStreamPreferences(source.streamPreferences),
    streamNameTemplate: String(source.streamNameTemplate || DEBRID_SETTINGS_DEFAULTS.streamNameTemplate),
    streamDescriptionTemplate: normalizeStreamDescriptionTemplate(source.streamDescriptionTemplate)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeDebridSettings
});

export const DebridSettingsStore = {

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
