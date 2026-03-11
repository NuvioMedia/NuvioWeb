import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { savedLibraryRepository } from "../../data/repository/savedLibraryRepository.js";
import { ProfileManager } from "./profileManager.js";

const PULL_RPC = "sync_pull_library";
const PUSH_RPC = "sync_push_library";

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function mapRemoteItem(row = {}) {
  const contentId = row.content_id || row.contentId || row.id || "";
  const updatedAtRaw = row.updated_at || row.updatedAt || row.created_at || row.createdAt || null;
  const updatedAt = Number(updatedAtRaw);
  return {
    contentId,
    contentType: row.content_type || row.contentType || "movie",
    title: row.name || row.title || "Untitled",
    poster: row.poster || null,
    background: row.background || null,
    description: row.description || "",
    releaseInfo: row.release_info || row.releaseInfo || "",
    imdbRating: row.imdb_rating || row.imdbRating || null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    addonBaseUrl: row.addon_base_url || row.addonBaseUrl || null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function libraryItemKey(item = {}) {
  const contentType = String(item.contentType || "movie").trim();
  const contentId = String(item.contentId || "").trim();
  return `${contentType}:${contentId}`;
}

function mergeLibraryItems(localItems = [], remoteItems = []) {
  if (!remoteItems.length) {
    return [...localItems];
  }
  const byKey = new Map();
  const upsert = (item, remote = false) => {
    if (!item?.contentId) {
      return;
    }
    const key = libraryItemKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingUpdated = Number(existing.updatedAt || 0);
    const incomingUpdated = Number(item.updatedAt || 0);
    if (incomingUpdated > existingUpdated || (incomingUpdated === existingUpdated && remote)) {
      byKey.set(key, item);
    }
  };
  localItems.forEach((item) => upsert(item, false));
  remoteItems.forEach((item) => upsert(item, true));
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function toRemoteItem(item = {}) {
  return {
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    name: item.title || item.name || "Untitled",
    poster: item.poster || null,
    poster_shape: "POSTER",
    background: item.background || null,
    description: item.description || "",
    release_info: item.releaseInfo || "",
    imdb_rating: item.imdbRating == null ? null : Number(item.imdbRating),
    genres: Array.isArray(item.genres) ? item.genres : [],
    addon_base_url: item.addonBaseUrl || null
  };
}

export const SavedLibrarySyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const localItems = await savedLibraryRepository.getAll(1000);
      const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: resolveProfileId() }, true);
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId));
      if (!remoteItems.length && localItems.length) {
        return localItems;
      }
      const mergedItems = mergeLibraryItems(localItems, remoteItems);
      await savedLibraryRepository.replaceAll(mergedItems);
      return mergedItems;
    } catch (error) {
      console.warn("Saved library sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const items = await savedLibraryRepository.getAll(1000);
      await SupabaseApi.rpc(PUSH_RPC, {
        p_profile_id: resolveProfileId(),
        p_items: items.map((item) => toRemoteItem(item))
      }, true);
      return true;
    } catch (error) {
      console.warn("Saved library sync push failed", error);
      return false;
    }
  }

};
