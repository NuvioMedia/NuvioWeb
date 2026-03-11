import { AuthManager } from "../auth/authManager.js";
import { ProfileManager } from "./profileManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";

const TABLE = "tv_profiles";
const FALLBACK_TABLE = "profiles";
const PULL_RPC = "sync_pull_profiles";
const PUSH_RPC = "sync_push_profiles";

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

function mapProfileRow(row = {}) {
  const profileIndex = Number(
    row.profile_index
    || row.profileIndex
    || row.id
    || 1
  );
  const normalizedIndex = Number.isFinite(profileIndex) && profileIndex > 0
    ? Math.trunc(profileIndex)
    : 1;
  return {
    id: String(normalizedIndex),
    profileIndex: normalizedIndex,
    name: row.name || `Profile ${normalizedIndex}`,
    avatarColorHex: row.avatar_color_hex || row.avatarColorHex || "#1E88E5",
    usesPrimaryAddons: typeof row.uses_primary_addons === "boolean"
      ? row.uses_primary_addons
      : Boolean(row.usesPrimaryAddons),
    usesPrimaryPlugins: typeof row.uses_primary_plugins === "boolean"
      ? row.uses_primary_plugins
      : Boolean(row.usesPrimaryPlugins),
    isPrimary: typeof row.is_primary === "boolean"
      ? row.is_primary
      : normalizedIndex === 1
  };
}

export const ProfileSyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      let rows = [];
      try {
        rows = await SupabaseApi.rpc(PULL_RPC, {}, true);
      } catch (rpcError) {
        const ownerId = await AuthManager.getEffectiveUserId();
        try {
          rows = await SupabaseApi.select(
            FALLBACK_TABLE,
            `user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
            true
          );
        } catch (primaryError) {
          if (!shouldTryLegacyTable(primaryError)) {
            throw rpcError;
          }
          rows = await SupabaseApi.select(
            TABLE,
            `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
            true
          );
        }
      }
      const profiles = (rows || []).map((row) => mapProfileRow(row));
      if (profiles.length) {
        await ProfileManager.replaceProfiles(profiles);
      }
      return profiles;
    } catch (error) {
      console.warn("Profile sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const profiles = await ProfileManager.getProfiles();
      try {
        await SupabaseApi.rpc(PUSH_RPC, {
          p_profiles: profiles.map((profile) => {
            const profileIndex = Number(profile.profileIndex || profile.id || 1);
            return {
              profile_index: Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
              name: profile.name,
              avatar_color_hex: profile.avatarColorHex || "#1E88E5",
              uses_primary_addons: Boolean(profile.usesPrimaryAddons),
              uses_primary_plugins: Boolean(profile.usesPrimaryPlugins)
            };
          })
        }, true);
        return true;
      } catch (rpcError) {
        console.warn("Profile sync push RPC failed, falling back to table sync", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      const rows = profiles.map((profile) => {
        const profileIndex = Number(profile.profileIndex || profile.id || 1);
        return {
          id: profile.id,
          owner_id: ownerId,
          profile_index: Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
          name: profile.name,
          avatar_color_hex: profile.avatarColorHex || "#1E88E5",
          is_primary: Boolean(profile.isPrimary)
        };
      });

      const fallbackRows = rows.map((row) => ({
        user_id: ownerId,
        profile_index: row.profile_index,
        name: row.name,
        avatar_color_hex: row.avatar_color_hex,
        uses_primary_addons: row.profile_index !== 1,
        uses_primary_plugins: row.profile_index !== 1
      }));
      try {
        await SupabaseApi.delete(FALLBACK_TABLE, `user_id=eq.${encodeURIComponent(ownerId)}`, true);
        if (fallbackRows.length) {
          await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,profile_index", true);
        }
      } catch (primaryError) {
        if (!shouldTryLegacyTable(primaryError)) {
          throw primaryError;
        }
        await SupabaseApi.upsert(TABLE, rows, "id", true);
      }
      return true;
    } catch (error) {
      console.warn("Profile sync push failed", error);
      return false;
    }
  }

};
