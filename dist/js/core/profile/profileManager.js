import { LocalStore } from "../storage/localStore.js";

const PROFILES_KEY = "profiles";
const ACTIVE_PROFILE_ID_KEY = "activeProfileId";

const DEFAULT_PROFILES = [
  { id: "1", profileIndex: 1, name: "Profile 1", avatarColorHex: "#1E88E5", isPrimary: true }
];

function normalizeProfile(profile, index = 0) {
  const fallbackIndex = index + 1;
  const profileIndex = Number(profile?.profileIndex || profile?.profile_index || profile?.id || fallbackIndex);
  const normalizedIndex = Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : fallbackIndex;
  return {
    ...profile,
    id: String(normalizedIndex),
    profileIndex: normalizedIndex
  };
}

export const ProfileManager = {

  async getProfiles() {
    const stored = LocalStore.get(PROFILES_KEY, null);
    if (Array.isArray(stored) && stored.length) {
      const normalized = stored.map((profile, index) => normalizeProfile(profile, index));
      LocalStore.set(PROFILES_KEY, normalized);
      return normalized;
    }
    LocalStore.set(PROFILES_KEY, DEFAULT_PROFILES);
    return DEFAULT_PROFILES;
  },

  async replaceProfiles(profiles) {
    const normalized = (Array.isArray(profiles) ? profiles : [])
      .map((profile, index) => normalizeProfile(profile, index));
    LocalStore.set(PROFILES_KEY, normalized);
  },

  async setActiveProfile(id) {
    LocalStore.set(ACTIVE_PROFILE_ID_KEY, String(id));
  },

  getActiveProfileId() {
    const raw = LocalStore.get(ACTIVE_PROFILE_ID_KEY, null);
    if (raw == null) {
      return "1";
    }
    return String(raw);
  }

};
