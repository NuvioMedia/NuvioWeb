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

function readForProfile(profileId = activeProfileId()) {
  const pid = String(profileId || "1");
  const all = readAll();
  const prefs = all[pid];
  return prefs && typeof prefs === "object" ? prefs : {};
}

function writeForProfile(profileId, prefs) {
  const pid = String(profileId || "1");
  const all = readAll();
  all[pid] = prefs;
  writeAll(all);
}

export const StreamPreferencesStore = {

  get(contentId, videoId, profileId = activeProfileId()) {
    const key = buildContentKey(contentId, videoId);
    if (!key) {
      return null;
    }
    return String(readForProfile(profileId)[key] || "") || null;
  },

  set(contentId, videoId, streamId, profileId = activeProfileId()) {
    const key = buildContentKey(contentId, videoId);
    const sid = String(streamId || "").trim();
    if (!key || !sid) {
      return;
    }
    const prefs = readForProfile(profileId);
    // Remove this key if already present so the rebuild moves it to the front.
    delete prefs[key];
    // Enforce the cap by evicting the oldest entries. Existing keys are stored
    // newest-first, so the oldest entries live at the end of the list.
    const keys = Object.keys(prefs);
    while (keys.length >= MAX_ENTRIES) {
      delete prefs[keys.pop()];
    }
    // Rebuild with the just-used key first (most recently used).
    const next = { [key]: sid };
    for (const k of keys) {
      next[k] = prefs[k];
    }
    writeForProfile(profileId, next);
  }

};
