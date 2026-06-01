import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import { DirectDebridStreamPreparer } from "../../../core/debrid/directDebridStreamPreparer.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { Environment } from "../../../platform/environment.js";
import { I18n } from "../../../i18n/index.js";

const failedAddonLogoUrls = new Set();
const addonLogoCache = new Map();
const ADDON_LOGO_CACHE_KEY = "nuvio.stream.addonLogoCache.v1";
const ADDON_LOGO_CACHE_LIMIT = 36;
const ADDON_LOGO_CACHE_MAX_LENGTH = 140000;
let addonLogoCacheHydrated = false;
let addonLogoCachePersistTimer = null;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function normalizeType(itemType) {
  const normalized = String(itemType || "movie").toLowerCase();
  return normalized || "movie";
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4k";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  if (value.includes("480")) return "480p";
  return "Auto";
}

function isMagnetUrl(value = "") {
  return String(value || "").trim().toLowerCase().startsWith("magnet:");
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri = resolve.magnetUri
    || (isMagnetUrl(item.url) ? item.url : "")
    || (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve
      || item.raw?.clientResolve
      || item.debridCacheStatus
      || item.raw?.debridCacheStatus
      || infoHash
      || magnetUri
  );
  if (!hasDebridMarker) {
    return "";
  }
  const locator = infoHash || magnetUri || item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(resolve.service || item.debridCacheStatus?.providerId || item.raw?.debridCacheStatus?.providerId || ""),
    String(locator),
    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),
    String(behaviorHints.filename || resolve.filename || ""),
    String(resolve.torrentName || "")
  ].join("::");
}

function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);
  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
  }
  const locator = item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(locator),
    String(item.sourceType || ""),
    String(item.fileIdx ?? ""),
    String(item.behaviorHints?.filename || "")
  ].join("::");
}

function mergeStreamItem(previous = {}, next = {}) {
  const behaviorHints = {
    ...(previous.behaviorHints || {}),
    ...(next.behaviorHints || {})
  };
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    url: next.url || previous.url || null,
    externalUrl: next.externalUrl || previous.externalUrl || null,
    ytId: next.ytId || previous.ytId || null,
    behaviorHints: Object.keys(behaviorHints).length ? behaviorHints : null,
    subtitles: Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources
  };
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = size;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex >= 3 ? 2 : (unitIndex >= 2 ? 1 : 0);
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function normalizeEpisodeCode(season, episode) {
  const seasonNumber = Number(season || 0);
  const episodeNumber = Number(episode || 0);
  if (seasonNumber <= 0 || episodeNumber <= 0) {
    return "";
  }
  return `S${seasonNumber} E${episodeNumber}`;
}

