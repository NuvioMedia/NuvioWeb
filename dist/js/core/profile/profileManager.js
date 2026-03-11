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
    profileIndex: normalizedIndex,
    avatarColorHex: String(profile?.avatarColorHex || "#1E88E5"),
    avatarId: profile?.avatarId || profile?.avatar_id || null,
    isPrimary: Boolean(profile?.isPrimary || normalizedIndex === 1),
    usesPrimaryAddons: Boolean(profile?.usesPrimaryAddons),
    usesPrimaryPlugins: Boolean(profile?.usesPrimaryPlugins)
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

  async createProfile({
    name,
    avatarColorHex = "#1E88E5",
    avatarId = null,
    usesPrimaryAddons = false,
    usesPrimaryPlugins = false
  } = {}) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      return false;
    }

    const profiles = await this.getProfiles();
    if (profiles.length >= 4) {
      return false;
    }

    const nextIndex = profiles.reduce((max, profile) => Math.max(max, Number(profile.profileIndex || profile.id || 0)), 0) + 1;
    const nextProfiles = [
      ...profiles,
      normalizeProfile({
        id: nextIndex,
        profileIndex: nextIndex,
        name: trimmedName,
        avatarColorHex,
        avatarId,
        isPrimary: false,
        usesPrimaryAddons,
        usesPrimaryPlugins
      }, profiles.length)
    ];
    LocalStore.set(PROFILES_KEY, nextProfiles);
    return true;
  },

  async updateProfile(profile) {
    const profiles = await this.getProfiles();
    const nextProfiles = profiles.map((entry, index) => {
      if (String(entry.id) !== String(profile?.id)) {
        return entry;
      }
      return normalizeProfile({
        ...entry,
        ...profile
      }, index);
    });
    LocalStore.set(PROFILES_KEY, nextProfiles);
    return true;
  },

  async deleteProfile(id) {
    const normalizedId = String(id || "");
    if (!normalizedId || normalizedId === "1") {
      return false;
    }

    const profiles = await this.getProfiles();
    const nextProfiles = profiles.filter((profile) => String(profile.id) !== normalizedId);
    if (nextProfiles.length === profiles.length) {
      return false;
    }
    LocalStore.set(PROFILES_KEY, nextProfiles);
    if (this.getActiveProfileId() === normalizedId) {
      LocalStore.set(ACTIVE_PROFILE_ID_KEY, "1");
    }
    return true;
  },

  getActiveProfileId() {
    const raw = LocalStore.get(ACTIVE_PROFILE_ID_KEY, null);
    if (raw == null) {
      return "1";
    }
    return String(raw);
  }

};
