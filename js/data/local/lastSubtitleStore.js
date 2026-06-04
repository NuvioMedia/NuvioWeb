import { LocalStore } from "../../core/storage/localStore.js";

// Remembers which subtitle language the user last chose for a given title/episode,
// so playback can restore it next time (mirrors lastSourceStore for the source).
const KEY = "lastSubtitleLanguages";
const MAX_ENTRIES = 300;

function load() {
  const value = LocalStore.get(KEY, {});
  return value && typeof value === "object" ? value : {};
}

function keyFor(contentId, videoId) {
  return `${String(contentId || "").trim()}::${String(videoId || "").trim()}`;
}

export const LastSubtitleStore = {
  get(contentId, videoId) {
    if (!contentId) return null;
    return load()[keyFor(contentId, videoId)] || null;
  },

  save(contentId, videoId, languageKey) {
    if (!contentId) return;
    const map = load();
    map[keyFor(contentId, videoId)] = {
      languageKey: String(languageKey || "").trim().toLowerCase() || null,
      savedAt: Date.now()
    };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (map[a].savedAt || 0) - (map[b].savedAt || 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete map[k]);
    }
    LocalStore.set(KEY, map);
  }
};
