import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const PROFILE_SCOPED_VERSION = 1;
const PROFILES_KEY = "profiles";
const SETTINGS_SYNC_DEBOUNCE_MS = 1500;

const scheduledSettingsSyncTimers = new Map();
const settingsSyncInFlightByProfile = new Map();

function normalizeProfileId(profileId) {
  const raw = String(profileId ?? ProfileManager.getActiveProfileId() ?? "1").trim();
  return raw || "1";
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isProfileScopedEnvelope(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value.__profileScoped === true
    && Number(value.version || 0) === PROFILE_SCOPED_VERSION
    && value.profiles
    && typeof value.profiles === "object"
  );
}

function getKnownProfileIds() {
  const storedProfiles = LocalStore.get(PROFILES_KEY, null);
  const ids = Array.isArray(storedProfiles)
    ? storedProfiles
      .map((profile) => String(profile?.id || profile?.profileIndex || "").trim())
      .filter(Boolean)
    : [];
  if (!ids.includes("1")) {
    ids.unshift("1");
  }
  return Array.from(new Set(ids));
}

function createEmptyEnvelope() {
  return {
    __profileScoped: true,
    version: PROFILE_SCOPED_VERSION,
    profiles: {}
  };
}

function normalizeEnvelopeProfiles(profiles = {}, normalize) {
  const normalized = {};
  Object.entries(profiles || {}).forEach(([profileId, value]) => {
    const normalizedProfileId = normalizeProfileId(profileId);
    normalized[normalizedProfileId] = normalize(cloneValue(value) || {});
  });
  return normalized;
}

function readEnvelope(key, normalize) {
  const raw = LocalStore.get(key, null);
  if (isProfileScopedEnvelope(raw)) {
    const next = {
      ...raw,
      profiles: normalizeEnvelopeProfiles(raw.profiles, normalize)
    };
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      LocalStore.set(key, next);
    }
    return next;
  }

  if (raw == null) {
    return createEmptyEnvelope();
  }

  const profileIds = getKnownProfileIds();
  const normalizedLegacy = normalize(cloneValue(raw) || {});
  const migrated = createEmptyEnvelope();
  profileIds.forEach((profileId) => {
    migrated.profiles[profileId] = cloneValue(normalizedLegacy);
  });
  LocalStore.set(key, migrated);
  return migrated;
}

function persistEnvelope(key, envelope) {
  LocalStore.set(key, envelope);
}

function ensureProfileValue(key, envelope, normalize, profileId) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (Object.prototype.hasOwnProperty.call(envelope.profiles, normalizedProfileId)) {
    return envelope.profiles[normalizedProfileId];
  }

  const primaryValue = envelope.profiles["1"];
  const seed = primaryValue != null
    ? cloneValue(primaryValue)
    : normalize({});
  envelope.profiles[normalizedProfileId] = normalize(seed || {});
  persistEnvelope(key, envelope);
  return envelope.profiles[normalizedProfileId];
}

export function queueProfileSettingsCloudSync(profileId = null, delayMs = SETTINGS_SYNC_DEBOUNCE_MS) {
  const normalizedProfileId = normalizeProfileId(profileId);
  if (scheduledSettingsSyncTimers.has(normalizedProfileId)) {
    clearTimeout(scheduledSettingsSyncTimers.get(normalizedProfileId));
  }
  const timerId = setTimeout(() => {
    scheduledSettingsSyncTimers.delete(normalizedProfileId);
    const runPush = async () => {
      const activePush = settingsSyncInFlightByProfile.get(normalizedProfileId);
      if (activePush) {
        await activePush.catch(() => false);
      }
      const pushPromise = import("../../core/profile/profileSettingsSyncService.js")
        .then(({ ProfileSettingsSyncService }) => ProfileSettingsSyncService.push(normalizedProfileId))
        .catch((error) => {
          console.warn("Profile settings sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          if (settingsSyncInFlightByProfile.get(normalizedProfileId) === pushPromise) {
            settingsSyncInFlightByProfile.delete(normalizedProfileId);
          }
        });
      settingsSyncInFlightByProfile.set(normalizedProfileId, pushPromise);
      await pushPromise;
    };
    void runPush();
  }, delayMs);
  scheduledSettingsSyncTimers.set(normalizedProfileId, timerId);
}

export function createProfileScopedStore({ key, normalize, merge }) {
  const mergeValues = typeof merge === "function"
    ? merge
    : (current, partial) => ({ ...(current || {}), ...(partial || {}) });

  return {
    getForProfile(profileId) {
      const envelope = readEnvelope(key, normalize);
      return cloneValue(ensureProfileValue(key, envelope, normalize, profileId));
    },

    get() {
      return this.getForProfile(normalizeProfileId());
    },

    replaceForProfile(profileId, nextValue, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize);
      const normalizedProfileId = normalizeProfileId(profileId);
      envelope.profiles[normalizedProfileId] = normalize(cloneValue(nextValue) || {});
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
      return cloneValue(envelope.profiles[normalizedProfileId]);
    },

    setForProfile(profileId, partial, { silentSync = false } = {}) {
      const current = this.getForProfile(profileId);
      return this.replaceForProfile(profileId, mergeValues(current, partial), { silentSync });
    },

    set(partial, options = {}) {
      return this.setForProfile(normalizeProfileId(options.profileId), partial, options);
    },

    clearProfile(profileId, { silentSync = false } = {}) {
      const envelope = readEnvelope(key, normalize);
      const normalizedProfileId = normalizeProfileId(profileId);
      delete envelope.profiles[normalizedProfileId];
      persistEnvelope(key, envelope);
      if (!silentSync) {
        queueProfileSettingsCloudSync(normalizedProfileId);
      }
    }
  };
}
