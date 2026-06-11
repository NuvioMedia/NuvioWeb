import { WatchProgressStore } from "../local/watchProgressStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { ContinueWatchingPreferences } from "../local/continueWatchingPreferences.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { TraktAuthStore } from "../local/traktAuthStore.js";
import { TraktAuthService } from "./traktAuthService.js";
import { metaRepository } from "./metaRepository.js";

const CW_PROGRESS_START_THRESHOLD = 0.02;
const CW_PROGRESS_END_THRESHOLD = 0.85;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

let watchProgressSyncTimer = null;
let watchProgressSyncInFlight = null;

function getWatchProgressSyncDebounceMs() {
  return globalThis.document?.body?.classList?.contains("performance-constrained") ? 15000 : 1500;
}

function queueWatchProgressCloudSync(delayMs = getWatchProgressSyncDebounceMs()) {
  if (watchProgressSyncTimer) {
    clearTimeout(watchProgressSyncTimer);
  }
  watchProgressSyncTimer = setTimeout(() => {
    watchProgressSyncTimer = null;
    const runPush = async () => {
      if (watchProgressSyncInFlight) {
        await watchProgressSyncInFlight.catch(() => false);
      }
      watchProgressSyncInFlight = import("../../core/profile/watchProgressSyncService.js")
        .then(({ WatchProgressSyncService }) => WatchProgressSyncService.push())
        .catch((error) => {
          console.warn("Watch progress cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          watchProgressSyncInFlight = null;
        });
      await watchProgressSyncInFlight;
    };
    void runPush();
  }, delayMs);
}

function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

function matchesProgressTarget(item = {}, contentId, videoId = null) {
  const wantedContentId = String(contentId || "").trim();
  if (!wantedContentId || String(item.contentId || "").trim() !== wantedContentId) {
    return false;
  }
  if (videoId == null) {
    return true;
  }
  return String(item.videoId || "") === String(videoId);
}

async function deleteWatchProgressFromCloud(items = []) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchProgressSyncService } = await import("../../core/profile/watchProgressSyncService.js");
    return WatchProgressSyncService.deleteItems(items);
  } catch (error) {
    console.warn("Watch progress cloud delete failed", error);
    return false;
  }
}

function progressFractionForContinueWatching(item = {}) {
  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (Number.isFinite(durationMs) && durationMs > 0 && Number.isFinite(positionMs) && positionMs > 0) {
    return Math.max(0, Math.min(1, positionMs / durationMs));
  }
  if (item.progressPercent != null && item.progressPercent !== "") {
    const explicitPercent = Number(item.progressPercent);
    if (Number.isFinite(explicitPercent)) {
      return Math.max(0, Math.min(1, explicitPercent / 100));
    }
  }
  return 0;
}

function isCompletedForContinueWatching(item = {}) {
  return progressFractionForContinueWatching(item) >= CW_PROGRESS_END_THRESHOLD;
}

function isInProgressForContinueWatching(item = {}) {
  const fraction = progressFractionForContinueWatching(item);
  return fraction >= CW_PROGRESS_START_THRESHOLD && fraction < CW_PROGRESS_END_THRESHOLD;
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgressForContinueWatching(item)) {
    return true;
  }
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  const hasStartedPlayback = Number(item.positionMs || 0) > 0 || Number(item.progressPercent || 0) > 0;
  return hasStartedPlayback;
}

function isTraktProgressItem(item = {}) {
  return String(item.source || "").toLowerCase().startsWith("trakt");
}

function selectedContinueWatchingSource() {
  const settings = TraktSettingsStore.get();
  const requestedSource = settings.watchProgressSource || WatchProgressSource.TRAKT;
  return requestedSource === WatchProgressSource.TRAKT && TraktAuthStore.isAuthenticated()
    ? WatchProgressSource.TRAKT
    : WatchProgressSource.NUVIO_SYNC;
}

function filterForSelectedContinueWatchingSource(items = []) {
  const useTrakt = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
  const all = Array.isArray(items) ? items : [];
  return all.filter((item) => (
    useTrakt ? isTraktProgressItem(item) : !isTraktProgressItem(item)
  ));
}

