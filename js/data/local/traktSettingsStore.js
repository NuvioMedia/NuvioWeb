import { createProfileScopedStore } from "./profileScopedStore.js";

export const WatchProgressSource = {
  TRAKT: "trakt",
  NUVIO_SYNC: "nuvio_sync"
};

export const TraktLibrarySourceMode = {
  TRAKT: "trakt",
  LOCAL: "local"
};

export const TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL = 0;
export const TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP = 60;

const STORE_KEY = "traktSettings";

function normalizeWatchProgressSource(value) {
  const normalized = String(value || WatchProgressSource.TRAKT).toLowerCase();
  return normalized === WatchProgressSource.NUVIO_SYNC
    ? WatchProgressSource.NUVIO_SYNC
    : WatchProgressSource.TRAKT;
}

function normalizeLibrarySourceMode(value) {
  const normalized = String(value || TraktLibrarySourceMode.TRAKT).toLowerCase();
  return normalized === TraktLibrarySourceMode.LOCAL
    ? TraktLibrarySourceMode.LOCAL
    : TraktLibrarySourceMode.TRAKT;
}

export function normalizeTraktContinueWatchingDaysCap(days) {
  const value = Number(days);
  if (value === TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL) {
    return TRAKT_CONTINUE_WATCHING_DAYS_CAP_ALL;
  }
  if (!Number.isFinite(value)) {
    return TRAKT_DEFAULT_CONTINUE_WATCHING_DAYS_CAP;
  }
  return Math.max(7, Math.min(365, Math.trunc(value)));
}

function normalize(settings = {}) {
  return {
    continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(settings.continueWatchingDaysCap),
    showMetaComments: settings.showMetaComments !== false,
    watchProgressSource: normalizeWatchProgressSource(settings.watchProgressSource),
    librarySourceMode: normalizeLibrarySourceMode(settings.librarySourceMode)
  };
}

const store = createProfileScopedStore({
  key: STORE_KEY,
  normalize
});

export const TraktSettingsStore = {
  get() {
    return store.get();
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  setContinueWatchingDaysCap(days) {
    return this.set({ continueWatchingDaysCap: normalizeTraktContinueWatchingDaysCap(days) });
  },

  setShowMetaComments(enabled) {
    return this.set({ showMetaComments: Boolean(enabled) });
  },

  setWatchProgressSource(source) {
    return this.set({ watchProgressSource: normalizeWatchProgressSource(source) });
  },

  setLibrarySourceMode(mode) {
    return this.set({ librarySourceMode: normalizeLibrarySourceMode(mode) });
  }
};
