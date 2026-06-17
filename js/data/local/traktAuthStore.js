import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const STORE_KEY = "traktAuthState";
const TOKEN_MAX_LIFETIME_SECONDS = 86400;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function clone(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeLifetimeSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return TOKEN_MAX_LIFETIME_SECONDS;
  }
  return Math.min(TOKEN_MAX_LIFETIME_SECONDS, Math.trunc(seconds));
}

function normalizeState(value = {}) {
  return {
    accessToken: String(value.accessToken || "") || null,
    refreshToken: String(value.refreshToken || "") || null,
    tokenType: String(value.tokenType || "") || null,
    createdAt: Number(value.createdAt || 0) || null,
    expiresIn: value.expiresIn == null ? null : normalizeLifetimeSeconds(value.expiresIn),
    username: String(value.username || "") || null,
    userSlug: String(value.userSlug || "") || null,
    deviceCode: String(value.deviceCode || "") || null,
    userCode: String(value.userCode || "") || null,
    verificationUrl: String(value.verificationUrl || "") || null,
    expiresAt: Number(value.expiresAt || 0) || null,
    pollInterval: Number(value.pollInterval || 0) || null
  };
}

function readEnvelope() {
  const raw = LocalStore.get(STORE_KEY, null);
  if (raw && typeof raw === "object" && raw.profiles && typeof raw.profiles === "object") {
    return {
      version: 1,
      profiles: Object.fromEntries(
        Object.entries(raw.profiles).map(([profileId, value]) => [
          String(profileId),
          normalizeState(value)
        ])
      )
    };
  }
  return { version: 1, profiles: {} };
}

function writeEnvelope(envelope) {
  LocalStore.set(STORE_KEY, envelope);
}

function readProfileState(profileId = activeProfileId()) {
  const envelope = readEnvelope();
  return clone(normalizeState(envelope.profiles[String(profileId)] || {}));
}

function writeProfileState(profileId, nextState) {
  const envelope = readEnvelope();
  envelope.profiles[String(profileId)] = normalizeState(nextState || {});
  writeEnvelope(envelope);
  return clone(envelope.profiles[String(profileId)]);
}

export const TraktAuthStore = {
  get(profileId = activeProfileId()) {
    return readProfileState(profileId);
  },

  isAuthenticated(profileId = activeProfileId()) {
    const state = readProfileState(profileId);
    return Boolean(state.accessToken && state.refreshToken);
  },

  saveDeviceFlow(data = {}, profileId = activeProfileId()) {
    const now = Date.now();
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      deviceCode: data.device_code || data.deviceCode || null,
      userCode: data.user_code || data.userCode || null,
      verificationUrl: data.verification_url || data.verificationUrl || "https://trakt.tv/activate",
      expiresAt: now + Number(data.expires_in || data.expiresIn || 0) * 1000,
      pollInterval: Number(data.interval || data.pollInterval || 5) || 5
    });
  },

  updatePollInterval(seconds, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      pollInterval: Math.max(1, Number(seconds || 5) || 5)
    });
  },

  saveToken(data = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      accessToken: data.access_token || data.accessToken || null,
      refreshToken: data.refresh_token || data.refreshToken || null,
      tokenType: data.token_type || data.tokenType || "bearer",
      createdAt: Number(data.created_at || data.createdAt || Math.floor(Date.now() / 1000)),
      expiresIn: normalizeLifetimeSeconds(
        data.expires_in || data.expiresIn || TOKEN_MAX_LIFETIME_SECONDS
      ),
      deviceCode: null,
      userCode: null,
      verificationUrl: null,
      expiresAt: null,
      pollInterval: null
    });
  },

  saveUser({ username = null, userSlug = null } = {}, profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      username: username || null,
      userSlug: userSlug || null
    });
  },

  clearDeviceFlow(profileId = activeProfileId()) {
    const current = readProfileState(profileId);
    return writeProfileState(profileId, {
      ...current,
      deviceCode: null,
      userCode: null,
      verificationUrl: null,
      expiresAt: null,
      pollInterval: null
    });
  },

  clearAuth(profileId = activeProfileId()) {
    return writeProfileState(profileId, {});
  }
};
