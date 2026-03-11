import { AuthManager } from "../auth/authManager.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";

const TABLE = "tv_watch_progress";
const FALLBACK_TABLE = "watch_progress";
const PULL_RPC = "sync_pull_watch_progress";
const PUSH_RPC = "sync_push_watch_progress";

function progressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const videoId = String(item.videoId || "main").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${videoId}::${season}::${episode}`;
}

function mergeProgressItems(localItems = [], remoteItems = []) {
  const byKey = new Map();
  const upsert = (item) => {
    if (!item?.contentId) {
      return;
    }
    const key = progressKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingUpdated = Number(existing.updatedAt || 0);
    const incomingUpdated = Number(item.updatedAt || 0);
    if (incomingUpdated > existingUpdated) {
      byKey.set(key, item);
      return;
    }
    if (incomingUpdated === existingUpdated) {
      const existingPos = Number(existing.positionMs || 0);
      const incomingPos = Number(item.positionMs || 0);
      if (incomingPos > existingPos) {
        byKey.set(key, item);
      }
    }
  };
  localItems.forEach(upsert);
  remoteItems.forEach(upsert);
  return Array.from(byKey.values()).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function shouldTryLegacyTable(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && error.code === "PGRST205") {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("PGRST205") || message.includes("Could not find the table");
}

function mapProgressRow(row = {}) {
  const contentId = row.content_id || row.contentId || "";
  const contentType = row.content_type || row.contentType || "movie";
  const updatedAtRaw = row.updated_at ?? row.last_watched ?? row.lastWatched ?? null;
  const updatedAt = (() => {
    if (updatedAtRaw == null) {
      return Date.now();
    }
    const numeric = Number(updatedAtRaw);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : Math.trunc(numeric * 1000);
    }
    const parsed = new Date(updatedAtRaw).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const positionMsRaw = row.position_ms ?? row.position ?? 0;
  const durationMsRaw = row.duration_ms ?? row.duration ?? 0;
  const seasonRaw = row.season ?? row.season_number ?? null;
  const episodeRaw = row.episode ?? row.episode_number ?? null;
  const seasonNum = Number(seasonRaw);
  const episodeNum = Number(episodeRaw);
  const toMs = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    if (n > 1_000_000_000_000) {
      return n;
    }
    return n < 1_000_000 ? Math.trunc(n * 1000) : Math.trunc(n);
  };
  return {
    contentId,
    contentType,
    videoId: row.video_id || row.videoId || null,
    season: Number.isFinite(seasonNum) && seasonNum > 0 ? seasonNum : null,
    episode: Number.isFinite(episodeNum) && episodeNum > 0 ? episodeNum : null,
    positionMs: toMs(positionMsRaw),
    durationMs: toMs(durationMsRaw),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function toSeconds(valueMs) {
  const n = Number(valueMs || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.max(0, Math.trunc(n / 1000));
}

function hasNoConflictConstraint(error) {
  if (!error) {
    return false;
  }
  if (String(error.code || "") === "42P10") {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("no unique or exclusion constraint");
}

function toProgressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const videoId = String(item.videoId || "main").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}:${videoId}:${season}:${episode}`;
}

export const WatchProgressSyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const localItems = await watchProgressRepository.getAll();
      const profileId = resolveProfileId();
      let rows = [];
      try {
        rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: profileId }, true);
      } catch (rpcError) {
        const ownerId = await AuthManager.getEffectiveUserId();
        try {
          rows = await SupabaseApi.select(
            FALLBACK_TABLE,
            `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=last_watched.desc`,
            true
          );
        } catch (_) {
          try {
            rows = await SupabaseApi.select(
              FALLBACK_TABLE,
              `user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=last_watched.desc`,
              true
            );
          } catch (primaryError) {
            if (!shouldTryLegacyTable(primaryError)) {
              throw rpcError;
            }
            rows = await SupabaseApi.select(
              TABLE,
              `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=updated_at.desc`,
              true
            );
          }
        }
      }
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowProfile = row?.profile_id ?? row?.profileId ?? null;
        if (rowProfile == null || rowProfile === "") {
          return true;
        }
        return String(rowProfile) === String(profileId);
      });
      const remoteItems = filteredRows.map((row) => mapProgressRow(row)).filter((item) => Boolean(item.contentId));
      const mergedItems = mergeProgressItems(localItems, remoteItems);
      await watchProgressRepository.replaceAll(mergedItems);
      return mergedItems;
    } catch (error) {
      console.warn("Watch progress sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const items = await watchProgressRepository.getAll();
      if (!items.length) {
        return true;
      }
      const profileId = resolveProfileId();
      try {
        await SupabaseApi.rpc(PUSH_RPC, {
          p_profile_id: profileId,
          p_entries: items.map((item) => ({
            content_id: item.contentId,
            content_type: item.contentType || "movie",
            video_id: item.videoId || item.contentId || null,
            season: item.season == null ? null : Number(item.season),
            episode: item.episode == null ? null : Number(item.episode),
            position: toSeconds(item.positionMs),
            duration: toSeconds(item.durationMs),
            last_watched: Number(item.updatedAt || Date.now()),
            progress_key: toProgressKey(item)
          }))
        }, true);
        return true;
      } catch (rpcError) {
        console.warn("Watch progress sync push RPC failed, falling back to table sync", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      const rows = items.map((item) => ({
        owner_id: ownerId,
        content_id: item.contentId,
        content_type: item.contentType,
        video_id: item.videoId || item.contentId || null,
        season: item.season == null ? null : Number(item.season),
        episode: item.episode == null ? null : Number(item.episode),
        position_ms: item.positionMs || 0,
        duration_ms: item.durationMs || 0,
        updated_at: new Date(item.updatedAt || Date.now()).toISOString()
      }));
      try {
        const fallbackRows = items.map((item) => ({
          user_id: ownerId,
          content_id: item.contentId,
          content_type: item.contentType,
          video_id: item.videoId || item.contentId,
          season: item.season == null ? null : Number(item.season),
          episode: item.episode == null ? null : Number(item.episode),
          position: Math.max(0, Math.trunc(Number(item.positionMs || 0) / 1000)),
          duration: Math.max(0, Math.trunc(Number(item.durationMs || 0) / 1000)),
          last_watched: Number(item.updatedAt || Date.now()),
          progress_key: toProgressKey(item),
          profile_id: profileId
        }));
        try {
          await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,progress_key", true);
        } catch (conflictError) {
          if (!hasNoConflictConstraint(conflictError)) {
            throw conflictError;
          }
          await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,content_id,video_id", true);
        }
      } catch (primaryError) {
        if (!shouldTryLegacyTable(primaryError)) {
          throw primaryError;
        }
        try {
          await SupabaseApi.upsert(TABLE, rows, "owner_id,content_id,video_id", true);
        } catch (conflictError) {
          if (!hasNoConflictConstraint(conflictError)) {
            throw conflictError;
          }
          await SupabaseApi.upsert(TABLE, rows, "owner_id,content_id", true);
        }
      }
      return true;
    } catch (error) {
      console.warn("Watch progress sync push failed", error);
      return false;
    }
  }

};
