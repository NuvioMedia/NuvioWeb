import { createProfileScopedStore } from "./profileScopedStore.js";

const KEY = "tmdbSettings";

const DEFAULTS = {
  enabled: false,
  modernHomeEnabled: false,
  enrichContinueWatching: true,
  language: "en",
  useArtwork: true,
  useBasicInfo: true,
  useDetails: true,
  useReleaseDates: true,
  useCredits: true,
  useProductions: true,
  useNetworks: true,
  useEpisodes: true,
  useTrailers: true,
  useMoreLikeThis: true,
  useCollections: true
};

export function normalizeTmdbLanguageCode(value = DEFAULTS.language) {
  const normalized = String(value || DEFAULTS.language)
    .trim()
    .replace(/_/g, "-");
  if (!normalized) {
    return DEFAULTS.language;
  }

  const [rawLanguage = DEFAULTS.language, rawRegion = ""] = normalized.split("-", 2);
  const language = rawLanguage.toLowerCase() || DEFAULTS.language;
  const region = /^[a-z]{2}$/i.test(rawRegion) ? rawRegion.toUpperCase() : rawRegion;
  return region ? `${language}-${region}` : language;
}

function normalizeTmdbSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(source.enabled),
    modernHomeEnabled: Boolean(source.modernHomeEnabled),
    enrichContinueWatching: source.enrichContinueWatching !== false,
    language: normalizeTmdbLanguageCode(source.language),
    useArtwork: source.useArtwork !== false,
    useBasicInfo: source.useBasicInfo !== false,
    useDetails: source.useDetails !== false,
    useReleaseDates: source.useReleaseDates !== false,
    useCredits: source.useCredits !== false,
    useProductions: source.useProductions !== false,
    useNetworks: source.useNetworks !== false,
    useEpisodes: source.useEpisodes !== false,
    useTrailers: source.useTrailers !== false,
    useMoreLikeThis: source.useMoreLikeThis !== false,
    useCollections: source.useCollections !== false
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTmdbSettings
});

export const TmdbSettingsStore = {
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
