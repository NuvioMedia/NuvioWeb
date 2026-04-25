import { AuthManager } from "../auth/authManager.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";

const TABLE = "tv_watch_progress";
const FALLBACK_TABLE = "watch_progress";
const PULL_RPC = "sync_pull_watch_progress";
const SYNTHETIC_EPISODE_VIDEO_PREFIX = "__nuvio_episode__:";
const PUSH_RETRY_BACKOFF_MS = 120000;

let activePushPromise = null;
let lastSuccessfulPushSignature = "";
let lastFailedPushSignature = "";
let lastFailedPushAt = 0;

function progressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const videoId = String(item.videoId || "main").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${videoId}::${season}::${episode}`;
}

function mergeProgressItems(localItems = [], remoteItems = []) {
  const localByKey = new Map(
    (Array.isArray(localItems) ? localItems : [])
      .filter((item) => Boolean(item?.contentId))
      .map((item) => [progressKey(item), item])
  );
  const remoteByKey = new Map(
    (Array.isArray(remoteItems) ? remoteItems : [])
      .filter((item) => Boolean(item?.contentId))
      .map((item) => [progressKey(item), item])
  );

  if (!remoteByKey.size) {
    return Array.from(localByKey.values())
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }

  const merged = [];
  remoteByKey.forEach((remoteItem, key) => {
    const localItem = localByKey.get(key);
    if (!localItem) {
      merged.push(remoteItem);
      return;
    }
    const remoteUpdatedAt = Number(remoteItem.updatedAt || 0);
    const localUpdatedAt = Number(localItem.updatedAt || 0);
    merged.push(remoteUpdatedAt > localUpdatedAt ? remoteItem : localItem);
  });

  return merged.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
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
  const rawVideoId = row.video_id || row.videoId || null;
  const normalizedVideoId = typeof rawVideoId === "string" && rawVideoId.trim() === contentId ? null : rawVideoId;
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
    videoId: typeof normalizedVideoId === "string" && normalizedVideoId.startsWith(SYNTHETIC_EPISODE_VIDEO_PREFIX)
      ? null
      : normalizedVideoId,
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

function toPositiveIntegerOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.trunc(n);
}

function toRemoteVideoId(item = {}) {
  const explicitVideoId = String(item.videoId || "").trim();
  const contentId = String(item.contentId || "").trim();
  if (explicitVideoId && explicitVideoId !== "main" && explicitVideoId !== contentId) {
    return explicitVideoId;
  }
  const season = toPositiveIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (season != null || episode != null) {
    return `${SYNTHETIC_EPISODE_VIDEO_PREFIX}${season || 0}:${episode || 0}`;
  }
  if (contentId) {
    return contentId;
  }
  return "main";
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
  const videoId = toRemoteVideoId(item);
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}:${videoId}:${season}:${episode}`;
}

function syncIdentityKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = toPositiveIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (contentId && season != null && episode != null) {
    return `${contentId}:episode:${season}:${episode}`;
  }
  return `${contentId}:video:${toRemoteVideoId(item)}`;
}

function dedupeSyncItems(items = []) {
  const byKey = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (!contentId) {
      return;
    }
    const key = toProgressKey(item);
    const existing = byKey.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values())
    .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0));
}

function coalesceSyncItems(items = []) {
  const byIdentity = new Map();
  dedupeSyncItems(items).forEach((item) => {
    const key = syncIdentityKey(item);
    const existing = byIdentity.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byIdentity.set(key, item);
    }
  });
  return Array.from(byIdentity.values())
    .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0));
}

