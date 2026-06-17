import { WatchProgressStore } from "../local/watchProgressStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { ContinueWatchingPreferences } from "../local/continueWatchingPreferences.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { TraktAuthStore } from "../local/traktAuthStore.js";
import { TraktAuthService } from "./traktAuthService.js";
import { metaRepository } from "./metaRepository.js";
import {
  WATCH_PROGRESS_COMPLETED_THRESHOLD,
  WATCH_PROGRESS_STARTED_THRESHOLD,
  getWatchProgressFraction,
  hasWatchProgressStarted,
  isWatchProgressCompleted,
  isWatchProgressInProgress,
  resolveWatchProgressResumePositionMs
} from "../../domain/model/watchProgress.js";

const CW_DISPLAY_SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";
const CW_PROGRESS_START_THRESHOLD = WATCH_PROGRESS_STARTED_THRESHOLD;
const CW_PROGRESS_END_THRESHOLD = WATCH_PROGRESS_COMPLETED_THRESHOLD;
// These bound a hung request so the fire-and-forget Continue Watching
// reconciliation can't leak a never-resolving promise. They are NOT on the
// app's critical path (the home screen paints from a snapshot), so they are
// generous — only a genuinely stuck request is abandoned.
const TRAKT_API_TIMEOUT_MS = 10000;
const PROGRESS_META_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, fallback) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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

function invalidateContinueWatchingDisplaySnapshot() {
  const sourceKey = `${activeProfileId()}:${selectedContinueWatchingSource()}`;
  const store = LocalStore.get(CW_DISPLAY_SNAPSHOT_KEY, {});
  if (
    !store ||
    typeof store !== "object" ||
    !Object.prototype.hasOwnProperty.call(store, sourceKey)
  ) {
    return;
  }
  const next = { ...store };
  delete next[sourceKey];
  LocalStore.set(CW_DISPLAY_SNAPSHOT_KEY, next);
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
    const { WatchProgressSyncService } =
      await import("../../core/profile/watchProgressSyncService.js");
    return WatchProgressSyncService.deleteItems(items);
  } catch (error) {
    console.warn("Watch progress cloud delete failed", error);
    return false;
  }
}

function isCompletedForContinueWatching(item = {}) {
  return isWatchProgressCompleted(item);
}

function isInProgressForContinueWatching(item = {}) {
  return isWatchProgressInProgress(item);
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgressForContinueWatching(item)) {
    return true;
  }
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  return hasWatchProgressStarted(item);
}

function isTraktProgressItem(item = {}) {
  return String(item.source || "")
    .toLowerCase()
    .startsWith("trakt");
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
  return all.filter((item) => (useTrakt ? isTraktProgressItem(item) : !isTraktProgressItem(item)));
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

  return [...nonSeriesItems, ...latestSeriesItems].sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
  );
}

function normalizeContentIdList(values = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function matchesAnyContentId(item = {}, contentIds = []) {
  const normalized = String(item?.contentId || "").trim();
  return Boolean(normalized && contentIds.includes(normalized));
}

function matchesResumeTarget(item = {}, { videoId = null, season = null, episode = null } = {}) {
  const wantedVideoId = String(videoId || "").trim();
  if (wantedVideoId && String(item?.videoId || "").trim() === wantedVideoId) {
    return true;
  }
  const wantedSeason = Number(season || 0);
  const wantedEpisode = Number(episode || 0);
  if (wantedSeason > 0 && wantedEpisode > 0) {
    return (
      Number(item?.season || item?.seasonNumber || 0) === wantedSeason &&
      Number(item?.episode || item?.episodeNumber || 0) === wantedEpisode
    );
  }
  return !wantedVideoId;
}

function selectBestResumeProgress(items = [], contentIds = [], target = {}) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => matchesAnyContentId(item, contentIds))
    .filter((item) => shouldTreatAsInProgressForContinueWatching(item));
  if (!candidates.length) {
    return null;
  }
  const targeted = candidates.filter((item) => matchesResumeTarget(item, target));
  const pool = targeted.length ? targeted : candidates;
  return (
    pool
      .slice()
      .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))[0] ||
    null
  );
}

function normalizeResumeProgress(progress = null) {
  if (!progress) {
    return null;
  }
  const durationMs = Number(progress.durationMs || 0);
  const positionMs = resolveWatchProgressResumePositionMs(progress, durationMs);
  return {
    ...progress,
    positionMs,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.trunc(durationMs) : 0,
    progressFraction: getWatchProgressFraction(progress),
    progressPercent:
      progress.progressPercent != null && progress.progressPercent !== ""
        ? Number(progress.progressPercent)
        : getWatchProgressFraction(progress) * 100
  };
}

function toProgressItemFromTraktHistory(historyItem) {
  if (!historyItem) return null;
  const isEpisode = historyItem.type === "episode";
  const tmdbId = isEpisode ? historyItem.showTmdbId : historyItem.tmdbId;
  const contentId = tmdbId
    ? `tmdb:${tmdbId}`
    : historyItem.traktId
      ? `trakt:${historyItem.traktId}`
      : null;
  if (!contentId) return null;
  const watchedAtMs = historyItem.watchedAt
    ? new Date(historyItem.watchedAt).getTime()
    : Date.now();
  return {
    contentId,
    videoId:
      isEpisode && historyItem.episodeTmdbId ? `tmdb:${historyItem.episodeTmdbId}` : contentId,
    contentType: isEpisode ? "series" : "movie",
    title: isEpisode ? historyItem.showTitle : historyItem.title,
    year: isEpisode ? historyItem.showYear : historyItem.year,
    imdbId: isEpisode ? historyItem.showImdbId : historyItem.imdbId,
    source: "trakt_history",
    updatedAt: watchedAtMs,
    positionMs: 0,
    durationMs: 0,
    // Trakt history represents completed items, not partial progress.
    // Keep it out of Continue Watching while still letting it seed Next Up.
    progressPercent: 100,
    profileId: activeProfileId(),
    seasonNumber: isEpisode ? historyItem.seasonNumber : undefined,
    episodeNumber: isEpisode ? historyItem.episodeNumber : undefined,
    episodeTitle: isEpisode ? historyItem.episodeTitle : undefined
  };
}

