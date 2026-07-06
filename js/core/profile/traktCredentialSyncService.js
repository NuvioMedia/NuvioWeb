import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { ProfileManager } from "./profileManager.js";

const TRAKT_PROVIDER = "trakt";
const PULL_RPC = "sync_pull_provider_credentials";
const PUSH_RPC = "sync_push_provider_credentials";
const DELETE_RPC = "sync_delete_provider_credentials";
const TOKEN_FALLBACK_LIFETIME_SECONDS = 86400;

let syncInFlight = Promise.resolve();

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function normalizeLifetimeSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return TOKEN_FALLBACK_LIFETIME_SECONDS;
  }
  return Math.min(TOKEN_FALLBACK_LIFETIME_SECONDS, Math.trunc(seconds));
}

function credentialJsonFromState(state = {}) {
  const accessToken = String(state.accessToken || "").trim();
  const refreshToken = String(state.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    return null;
  }
  const credential = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: String(state.tokenType || "bearer").trim() || "bearer",
    created_at: Number(state.createdAt || Math.floor(Date.now() / 1000)),
    expires_in: normalizeLifetimeSeconds(state.expiresIn || TOKEN_FALLBACK_LIFETIME_SECONDS)
  };
  const username = String(state.username || "").trim();
  const userSlug = String(state.userSlug || "").trim();
  if (username) {
    credential.username = username;
  }
  if (userSlug) {
    credential.user_slug = userSlug;
  }
  return credential;
}

function stateFromCredentialJson(credential = {}) {
  if (!credential) {
    return null;
  }
  if (typeof credential === "string") {
    try {
      credential = JSON.parse(credential);
    } catch (_) {
      return null;
    }
  }
  if (typeof credential !== "object") {
    return null;
  }
  const accessToken = String(credential.access_token || credential.accessToken || "").trim();
  const refreshToken = String(credential.refresh_token || credential.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    tokenType: credential.token_type || credential.tokenType || "bearer",
    createdAt: Number(
      credential.created_at || credential.createdAt || Math.floor(Date.now() / 1000)
    ),
    expiresIn: normalizeLifetimeSeconds(
      credential.expires_in || credential.expiresIn || TOKEN_FALLBACK_LIFETIME_SECONDS
    ),
    username: credential.username || null,
    userSlug: credential.user_slug || credential.userSlug || null
  };
}

function syncSignature(state = {}) {
  return [
    state.accessToken || "",
    state.refreshToken || "",
    state.tokenType || "",
    state.createdAt == null ? "" : String(state.createdAt),
    state.expiresIn == null ? "" : String(normalizeLifetimeSeconds(state.expiresIn)),
    state.username || "",
    state.userSlug || ""
  ].join("|");
}

async function withSyncLock(task) {
  const previous = syncInFlight;
  let release;
  syncInFlight = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

export const TraktCredentialSyncService = {
  async pushCurrentToRemote(profileId = null) {
    const resolvedProfileId = resolveProfileId(profileId);
    return this.pushStateToRemote(TraktAuthStore.get(resolvedProfileId), resolvedProfileId);
  },

  async pushStateToRemote(state = {}, profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const credentialJson = credentialJsonFromState(state);
        if (!credentialJson) {
          return false;
        }
        const resolvedProfileId = resolveProfileId(profileId);
        await SupabaseApi.rpc(
          PUSH_RPC,
          {
            p_profile_id: resolvedProfileId,
            p_credentials: [
              {
                provider: TRAKT_PROVIDER,
                credential_json: credentialJson
              }
            ]
          },
          true
        );
        return true;
      } catch (error) {
        console.warn("Trakt credential sync push failed", error);
        return false;
      }
    });
  },

  async pullFromRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const resolvedProfileId = resolveProfileId(profileId);
        const credentials = await SupabaseApi.rpc(
          PULL_RPC,
          { p_profile_id: resolvedProfileId },
          true
        );
        const traktCredential = (Array.isArray(credentials) ? credentials : []).find(
          (entry) => String(entry?.provider || "").toLowerCase() === TRAKT_PROVIDER
        );
        const remoteState = stateFromCredentialJson(
          traktCredential?.credential_json || traktCredential?.credentialJson || null
        );
        if (!remoteState) {
          return false;
        }
        const localState = TraktAuthStore.get(resolvedProfileId);
        if (syncSignature(localState) === syncSignature(remoteState)) {
          return false;
        }
        TraktAuthStore.saveToken(remoteState, resolvedProfileId);
        TraktAuthStore.saveUser(
          { username: remoteState.username, userSlug: remoteState.userSlug },
          resolvedProfileId
        );
        return true;
      } catch (error) {
        console.warn("Trakt credential sync pull failed", error);
        return false;
      }
    });
  },

  async deleteRemote(profileId = null) {
    return withSyncLock(async () => {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        await SupabaseApi.rpc(
          DELETE_RPC,
          {
            p_profile_id: resolveProfileId(profileId),
            p_provider: TRAKT_PROVIDER
          },
          true
        );
        return true;
      } catch (error) {
        console.warn("Trakt credential sync delete failed", error);
        return false;
      }
    });
  }
};
