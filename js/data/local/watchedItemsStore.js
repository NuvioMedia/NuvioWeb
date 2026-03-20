import { LocalStore } from "../../core/storage/localStore.js";

const WATCHED_ITEMS_KEY = "watchedItems";

function normalizeEpisodeNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeItem(item = {}, profileId) {
  return {
    profileId: String(profileId || 1),
    contentId: String(item.contentId || ""),
    contentType: String(item.contentType || "movie"),
    title: String(item.title || ""),
    season: normalizeEpisodeNumber(item.season),
    episode: normalizeEpisodeNumber(item.episode),
    watchedAt: Number(item.watchedAt || Date.now())
  };
}

function watchedItemKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${season}::${episode}`;
}

function dedupeAndSort(items = []) {
  const byKey = new Map();
  (items || []).forEach((raw) => {
    const normalized = normalizeItem(raw, raw?.profileId);
    if (!normalized.contentId) {
      return;
    }
    const key = `${String(normalized.profileId || "1")}::${watchedItemKey(normalized)}`;
    const existing = byKey.get(key);
    if (!existing || Number(normalized.watchedAt || 0) >= Number(existing.watchedAt || 0)) {
      byKey.set(key, normalized);
    }
  });
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0));
}

export const WatchedItemsStore = {

  listAll() {
    const raw = LocalStore.get(WATCHED_ITEMS_KEY, []);
    return dedupeAndSort(Array.isArray(raw) ? raw : []);
  },

  listForProfile(profileId) {
    const pid = String(profileId || 1);
    return this.listAll().filter((item) => String(item.profileId || "1") === pid);
  },

  upsert(item, profileId) {
    const pid = String(profileId || 1);
    const normalized = normalizeItem(item, pid);
    if (!normalized.contentId) {
      return;
    }
    const key = watchedItemKey(normalized);
    const next = dedupeAndSort([
      normalized,
      ...this.listAll().filter((entry) => !(
        String(entry.profileId || "1") === pid
        && watchedItemKey(entry) === key
      ))
    ]).slice(0, 5000);
    LocalStore.set(WATCHED_ITEMS_KEY, next);
  },

  remove(contentId, profileId, options = null) {
    const pid = String(profileId || 1);
    const targetContentId = String(contentId || "");
    const targetSeason = normalizeEpisodeNumber(options?.season);
    const targetEpisode = normalizeEpisodeNumber(options?.episode);
    const hasScopedEpisode = targetSeason != null || targetEpisode != null;
    const next = this.listAll().filter((entry) => {
      if (String(entry.profileId || "1") !== pid || entry.contentId !== targetContentId) {
        return true;
      }
      if (!hasScopedEpisode) {
        return false;
      }
      return !(entry.season === targetSeason && entry.episode === targetEpisode);
    });
    LocalStore.set(WATCHED_ITEMS_KEY, next);
  },

  replaceForProfile(profileId, items = []) {
    const pid = String(profileId || 1);
    const keepOtherProfiles = this.listAll().filter((entry) => String(entry.profileId || "1") !== pid);
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem(item, pid))
      .filter((item) => Boolean(item.contentId));
    LocalStore.set(WATCHED_ITEMS_KEY, dedupeAndSort([...normalized, ...keepOtherProfiles]).slice(0, 5000));
  }

};
