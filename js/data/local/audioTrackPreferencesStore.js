import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "audioTrackPreferences";
const MAX_ENTRIES = 500;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function readAll() {
  const raw = LocalStore.get(KEY, {});
  return raw && typeof raw === "object" ? raw : {};
}

function writeAll(next) {
  LocalStore.set(KEY, next && typeof next === "object" ? next : {});
}

// Entries are kept as a newest-first array so cap eviction never depends on
// object key iteration order (a numeric-looking content id would otherwise sort
// ahead of string keys). Mirrors streamPreferencesStore.
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

// Remembers the audio track a user explicitly picked for a title so it can be
// re-applied next time they open it, matching the Android TV app. Keyed by the
// title content id (remembered across episodes of a series).
export const AudioTrackPreferencesStore = {
  get(contentId, profileId = activeProfileId()) {
    const key = String(contentId || "").trim();
    if (!key) {
      return null;
    }
    const entry = readEntries(profileId).find((item) => item.key === key);
    if (!entry) {
      return null;
    }
    return {
      languageKey: String(entry.languageKey || ""),
      label: String(entry.label || "")
    };
  },

  set(contentId, { languageKey = "", label = "" } = {}, profileId = activeProfileId()) {
    const key = String(contentId || "").trim();
    const lang = String(languageKey || "").trim();
    const name = String(label || "").trim();
    if (!key || (!lang && !name)) {
      return;
    }
    const entries = readEntries(profileId).filter((item) => item.key !== key);
    entries.unshift({ key, languageKey: lang, label: name, cachedAtMs: Date.now() });
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    writeEntries(profileId, entries);
  }
};
