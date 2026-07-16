import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "streamPreferences";
const MAX_ENTRIES = 500;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function buildContentKey(contentId, videoId) {
  const cid = String(contentId || "").trim();
  const vid = String(videoId || "").trim();
  return vid && vid !== cid ? `${cid}::${vid}` : cid;
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" ? raw : {};
}

function writeAll(next) {
  LocalStore.set(KEY, next && typeof next === "object" ? next : {});
}

// Entries are stored as an explicit newest-first array so ordering never relies
// on JavaScript object key iteration: a numeric-looking content id used as an
// object key would otherwise be reordered ahead of string keys and corrupt the
// cap eviction.
function readEntries(profileId = activeProfileId()) {
  const all = readAll();
  const list = all[String(profileId || "1")];
  return Array.isArray(list)
    ? list.filter((entry) => entry && typeof entry === "object" && entry.key)
    : [];
}

function writeEntries(profileId, entries) {
  const all = readAll();
  all[String(profileId || "1")] = entries;
  writeAll(all);
}

export const StreamPreferencesStore = {
  getEntry(contentId, videoId, profileId = activeProfileId()) {
    const key = buildContentKey(contentId, videoId);
    if (!key) {
      return null;
    }
    const entry = readEntries(profileId).find((item) => item.key === key);
    return entry ? { ...entry } : null;
  },

  get(contentId, videoId, profileId = activeProfileId()) {
    const entry = this.getEntry(contentId, videoId, profileId);
    return entry ? String(entry.streamId || "") || null : null;
  },

  getValid(contentId, videoId, maxAgeMs, profileId = activeProfileId()) {
    const entry = this.getEntry(contentId, videoId, profileId);
    const cachedAtMs = Number(entry?.cachedAtMs || 0);
    const ageMs = Date.now() - cachedAtMs;
    if (!entry || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || cachedAtMs <= 0 || ageMs < 0 || ageMs > maxAgeMs) {
      return null;
    }
    return { ...entry, streamId: String(entry.streamId || "") || null };
  },

  set(contentId, videoId, streamId, metadata = {}, profileId = activeProfileId()) {
    const key = buildContentKey(contentId, videoId);
    const sid = String(streamId || "").trim();
    if (!key || !sid) {
      return;
    }
    const entries = readEntries(profileId).filter((item) => item.key !== key);
    // Newest first; drop the oldest entries once the cap is exceeded.
    entries.unshift({
      key,
      streamId: sid,
      cachedAtMs: Date.now(),
      bingeGroup: String(metadata?.bingeGroup || "").trim() || null
    });
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeEntries(profileId, entries);
  }
};
