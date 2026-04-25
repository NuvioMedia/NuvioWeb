import { WatchProgressStore } from "../local/watchProgressStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const CONTINUE_WATCHING_DAYS_CAP = 60;
const IN_PROGRESS_START_THRESHOLD = 0.02;
const IN_PROGRESS_END_THRESHOLD = 0.85;

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

function toProgressFraction(item = {}) {
  const explicitPercent = Number(item.progressPercent);
  if (Number.isFinite(explicitPercent) && explicitPercent > 0) {
    return Math.max(0, Math.min(1, explicitPercent / 100));
  }

  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(positionMs) || positionMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, positionMs / durationMs));
}

function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series";
}

function isInProgress(item = {}) {
  const fraction = toProgressFraction(item);
  return fraction >= IN_PROGRESS_START_THRESHOLD && fraction < IN_PROGRESS_END_THRESHOLD;
}

function isCompleted(item = {}) {
  return toProgressFraction(item) >= IN_PROGRESS_END_THRESHOLD;
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgress(item)) {
    return true;
  }
  if (isCompleted(item)) {
    return false;
  }

  const hasStartedPlayback = Number(item.positionMs || 0) > 0 || Number(item.progressPercent || 0) > 0;
  const source = String(item.source || "").toLowerCase();
  return hasStartedPlayback
    && source !== "trakt_history"
    && source !== "trakt_show_progress";
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

class WatchProgressRepository {

  async saveProgress(progress) {
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
    WatchProgressStore.remove(contentId, videoId, activeProfileId());
    queueWatchProgressCloudSync();
  }

  async getRecent(limit = 30) {
    const now = Date.now();
    const cutoffMs = now - (CONTINUE_WATCHING_DAYS_CAP * 24 * 60 * 60 * 1000);
    const recentItems = WatchProgressStore.listForProfile(activeProfileId())
      .filter((item) => Number(item?.updatedAt || 0) >= cutoffMs)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 300);

    const inProgressOnly = deduplicateInProgress(
      recentItems.filter((item) => shouldTreatAsInProgressForContinueWatching(item))
    );

    return inProgressOnly.slice(0, limit);
  }

  async getAll() {
    return WatchProgressStore.listForProfile(activeProfileId());
  }

  async replaceAll(items) {
    WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchProgressRepository = new WatchProgressRepository();