function rowFreshness(row = {}) {
  const candidates = [
    row?.updated_at,
    row?.last_watched,
    row?.updatedAt
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function dedupeRowsForConflict(rows = [], onConflict = "") {
  const columns = String(onConflict || "")
    .split(",")
    .map((column) => String(column || "").trim())
    .filter(Boolean);
  if (!columns.length) {
    return Array.isArray(rows) ? rows : [];
  }
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = columns
      .map((column) => {
        const value = row?.[column];
        return value == null ? "" : String(value);
      })
      .join("::");
    const existing = byKey.get(key);
    if (!existing || rowFreshness(row) >= rowFreshness(existing)) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

function dedupeRemoteProgressEntries(rows = []) {
  return dedupeRowsForConflict(
    dedupeRowsForConflict(rows, "progress_key"),
    "content_id,video_id,season,episode"
  );
}

function buildRemoteProgressEntries(items = []) {
  return dedupeRemoteProgressEntries(items.map((item) => ({
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    video_id: toRemoteVideoId(item),
    season: item.season == null ? null : Number(item.season),
    episode: item.episode == null ? null : Number(item.episode),
    position: toSeconds(item.positionMs),
    duration: toSeconds(item.durationMs),
    last_watched: Number(item.updatedAt || Date.now()),
    progress_key: toProgressKey(item)
  })));
}

function buildLegacyFallbackRows(items = [], ownerId, profileId) {
  return buildRemoteProgressEntries(items).map((row) => ({
    user_id: ownerId,
    content_id: row.content_id,
    content_type: row.content_type,
    video_id: row.video_id,
    season: row.season,
    episode: row.episode,
    position: row.position,
    duration: row.duration,
    last_watched: row.last_watched,
    progress_key: row.progress_key,
    profile_id: profileId
  }));
}

function buildPrimaryRows(items = [], ownerId) {
  return dedupeRowsForConflict(items.map((item) => ({
    owner_id: ownerId,
    content_id: item.contentId,
    content_type: item.contentType,
    video_id: toRemoteVideoId(item),
    season: item.season == null ? null : Number(item.season),
    episode: item.episode == null ? null : Number(item.episode),
    position_ms: item.positionMs || 0,
    duration_ms: item.durationMs || 0,
    updated_at: new Date(item.updatedAt || Date.now()).toISOString()
  })), "owner_id,content_id,video_id,season,episode");
}

function buildPushSignature(rows = []) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row.progress_key || ""),
      String(row.video_id || ""),
      Number(row.season || 0),
      Number(row.episode || 0),
      Number(row.position || 0),
      Number(row.duration || 0),
      Number(row.last_watched || 0)
    ])
  );
}

async function upsertRowsIndividually(table, rows, conflictCandidates = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    await upsertWithConflictCandidates(table, [row], conflictCandidates);
  }
}

async function upsertWithConflictCandidates(table, rows, conflictCandidates = []) {
  let lastError = null;
  for (const onConflict of conflictCandidates) {
    try {
      const dedupedRows = dedupeRowsForConflict(rows, onConflict);
      await SupabaseApi.upsert(table, dedupedRows, onConflict, true);
      return;
    } catch (error) {
      lastError = error;
      if (!hasNoConflictConstraint(error)) {
        throw error;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
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
    if (activePushPromise) {
      return activePushPromise;
    }
    activePushPromise = (async () => {
      let pushSignature = "";
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const items = coalesceSyncItems(await watchProgressRepository.getAll());
        if (!items.length) {
          return true;
        }
        const profileId = resolveProfileId();
        const ownerId = await AuthManager.getEffectiveUserId();
        const fallbackRows = buildLegacyFallbackRows(items, ownerId, profileId);
        pushSignature = buildPushSignature(fallbackRows);
        if (pushSignature && pushSignature === lastSuccessfulPushSignature) {
          return true;
        }
        if (
          pushSignature
          && pushSignature === lastFailedPushSignature
          && (Date.now() - Number(lastFailedPushAt || 0)) < PUSH_RETRY_BACKOFF_MS
        ) {
          return false;
        }
        const rows = buildPrimaryRows(items, ownerId);
        try {
          await upsertRowsIndividually(FALLBACK_TABLE, fallbackRows, [
            "user_id,profile_id,progress_key",
            "user_id,progress_key",
            "user_id,profile_id,content_id,video_id",
            "user_id,content_id,video_id"
          ]);
        } catch (primaryError) {
          if (!shouldTryLegacyTable(primaryError)) {
            throw primaryError;
          }
          await upsertRowsIndividually(TABLE, rows, [
            "owner_id,content_id,video_id",
            "owner_id,content_id"
          ]);
        }
        lastSuccessfulPushSignature = pushSignature;
        lastFailedPushSignature = "";
        lastFailedPushAt = 0;
        return true;
      } catch (error) {
        if (typeof pushSignature === "string" && pushSignature) {
          lastFailedPushSignature = pushSignature;
        }
        lastFailedPushAt = Date.now();
        console.warn("Watch progress sync push failed", error);
        return false;
      }
    })().finally(() => {
      activePushPromise = null;
    });
    return activePushPromise;
  }

};
