import { LocalStore } from "../../core/storage/localStore.js";

const HOME_IMAGE_CACHE_KEY = "homeImageCache.v1";
const MAX_HOME_IMAGE_URLS = 500;
const HOME_IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) {
    return "";
  }
  return url;
}

function readEntries() {
  const raw = LocalStore.get(HOME_IMAGE_CACHE_KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  const now = Date.now();
  const cutoff = now - HOME_IMAGE_TTL_MS;
  return raw
    .map((entry) => ({
      url: normalizeUrl(entry?.url || entry),
      lastSeen: Number(entry?.lastSeen || 0) || 0
    }))
    .filter((entry) => entry.url && entry.lastSeen >= cutoff);
}

function writeEntries(entries) {
  LocalStore.set(
    HOME_IMAGE_CACHE_KEY,
    entries
      .filter((entry) => entry?.url)
      .sort((left, right) => Number(right.lastSeen || 0) - Number(left.lastSeen || 0))
      .slice(0, MAX_HOME_IMAGE_URLS)
  );
}

export const HomeImageCacheStore = {

  getUrls(limit = 120) {
    return readEntries()
      .slice(0, Math.max(0, Number(limit || 0) || 0))
      .map((entry) => entry.url);
  },

  rememberUrls(urls = []) {
    const normalizedUrls = Array.from(new Set((Array.isArray(urls) ? urls : [])
      .map(normalizeUrl)
      .filter(Boolean)));
    if (!normalizedUrls.length) {
      return;
    }

    const now = Date.now();
    const byUrl = new Map(readEntries().map((entry) => [entry.url, entry]));
    normalizedUrls.forEach((url) => {
      byUrl.set(url, { url, lastSeen: now });
    });
    writeEntries(Array.from(byUrl.values()));
  },

  clear() {
    LocalStore.remove(HOME_IMAGE_CACHE_KEY);
  }

};