function deduplicateInProgress(items = []) {
  const seriesItems = [];
  const nonSeriesItems = [];

  items.forEach((item) => {
    if (isSeriesType(item?.contentType)) {
      seriesItems.push(item);
      return;
    }
    nonSeriesItems.push(item);
  });

  const latestSeriesItems = [];
  const seenContentIds = new Set();
  seriesItems
    .slice()
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .forEach((item) => {
      const contentId = String(item?.contentId || "").trim();
      if (!contentId || seenContentIds.has(contentId)) {
        return;
      }
      seenContentIds.add(contentId);
      latestSeriesItems.push(item);
    });

  return [...nonSeriesItems, ...latestSeriesItems]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function toProgressItemFromTraktHistory(historyItem) {
  if (!historyItem) return null;
  const isEpisode = historyItem.type === "episode";
  const tmdbId = isEpisode ? historyItem.showTmdbId : historyItem.tmdbId;
  const contentId = tmdbId ? `tmdb:${tmdbId}` : historyItem.traktId ? `trakt:${historyItem.traktId}` : null;
  if (!contentId) return null;
  const watchedAtMs = historyItem.watchedAt ? new Date(historyItem.watchedAt).getTime() : Date.now();
  return {
    contentId,
    videoId: isEpisode && historyItem.episodeTmdbId ? `tmdb:${historyItem.episodeTmdbId}` : contentId,
    contentType: isEpisode ? "series" : "movie",
    title: isEpisode ? historyItem.showTitle : historyItem.title,
    year: isEpisode ? historyItem.showYear : historyItem.year,
    imdbId: isEpisode ? historyItem.showImdbId : historyItem.imdbId,
    source: "trakt_history",
    updatedAt: watchedAtMs,
    positionMs: 0,
    durationMs: 0,
    progressPercent: 80,
    profileId: activeProfileId(),
    seasonNumber: isEpisode ? historyItem.seasonNumber : undefined,
    episodeNumber: isEpisode ? historyItem.episodeNumber : undefined,
    episodeTitle: isEpisode ? historyItem.episodeTitle : undefined
  };
}

function toProgressItemFromPlayback(playbackItem) {
  if (!playbackItem || playbackItem.progressPercent == null) return null;
  const progressFraction = playbackItem.progressPercent / 100;
  if (progressFraction < CW_PROGRESS_START_THRESHOLD || progressFraction >= CW_PROGRESS_END_THRESHOLD) return null;
  const isEpisode = playbackItem.type === "episode";
  const pausedAtMs = playbackItem.pausedAt ? new Date(playbackItem.pausedAt).getTime() : Date.now();
  return {
    contentId: playbackItem.contentId,
    videoId: playbackItem.videoId,
    contentType: isEpisode ? "series" : "movie",
    title: playbackItem.title || "",
    year: playbackItem.year,
    imdbId: playbackItem.imdbId,
    source: "trakt_playback",
    updatedAt: pausedAtMs,
    positionMs: 0,
    durationMs: 0,
    progressPercent: playbackItem.progressPercent,
    profileId: activeProfileId(),
    seasonNumber: playbackItem.seasonNumber,
    episodeNumber: playbackItem.episodeNumber,
    episodeTitle: playbackItem.episodeTitle
  };
}

function toNextEpisodeItem(watchedShowItem) {
  if (!watchedShowItem || !watchedShowItem.nextEpisode) return null;
  const { nextEpisode, contentId, title, year, imdbId } = watchedShowItem;
  return {
    contentId,
    videoId: null,
    contentType: "series",
    title: title || "",
    year,
    imdbId,
    source: "trakt_watched_show",
    updatedAt: Date.now(),
    positionMs: 0,
    durationMs: 0,
    progressPercent: 0,
    profileId: activeProfileId(),
    seasonNumber: nextEpisode.season,
    episodeNumber: nextEpisode.number,
    episodeTitle: nextEpisode.title || undefined
  };
}

// Cache for enriched metadata (5-minute TTL)
const enrichedMetaCache = new Map();
const ENRICHED_META_CACHE_TTL_MS = 5 * 60 * 1000;

async function batchEnrichProgressItems(items) {
  if (!items.length) return [];
  const now = Date.now();
  const results = [];

  for (const item of items) {
    const lookupId = item.imdbId || item.contentId;
    const cacheKey = `${item.contentType}:${lookupId}`;
    const cached = enrichedMetaCache.get(cacheKey);

    let meta = null;
    if (cached && (now - cached.timestamp) < ENRICHED_META_CACHE_TTL_MS) {
      meta = cached.meta;
    } else {
      const canonicalType = item.contentType === "series" ? "series" : "movie";
      meta = await metaRepository.getMetaFromAllAddons(canonicalType, lookupId).catch(() => null);
      enrichedMetaCache.set(cacheKey, { meta, timestamp: now });
    }

    results.push(meta ? { ...item, enrichedMeta: meta } : item);
  }

  return results;
}

class WatchProgressRepository {

  async saveProgress(progress) {
    if (isSeriesType(progress?.contentType)) {
      ContinueWatchingPreferences.removeDismissedNextUpKeysForContent(progress?.contentId, activeProfileId());
    }
    WatchProgressStore.upsert({
      ...progress,
      updatedAt: progress.updatedAt || Date.now()
    }, activeProfileId());
    queueWatchProgressCloudSync();
  }

  async getProgressByContentId(contentId) {
    return WatchProgressStore.findByContentId(contentId, activeProfileId());
  }

  async removeProgress(contentId, videoId = null) {
    const pid = activeProfileId();
    const removedItems = WatchProgressStore.listForProfile(pid)
      .filter((item) => matchesProgressTarget(item, contentId, videoId));
    WatchProgressStore.remove(contentId, videoId, pid);
    await deleteWatchProgressFromCloud(removedItems);
    queueWatchProgressCloudSync();
  }

  async getRecent(limit = 30) {
    const now = Date.now();
    const useTraktProgress = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
    const daysCap = Number(TraktSettingsStore.get().continueWatchingDaysCap || 60);
    const cutoffMs = !useTraktProgress || daysCap === 0 ? 0 : now - (daysCap * 24 * 60 * 60 * 1000);

    let traktHistoryItems = [];
    let playbackItems = [];
    let nextEpisodeItems = [];

    if (useTraktProgress && TraktAuthStore.isAuthenticated()) {
      // Parallelize all Trakt fetches via Promise.all
      const [history, playbackState, watchedShows] = await Promise.all([
        TraktAuthService.fetchWatchHistory({ limit: 100 }).catch((err) => {
          console.warn("[CW] Trakt history fetch failed", err);
          return [];
        }),
        TraktAuthService.fetchPlaybackState({ limit: 50 }).catch((err) => {
          console.warn("[CW] Trakt playback state fetch failed", err);
          return [];
        }),
        TraktAuthService.fetchWatchedShows().catch((err) => {
          console.warn("[CW] Trakt watched shows fetch failed", err);
          return [];
        })
      ]);

      traktHistoryItems = history.map(toProgressItemFromTraktHistory).filter(Boolean);
      playbackItems = playbackState.map(toProgressItemFromPlayback).filter(Boolean);
      nextEpisodeItems = watchedShows.map(toNextEpisodeItem).filter(Boolean);
    }

    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    const allItems = [...localItems, ...traktHistoryItems, ...playbackItems, ...nextEpisodeItems];

    const recentItems = filterForSelectedContinueWatchingSource(allItems)
      .filter((item) => cutoffMs === 0 || Number(item?.updatedAt || 0) >= cutoffMs)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 300);

    const inProgressOnly = deduplicateInProgress(
      recentItems.filter((item) => shouldTreatAsInProgressForContinueWatching(item))
    );

    const enrichedItems = await batchEnrichProgressItems(inProgressOnly.slice(0, limit));
    return enrichedItems;
  }

  async getAll() {
    return WatchProgressStore.listForProfile(activeProfileId());
  }

  async getAllForContinueWatching() {
    return filterForSelectedContinueWatchingSource(WatchProgressStore.listForProfile(activeProfileId()));
  }

  getContinueWatchingSourceKey() {
    return `${activeProfileId()}:${selectedContinueWatchingSource()}`;
  }

  getContinueWatchingSource() {
    return selectedContinueWatchingSource();
  }

  async replaceAll(items) {
    WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchProgressRepository = new WatchProgressRepository();
