import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.fetch = async () =>
  new Response("[]", {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

const { TraktAuthStore } = await import("../js/data/local/traktAuthStore.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../js/data/local/traktSettingsStore.js");
const { watchProgressRepository } =
  await import("../js/data/repository/watchProgressRepository.js");
const { metaRepository } = await import("../js/data/repository/metaRepository.js");

metaRepository.getMetaFromAllAddons = async () => null;

test("keeps locally recorded rewatch progress in the selected Trakt source", async () => {
  TraktAuthStore.saveToken({
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    created_at: Math.floor(Date.now() / 1000),
    expires_in: 3600
  });
  TraktSettingsStore.setWatchProgressSource(WatchProgressSource.TRAKT);

  await watchProgressRepository.saveProgress({
    contentId: "tt0944947",
    contentType: "series",
    videoId: "tt0944947:1:1",
    season: 1,
    episode: 1,
    positionMs: 120_000,
    durationMs: 3_600_000
  });

  const traktItems = await watchProgressRepository.getRecent();
  assert.equal(traktItems.length, 1);
  assert.equal(traktItems[0].source, "trakt_local");
  assert.equal(traktItems[0].contentId, "tt0944947");

  TraktSettingsStore.setWatchProgressSource(WatchProgressSource.NUVIO_SYNC);
  const nuvioItems = await watchProgressRepository.getRecent();
  assert.equal(nuvioItems.length, 0);
});
