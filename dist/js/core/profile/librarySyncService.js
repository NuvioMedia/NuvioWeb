import { AuthManager } from "../auth/authManager.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";

const ADDONS_TABLE = "addons";
const TABLE = "tv_addons";

function isMissingResourceError(error) {
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

function isOnConflictConstraintError(error) {
  if (!error) {
    return false;
  }
  if (typeof error.code === "string" && error.code === "42P10") {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("42P10")
    || message.includes("no unique or exclusion constraint matching the ON CONFLICT specification");
}

async function resolveProfileId() {
  const activeId = String(ProfileManager.getActiveProfileId() || "1");
  const direct = Number(activeId);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => String(profile.id) === activeId);
  const candidate = Number(activeProfile?.profileIndex || activeProfile?.id || 1);
  return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 1;
}

async function resolveAddonProfileId() {
  const profileId = await resolveProfileId();
  if (profileId === 1) {
    return 1;
  }

  const profiles = await ProfileManager.getProfiles();
  const activeProfile = profiles.find((profile) => {
    const id = Number(profile?.profileIndex || profile?.id || 1);
    return Number.isFinite(id) && Math.trunc(id) === profileId;
  });
  const usesPrimaryAddons = typeof activeProfile?.usesPrimaryAddons === "boolean"
    ? activeProfile.usesPrimaryAddons
    : (typeof activeProfile?.uses_primary_addons === "boolean"
      ? activeProfile.uses_primary_addons
      : true);

  return usesPrimaryAddons ? 1 : profileId;
}

function extractAddonUrls(rows = []) {
  return (rows || [])
    .map((row) => row?.url || row?.base_url || null)
    .filter(Boolean);
}

export const LibrarySyncService = {

  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        console.warn("[AddonSync] pull skipped: auth state is not AUTHENTICATED");
        return [];
      }
      const localUrls = addonRepository.getInstalledAddonUrls();
      const profileId = await resolveAddonProfileId();
      console.log(`[AddonSync] pull start profileId=${profileId}`);
      const ownerId = await AuthManager.getEffectiveUserId();
      let addonTableMissing = false;

      try {
        const addonRows = await SupabaseApi.select(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=url,sort_order&order=sort_order.asc`,
          true
        );
        const addonUrls = extractAddonUrls(addonRows);
        console.log(`[AddonSync] pull table addons returned ${addonUrls.length} urls`);
        await addonRepository.setAddonOrder(addonUrls, { silent: true });
        return addonUrls;
      } catch (addonsTableError) {
        addonTableMissing = isMissingResourceError(addonsTableError);
        console.warn("Addon sync pull addons-table read failed", addonsTableError);
      }

      let tvTableMissing = false;
      try {
        const rows = await SupabaseApi.select(
          TABLE,
          `owner_id=eq.${encodeURIComponent(ownerId)}&select=base_url,position&order=position.asc`,
          true
        );
        const urls = extractAddonUrls(rows);
        console.log(`[AddonSync] pull table ${TABLE} returned ${urls.length} urls`);
        await addonRepository.setAddonOrder(urls, { silent: true });
        return urls;
      } catch (tvTableError) {
        tvTableMissing = isMissingResourceError(tvTableError);
        console.warn("Addon sync pull tv-table read failed", tvTableError);
      }

      if (addonTableMissing && tvTableMissing) {
        try {
          const rpcRows = await SupabaseApi.rpc(
            "sync_pull_addons",
            { p_profile_id: profileId },
            true
          );
          const urls = extractAddonUrls(rpcRows);
          console.log(`[AddonSync] pull RPC sync_pull_addons returned ${urls.length} urls`);
          await addonRepository.setAddonOrder(urls, { silent: true });
          return urls;
        } catch (rpcError) {
          console.warn("Addon sync pull RPC failed", rpcError);
        }
      }

      if (localUrls.length) {
        console.log("[AddonSync] no remote addon source available, preserving local addons");
        return localUrls;
      }
      return [];
    } catch (error) {
      console.warn("Library sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        console.warn("[AddonSync] push skipped: auth state is not AUTHENTICATED");
        return false;
      }
      const profileId = await resolveAddonProfileId();
      const urls = addonRepository.getInstalledAddonUrls();
      console.log(`[AddonSync] push start profileId=${profileId} urls=${urls.length}`);

      try {
        await SupabaseApi.rpc(
          "sync_push_addons",
          {
            p_profile_id: profileId,
            p_addons: urls.map((url, index) => ({
              url,
              sort_order: index
            }))
          },
          true
        );
        return true;
      } catch (rpcError) {
        console.warn("Addon sync push RPC failed, falling back to legacy table", rpcError);
      }

      const ownerId = await AuthManager.getEffectiveUserId();
      try {
        await SupabaseApi.delete(
          ADDONS_TABLE,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
          true
        );
        const addonRows = urls.map((url, index) => ({
          user_id: ownerId,
          profile_id: profileId,
          url,
          sort_order: index
        }));
        if (addonRows.length) {
          try {
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, "user_id,profile_id,url", true);
          } catch (upsertError) {
            if (!isOnConflictConstraintError(upsertError)) {
              throw upsertError;
            }
            await SupabaseApi.upsert(ADDONS_TABLE, addonRows, null, true);
          }
        }
        return true;
      } catch (addonsTableError) {
        if (!isMissingResourceError(addonsTableError)) {
          console.warn("Addon sync push addons-table fallback failed", addonsTableError);
          return false;
        }
        console.warn("Addon sync push addons-table missing, trying tv_addons fallback", addonsTableError);
      }

      const rows = urls.map((baseUrl, index) => ({
        owner_id: ownerId,
        base_url: baseUrl,
        position: index
      }));
      try {
        await SupabaseApi.delete(TABLE, `owner_id=eq.${encodeURIComponent(ownerId)}`, true);
        if (rows.length) {
          await SupabaseApi.upsert(TABLE, rows, "owner_id,base_url", true);
        }
        return true;
      } catch (tvTableError) {
        console.warn("Addon sync push tv_addons fallback failed", tvTableError);
        return false;
      }
    } catch (error) {
      console.warn("Library sync push failed", error);
      return false;
    }
  }

};
