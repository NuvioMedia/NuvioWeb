import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";

const PULL_RPC = "sync_pull_watched_items";
const PUSH_RPC = "sync_push_watched_items";
const DELETE_RPC = "sync_delete_watched_items";
const SYNC_STATE_KEY = "watchedItemsSyncState";
const WATCHED_ITEMS_PAGE_SIZE = 900;

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

function watchedStateForProfile(profileId = resolveProfileId()) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const profileState = state && typeof state === "object" ? state[String(profileId)] : null;
  return profileState && typeof profileState === "object" ? profileState : {};
}

function writeWatchedStateForProfile(profileId = resolveProfileId(), patch = {}) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const next = state && typeof state === "object" ? state : {};
  next[String(profileId)] = {
    ...(next[String(profileId)] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, next);
}

function mergeWatchedItems(localItems = [], remoteItems = [], lastSuccessfulPushAt = 0) {
  if (!remoteItems.length) {
    return [...localItems];
  }
  const byKey = new Map();
  const upsert = (item, preferIncomingOnTie = false) => {
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
    if (incomingWatchedAt > existingWatchedAt || (incomingWatchedAt === existingWatchedAt && preferIncomingOnTie)) {
      byKey.set(key, item);
    }
  };

  remoteItems.forEach((item) => upsert(item, true));
  if (lastSuccessfulPushAt > 0) {
    localItems.forEach((item) => {
      const key = watchedItemKey(item);
      if (!byKey.has(key) && Number(item.watchedAt || 0) > lastSuccessfulPushAt) {
        byKey.set(key, item);
      }
    });
  }
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

function toDeleteKey(item = {}) {
  const key = {
    content_id: item.contentId
  };
  if (item.season != null) {
    key.season = Number(item.season);
  }
  if (item.episode != null) {
    key.episode = Number(item.episode);
  }
  return key;
}

async function pullRemoteWatchedItems(profileId) {
  const allRows = [];
  let page = 1;
  while (true) {
    const rows = await SupabaseApi.rpc(PULL_RPC, {
      p_profile_id: profileId,
      p_page: page,
      p_page_size: WATCHED_ITEMS_PAGE_SIZE
    }, true);
    const pageRows = Array.isArray(rows) ? rows : [];
    allRows.push(...pageRows);
    if (pageRows.length < WATCHED_ITEMS_PAGE_SIZE) {
      return allRows;
    }
    page += 1;
  }
}

export const WatchedItemsSyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const profileId = resolveProfileId();
      const localItems = await watchedItemsRepository.getAll(5000);
      const rows = await pullRemoteWatchedItems(profileId);
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId));
      if (!remoteItems.length && localItems.length) {
        return localItems;
      }
      const mergedItems = mergeWatchedItems(
        localItems,
        remoteItems,
        Number(watchedStateForProfile(profileId).lastSuccessfulPushAt || 0)
      );
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
      writeWatchedStateForProfile(resolveProfileId(), { lastSuccessfulPushAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("Watched items sync push failed", error);
      return false;
    }
  },

  async deleteItems(items = []) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const keys = (Array.isArray(items) ? items : [])
        .filter((item) => Boolean(item?.contentId))
        .map((item) => toDeleteKey(item));
      if (!keys.length) {
        return true;
      }
      await SupabaseApi.rpc(DELETE_RPC, {
        p_profile_id: resolveProfileId(),
        p_keys: keys
      }, true);
      writeWatchedStateForProfile(resolveProfileId(), { lastSuccessfulPushAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("Watched items sync delete failed", error);
      return false;
    }
  }

};
