import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { ProfileManager } from "./profileManager.js";

const PULL_RPC = "sync_pull_watched_items";
const PUSH_RPC = "sync_push_watched_items";

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function mapRemoteItem(row = {}) {
  const watchedAtRaw = row.watched_at || row.watchedAt || null;
  const numeric = Number(watchedAtRaw);
  const parsedDate = Number.isFinite(numeric) ? numeric : new Date(watchedAtRaw).getTime();
  return {
    contentId: row.content_id || row.contentId || "",
    contentType: row.content_type || row.contentType || "movie",
    title: row.title || row.name || "",
    season: row.season == null ? null : Number(row.season),
    episode: row.episode == null ? null : Number(row.episode),
    watchedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now()
  };
}

function watchedItemKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}:${season}:${episode}`;
}

function mergeWatchedItems(localItems = [], remoteItems = []) {
  if (!remoteItems.length) {
    return [...localItems];
  }
  const byKey = new Map();
  const upsert = (item, remote = false) => {
    const key = watchedItemKey(item);
    if (key.startsWith(":")) {
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingWatchedAt = Number(existing.watchedAt || 0);
    const incomingWatchedAt = Number(item.watchedAt || 0);
    if (incomingWatchedAt > existingWatchedAt || (incomingWatchedAt === existingWatchedAt && remote)) {
      byKey.set(key, item);
    }
  };
  localItems.forEach((item) => upsert(item, false));
  remoteItems.forEach((item) => upsert(item, true));
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0));
}

function toRemoteItem(item = {}) {
  return {
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    title: item.title || "",
    season: item.season == null ? null : Number(item.season),
    episode: item.episode == null ? null : Number(item.episode),
    watched_at: Number(item.watchedAt || Date.now())
  };
}

export const WatchedItemsSyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const localItems = await watchedItemsRepository.getAll(5000);
      const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: resolveProfileId() }, true);
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId));
      if (!remoteItems.length && localItems.length) {
        return localItems;
      }
      const mergedItems = mergeWatchedItems(localItems, remoteItems);
      await watchedItemsRepository.replaceAll(mergedItems);
      return mergedItems;
    } catch (error) {
      console.warn("Watched items sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const items = await watchedItemsRepository.getAll(5000);
      await SupabaseApi.rpc(PUSH_RPC, {
        p_profile_id: resolveProfileId(),
        p_items: items.map((item) => toRemoteItem(item))
      }, true);
      return true;
    } catch (error) {
      console.warn("Watched items sync push failed", error);
      return false;
    }
  }

};
