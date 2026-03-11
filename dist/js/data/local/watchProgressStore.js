import { LocalStore } from "../../core/storage/localStore.js";

const WATCH_PROGRESS_KEY = "watchProgressItems";

function normalizeProgress(progress = {}, profileId = 1) {
  const updatedAt = Number(progress.updatedAt || Date.now());
  const season = progress.season == null ? null : Number(progress.season);
  const episode = progress.episode == null ? null : Number(progress.episode);
  const normalizedProfileId = String(progress.profileId || profileId || "1");
  return {
    ...progress,
    profileId: normalizedProfileId,
    contentId: String(progress.contentId || "").trim(),
    contentType: String(progress.contentType || "movie").trim() || "movie",
    videoId: progress.videoId == null ? null : String(progress.videoId),
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function progressKey(progress = {}) {
  const profileId = String(progress.profileId || "1").trim() || "1";
  const contentId = String(progress.contentId || "").trim();
  const videoId = progress.videoId == null ? "main" : String(progress.videoId).trim();
  const season = progress.season == null ? "" : String(Number(progress.season));
  const episode = progress.episode == null ? "" : String(Number(progress.episode));
  return `${profileId}::${contentId}::${videoId}::${season}::${episode}`;
}

function dedupeAndSort(items = []) {
  const byKey = new Map();
  (items || []).forEach((raw) => {
    const item = normalizeProgress(raw);
    if (!item.contentId) {
      return;
    }
    const key = progressKey(item);
    const existing = byKey.get(key);
    if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

export const WatchProgressStore = {

  listAll() {
    return dedupeAndSort(LocalStore.get(WATCH_PROGRESS_KEY, []));
  },

  listForProfile(profileId) {
    const pid = String(profileId || "1");
    return this.listAll().filter((item) => String(item.profileId || "1") === pid);
  },

  upsert(progress, profileId) {
    const pid = String(profileId || "1");
    const normalized = normalizeProgress(progress, pid);
    if (!normalized.contentId) {
      return;
    }
    const items = this.listAll();
    const key = progressKey(normalized);
    const next = dedupeAndSort([
      normalized,
      ...items.filter((item) => progressKey(item) !== key)
    ]).slice(0, 5000);
    LocalStore.set(WATCH_PROGRESS_KEY, next);
  },

  findByContentId(contentId, profileId) {
    const wanted = String(contentId || "").trim();
    return this.listForProfile(profileId).find((item) => item.contentId === wanted) || null;
  },

  remove(contentId, videoId = null, profileId) {
    const wantedContentId = String(contentId || "").trim();
    const wantedVideoId = videoId == null ? null : String(videoId);
    const pid = String(profileId || "1");
    const next = this.listAll().filter((item) => {
      if (String(item.profileId || "1") !== pid) {
        return true;
      }
      if (item.contentId !== wantedContentId) {
        return true;
      }
      if (wantedVideoId == null) {
        return false;
      }
      return String(item.videoId || "") !== wantedVideoId;
    });
    LocalStore.set(WATCH_PROGRESS_KEY, next);
  },

  replaceForProfile(profileId, items = []) {
    const pid = String(profileId || "1");
    const keepOtherProfiles = this.listAll().filter((item) => String(item.profileId || "1") !== pid);
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeProgress(item, pid))
      .filter((item) => Boolean(item.contentId));
    const next = dedupeAndSort([...normalized, ...keepOtherProfiles]).slice(0, 5000);
    LocalStore.set(WATCH_PROGRESS_KEY, next);
  }

};