function toProgressItemFromPlayback(playbackItem) {
  if (!playbackItem || playbackItem.progressPercent == null) return null;
  const progressFraction = playbackItem.progressPercent / 100;
  if (
    progressFraction < CW_PROGRESS_START_THRESHOLD ||
    progressFraction >= CW_PROGRESS_END_THRESHOLD
  )
    return null;
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
  return Promise.all(
    items.map(async (item) => {
      const lookupId = item.imdbId || item.contentId;
      const cacheKey = `${item.contentType}:${lookupId}`;
      const cached = enrichedMetaCache.get(cacheKey);
      let meta = null;
      if (cached && now - cached.timestamp < ENRICHED_META_CACHE_TTL_MS) {
        meta = cached.meta;
      } else {
        const canonicalType = item.contentType === "series" ? "series" : "movie";
        meta = await withTimeout(
          metaRepository.getMetaFromAllAddons(canonicalType, lookupId),
          PROGRESS_META_TIMEOUT_MS,
          null
        ).catch(() => null);
        // Only cache real metadata. Caching a null (timeout/miss) would leave the
        // item unenriched for the full TTL after a single slow response.
        if (meta) {
          enrichedMetaCache.set(cacheKey, { meta, timestamp: now });
        }
      }
      return meta ? { ...item, enrichedMeta: meta } : item;
    })
  );
}

class WatchProgressRepository {
  async saveProgress(progress) {
    if (isSeriesType(progress?.contentType)) {
      ContinueWatchingPreferences.removeDismissedNextUpKeysForContent(
        progress?.contentId,
        activeProfileId()
      );
    }
    WatchProgressStore.upsert(
      {
        ...progress,
        updatedAt: progress.updatedAt || Date.now()
      },
      activeProfileId()
    );
    invalidateContinueWatchingDisplaySnapshot();
    queueWatchProgressCloudSync();
  }

  async getProgressByContentId(contentId) {
    return WatchProgressStore.findByContentId(contentId, activeProfileId());
  }

  async getResumeByContentIds(contentIds, target = {}) {
    const candidates = normalizeContentIdList(contentIds);
    if (!candidates.length) {
      return null;
    }
    const localItems = WatchProgressStore.listForProfile(activeProfileId());
    let sourceItems = filterForSelectedContinueWatchingSource(localItems);

    if (
      selectedContinueWatchingSource() === WatchProgressSource.TRAKT &&
      TraktAuthStore.isAuthenticated()
    ) {
      sourceItems = await this.getRecent(300).catch((error) => {
        console.warn("[CW] Resume lookup failed", error);
        return sourceItems;
      });
    }

    return normalizeResumeProgress(selectBestResumeProgress(sourceItems, candidates, target));
  }

  async getResumeByContentId(contentId, target = {}) {
    return this.getResumeByContentIds([contentId], target);
  }

  async removeProgress(contentId, videoId = null) {
    const pid = activeProfileId();
    const removedItems = WatchProgressStore.listForProfile(pid).filter((item) =>
      matchesProgressTarget(item, contentId, videoId)
    );
    WatchProgressStore.remove(contentId, videoId, pid);
    await deleteWatchProgressFromCloud(removedItems);
    invalidateContinueWatchingDisplaySnapshot();
    queueWatchProgressCloudSync();
  }

  async getRecent(limit = 30) {
    const now = Date.now();
    const useTraktProgress = selectedContinueWatchingSource() === WatchProgressSource.TRAKT;
    const daysCap = Number(TraktSettingsStore.get().continueWatchingDaysCap || 60);
    const cutoffMs = !useTraktProgress || daysCap === 0 ? 0 : now - daysCap * 24 * 60 * 60 * 1000;

    let traktHistoryItems = [];
    let playbackItems = [];
    let nextEpisodeItems = [];

    if (useTraktProgress && TraktAuthStore.isAuthenticated()) {
      // Parallelize all Trakt fetches via Promise.all
      const [history, playbackState, watchedShows] = await Promise.all([
        withTimeout(
          TraktAuthService.fetchWatchHistory({ limit: 100 }),
          TRAKT_API_TIMEOUT_MS,
          []
        ).catch((err) => {
          console.warn("[CW] Trakt history fetch failed", err);
          return [];
        }),
        withTimeout(
          TraktAuthService.fetchPlaybackState({ limit: 50 }),
          TRAKT_API_TIMEOUT_MS,
          []
        ).catch((err) => {
          console.warn("[CW] Trakt playback state fetch failed", err);
          return [];
        }),
        withTimeout(TraktAuthService.fetchWatchedShows(), TRAKT_API_TIMEOUT_MS, []).catch((err) => {
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
    return filterForSelectedContinueWatchingSource(
      WatchProgressStore.listForProfile(activeProfileId())
    );
  }

  getContinueWatchingSourceKey() {
    return `${activeProfileId()}:${selectedContinueWatchingSource()}`;
  }

  getContinueWatchingSource() {
    return selectedContinueWatchingSource();
  }

  async replaceAll(items) {
    WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
    invalidateContinueWatchingDisplaySnapshot();
  }
}

export const watchProgressRepository = new WatchProgressRepository();