function flattenStreams(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  const flattened = [];
  (streamResult.data || []).forEach((group) => {
    const groupName = group.addonName || "Addon";
    (group.streams || []).forEach((stream, index) => {
      const entry = {
        id: stream.id || `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || null,
        url: stream.url || null,
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx ?? null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        quality: stream.quality || null,
        qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
        clientResolve: stream.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        addonName: stream.addonName || groupName,
        addonLogo: stream.addonLogo || group.addonLogo || null,
        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        sourceType: stream.type || stream.source || "",
        raw: stream
      };
      if (DirectDebridResolver.shouldListStream(entry)) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
}

function mergeStreamItems(existing = [], incoming = []) {
  const order = [];
  const byKey = new Map();
  const push = (item) => {
    if (!item) {
      return;
    }
    const key = streamMergeKey(item);
    if (!key) {
      return;
    }
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, item);
      return;
    }
    byKey.set(key, mergeStreamItem(byKey.get(key), item));
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return order.map((key) => byKey.get(key));
}

function iconSvg(kind) {
  if (kind === "peers") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.76 0 5-2.46 5-5.5S14.76 1 12 1 7 3.46 7 6.5 9.24 12 12 12Zm0 2c-4.42 0-8 2.46-8 5.5V23h16v-3.5c0-3.04-3.58-5.5-8-5.5Z" fill="currentColor"/></svg>';
  }
  if (kind === "size") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h13l3 3v15H4V3Zm13 1.5V7h2.5L17 4.5ZM8 10h8v2H8v-2Zm0 4h8v2H8v-2Z" fill="currentColor"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.18 7.18 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.49.42l-.37 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.37 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" fill="currentColor"/></svg>';
}

function renderMetaItem(kind, value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return `
    <span class="stream-route-meta-item ${kind}">
      <span class="stream-route-meta-icon">${iconSvg(kind)}</span>
      <span>${escapeHtml(text)}</span>
    </span>
  `;
}

function extractPeerCount(stream = {}) {
  const text = String([
    stream.name || "",
    stream.title || "",
    stream.description || "",
    stream.behaviorHints?.filename || ""
  ].join(" "));
  const patterns = [
    /\bseed(?:ers?)?\s*[:\-]?\s*(\d{1,5})\b/i,
    /\bpeers?\s*[:\-]?\s*(\d{1,5})\b/i,
    /\b(\d{1,5})\s*seed(?:ers?)?\b/i,
    /\b👤\s*(\d{1,5})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function extractIndexerName(stream = {}) {
  const sources = Array.isArray(stream.sources) ? stream.sources : [];
  for (const source of sources) {
    const value = String(source || "").trim();
    if (value) {
      return value;
    }
  }
  const searchText = String([
    stream.name || "",
    stream.title || "",
    stream.description || "",
    stream.behaviorHints?.filename || ""
  ].join(" "));
  const known = [
    "ThePirateBay",
    "1337x",
    "RARBG",
    "YTS",
    "EZTV",
    "TorBox",
    "Torrentio",
    "Orion"
  ];
  return known.find((entry) => new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(searchText)) || "";
}

function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) {
    return "A";
  }
  if (/torrentio|torbox|torrent/i.test(cleaned)) {
    return "µ";
  }
  const letters = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
  return letters || cleaned.charAt(0).toUpperCase();
}

function normalizeAddonLogoUrl(value = "") {
  return String(value || "").trim();
}

function isImgurLogoUrl(value = "") {
  const url = normalizeAddonLogoUrl(value);
  if (!url) {
    return false;
  }
  try {
    const host = new URL(url, globalThis.location?.href || "https://nuvio.local/").hostname.toLowerCase();
    return host === "i.imgur.com" || host === "imgur.com" || host.endsWith(".imgur.com");
  } catch (_) {
    return /(^|\/\/)(?:i\.)?imgur\.com\//i.test(url);
  }
}

function hydrateAddonLogoCache() {
  if (addonLogoCacheHydrated) {
    return;
  }
  addonLogoCacheHydrated = true;
  const cached = LocalStore.get(ADDON_LOGO_CACHE_KEY, {});
  const entries = cached && typeof cached === "object" && !Array.isArray(cached)
    ? cached
    : {};
  Object.keys(entries).forEach((url) => {
    const entry = entries[url];
    const dataUrl = String(entry?.dataUrl || "").trim();
    if (!url || !dataUrl.startsWith("data:image/")) {
      return;
    }
    addonLogoCache.set(url, {
      status: "ready",
      displayUrl: dataUrl,
      updatedAt: Number(entry?.updatedAt || Date.now())
    });
  });
}

function persistAddonLogoCache() {
  addonLogoCachePersistTimer = null;
  const entries = Array.from(addonLogoCache.entries())
    .filter(([, entry]) => (
      entry?.status === "ready"
      && String(entry.displayUrl || "").startsWith("data:image/")
      && String(entry.displayUrl || "").length <= ADDON_LOGO_CACHE_MAX_LENGTH
    ))
    .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0))
    .slice(0, ADDON_LOGO_CACHE_LIMIT);
  const payload = {};
  entries.forEach(([url, entry]) => {
    payload[url] = {
      dataUrl: entry.displayUrl,
      updatedAt: Number(entry.updatedAt || Date.now())
    };
  });
  LocalStore.set(ADDON_LOGO_CACHE_KEY, payload);
}

function scheduleAddonLogoCachePersist() {
  if (addonLogoCachePersistTimer) {
    return;
  }
  addonLogoCachePersistTimer = setTimeout(persistAddonLogoCache, 800);
}

function imageToDataUrl(image) {
  const naturalWidth = Math.max(1, Number(image?.naturalWidth || image?.width || 1));
  const naturalHeight = Math.max(1, Number(image?.naturalHeight || image?.height || 1));
  const maxSize = 144;
  const ratio = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * ratio));
  const height = Math.max(1, Math.round(naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function requestAddonLogo(url = "", onSettled = null) {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return;
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  if (cached?.status === "ready" || cached?.status === "loading" || cached?.status === "direct") {
    return;
  }

  addonLogoCache.set(normalized, { status: "loading", updatedAt: Date.now() });

  const fail = () => {
    failedAddonLogoUrls.add(normalized);
    addonLogoCache.set(normalized, { status: "failed", updatedAt: Date.now() });
    if (typeof onSettled === "function") {
      onSettled();
    }
  };
  const image = new Image();
  const shouldTryDataCache = !isImgurLogoUrl(normalized);
  if (shouldTryDataCache) {
    image.crossOrigin = "anonymous";
  }
  image.decoding = "async";
  try {
    image.referrerPolicy = "no-referrer";
  } catch (_) {
    // Some TV browsers expose referrerPolicy as read-only.
  }
  image.onload = () => {
    if (!shouldTryDataCache) {
      addonLogoCache.set(normalized, {
        status: "direct",
        displayUrl: normalized,
        updatedAt: Date.now()
      });
      if (typeof onSettled === "function") {
        onSettled();
      }
      return;
    }
    try {
      const dataUrl = imageToDataUrl(image);
      addonLogoCache.set(normalized, {
        status: "ready",
        displayUrl: dataUrl,
        updatedAt: Date.now()
      });
      scheduleAddonLogoCachePersist();
    } catch (_) {
      fail();
      return;
    }
    if (typeof onSettled === "function") {
      onSettled();
    }
  };
  image.onerror = fail;
  image.src = normalized;
}

function getCachedAddonLogoDisplayUrl(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return "";
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  return cached?.status === "ready" || cached?.status === "direct"
    ? String(cached.displayUrl || "")
    : "";
}

function normalizeAddonLookupKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildAddonLogoLookup(addons = []) {
  const lookup = {};
  (addons || []).forEach((addon) => {
    const logo = normalizeAddonLogoUrl(addon?.logo);
    if (!logo) {
      return;
    }
    [
      addon?.displayName,
      addon?.name,
      addon?.id,
      addon?.baseUrl
    ].forEach((key) => {
      const normalized = normalizeAddonLookupKey(key);
      if (normalized && !lookup[normalized]) {
        lookup[normalized] = logo;
      }
    });
  });
  return lookup;
}

function resolveAddonLogo(addonName = "", lookup = {}) {
  const key = normalizeAddonLookupKey(addonName);
  return key ? normalizeAddonLogoUrl(lookup?.[key]) : "";
}

function rememberFailedAddonLogo(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (normalized) {
    failedAddonLogoUrls.add(normalized);
  }
}

function getStreamHeadline(stream = {}) {
  const primary = [
    stream.name,
    stream.title,
    stream.description
  ].find((value) => String(value || "").trim());
  if (!primary) {
    return stream.addonName || "Unknown source";
  }
  const firstLine = String(primary).split(/\r?\n/)[0].trim();
  return firstLine || (stream.addonName || "Unknown source");
}

function getStreamQuality(stream = {}) {
  const qualityLines = [];
  [stream.name, stream.title, stream.description].forEach((value) => {
    String(value || "").split(/\r?\n/).forEach((line) => {
      const normalized = String(line || "").trim();
      if (normalized) {
        qualityLines.push(normalized);
      }
    });
  });
  const qualityCandidate = qualityLines.find((line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line));
  if (qualityCandidate) {
    return qualityCandidate;
  }
  return detectQuality([
    stream.name || "",
    stream.title || "",
    stream.description || "",
    stream.behaviorHints?.filename || "",
    stream.sourceType || ""
  ].join(" "));
}

function isMetaNoiseLine(line = "") {
  const value = String(line || "").trim();
  if (!value) {
    return true;
  }
  if (/[👤💾⚙🧲]/u.test(value)) {
    return true;
  }
  if (/(?:thepiratebay|torrentio|torbox|1337x|rarbg|yts|eztv|orion)/i.test(value) && /\b\d+(?:\.\d+)?\s*(?:mb|gb|tb)\b/i.test(value)) {
    return true;
  }
  if (/\b(?:seed(?:ers?)?|peers?)\b/i.test(value) && /\b\d+(?:\.\d+)?\s*(?:mb|gb|tb)\b/i.test(value)) {
    return true;
  }
  return false;
}

function getStreamDescriptionLines(stream = {}) {
  const candidates = [
    stream.name,
    stream.description,
    stream.title,
    stream.behaviorHints?.filename
  ].reduce((items, value) => {
    String(value || "").split(/\r?\n/).forEach((line) => {
      const normalized = String(line || "").trim();
      if (normalized) {
        items.push(normalized);
      }
    });
    return items;
  }, []);
  const unique = [];
  candidates.forEach((value) => {
    if (!unique.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      unique.push(value);
    }
  });
  const headline = getStreamHeadline(stream).toLowerCase();
  const quality = getStreamQuality(stream).toLowerCase();
  return unique
    .filter((entry) => {
      const normalized = entry.toLowerCase();
      return normalized !== headline && normalized !== quality && !isMetaNoiseLine(entry);
    })
    .slice(0, 2);
}

function getOrderedFilterNames(sourceChips = [], streams = []) {
  const ordered = [];
  const sortedChips = (sourceChips || [])
    .slice()
    .sort((left, right) => Number(left?.orderIndex ?? Number.MAX_SAFE_INTEGER) - Number(right?.orderIndex ?? Number.MAX_SAFE_INTEGER));
  sortedChips.forEach((chip) => {
    if (chip?.name && !ordered.includes(chip.name)) {
      ordered.push(chip.name);
    }
  });
  const sortedStreams = (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const leftOrder = Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.stream);
  sortedStreams.forEach((stream) => {
    const addonName = String(stream?.addonName || "").trim();
    if (addonName && !ordered.includes(addonName)) {
      ordered.push(addonName);
    }
  });
  return ordered;
}

function sortStreamsByAddonOrder(streams = [], sourceChips = []) {
  const order = new Map();
  (sourceChips || []).forEach((chip, index) => {
    const name = String(chip?.name || "").trim();
    if (name && !order.has(name)) {
      order.set(name, index);
    }
  });
  return (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const leftOrder = order.has(left.stream?.addonName)
        ? order.get(left.stream.addonName)
        : Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = order.has(right.stream?.addonName)
        ? order.get(right.stream.addonName)
        : Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.stream);
}

export const StreamScreen = {

  cancelScheduledRender() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  requestRender() {
    if (!this.container || Router.getCurrent() !== "stream") {
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "stream") {
        return;
      }
      this.render();
    });
  },

  applyAddonLogos(streams = []) {
    const lookup = this.addonLogoLookup || {};
    return (streams || []).map((stream) => {
      const currentLogo = normalizeAddonLogoUrl(stream?.addonLogo);
      if (currentLogo) {
        return stream;
      }
      const addonLogo = resolveAddonLogo(stream?.addonName, lookup);
      return addonLogo ? { ...stream, addonLogo } : stream;
    });
  },

  scheduleDebridPreparation() {
    const token = this.loadToken || 0;
    if (this.debridPreparationScheduled) {
      return;
    }
    this.debridPreparationScheduled = true;
    setTimeout(() => {
      this.debridPreparationScheduled = false;
      if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
        return;
      }
      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      void DirectDebridStreamPreparer.prepare(this.streams, {
        season,
        episode,
        onPrepared: (original, prepared) => {
          if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
            return;
          }
          const keyFor = (stream) => [
            stream.clientResolve?.service || "",
            stream.clientResolve?.infoHash || stream.infoHash || "",
            stream.clientResolve?.fileIdx ?? stream.fileIdx ?? "",
            stream.clientResolve?.filename || stream.behaviorHints?.filename || "",
            stream.name || "",
            stream.title || ""
          ].join("|");
          const originalKey = keyFor(original);
          this.streams = this.streams.map((stream) => (
            keyFor(stream) === originalKey ? { ...stream, ...prepared } : stream
          ));
          this.requestRender();
        }
      });
    }, 0);
  },

  getBackdropUrl() {
    return this.params?.backdrop || this.params?.landscapePoster || this.params?.poster || "";
  },

  getRouteStateKey(params = {}) {
    const itemType = normalizeType(params?.itemType);
    const itemId = String(params?.itemId || "").trim();
    const videoId = String(params?.videoId || "").trim();
    if (!itemId && !videoId) {
      return null;
    }
    return `stream:${itemType}:${itemId}:${videoId}`;
  },

  navigateBackFromStream() {
    const itemId = String(this.params?.itemId || "").trim();
    if (!itemId) {
      return false;
    }
    void Router.navigate("detail", {
      itemId,
      itemType: normalizeType(this.params?.itemType),
      fallbackTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
      returnHomeOnBack: Boolean(this.params?.continueWatchingBackHome || this.params?.returnHomeOnBack)
    }, {
      skipStackPush: true,
      replaceHistory: true
    });
    return true;
  },

  consumeBackRequest() {
    return this.navigateBackFromStream();
  },

  captureRouteState() {
    const list = this.container?.querySelector(".stream-route-list");
    return {
      params: this.params ? { ...this.params } : {},
      loading: Boolean(this.loading),
      error: String(this.error || ""),
      streams: Array.isArray(this.streams) ? this.streams.map((stream) => ({ ...stream })) : [],
      addonFilter: String(this.addonFilter || "all"),
      focusState: this.focusState ? { ...this.focusState } : { zone: "filter", index: 0 },
      sourceChips: Array.isArray(this.sourceChips) ? this.sourceChips.map((chip) => ({ ...chip })) : [],
      addonLogoLookup: this.addonLogoLookup ? { ...this.addonLogoLookup } : {},
      listScrollTop: Number(list?.scrollTop || 0)
    };
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("stream");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.error = "";
    this.loading = true;
    this.streams = [];
    this.sourceChips = [];
    this.addonLogoLookup = {};
    this.addonFilter = "all";

    const restored = navigationContext?.restoredState && typeof navigationContext.restoredState === "object"
      ? navigationContext.restoredState
      : null;
    if (restored) {
      this.loading = Boolean(restored.loading);
      this.error = String(restored.error || "");
      this.streams = Array.isArray(restored.streams) ? restored.streams.map((stream) => ({ ...stream })) : [];
      this.addonFilter = String(restored.addonFilter || "all");
      this.focusState = restored.focusState ? { ...restored.focusState } : { zone: "filter", index: 0 };
      this.sourceChips = Array.isArray(restored.sourceChips) ? restored.sourceChips.map((chip) => ({ ...chip })) : [];
      this.addonLogoLookup = restored.addonLogoLookup && typeof restored.addonLogoLookup === "object"
        ? { ...restored.addonLogoLookup }
        : {};
      this.listScrollTop = Number(restored.listScrollTop || 0);
    }

    this.render();

    if (restored && navigationContext?.isBackNavigation && this.streams.length) {
      this.loading = false;
      this.render();
      return;
    }

    void this.loadStreams();
  },

  async loadStreams() {
    const token = this.loadToken;
    const itemType = normalizeType(this.params?.itemType);
    const videoId = String(this.params?.videoId || this.params?.itemId || "");

    this.loading = true;
    this.error = "";
    this.streams = [];
    this.addonFilter = "all";
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.addonLogoLookup = {};

    this.sourceChips = [];
    this.requestRender();

    const upsertSourceChip = (addon, status = "loading") => {
      const name = String(addon?.displayName || addon?.name || "").trim();
      if (!name) {
        return;
      }
      const orderIndex = Number(addon?.orderIndex);
      const nextChip = {
        name,
        logo: normalizeAddonLogoUrl(addon.logo),
        status,
        orderIndex: Number.isFinite(orderIndex) ? orderIndex : Number.MAX_SAFE_INTEGER
      };
      const existingIndex = this.sourceChips.findIndex((chip) => chip.name === name);
      if (existingIndex >= 0) {
        this.sourceChips[existingIndex] = { ...this.sourceChips[existingIndex], ...nextChip };
      } else {
        this.sourceChips.push(nextChip);
      }
      this.addonLogoLookup[name] = nextChip.logo;
      this.sourceChips = this.sourceChips
        .slice()
        .sort((left, right) => Number(left.orderIndex || 0) - Number(right.orderIndex || 0));
    };

    const markSuccessfulSources = (names = []) => {
      if (!Array.isArray(names) || !names.length) {
        return;
      }
      const entries = names
        .map((entry) => {
          if (entry && typeof entry === "object") {
            return {
              name: String(entry.name || entry.addonName || "").trim(),
              logo: normalizeAddonLogoUrl(entry.logo || entry.addonLogo),
              orderIndex: Number(entry.orderIndex ?? entry.addonOrderIndex)
            };
          }
          const name = String(entry || "").trim();
          const existingStream = this.streams.find((stream) => stream.addonName === name);
          return {
            name,
            logo: resolveAddonLogo(name, this.addonLogoLookup),
            orderIndex: Number(existingStream?.addonOrderIndex)
          };
        })
        .filter((entry) => entry.name);
      const successSet = new Set(entries.map((entry) => entry.name));
      const known = new Set(this.sourceChips.map((chip) => chip.name));
      this.sourceChips = this.sourceChips.map((chip) => (
        successSet.has(chip.name) ? { ...chip, status: "success" } : chip
      ));
      entries.forEach((entry) => {
        if (!known.has(entry.name)) {
          const orderIndex = Number.isFinite(entry.orderIndex) ? entry.orderIndex : Number.MAX_SAFE_INTEGER;
          this.sourceChips.push({
            name: entry.name,
            logo: entry.logo || resolveAddonLogo(entry.name, this.addonLogoLookup),
            status: "success",
            orderIndex
          });
        }
      });
      this.sourceChips = this.sourceChips
        .slice()
        .sort((left, right) => Number(left.orderIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.orderIndex ?? Number.MAX_SAFE_INTEGER));
    };

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onAddon: (addon) => {
        if (token !== this.loadToken) {
          return;
        }
        upsertSourceChip(addon, "loading");
        this.requestRender();
      },
      onChunk: (chunkResult) => {
        if (token !== this.loadToken || chunkResult?.status !== "success") {
          return;
        }
        const groups = Array.isArray(chunkResult.data) ? chunkResult.data : [];
        markSuccessfulSources(groups.map((group) => ({
          name: group?.addonName || "",
          logo: group?.addonLogo || "",
          orderIndex: group?.addonOrderIndex
        })));
        const chunkItems = this.applyAddonLogos(flattenStreams(chunkResult));
        if (!chunkItems.length) {
          this.requestRender();
          return;
        }
        this.streams = mergeStreamItems(this.streams, chunkItems);
        this.scheduleDebridPreparation();
        this.loading = false;
        if (this.focusState.zone !== "card") {
          this.focusState = { zone: "card", index: 0 };
        }
        this.requestRender();
      }
    };

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, videoId, options);
      if (token !== this.loadToken) {
        return;
      }
      this.streams = mergeStreamItems(this.streams, this.applyAddonLogos(flattenStreams(streamResult)));
      this.scheduleDebridPreparation();
      markSuccessfulSources(this.streams.map((stream) => stream.addonName));
      this.sourceChips = this.sourceChips.map((chip) => (
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      ));
      this.loading = false;
      if (this.streams.length) {
        this.focusState = { zone: "card", index: clamp(Number(this.focusState?.index || 0), 0, this.streams.length - 1) };
      } else {
        this.focusState = { zone: "filter", index: 0 };
      }
      this.requestRender();
      this.scheduleErrorChipCleanup();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.loading = false;
      this.error = error?.message || "Failed to load streams.";
      this.sourceChips = this.sourceChips.map((chip) => (
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      ));
      this.requestRender();
      this.scheduleErrorChipCleanup();
    }
  },

  scheduleErrorChipCleanup() {
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (!this.sourceChips.some((chip) => chip.status === "error")) {
      return;
    }
    this.errorChipTimer = setTimeout(() => {
      this.sourceChips = this.sourceChips.filter((chip) => chip.status !== "error");
      this.requestRender();
    }, 1600);
  },

  getOrderedFilterNames() {
    return getOrderedFilterNames(this.sourceChips, this.streams);
  },

  getFilteredStreams(filter = this.addonFilter) {
    const orderedStreams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
    if (filter === "all") {
      return orderedStreams;
    }
    return orderedStreams.filter((stream) => stream.addonName === filter);
  },

  hasPendingSourceLoads(filter = this.addonFilter) {
    if (!Array.isArray(this.sourceChips) || !this.sourceChips.length) {
      return Boolean(this.loading);
    }
    if (filter === "all") {
      return this.sourceChips.some((chip) => chip.status === "loading");
    }
    return this.sourceChips.some((chip) => chip.name === filter && chip.status === "loading");
  },

  setAddonFilter(nextFilter, preferredZone = "filter", preferredIndex = 0) {
    const targetFilter = String(nextFilter || "all");
    this.addonFilter = targetFilter;
    const filtered = this.getFilteredStreams(targetFilter);
    if (preferredZone === "card" && filtered.length) {
      this.focusState = { zone: "card", index: clamp(preferredIndex, 0, filtered.length - 1) };
    } else {
      const ordered = ["all", ...this.getOrderedFilterNames()];
      this.focusState = { zone: "filter", index: clamp(ordered.indexOf(targetFilter), 0, Math.max(0, ordered.length - 1)) };
    }
    this.listScrollTop = 0;
    this.render();
  },

  focusList(list, index) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const targetIndex = clamp(index, 0, list.length - 1);
    const target = list[targetIndex];
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }

    const chipTrack = target.closest(".stream-route-chip-track");
    if (chipTrack) {
      const left = target.offsetLeft;
      const right = left + target.offsetWidth;
      const viewLeft = chipTrack.scrollLeft;
      const viewRight = viewLeft + chipTrack.clientWidth;
      const pad = 24;
      if (right > viewRight - pad) {
        chipTrack.scrollLeft = Math.max(0, right - chipTrack.clientWidth + pad);
      } else if (left < viewLeft + pad) {
        chipTrack.scrollLeft = Math.max(0, left - pad);
      }
    }

    const listNode = target.closest(".stream-route-list");
    if (listNode) {
      this.ensureListItemVisible(listNode, target);
      this.listScrollTop = Number(listNode.scrollTop || 0);
    }
    return true;
  },

  ensureListItemVisible(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    const itemTop = Number(target.offsetTop || 0);
    const itemBottom = itemTop + Number(target.offsetHeight || 0);
    const viewTop = Number(listNode.scrollTop || 0);
    const viewHeight = Number(listNode.clientHeight || 0);
    const viewBottom = viewTop + viewHeight;
    const pad = 16;
    if (itemBottom > viewBottom - pad) {
      listNode.scrollTop = Math.max(0, itemBottom - viewHeight + pad);
    } else if (itemTop < viewTop + pad) {
      listNode.scrollTop = Math.max(0, itemTop - pad);
    }
  },

  getFocusLists() {
    const chips = Array.from(this.container.querySelectorAll(".stream-route-chip.focusable"));
    const cards = Array.from(this.container.querySelectorAll(".stream-route-card.focusable"));
    return { chips, cards };
  },

  applyFocus() {
    const { chips, cards } = this.getFocusLists();
    if (!chips.length && !cards.length) {
      return;
    }
    const zone = this.focusState?.zone || (cards.length ? "card" : "filter");
    const index = Number(this.focusState?.index || 0);
    if (zone === "card" && cards.length) {
      this.focusState = { zone: "card", index: clamp(index, 0, cards.length - 1) };
      this.focusList(cards, this.focusState.index);
      return;
    }
    this.focusState = { zone: "filter", index: clamp(index, 0, Math.max(0, chips.length - 1)) };
    this.focusList(chips, this.focusState.index);
  },

  restoreScrollPosition() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    list.scrollTop = Number(this.listScrollTop || 0);
  },

  getHeaderMeta() {
    const isSeries = normalizeType(this.params?.itemType) === "series";
    const title = String(this.params?.itemTitle || this.params?.playerTitle || "Untitled");
    const subtitle = isSeries
      ? String(this.params?.episodeTitle || this.params?.playerSubtitle || "").trim()
      : String(this.params?.itemSubtitle || "").trim();
    const episodeLabel = normalizeEpisodeCode(this.params?.season, this.params?.episode);
    const detailLine = isSeries
      ? ""
      : [String(this.params?.genres || "").trim(), String(this.params?.year || "").trim()].filter(Boolean).join(" • ");
    return { isSeries, title, subtitle, episodeLabel, detailLine };
  },

  renderChip(name, selected, status) {
    const chipStatus = String(status || "success");
    const classes = [
      "stream-route-chip",
      "focusable",
      selected ? "selected" : "",
      chipStatus !== "success" ? chipStatus : ""
    ].filter(Boolean).join(" ");
    const spinner = chipStatus === "loading" ? '<span class="stream-route-chip-spinner" aria-hidden="true"></span>' : "";
    return `
      <button class="${classes}" data-action="setFilter" data-addon="${escapeHtml(name)}">
        ${spinner}
        <span>${escapeHtml(name === "all" ? t("common.all", {}, "All") : name)}</span>
      </button>
    `;
  },

  renderStreamCard(stream, index) {
    const headline = getStreamHeadline(stream);
    const quality = getStreamQuality(stream);
    const descriptionLines = getStreamDescriptionLines(stream);
    const addonLogoUrl = normalizeAddonLogoUrl(stream.addonLogo) || resolveAddonLogo(stream.addonName, this.addonLogoLookup);
    const cachedAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
    const displayAddonLogoUrl = cachedAddonLogoUrl || "";
    if (addonLogoUrl && !displayAddonLogoUrl && !failedAddonLogoUrls.has(addonLogoUrl)) {
      requestAddonLogo(addonLogoUrl, () => this.requestRender());
    }
    const addonBadgeLabel = escapeHtml(getAddonBadgeLabel(stream.addonName || ""));
    const meta = [
      renderMetaItem("peers", extractPeerCount(stream)),
      renderMetaItem("size", formatBytes(stream.behaviorHints?.videoSize)),
      renderMetaItem("source", extractIndexerName(stream))
    ].filter(Boolean).join("");
    const isResolving = this.resolvingStreamId === stream.id;
    const addonBadge = displayAddonLogoUrl
      ? `<img src="${escapeHtml(displayAddonLogoUrl)}" alt="${escapeHtml(stream.addonName || "Addon")}" data-addon-logo="${escapeHtml(addonLogoUrl)}" decoding="async" /><span hidden>${addonBadgeLabel}</span>`
      : `<span>${addonBadgeLabel}</span>`;

    return `
      <article class="stream-route-card focusable${this.focusState.zone === "card" && this.focusState.index === index ? " focused" : ""}"
               data-action="playStream"
               data-stream-id="${escapeHtml(stream.id)}">
        <div class="stream-route-card-copy">
          <div class="stream-route-card-heading">${escapeHtml(headline)}</div>
          <div class="stream-route-card-quality">${escapeHtml(quality)}</div>
          ${descriptionLines.map((line, lineIndex) => `<div class="stream-route-card-line${lineIndex > 0 ? " secondary" : ""}">${escapeHtml(line)}</div>`).join("")}
          ${meta ? `<div class="stream-route-card-meta">${meta}</div>` : ""}
        </div>
        <div class="stream-route-card-side">
          <div class="stream-route-addon-badge">${addonBadge}</div>
          <div class="stream-route-addon-name">${escapeHtml(stream.addonName || "Addon")}</div>
          ${isResolving ? `<div class="stream-route-addon-name">${escapeHtml(t("stream.debrid.resolving", {}, "Resolving"))}</div>` : ""}
        </div>
      </article>
    `;
  },

  renderLoadingCards(count = 3) {
    const safeCount = Math.max(1, Number(count || 0));
    return Array.from({ length: safeCount }).map(() => `
      <div class="stream-route-card skeleton">
        <div class="stream-route-skeleton-line wide"></div>
        <div class="stream-route-skeleton-line short"></div>
        <div class="stream-route-skeleton-line"></div>
        <div class="stream-route-skeleton-line"></div>
      </div>
    `).join("");
  },

  render() {
    this.cancelScheduledRender();
    const { isSeries, title, subtitle, episodeLabel, detailLine } = this.getHeaderMeta();
    const backdrop = this.getBackdropUrl();
    const logo = this.params?.logo || "";
    const orderedFilters = this.getOrderedFilterNames();
    const chips = [
      this.renderChip("all", this.addonFilter === "all", "success"),
      ...orderedFilters.map((name) => {
        const chip = this.sourceChips.find((entry) => entry.name === name) || { name, status: "success" };
        return this.renderChip(name, this.addonFilter === name, chip.status);
      })
    ].join("");
    const filtered = this.getFilteredStreams();
    const hasPendingForFilter = this.hasPendingSourceLoads();
    const hasAnyStreams = this.streams.length > 0;

    let body = "";
    if (filtered.length) {
      body = filtered.map((stream, index) => this.renderStreamCard(stream, index)).join("");
      if (hasPendingForFilter) {
        body += this.renderLoadingCards(1);
      }
    } else if ((this.loading && !hasAnyStreams) || hasPendingForFilter) {
      body = this.renderLoadingCards();
    } else if (this.error) {
      body = `<div class="stream-route-empty">${escapeHtml(this.error)}</div>`;
    } else if (!filtered.length) {
      body = `<div class="stream-route-empty">No sources found for this filter.</div>`;
    }

    this.container.innerHTML = `
      <div class="stream-route-shell">
        <div class="stream-route-backdrop"${backdrop ? ` style="background-image:url('${String(backdrop).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="stream-route-backdrop-dim"></div>
        <div class="stream-route-left-gradient"></div>
        <div class="stream-route-right-gradient"></div>
        <div class="stream-route-content">
          <section class="stream-route-left">
            <div class="stream-route-left-inner">
              ${logo ? `<img src="${logo}" class="stream-route-logo" alt="${escapeHtml(title)}" />` : `<h1 class="stream-route-title">${escapeHtml(title)}</h1>`}
              ${episodeLabel ? `<div class="stream-route-episode-code">${escapeHtml(episodeLabel)}</div>` : ""}
              ${subtitle ? `<div class="stream-route-subtitle">${escapeHtml(subtitle)}</div>` : ""}
              ${detailLine ? `<div class="stream-route-detail-line">${escapeHtml(detailLine)}</div>` : (!isSeries && subtitle ? `<div class="stream-route-detail-line">${escapeHtml(subtitle)}</div>` : "")}
            </div>
          </section>
          <section class="stream-route-right">
            <div class="stream-route-chip-wrap">
              <div class="stream-route-chip-track">${chips}</div>
            </div>
            <div class="stream-route-panel-shell">
              <div class="stream-route-panel">
                <div class="stream-route-list">${body}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    this.bindAddonLogoFallbacks();
    ScreenUtils.indexFocusables(this.container);
    this.restoreScrollPosition();
    this.applyFocus();
    this.bindListScrollState();
  },

  bindListScrollState() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    list.addEventListener("scroll", () => {
      this.listScrollTop = Number(list.scrollTop || 0);
    }, { passive: true });
  },

  bindAddonLogoFallbacks() {
    this.container?.querySelectorAll(".stream-route-addon-badge img[data-addon-logo]").forEach((node) => {
      if (!(node instanceof HTMLImageElement) || node.dataset.fallbackBound === "true") {
        return;
      }
      node.dataset.fallbackBound = "true";
      const fallback = node.nextElementSibling;
      const applyFallback = () => {
        rememberFailedAddonLogo(node.dataset.addonLogo || node.getAttribute("src") || "");
        node.hidden = true;
        if (fallback instanceof HTMLElement) {
          fallback.hidden = false;
        }
      };
      node.addEventListener("error", applyFallback, { once: true });
      if (node.complete && Number(node.naturalWidth || 0) <= 0) {
        applyFallback();
      }
    });
  },

  async playStream(streamId) {
    const filtered = this.getFilteredStreams();
    const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
    if (!selected) {
      return;
    }
    let targetUrl = selected.url || selected.externalUrl || "";
    if (!targetUrl) {
      if (!DirectDebridResolver.canResolveStream(selected, {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      })) {
        window.alert?.(t("stream.debrid.unavailable", {}, "This Debrid source needs a configured Debrid account."));
        return;
      }
      this.resolvingStreamId = selected.id;
      this.requestRender();
      const result = await DirectDebridResolver.resolve(selected, {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      });
      this.resolvingStreamId = null;
      if (result.status !== "success" || !result.stream?.url) {
        this.requestRender();
        const messageKey = result.status === "not_cached"
          ? "stream.debrid.notCached"
          : result.status === "stale"
              ? "stream.debrid.stale"
              : "stream.debrid.failed";
        const fallback = result.status === "not_cached"
          ? "Not cached on this service."
          : result.status === "stale"
              ? "This Debrid result expired. Refreshing streams."
              : "Could not resolve this Debrid stream.";
        window.alert?.(t(messageKey, {}, fallback));
        return;
      }
      selected.url = result.stream.url;
      selected.externalUrl = null;
      selected.behaviorHints = result.stream.behaviorHints || selected.behaviorHints;
      selected.raw = result.stream.raw || selected.raw;
      this.streams = this.streams.map((stream) => stream.id === selected.id ? { ...stream, ...selected } : stream);
      targetUrl = selected.url || selected.externalUrl || "";
      this.requestRender();
    }
    const itemType = normalizeType(this.params?.itemType);
    Router.navigate("player", {
      streamUrl: targetUrl,
      itemId: this.params?.itemId || null,
      itemType: itemType || "movie",
      imdbId: this.params?.imdbId || null,
      videoId: this.params?.videoId || null,
      resumePositionMs: Number(this.params?.resumePositionMs || 0) || 0,
      episodeLabel: this.params?.season && this.params?.episode
        ? `S${this.params.season}E${this.params.episode}`
        : null,
      playerTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
      playerSubtitle: this.params?.episodeTitle || this.params?.playerSubtitle || "",
      playerEpisodeTitle: this.params?.episodeTitle || "",
      playerReleaseYear: this.params?.year || "",
      playerBackdropUrl: this.getBackdropUrl() || null,
      playerLogoUrl: this.params?.logo || null,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode),
      episodes: Array.isArray(this.params?.episodes) ? this.params.episodes : [],
      streamCandidates: filtered,
      returnToStreamOnBack: true,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      nextEpisodeVideoId: this.params?.nextEpisodeVideoId || null,
      nextEpisodeLabel: this.params?.nextEpisodeLabel || null,
      nextEpisodeSeason: this.params?.nextEpisodeSeason ?? null,
      nextEpisodeEpisode: this.params?.nextEpisodeEpisode ?? null,
      nextEpisodeTitle: this.params?.nextEpisodeTitle || "",
      nextEpisodeReleased: this.params?.nextEpisodeReleased || ""
    });
  },

  onPointerFocus(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const { chips, cards } = this.getFocusLists();
    const chipIndex = chips.indexOf(target);
    if (chipIndex >= 0) {
      this.focusState = { zone: "filter", index: chipIndex };
      this.focusList(chips, chipIndex);
      return true;
    }
    const cardIndex = cards.indexOf(target);
    if (cardIndex >= 0) {
      this.focusState = { zone: "card", index: cardIndex };
      this.focusList(cards, cardIndex);
      return true;
    }
    return false;
  },

  onPointerActivate(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    this.onPointerFocus(target);
    const action = String(target.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(target.dataset.addon || "all");
      const { chips } = this.getFocusLists();
      this.setAddonFilter(addon, "filter", Math.max(0, chips.indexOf(target)));
      return true;
    }
    if (action === "playStream") {
      this.playStream(target.dataset.streamId);
      return true;
    }
    return false;
  },

  onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      if (!this.navigateBackFromStream()) {
        Router.back();
      }
      return;
    }

    const direction = getDpadDirection(event);
    if (direction) {
      const { chips, cards } = this.getFocusLists();
      const zone = this.focusState?.zone || (cards.length ? "card" : "filter");
      let index = Number(this.focusState?.index || 0);
      event?.preventDefault?.();

      if (zone === "filter") {
        if (direction === "left") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition - 1, 0, ordered.length - 1)];
            this.setAddonFilter(nextFilter, "filter", clamp(index - 1, 0, Math.max(0, chips.length - 1)));
          }
          return;
        }
        if (direction === "right") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition + 1, 0, ordered.length - 1)];
            this.setAddonFilter(nextFilter, "filter", clamp(index + 1, 0, Math.max(0, chips.length - 1)));
          }
          return;
        }
        if (direction === "down" && cards.length) {
          this.focusState = { zone: "card", index: clamp(index, 0, cards.length - 1) };
          this.applyFocus();
        }
        return;
      }

      if (zone === "card") {
        if (direction === "up") {
          if (index > 0) {
            this.focusState = { zone: "card", index: index - 1 };
            this.applyFocus();
            return;
          }
          this.focusState = {
            zone: "filter",
            index: clamp(["all", ...this.getOrderedFilterNames()].indexOf(this.addonFilter), 0, Math.max(0, chips.length - 1))
          };
          this.applyFocus();
          return;
        }
        if (direction === "down") {
          this.focusState = { zone: "card", index: clamp(index + 1, 0, Math.max(0, cards.length - 1)) };
          this.applyFocus();
          return;
        }
        if (direction === "left" || direction === "right") {
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const delta = direction === "left" ? -1 : 1;
          const nextFilter = ordered[clamp(currentIndex + delta, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", index);
          return;
        }
      }
      return;
    }

    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(current.dataset.addon || "all");
      this.setAddonFilter(addon, "filter", Array.from(this.container.querySelectorAll(".stream-route-chip.focusable")).indexOf(current));
      return;
    }
    if (action === "playStream") {
      this.playStream(current.dataset.streamId);
    }
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    this.cancelScheduledRender();
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    ScreenUtils.hide(this.container);
  }

};
