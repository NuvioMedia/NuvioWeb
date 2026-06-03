import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { CollectionsStore } from "../../data/local/collectionsStore.js";
import { ProfileManager } from "./profileManager.js";

const PULL_RPC = "sync_pull_collections";
const PUSH_RPC = "sync_push_collections";
const PUSH_DEBOUNCE_MS = 500;

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseRemoteCollectionsPayload(blob = null) {
  const raw = blob?.collections_json ?? blob?.collectionsJson ?? blob ?? [];
  if (typeof raw === "string") {
    return CollectionsStore.importFromJson(raw);
  }
  try {
    return CollectionsStore.importFromJson(JSON.stringify(raw));
  } catch (_) {
    return [];
  }
}

export const CollectionSyncService = {
  syncingFromRemoteProfiles: new Set(),
  pushTimers: new Map(),

  isSyncingFromRemote(profileId = null) {
    return this.syncingFromRemoteProfiles.has(resolveProfileId(profileId));
  },

  async push(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    try {
      const collectionsJson = CollectionsStore.exportCurrentProfileJson(resolvedProfileId);
      const parsedJson = CollectionsStore.importFromJson(collectionsJson);
      await SupabaseApi.rpc(PUSH_RPC, {
        p_profile_id: resolvedProfileId,
        p_collections_json: parsedJson
      }, true);
      return true;
    } catch (error) {
      console.warn("Collection sync push failed", error);
      return false;
    }
  },

  async pull(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    try {
      const rows = await SupabaseApi.rpc(PULL_RPC, {
        p_profile_id: resolvedProfileId
      }, true);
      const blob = Array.isArray(rows) ? (rows[0] || null) : (rows || null);
      if (!blob) {
        return false;
      }

      const remoteCollections = parseRemoteCollectionsPayload(blob);
      const localCollections = CollectionsStore.getForProfile(resolvedProfileId);
      if (stableStringify(remoteCollections) === stableStringify(localCollections)) {
        return false;
      }

      this.syncingFromRemoteProfiles.add(resolvedProfileId);
      try {
        CollectionsStore.replaceForProfile(resolvedProfileId, remoteCollections, { silentSync: true });
      } finally {
        this.syncingFromRemoteProfiles.delete(resolvedProfileId);
      }
      return true;
    } catch (error) {
      console.warn("Collection sync pull failed", error);
      return false;
    }
  },

  triggerPush(profileId = null) {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    const resolvedProfileId = resolveProfileId(profileId);
    if (this.isSyncingFromRemote(resolvedProfileId)) {
      return;
    }
    const existingTimer = this.pushTimers.get(resolvedProfileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timerId = setTimeout(() => {
      this.pushTimers.delete(resolvedProfileId);
      void this.push(resolvedProfileId);
    }, PUSH_DEBOUNCE_MS);
    this.pushTimers.set(resolvedProfileId, timerId);
  }
};
