import { LocalStore } from "../../core/storage/localStore.js";

// Remembers which source/provider the user last played for a given title/episode,
// so "Continue watching" can auto-play the same source. Stores an IDENTITY (not the
// URL — plugin/CDN URLs expire) and the stream screen re-resolves a fresh URL.
const KEY = "lastPlayedSources";
const MAX_ENTRIES = 300;

function load() {
  const value = LocalStore.get(KEY, {});
  return value && typeof value === "object" ? value : {};
}

function keyFor(contentId, videoId) {
  return `${String(contentId || "").trim()}::${String(videoId || "").trim()}`;
}

export const LastSourceStore = {
  get(contentId, videoId) {
    if (!contentId) return null;
    return load()[keyFor(contentId, videoId)] || null;
  },

  save(contentId, videoId, data = {}) {
    if (!contentId) return;
    const map = load();
    map[keyFor(contentId, videoId)] = {
      addonName: data.addonName || null,
      sourceName: data.sourceName || null,
      bingeGroup: data.bingeGroup || null,
      quality: data.quality || null,
      provider: data.provider || null,
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
  },

  // Pick the stream from a list that best matches a remembered source identity.
  matchStream(streams, remembered) {
    if (!Array.isArray(streams) || !streams.length || !remembered) return null;
    const byBinge = remembered.bingeGroup
      ? streams.find((s) => s?.behaviorHints?.bingeGroup && s.behaviorHints.bingeGroup === remembered.bingeGroup)
      : null;
    if (byBinge) return byBinge;
    const byNameQuality = remembered.sourceName
      ? streams.find((s) => (s.addonName || s.sourceName || "") === remembered.sourceName
          && (!remembered.quality || s.quality === remembered.quality))
      : null;
    if (byNameQuality) return byNameQuality;
    const byName = remembered.sourceName
      ? streams.find((s) => (s.addonName || s.sourceName || "") === remembered.sourceName)
      : null;
    if (byName) return byName;
    return remembered.addonName
      ? streams.find((s) => (s.addonName || "") === remembered.addonName) || null
      : null;
  }
};
