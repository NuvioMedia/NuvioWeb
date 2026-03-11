import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { PluginRuntime } from "../player/pluginRuntime.js";
import { ProfileManager } from "./profileManager.js";

const TABLE = "plugins";
const PUSH_RPC = "sync_push_plugins";

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

async function resolvePluginProfileId() {
  const profileId = resolveProfileId();
  if (profileId === 1) {
    return 1;
  }
  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => {
    const id = Number(profile?.profileIndex || profile?.id || 1);
    return Number.isFinite(id) && Math.trunc(id) === profileId;
  });
  const usesPrimaryPlugins = typeof activeProfile?.usesPrimaryPlugins === "boolean"
    ? activeProfile.usesPrimaryPlugins
    : (typeof activeProfile?.uses_primary_plugins === "boolean"
      ? activeProfile.uses_primary_plugins
      : false);
  return usesPrimaryPlugins ? 1 : profileId;
}

function shouldTryLegacyTable(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && (error.code === "PGRST205" || error.code === "PGRST202")) {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("PGRST205")
    || message.includes("PGRST202")
    || message.includes("Could not find the table")
    || message.includes("Could not find the function");
}

function sourceIdFromUrl(url, index) {
  const compact = String(url || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-18)
    .toLowerCase();
  return `plugin_${index + 1}_${compact || "source"}`;
}

function mapRemoteRowsToSources(rows = []) {
  return (rows || [])
    .map((row, index) => {
      const url = row.url || row.url_template || row.urlTemplate || "";
      if (!url) {
        return null;
      }
      return {
        id: sourceIdFromUrl(url, index),
        name: row.name || `Plugin ${index + 1}`,
        urlTemplate: url,
        enabled: row.enabled !== false
      };
    })
    .filter(Boolean);
}

function sourceKey(source = {}) {
  return String(source.urlTemplate || "").trim();
}

function mergeSources(localSources = [], remoteSources = []) {
  if (!remoteSources.length) {
    return [...localSources];
  }
  const localByKey = new Map();
  localSources.forEach((source) => {
    const key = sourceKey(source);
    if (!key) {
      return;
    }
    localByKey.set(key, source);
  });

  const merged = [];
  remoteSources.forEach((remoteSource, index) => {
    const key = sourceKey(remoteSource);
    if (!key) {
      return;
    }
    const localSource = localByKey.get(key);
    merged.push({
      ...(localSource || {}),
      ...remoteSource,
      id: remoteSource.id || localSource?.id || sourceIdFromUrl(key, index)
    });
    localByKey.delete(key);
  });

  localByKey.forEach((localSource) => {
    merged.push(localSource);
  });

  return merged;
}

function readLocalSources() {
  return PluginRuntime.listSources();
}

function writeLocalSources(sources) {
  PluginRuntime.saveSources(sources || []);
}

export const PluginSyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const localSources = readLocalSources();
      const profileId = await resolvePluginProfileId();
      const ownerId = await AuthManager.getEffectiveUserId();
      const rows = await SupabaseApi.select(
        TABLE,
        `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=url,name,enabled,sort_order&order=sort_order.asc`,
        true
      );
      const remoteSources = mapRemoteRowsToSources(rows);
      if (!remoteSources.length && localSources.length) {
        return localSources;
      }
      const mergedSources = mergeSources(localSources, remoteSources);
      writeLocalSources(mergedSources);
      return mergedSources;
    } catch (error) {
      console.warn("Plugin sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const profileId = await resolvePluginProfileId();
      const sources = readLocalSources();
      try {
        await SupabaseApi.rpc(PUSH_RPC, {
          p_profile_id: profileId,
          p_plugins: sources.map((source, index) => ({
            url: source.urlTemplate,
            name: source.name || `Plugin ${index + 1}`,
            enabled: source.enabled !== false,
            sort_order: index
          }))
        }, true);
        return true;
      } catch (rpcError) {
        if (!shouldTryLegacyTable(rpcError)) {
          throw rpcError;
        }
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      const rows = sources.map((source, index) => ({
        user_id: ownerId,
        profile_id: profileId,
        url: source.urlTemplate,
        name: source.name || `Plugin ${index + 1}`,
        enabled: source.enabled !== false,
        sort_order: index
      }));
      await SupabaseApi.delete(
        TABLE,
        `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
        true
      );
      if (rows.length) {
        try {
          await SupabaseApi.upsert(TABLE, rows, "user_id,profile_id,url", true);
        } catch (upsertError) {
          await SupabaseApi.upsert(TABLE, rows, null, true);
        }
      }
      return true;
    } catch (error) {
      console.warn("Plugin sync push failed", error);
      return false;
    }
  }

};
