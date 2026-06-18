import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import {
  selectAutoPlayStream,
  isAutoPlayEffectivelyEnabled
} from "../../../core/streams/streamAutoPlaySelector.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import { DirectDebridStreamPreparer } from "../../../core/debrid/directDebridStreamPreparer.js";
import { WebOsEngineFsResolver } from "../../../core/p2p/webosEngineFsResolver.js";
import { TizenStreamingServerResolver } from "../../../core/p2p/tizenStreamingServerResolver.js";
import { DebridSettingsStore } from "../../../data/local/debridSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import {
  ensureWebOsImageProxyReady,
  isWebOsImageProxyUrl,
  normalizeImageUrl,
  onWebOsImageProxyReady
} from "../../../core/media/imageProxy.js";
import { Environment } from "../../../platform/environment.js";
import { WebOsLunaService } from "../../../platform/webos/webosLunaService.js";
import { I18n } from "../../../i18n/index.js";
import {
  matchStreamBadges,
  normalizeStreamBadgeChipColor,
  normalizeStreamBadgeRules
} from "../../../core/streams/streamBadgeRules.js";

const failedAddonLogoUrls = new Set();
const addonLogoCache = new Map();
const ADDON_LOGO_CACHE_KEY = "nuvio.stream.addonLogoCache.v1";
const ADDON_LOGO_CACHE_LIMIT = 36;
const ADDON_LOGO_CACHE_MAX_LENGTH = 140000;
const STREAM_BADGE_LIMIT = 9;
const WEBOS_NATIVE_PLAYER_APP_IDS = [
  "com.webos.app.mediadiscovery",
  "com.webos.app.photovideo",
  "com.webos.app.smartshare"
];
const WEBOS_DLNA_PROTOCOL_SUFFIX =
  "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
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
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLaunchableExternalMediaUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:"
    );
  } catch (_) {
    return false;
  }
}

function isLocalOnlyPlaybackUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "file:") {
      return false;
    }
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch (_) {
    return false;
  }
}

function buildWebOsDlnaProtocolInfo(mimeType = "video/mp4") {
  const normalized = String(mimeType || "video/mp4").trim() || "video/mp4";
  return `http-get:*:${normalized}:${WEBOS_DLNA_PROTOCOL_SUFFIX}`;
}

function normalizeExternalLaunchFileName(value = "") {
  const trimmed = String(value || "").trim();
  return (
    trimmed
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Nuvio"
  );
}

function guessMimeTypeFromUrl(url = "") {
  const value = String(url || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  const extensionMatch = value.match(
    /\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|ts|m2ts|mp3|aac|flac)(?=($|[/?#&]))/i
  );
  if (!extensionMatch) {
    return null;
  }
  const extension = String(extensionMatch[1] || "").toLowerCase();
  const mimeMap = {
    aac: "audio/aac",
    flac: "audio/flac",
    m2ts: "video/mp2t",
    m3u8: "application/vnd.apple.mpegurl",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mpd: "application/dash+xml",
    ts: "video/mp2t",
    webm: "video/webm"
  };
  return mimeMap[extension] || null;
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
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri =
    resolve.magnetUri ||
    (isMagnetUrl(item.url) ? item.url : "") ||
    (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve ||
    item.raw?.clientResolve ||
    item.debridCacheStatus ||
    item.raw?.debridCacheStatus ||
    infoHash ||
    magnetUri
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
    String(
      resolve.service ||
        item.debridCacheStatus?.providerId ||
        item.raw?.debridCacheStatus?.providerId ||
        ""
    ),
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
    subtitles:
      Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources,
    streamPresentation: next.streamPresentation || previous.streamPresentation || null
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
  const precision = unitIndex >= 3 ? 2 : unitIndex >= 2 ? 1 : 0;
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
      const streamOrigin = {
        ...(group.streamOrigin || {}),
        ...(stream.streamOrigin || {}),
        addonId:
          stream.addonId ||
          group.addonId ||
          group.streamOrigin?.addonId ||
          stream.streamOrigin?.addonId ||
          null,
        addonBaseUrl:
          stream.addonBaseUrl ||
          group.addonBaseUrl ||
          group.streamOrigin?.addonBaseUrl ||
          stream.streamOrigin?.addonBaseUrl ||
          null,
        addonName:
          stream.addonName ||
          group.addonName ||
          group.streamOrigin?.addonName ||
          stream.streamOrigin?.addonName ||
          groupName,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };
      const entry = {
        id:
          stream.id ||
          `${groupName}-${index}-${stream.url || stream.externalUrl || stream.ytId || ""}`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || null,
        url: stream.url || null,
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx ?? null,
        engineFs: stream.engineFs || stream.raw?.engineFs || null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        quality: stream.quality || null,
        qualityValue: Number.isFinite(Number(stream.qualityValue))
          ? Number(stream.qualityValue)
          : -1,
        clientResolve: stream.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        streamPresentation: stream.streamPresentation || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        addonId: stream.addonId || group.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
        addonName: stream.addonName || groupName,
        addonLogo: stream.addonLogo || group.addonLogo || null,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null,
        streamOrigin,
        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
        raw: stream
      };
      if (
        DirectDebridResolver.shouldListStream(entry) ||
        WebOsEngineFsResolver.canResolveStream(entry) ||
        TizenStreamingServerResolver.canResolveStream(entry)
      ) {
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
  return normalizeImageUrl(value);
}

async function ensureAddonLogoImageProxyReady() {
  if (!Environment.isWebOS()) {
    return false;
  }
  try {
    return await ensureWebOsImageProxyReady();
  } catch (_) {
    return false;
  }
}

async function warmAddonLogoPreview(url = "") {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return false;
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  if (cached?.status === "ready" || cached?.status === "direct") {
    return true;
  }
  if (cached?.status === "loading") {
    return cached.promise || Promise.resolve(false);
  }

  const loadingEntry = { status: "loading", updatedAt: Date.now(), promise: null };
  addonLogoCache.set(normalized, loadingEntry);
  const promise = new Promise((resolve) => {
    const settle = (ok) => resolve(ok);
    const fail = () => {
      failedAddonLogoUrls.add(normalized);
      addonLogoCache.set(normalized, { status: "failed", updatedAt: Date.now() });
      settle(false);
    };
    const finishDirect = () => {
      addonLogoCache.set(normalized, {
        status: "direct",
        displayUrl: normalized,
        updatedAt: Date.now()
      });
      settle(true);
    };
    const loadDirect = () => {
      const directImage = new Image();
      directImage.decoding = "async";
      try {
        directImage.referrerPolicy = "no-referrer";
      } catch (_) {}
      directImage.onload = () => {
        (async () => {
          await awaitImageDecoded(directImage);
          finishDirect();
        })();
      };
      directImage.onerror = fail;
      directImage.src = normalized;
    };
    const finish = (image = null) => {
      if (image && typeof imageToDataUrl === "function") {
        (async () => {
          try {
            if (!(await awaitImageDecoded(image))) {
              throw new Error("decode-failed");
            }
            const dataUrl = imageToDataUrl(image);
            if (dataUrl) {
              addonLogoCache.set(normalized, {
                status: "ready",
                displayUrl: dataUrl,
                updatedAt: Date.now()
              });
              scheduleAddonLogoCachePersist();
              settle(true);
              return;
            }
          } catch (_) {}
          finishDirect();
        })();
        return;
      }
      finishDirect();
    };
    const image = new Image();
    image.decoding = "async";
    try {
      image.crossOrigin = "anonymous";
    } catch (_) {}
    try {
      image.referrerPolicy = "no-referrer";
    } catch (_) {}
    image.onload = () => finish(image);
    image.onerror = loadDirect;
    image.src = normalized;
  });
  loadingEntry.promise = promise;
  return promise;
}

export function resetAddonLogoCache() {
  failedAddonLogoUrls.clear();
  addonLogoCache.clear();
  addonLogoCacheHydrated = false;
  if (addonLogoCachePersistTimer) {
    clearTimeout(addonLogoCachePersistTimer);
    addonLogoCachePersistTimer = null;
  }
  LocalStore.remove(ADDON_LOGO_CACHE_KEY);
}

export async function preloadStreamBadgeImages(settings = StreamBadgeSettingsStore.snapshot()) {
  const rules = normalizeStreamBadgeRules(settings?.rules);
  const urls = new Set();
  rules.imports.forEach((importItem) => {
    (importItem.filters || []).forEach((filter) => {
      const url = normalizeAddonLogoUrl(filter.imageURL);
      if (url) {
        urls.add(url);
      }
    });
  });
  await Promise.all(Array.from(urls).map((url) => requestAddonLogo(url)));
}

async function preloadMatchedStreamBadgeImages(
  streams = [],
  settings = StreamBadgeSettingsStore.snapshot()
) {
  const urls = new Set();
  (streams || []).forEach((stream) => {
    matchStreamBadges(stream, settings?.rules)
      .slice(0, STREAM_BADGE_LIMIT)
      .forEach((badge) => {
        const url = normalizeAddonLogoUrl(badge.imageURL);
        if (url) {
          urls.add(url);
        }
      });
  });
  await Promise.all(Array.from(urls).map((url) => requestAddonLogo(url)));
}

async function preloadAddonLogoImages(streams = [], lookup = {}) {
  const urls = new Set();
  (streams || []).forEach((stream) => {
    const url = normalizeAddonLogoUrl(
      stream?.addonLogo || stream?.raw?.addonLogo || resolveAddonLogo(stream?.addonName, lookup)
    );
    if (url) {
      urls.add(url);
    }
  });
  await Promise.all(Array.from(urls).map((url) => warmAddonLogoPreview(url)));
}

function hydrateAddonLogoCache() {
  if (addonLogoCacheHydrated) {
    return;
  }
  addonLogoCacheHydrated = true;
  const cached = LocalStore.get(ADDON_LOGO_CACHE_KEY, {});
  const entries = cached && typeof cached === "object" && !Array.isArray(cached) ? cached : {};
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
    .filter(
      ([, entry]) =>
        entry?.status === "ready" &&
        String(entry.displayUrl || "").startsWith("data:image/") &&
        String(entry.displayUrl || "").length <= ADDON_LOGO_CACHE_MAX_LENGTH
    )
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

async function awaitImageDecoded(image) {
  if (!image || typeof image.decode !== "function") {
    return true;
  }
  try {
    await image.decode();
    return true;
  } catch (_) {
    return false;
  }
}

function requestAddonLogo(url = "", onSettled = null) {
  const normalized = normalizeAddonLogoUrl(url);
  if (!normalized || failedAddonLogoUrls.has(normalized)) {
    return Promise.resolve(false);
  }
  hydrateAddonLogoCache();
  const cached = addonLogoCache.get(normalized);
  if (cached?.status === "ready" || cached?.status === "direct") {
    return Promise.resolve(true);
  }
  if (cached?.status === "loading") {
    return cached.promise || Promise.resolve(false);
  }

  if (Environment.isWebOS() && !isWebOsImageProxyUrl(normalized)) {
    addonLogoCache.set(normalized, {
      status: "direct",
      displayUrl: normalized,
      updatedAt: Date.now()
    });
    if (typeof onSettled === "function") {
      setTimeout(onSettled, 0);
    }
    return Promise.resolve(true);
  }

  const loadingEntry = { status: "loading", updatedAt: Date.now(), promise: null };
  addonLogoCache.set(normalized, loadingEntry);
  const promise = new Promise((resolve) => {
    const settle = (ok) => {
      if (typeof onSettled === "function") {
        onSettled();
      }
      resolve(ok);
    };
    const fail = () => {
      failedAddonLogoUrls.add(normalized);
      addonLogoCache.set(normalized, { status: "failed", updatedAt: Date.now() });
      settle(false);
    };
    const finishDirect = () => {
      addonLogoCache.set(normalized, {
        status: "direct",
        displayUrl: normalized,
        updatedAt: Date.now()
      });
      settle(true);
    };
    const loadDirect = () => {
      const directImage = new Image();
      directImage.decoding = "async";
      try {
        directImage.referrerPolicy = "no-referrer";
      } catch (_) {
        // Some TV browsers expose referrerPolicy as read-only.
      }
      directImage.onload = () => {
        (async () => {
          await awaitImageDecoded(directImage);
          finishDirect();
        })();
      };
      directImage.onerror = fail;
      directImage.src = normalized;
    };
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    try {
      image.referrerPolicy = "no-referrer";
    } catch (_) {
      // Some TV browsers expose referrerPolicy as read-only.
    }
    image.onload = () => {
      (async () => {
        try {
          if (!(await awaitImageDecoded(image))) {
            throw new Error("decode-failed");
          }
          const dataUrl = imageToDataUrl(image);
          addonLogoCache.set(normalized, {
            status: "ready",
            displayUrl: dataUrl,
            updatedAt: Date.now()
          });
          scheduleAddonLogoCachePersist();
          settle(true);
        } catch (_) {
          loadDirect();
        }
      })();
    };
    image.onerror = loadDirect;
    image.src = normalized;
  });
  loadingEntry.promise = promise;
  return promise;
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
  return String(value || "")
    .trim()
    .toLowerCase();
}

function rememberAddonLogoLookup(lookup = {}, addonName = "", addonLogo = "") {
  const key = normalizeAddonLookupKey(addonName);
  const rawLogo = String(addonLogo || "").trim();
  const logo = normalizeAddonLogoUrl(rawLogo) || rawLogo;
  if (key && logo) {
    lookup[key] = logo;
  }
}

function normalizeAddonLogoLookup(lookup = {}) {
  const normalized = {};
  Object.entries(lookup || {}).forEach(([key, value]) => {
    rememberAddonLogoLookup(normalized, key, value);
  });
  return normalized;
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
  const primary = [stream.name, stream.title, stream.description].find((value) =>
    String(value || "").trim()
  );
  if (!primary) {
    return stream.addonName || "Unknown source";
  }
  const firstLine = String(primary).split(/\r?\n/)[0].trim();
  return firstLine || stream.addonName || "Unknown source";
}

function getStreamQuality(stream = {}) {
  const qualityLines = [];
  [stream.name, stream.title, stream.description].forEach((value) => {
    String(value || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const normalized = String(line || "").trim();
        if (normalized) {
          qualityLines.push(normalized);
        }
      });
  });
  const qualityCandidate = qualityLines.find(
    (line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line)
  );
  if (qualityCandidate) {
    return detectQuality(qualityCandidate);
  }
  return detectQuality(
    [
      stream.name || "",
      stream.title || "",
      stream.description || "",
      stream.behaviorHints?.filename || "",
      stream.sourceType || ""
    ].join(" ")
  );
}

function getStreamDescriptionLines(stream = {}) {
  const displayDescription = String(stream.description || stream.title || "").trim();
  const displayName = String(stream.name || stream.title || stream.description || "").trim();
  if (!displayDescription || displayDescription === displayName) {
    return [];
  }
  return displayDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeBadgeText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toBadgeArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeBadgeText).filter(Boolean)
    : [normalizeBadgeText(value)].filter(Boolean);
}

function parsedStreamDetails(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const raw = resolve.stream?.raw || {};
  return raw.parsed || {};
}

function normalizeCodecBadge(value = "") {
  const normalized = normalizeBadgeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (normalized === "av1") return "AV1";
  if (["hevc", "h265", "x265"].includes(normalized)) return "HEVC";
  if (["avc", "h264", "x264"].includes(normalized)) return "AVC";
  return normalizeBadgeText(value).toUpperCase();
}

const LANGUAGE_BADGE_ALIASES = {
  en: "🇬🇧",
  eng: "🇬🇧",
  english: "🇬🇧",
  hi: "🇮🇳",
  hin: "🇮🇳",
  hindi: "🇮🇳",
  it: "🇮🇹",
  ita: "🇮🇹",
  italian: "🇮🇹",
  es: "🇪🇸",
  spa: "🇪🇸",
  spanish: "🇪🇸",
  fr: "🇫🇷",
  fra: "🇫🇷",
  fre: "🇫🇷",
  french: "🇫🇷",
  de: "🇩🇪",
  deu: "🇩🇪",
  ger: "🇩🇪",
  german: "🇩🇪",
  pt: "🇵🇹",
  por: "🇵🇹",
  portuguese: "🇵🇹",
  "pt-br": "🇧🇷",
  ptbr: "🇧🇷",
  br: "🇧🇷",
  brazilian: "🇧🇷",
  "brazilian portuguese": "🇧🇷",
  pl: "🇵🇱",
  polish: "🇵🇱",
  cs: "🇨🇿",
  czech: "🇨🇿",
  la: "LAT",
  latino: "LAT",
  ja: "🇯🇵",
  jpn: "🇯🇵",
  japanese: "🇯🇵",
  ko: "🇰🇷",
  kor: "🇰🇷",
  korean: "🇰🇷",
  zh: "🇨🇳",
  chinese: "🇨🇳",
  multi: "Multi"
};

function languageBadge(value = "") {
  const text = normalizeBadgeText(value);
  const normalized = text.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return LANGUAGE_BADGE_ALIASES[normalized] || LANGUAGE_BADGE_ALIASES[compact] || text;
}

function fallbackLanguagesFromText(text = "") {
  const value = String(text || "");
  const matches = [];
  const pushMatch = (label) => {
    if (label && !matches.includes(label)) {
      matches.push(label);
    }
  };
  if (/(^|[^a-z0-9])(pt[\s._-]?br|brazilian[\s._-]?portuguese)([^a-z0-9]|$)/i.test(value))
    pushMatch("pt-br");
  if (/(^|[^a-z0-9])(en|eng|english)([^a-z0-9]|$)/i.test(value)) pushMatch("en");
  if (/(^|[^a-z0-9])(pt|por|portuguese)([^a-z0-9]|$)/i.test(value) && !matches.includes("pt-br"))
    pushMatch("pt");
  if (/(^|[^a-z0-9])(it|ita|italian)([^a-z0-9]|$)/i.test(value)) pushMatch("it");
  if (/(^|[^a-z0-9])(es|spa|spanish)([^a-z0-9]|$)/i.test(value)) pushMatch("es");
  if (/(^|[^a-z0-9])(fr|fra|fre|french)([^a-z0-9]|$)/i.test(value)) pushMatch("fr");
  if (/(^|[^a-z0-9])(de|deu|ger|german)([^a-z0-9]|$)/i.test(value)) pushMatch("de");
  if (/(^|[^a-z0-9])(multi|multilang|multi[\s._-]?audio)([^a-z0-9]|$)/i.test(value))
    pushMatch("multi");
  return matches;
}

function fallbackPresentationFromText(stream = {}) {
  const parsed = parsedStreamDetails(stream);
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    stream.sourceType,
    ...(Array.isArray(parsed.languages) ? parsed.languages : [])
  ]
    .filter(Boolean)
    .join(" ");
  const visualTags = [];
  if (/\b(dolby[ ._-]?vision|dovi|dv)\b/i.test(text)) visualTags.push("DV");
  if (/\bhdr10\+|hdr10plus\b/i.test(text)) visualTags.push("HDR10+");
  else if (/\bhdr10\b/i.test(text)) visualTags.push("HDR10");
  else if (/\bhdr\b/i.test(text)) visualTags.push("HDR");
  if (/\bhlg\b/i.test(text)) visualTags.push("HLG");
  if (/\b10\s?bit\b/i.test(text)) visualTags.push("10bit");
  if (/\bimax\b/i.test(text)) visualTags.push("IMAX");
  const audioTags = [];
  if (/\batmos\b/i.test(text)) audioTags.push("Atmos");
  if (/\b(truehd|true hd)\b/i.test(text)) audioTags.push("TrueHD");
  if (/\bdts[\s._-]?x\b/i.test(text)) audioTags.push("DTS:X");
  if (/\bdts[\s._-]?hd\b/i.test(text)) audioTags.push("DTS-HD");
  if (/\bddp|dd\+|dolby digital plus\b/i.test(text)) audioTags.push("DD+");
  if (/\baac\b/i.test(text)) audioTags.push("AAC");
  const audioChannels = [];
  const channelMatch = text.match(/\b([257]\.1|6\.1|2\.0)\b/);
  if (channelMatch) audioChannels.push(channelMatch[1]);
  const codec = /\b(av1|hevc|h\.?265|x265|avc|h\.?264|x264)\b/i.exec(text)?.[1] || "";
  return {
    resolution: detectQuality(text),
    quality: "",
    visualTags,
    encode: normalizeCodecBadge(codec),
    audioTags,
    audioChannels,
    languages: fallbackLanguagesFromText(text),
    size: stream.behaviorHints?.videoSize || 0
  };
}

function getStreamPresentation(stream = {}) {
  const parsed = parsedStreamDetails(stream);
  const presentation = stream.streamPresentation || stream.raw?.streamPresentation || {};
  const fallback = fallbackPresentationFromText(stream);
  const visualTags = toBadgeArray(
    presentation.visualTags?.length ? presentation.visualTags : parsed.hdr
  );
  const audioTags = toBadgeArray(
    presentation.audioTags?.length ? presentation.audioTags : parsed.audio
  );
  const audioChannels = toBadgeArray(
    presentation.audioChannels?.length ? presentation.audioChannels : parsed.channels
  );
  const languages = toBadgeArray(
    presentation.languages?.length ? presentation.languages : parsed.languages
  );
  const languageEmojis = toBadgeArray(
    presentation.languageEmojis?.length ? presentation.languageEmojis : []
  );
  const resolvedLanguages = languages.length ? languages : fallback.languages;
  return {
    resolution: presentation.resolution || parsed.resolution || fallback.resolution,
    quality: presentation.quality || parsed.quality || fallback.quality,
    visualTags: visualTags.length ? visualTags : fallback.visualTags,
    encode: normalizeCodecBadge(presentation.encode || parsed.codec || fallback.encode),
    audioTags: audioTags.length ? audioTags : fallback.audioTags,
    audioChannels: audioChannels.length ? audioChannels : fallback.audioChannels,
    languages: resolvedLanguages,
    languageEmojis: languageEmojis.length
      ? languageEmojis
      : resolvedLanguages.map(languageBadge).filter(Boolean),
    size: presentation.size || stream.behaviorHints?.videoSize || fallback.size,
    indexer: presentation.indexer || parsed.indexer || "",
    releaseGroup: presentation.releaseGroup || parsed.group || "",
    cached: presentation.cached,
    serviceShortName: presentation.serviceShortName || ""
  };
}

function renderImageBadgeChip(badge = {}) {
  const imageUrl = normalizeAddonLogoUrl(badge.imageURL);
  let displayImageUrl = getCachedAddonLogoDisplayUrl(imageUrl);
  if (imageUrl && !displayImageUrl && !failedAddonLogoUrls.has(imageUrl)) {
    requestAddonLogo(imageUrl);
    if (Environment.isWebOS()) {
      displayImageUrl = getCachedAddonLogoDisplayUrl(imageUrl);
    }
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled =
    String(badge.tagStyle || "")
      .trim()
      .toLowerCase() === "filled";
  const fallbackImageUrl = Environment.isWebOS() ? "" : imageUrl;
  const safeImageUrl = displayImageUrl || fallbackImageUrl;
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `
    <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
      ${
        safeImageUrl
          ? `<img src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(badge.name || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : ""
      }
    </span>
  `;
}

function renderImportedStreamBadgeChips(stream = {}, badges = [], showFileSizeBadges = true) {
  const sizeBytes = stream.behaviorHints?.videoSize;
  const chips = [];
  badges.slice(0, STREAM_BADGE_LIMIT).forEach((badge) => {
    chips.push(renderImageBadgeChip(badge));
  });
  if (showFileSizeBadges && sizeBytes != null) {
    chips.push(
      `<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [formatBytes(sizeBytes)], `SIZE ${formatBytes(sizeBytes)}`))}</span>`
    );
  }
  return chips.length
    ? `<div class="stream-route-card-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${chips.join("")}</div>`
    : "";
}

function renderStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return "";
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  const importedBadges = matchStreamBadges(stream, currentBadgeSettings.rules);
  return renderImportedStreamBadgeChips(
    stream,
    importedBadges,
    currentBadgeSettings.showFileSizeBadges !== false
  );
}

function resolveStreamBadgePlacement(badgeSettings = null) {
  const placement = String(
    (badgeSettings || StreamBadgeSettingsStore.snapshot()).badgePlacement || "BOTTOM"
  )
    .trim()
    .toUpperCase();
  return placement === "TOP" ? "TOP" : "BOTTOM";
}

function getOrderedFilterNames(sourceChips = [], streams = []) {
  const ordered = [];
  const sortedChips = (sourceChips || [])
    .slice()
    .sort(
      (left, right) =>
        Number(left?.orderIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.orderIndex ?? Number.MAX_SAFE_INTEGER)
    );
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
    if (this.renderDelayTimer) {
      clearTimeout(this.renderDelayTimer);
      this.renderDelayTimer = null;
    }
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  requestRender({ delayMs = 0 } = {}) {
    if (!this.container || Router.getCurrent() !== "stream") {
      return;
    }
    const delay = Math.max(0, Number(delayMs || 0));
    if (delay > 0) {
      if (this.renderFrame || this.renderDelayTimer) {
        return;
      }
      this.renderDelayTimer = setTimeout(() => {
        this.renderDelayTimer = null;
        this.requestRender();
      }, delay);
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

  areAddonLogosReady(streams = []) {
    return (streams || []).every((stream) => {
      const addonLogoUrl =
        normalizeAddonLogoUrl(stream?.addonLogo) ||
        resolveAddonLogo(stream?.addonName, this.addonLogoLookup);
      if (!addonLogoUrl || failedAddonLogoUrls.has(addonLogoUrl)) {
        return true;
      }
      return Boolean(getCachedAddonLogoDisplayUrl(addonLogoUrl));
    });
  },

  requestAddonLogoPrerender(streams = []) {
    const urls = Array.from(
      new Set(
        (streams || [])
          .map(
            (stream) =>
              normalizeAddonLogoUrl(stream?.addonLogo) ||
              resolveAddonLogo(stream?.addonName, this.addonLogoLookup)
          )
          .filter(
            (url) => url && !failedAddonLogoUrls.has(url) && !getCachedAddonLogoDisplayUrl(url)
          )
      )
    );
    if (!urls.length) {
      return;
    }
    const key = urls.sort().join("|");
    if (this.pendingAddonLogoPrerenderKey === key) {
      return;
    }
    const token = this.loadToken || 0;
    this.pendingAddonLogoPrerenderKey = key;
    void preloadAddonLogoImages(streams, this.addonLogoLookup).finally(() => {
      if (this.pendingAddonLogoPrerenderKey === key) {
        this.pendingAddonLogoPrerenderKey = "";
      }
      if (this.container && Router.getCurrent() === "stream" && token === this.loadToken) {
        this.requestRender();
      }
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
          const keyFor = (stream) =>
            [
              stream.clientResolve?.service || "",
              stream.clientResolve?.infoHash || stream.infoHash || "",
              stream.clientResolve?.fileIdx ?? stream.fileIdx ?? "",
              stream.clientResolve?.filename || stream.behaviorHints?.filename || "",
              stream.name || "",
              stream.title || ""
            ].join("|");
          const originalKey = keyFor(original);
          this.streams = this.streams.map((stream) =>
            keyFor(stream) === originalKey ? { ...stream, ...prepared } : stream
          );
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
    void Router.navigate(
      "detail",
      {
        itemId,
        itemType: normalizeType(this.params?.itemType),
        fallbackTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
        returnHomeOnBack: Boolean(
          this.params?.continueWatchingBackHome ||
          this.params?.returnHomeOnBack ||
          this.params?.returnToDetail ||
          this.params?.fromDetailRoute
        )
      },
      {
        skipStackPush: true,
        replaceHistory: true
      }
    );
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
      sourceChips: Array.isArray(this.sourceChips)
        ? this.sourceChips.map((chip) => ({ ...chip }))
        : [],
      addonLogoLookup: this.addonLogoLookup ? { ...this.addonLogoLookup } : {},
      listScrollTop: Number(list?.scrollTop || 0)
    };
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("stream");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    const token = this.loadToken;
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.error = "";
    this.loading = true;
    this.streams = [];
    this.sourceChips = [];
    this.addonLogoLookup = {};
    this.addonFilter = "all";
    this.hasRenderedStreamRouteShell = false;
    this.autoResumeAttempted = false;
    this.autoPlayAttempted = false;
    this.cancelAutoPlayCountdown();
    this.webOsNativePlayerAppId = "";
    this.nativePlayerPendingStreamId = "";
    this.nativePlayerRequestToken = 0;
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    if (Environment.isWebOS()) {
      this.releaseImageProxyReadyListener = onWebOsImageProxyReady(() => {
        failedAddonLogoUrls.clear();
        this.requestRender({ delayMs: 0 });
      });
      void ensureWebOsImageProxyReady();
      void this.detectWebOsNativePlayerApp();
    }

    const restored =
      navigationContext?.restoredState && typeof navigationContext.restoredState === "object"
        ? navigationContext.restoredState
        : null;
    if (restored) {
      this.loading = Boolean(restored.loading);
      this.error = String(restored.error || "");
      this.streams = Array.isArray(restored.streams)
        ? restored.streams.map((stream) => ({ ...stream }))
        : [];
      this.addonFilter = String(restored.addonFilter || "all");
      this.focusState = restored.focusState
        ? { ...restored.focusState }
        : { zone: "filter", index: 0 };
      this.sourceChips = Array.isArray(restored.sourceChips)
        ? restored.sourceChips.map((chip) => ({ ...chip }))
        : [];
      this.addonLogoLookup =
        restored.addonLogoLookup && typeof restored.addonLogoLookup === "object"
          ? normalizeAddonLogoLookup(restored.addonLogoLookup)
          : {};
      this.listScrollTop = Number(restored.listScrollTop || 0);
    }

    if (restored && this.streams.length) {
      await ensureAddonLogoImageProxyReady();
      if (token !== this.loadToken || Router.getCurrent() !== "stream") {
        return;
      }
      this.streams = this.applyAddonLogos(this.streams);
      await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      if (token !== this.loadToken || Router.getCurrent() !== "stream") {
        return;
      }
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
    if (!this.hasRenderedStreamRouteShell) {
      this.requestRender();
    }
    await ensureAddonLogoImageProxyReady();
    if (token !== this.loadToken) {
      return;
    }
    const pendingChunkTasks = new Set();
    const badgeSettings = StreamBadgeSettingsStore.snapshot();

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
      rememberAddonLogoLookup(this.addonLogoLookup, name, addon.logo || nextChip.logo);
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
      this.sourceChips = this.sourceChips.map((chip) =>
        successSet.has(chip.name) ? { ...chip, status: "success" } : chip
      );
      entries.forEach((entry) => {
        if (!known.has(entry.name)) {
          const orderIndex = Number.isFinite(entry.orderIndex)
            ? entry.orderIndex
            : Number.MAX_SAFE_INTEGER;
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
        .sort(
          (left, right) =>
            Number(left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
            Number(right.orderIndex ?? Number.MAX_SAFE_INTEGER)
        );
    };

    const displayChunkGroups = async (groups = []) => {
      if (token !== this.loadToken) {
        return;
      }
      const chunkStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams({ status: "success", data: groups }))
      );
      if (!chunkStreams.length) {
        return;
      }
      await Promise.all([
        preloadMatchedStreamBadgeImages(chunkStreams, badgeSettings),
        preloadAddonLogoImages(chunkStreams, this.addonLogoLookup)
      ]);
      if (token !== this.loadToken) {
        return;
      }
      this.streams = mergeStreamItems(this.streams, chunkStreams);
      this.scheduleDebridPreparation();
      markSuccessfulSources(
        groups.map((group) => ({
          name: group?.addonName || "",
          logo: group?.addonLogo || "",
          orderIndex: group?.addonOrderIndex
        }))
      );
      if (this.streams.length && this.focusState?.zone !== "card") {
        this.focusState = { zone: "card", row: 0, action: "play" };
      }
      this.requestRender({ delayMs: 120 });
    };

    const queueChunkGroups = (groups = []) => {
      const task = displayChunkGroups(groups)
        .catch((error) => {
          console.warn("Stream chunk prerender failed", error);
        })
        .finally(() => {
          pendingChunkTasks.delete(task);
        });
      pendingChunkTasks.add(task);
      return task;
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
        this.requestRender({ delayMs: 120 });
      },
      onChunk: (chunkResult) => {
        if (token !== this.loadToken || chunkResult?.status !== "success") {
          return;
        }
        const groups = Array.isArray(chunkResult.data) ? chunkResult.data : [];
        queueChunkGroups(groups);
      }
    };

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(
        itemType,
        videoId,
        options
      );
      if (token !== this.loadToken) {
        return;
      }
      const loadedStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams(streamResult))
      );
      await Promise.allSettled(Array.from(pendingChunkTasks));
      if (token !== this.loadToken) {
        return;
      }
      const existingKeys = new Set(
        this.streams.map((stream) => streamMergeKey(stream)).filter(Boolean)
      );
      const missingStreams = loadedStreams.filter((stream) => {
        const key = streamMergeKey(stream);
        return key && !existingKeys.has(key);
      });
      if (missingStreams.length) {
        await Promise.all([
          preloadMatchedStreamBadgeImages(missingStreams, badgeSettings),
          preloadAddonLogoImages(missingStreams, this.addonLogoLookup)
        ]);
        if (token !== this.loadToken) {
          return;
        }
        this.streams = mergeStreamItems(this.streams, missingStreams);
      }
      this.scheduleDebridPreparation();
      markSuccessfulSources(this.streams.map((stream) => stream.addonName));
      if (this.streams.length) {
        await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      }
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.loading = false;
      if (this.streams.length) {
        const visibleStreams = this.getFilteredStreams();
        const maxCardIndex = Math.max(0, visibleStreams.length - 1);
        let initialIndex = clamp(Number(this.focusState?.index || 0), 0, maxCardIndex);
        const preferred = String(this.params?.preferredStreamId || "").trim();
        if (preferred) {
          const prefIdx = visibleStreams.findIndex((s) => String(s?.id || "") === preferred);
          if (prefIdx >= 0) {
            initialIndex = prefIdx;
          }
        }
        const rowIndex = clamp(initialIndex, 0, this.streams.length - 1);
        this.focusState = {
          zone: "card",
          index: clamp(initialIndex, 0, maxCardIndex),
          row: rowIndex,
          action: String(this.focusState?.action || "play")
        };
      } else {
        this.focusState = { zone: "filter", index: 0 };
      }
      this.requestRender();
      this.scheduleErrorChipCleanup();
      this.maybeAutoResumeStream();
      this.maybeAutoPlayStream();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.loading = false;
      this.error = error?.message || "Failed to load streams.";
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.requestRender();
      this.scheduleErrorChipCleanup();
    }
  },

  // Continue Watching can pass the identity of the stream that was playing.
  // If that same source shows up again, resume it directly.
  maybeAutoResumeStream() {
    if (this.autoResumeAttempted) {
      return;
    }
    const identity = String(this.params?.resumeStreamIdentity || "").trim();
    if (!identity || !this.streams.length) {
      return;
    }
    this.autoResumeAttempted = true;
    const match = this.streams.find((stream) => streamMergeKey(stream) === identity);
    if (match?.id) {
      void this.playStream(match.id);
    }
  },

  maybeAutoPlayStream() {
    if (this.autoPlayAttempted || this.autoPlayCountdown) {
      return;
    }
    // Resume already navigated away, or there is nothing to play.
    if (Router.getCurrent() !== "stream" || !this.streams.length) {
      return;
    }
    const settings = PlayerSettingsStore.get();
    if (!isAutoPlayEffectivelyEnabled(settings)) {
      return;
    }
    this.autoPlayAttempted = true;
    const installedAddonNames = new Set(
      (addonRepository.getCachedInstalledAddons() || [])
        .map((addon) => String(addon?.displayName || addon?.name || "").trim())
        .filter(Boolean)
    );
    const selected = selectAutoPlayStream(this.getFilteredStreams(), {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames
    });
    if (!selected?.id) {
      return;
    }
    this.startAutoPlayCountdown(selected, Number(settings.streamAutoPlayTimeoutSeconds || 0));
  },

  startAutoPlayCountdown(stream, seconds) {
    this.cancelAutoPlayCountdown();
    // Focus the chosen stream so cancelling leaves the user on it.
    const visible = this.getFilteredStreams();
    const idx = visible.findIndex((entry) => String(entry?.id || "") === String(stream.id || ""));
    if (idx >= 0) {
      this.focusState = { zone: "card", index: idx, row: idx, action: "play" };
    }
    const total = Math.max(0, Math.trunc(Number(seconds) || 0));
    if (total <= 0) {
      void this.playStream(stream.id);
      return;
    }
    this.autoPlayCountdown = {
      streamId: stream.id,
      label: getStreamHeadline(stream) || stream.addonName || "stream",
      secondsLeft: total
    };
    this.requestRender({ delayMs: 0 });
    this.autoPlayTimer = setInterval(() => {
      if (!this.autoPlayCountdown) {
        return;
      }
      this.autoPlayCountdown.secondsLeft -= 1;
      if (this.autoPlayCountdown.secondsLeft <= 0) {
        const targetId = this.autoPlayCountdown.streamId;
        this.cancelAutoPlayCountdown();
        void this.playStream(targetId);
        return;
      }
      this.requestRender({ delayMs: 0 });
    }, 1000);
  },

  cancelAutoPlayCountdown() {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoPlayCountdown) {
      this.autoPlayCountdown = null;
      this.requestRender({ delayMs: 0 });
    }
  },

  renderAutoPlayOverlay() {
    if (!this.autoPlayCountdown) {
      return "";
    }
    const { label, secondsLeft } = this.autoPlayCountdown;
    return `
      <div class="stream-route-autoplay">
        <div class="stream-route-autoplay-card">
          <div class="stream-route-autoplay-title">${escapeHtml(t("stream_autoplay_title", {}, "Auto-playing"))}</div>
          <div class="stream-route-autoplay-name">${escapeHtml(label)}</div>
          <div class="stream-route-autoplay-count">${escapeHtml(t("stream_autoplay_countdown", [secondsLeft], `Starting in ${secondsLeft}s`))}</div>
          <div class="stream-route-autoplay-hint">${escapeHtml(t("stream_autoplay_hint", {}, "Press OK to play now, or any key to choose manually"))}</div>
        </div>
      </div>`;
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
      this.focusState = {
        zone: "card",
        row: clamp(preferredIndex, 0, filtered.length - 1),
        action: "play"
      };
    } else {
      const ordered = ["all", ...this.getOrderedFilterNames()];
      this.focusState = {
        zone: "filter",
        index: clamp(ordered.indexOf(targetFilter), 0, Math.max(0, ordered.length - 1))
      };
    }
    this.listScrollTop = 0;
    this.render();
  },

  resolveCardActionForRow(row = null, preferredAction = "play") {
    if (!row) {
      return null;
    }
    if (preferredAction === "native" && row.native) {
      return row.native;
    }
    return row.play || row.native || null;
  },

  getCardRows() {
    return Array.from(
      this.container?.querySelectorAll(".stream-route-card-row[data-stream-row]") || []
    )
      .map((rowNode) => ({
        row: Number(rowNode.dataset.streamRow || 0),
        play: rowNode.querySelector('[data-card-action="play"]'),
        native: rowNode.querySelector('[data-card-action="native"]')
      }))
      .filter((row) => row.play || row.native);
  },

  isCardActionFocused(rowIndex, action) {
    return (
      this.focusState?.zone === "card" &&
      Number(this.focusState?.row || 0) === Number(rowIndex) &&
      String(this.focusState?.action || "play") === String(action || "play")
    );
  },

  focusElement(target) {
    if (!target) {
      return false;
    }
    this.container
      .querySelectorAll(".focusable")
      .forEach((node) => node.classList.remove("focused"));
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
      this.scheduleFocusedListItemVisibilityCheck(listNode, target);
    }
    return true;
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
    return this.focusElement(target);
  },

  setListScrollTop(listNode, nextScrollTop) {
    if (!listNode) {
      return;
    }
    const maxScrollTop = Math.max(
      0,
      Number(listNode.scrollHeight || 0) - Number(listNode.clientHeight || 0)
    );
    const normalized = clamp(Number(nextScrollTop || 0), 0, maxScrollTop);
    listNode.scrollTop = normalized;
    if (typeof listNode.scrollTo === "function") {
      try {
        listNode.scrollTo(0, normalized);
      } catch (_) {
        listNode.scrollTop = normalized;
      }
    }
    this.listScrollTop = Number(listNode.scrollTop || normalized || 0);
  },

  ensureListItemVisible(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    const viewTop = Number(listNode.scrollTop || 0);
    let itemTop = Number(target.offsetTop || 0);
    let itemBottom = itemTop + Number(target.offsetHeight || 0);
    if (
      typeof listNode.getBoundingClientRect === "function" &&
      typeof target.getBoundingClientRect === "function"
    ) {
      const listRect = listNode.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (
        listRect &&
        targetRect &&
        Number.isFinite(targetRect.top) &&
        Number.isFinite(listRect.top)
      ) {
        itemTop = viewTop + (targetRect.top - listRect.top);
        itemBottom = viewTop + (targetRect.bottom - listRect.top);
      }
    }
    const viewHeight = Number(listNode.clientHeight || 0);
    if (!viewHeight) {
      return;
    }
    const viewBottom = viewTop + viewHeight;
    const pad = 16;
    if (itemBottom > viewBottom - pad) {
      this.setListScrollTop(listNode, itemBottom - viewHeight + pad);
    } else if (itemTop < viewTop + pad) {
      this.setListScrollTop(listNode, itemTop - pad);
    }
  },

  scheduleFocusedListItemVisibilityCheck(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    const run = () => {
      const root = document.documentElement || document.body;
      if (!this.container || !root?.contains?.(listNode) || !root?.contains?.(target)) {
        return;
      }
      this.ensureListItemVisible(listNode, target);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
      return;
    }
    setTimeout(run, 0);
  },

  getFocusLists() {
    const chips = Array.from(this.container.querySelectorAll(".stream-route-chip.focusable"));
    const rows = this.getCardRows();
    return { chips, rows };
  },

  applyFocus() {
    const { chips, rows } = this.getFocusLists();
    if (!chips.length && !rows.length) {
      return;
    }
    const zone = this.focusState?.zone || (rows.length ? "card" : "filter");
    const index = Number(this.focusState?.index || 0);
    if (zone === "card" && rows.length) {
      const rowIndex = clamp(Number(this.focusState?.row || 0), 0, rows.length - 1);
      const preferredAction = String(this.focusState?.action || "play");
      const target = this.resolveCardActionForRow(rows[rowIndex], preferredAction);
      const resolvedAction = target?.dataset?.cardAction || "play";
      this.focusState = { zone: "card", row: rowIndex, action: resolvedAction };
      this.focusElement(target);
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
    this.setListScrollTop(list, Number(this.listScrollTop || 0));
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
      : [String(this.params?.genres || "").trim(), String(this.params?.year || "").trim()]
          .filter(Boolean)
          .join(" • ");
    return { isSeries, title, subtitle, episodeLabel, detailLine };
  },

  async detectWebOsNativePlayerApp() {
    if (!Environment.isWebOS() || !WebOsLunaService.isAvailable()) {
      this.webOsNativePlayerAppId = "";
      return "";
    }
    const requestToken = Number(this.nativePlayerRequestToken || 0) + 1;
    this.nativePlayerRequestToken = requestToken;
    for (const appId of WEBOS_NATIVE_PLAYER_APP_IDS) {
      try {
        const payload = await WebOsLunaService.request("luna://com.webos.applicationManager", {
          method: "getAppLoadStatus",
          parameters: { appId }
        });
        if (payload?.exist) {
          if (this.nativePlayerRequestToken === requestToken) {
            this.webOsNativePlayerAppId = appId;
            this.requestRender({ delayMs: 0 });
          }
          return appId;
        }
      } catch (_) {
        // Continue trying known native-player app ids.
      }
    }
    if (this.nativePlayerRequestToken === requestToken) {
      this.webOsNativePlayerAppId = "";
      this.requestRender({ delayMs: 0 });
    }
    return "";
  },

  showStreamToast(message) {
    if (!this.container) {
      return;
    }
    const shell = this.container.querySelector(".stream-route-shell");
    if (!shell) {
      return;
    }
    let toast = shell.querySelector(".stream-route-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "stream-route-toast";
      shell.appendChild(toast);
    }
    toast.textContent = String(message || "").trim();
    toast.classList.add("visible");
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
    }
    this.streamToastTimer = setTimeout(() => {
      toast?.classList.remove("visible");
    }, 2600);
  },

  getStreamRequestHeaders(stream = {}) {
    const raw = stream?.raw || stream || {};
    const requestHeaders =
      raw?.behaviorHints?.proxyHeaders?.request || stream?.behaviorHints?.proxyHeaders?.request;
    return requestHeaders && typeof requestHeaders === "object" ? { ...requestHeaders } : {};
  },

  resolveStreamMimeType(stream = {}, fallbackUrl = "") {
    const raw = stream?.raw || stream || {};
    const candidates = [
      stream?.mimeType,
      raw?.mimeType,
      stream?.sourceType,
      raw?.sourceType,
      raw?.type,
      raw?.source
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const explicit = candidates.find((value) => value.includes("/"));
    if (explicit) {
      return explicit;
    }
    const alias = String(candidates[0] || "").toLowerCase();
    const aliasMap = {
      dash: "application/dash+xml",
      hls: "application/vnd.apple.mpegurl",
      m3u8: "application/vnd.apple.mpegurl",
      m4v: "video/mp4",
      mkv: "video/x-matroska",
      mov: "video/quicktime",
      mp4: "video/mp4",
      mpd: "application/dash+xml",
      ts: "video/mp2t",
      webm: "video/webm"
    };
    return aliasMap[alias] || guessMimeTypeFromUrl(fallbackUrl) || "video/mp4";
  },

  getWebOsNativeLaunchUrl(stream = {}) {
    const requestHeaders = this.getStreamRequestHeaders(stream);
    if (Object.keys(requestHeaders).length) {
      return "";
    }
    const candidates = [
      stream?.engineFs?.publicPlaybackUrl,
      stream?.raw?.engineFs?.publicPlaybackUrl,
      stream?.externalUrl,
      stream?.url,
      stream?.raw?.externalUrl,
      stream?.raw?.url
    ].filter(Boolean);
    return (
      candidates.find(
        (value) => isLaunchableExternalMediaUrl(value) && !isLocalOnlyPlaybackUrl(value)
      ) || ""
    );
  },

  canOfferNativePlayerForStream(stream = {}) {
    if (!Environment.isWebOS() || !this.webOsNativePlayerAppId) {
      return false;
    }
    if (this.getWebOsNativeLaunchUrl(stream)) {
      return true;
    }
    if (WebOsEngineFsResolver.canResolveStream(stream)) {
      return true;
    }
    return DirectDebridResolver.canResolveStream(stream, {
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null
    });
  },

  replaceStreamInList(streamId, nextStream = null) {
    if (!streamId || !nextStream) {
      return;
    }
    this.streams = this.streams.map((stream) =>
      stream.id === streamId ? { ...stream, ...nextStream } : stream
    );
  },

  async resolveStreamForNativePlayer(stream = {}) {
    const directUrl = this.getWebOsNativeLaunchUrl(stream);
    if (directUrl) {
      return { status: "success", stream };
    }
    if (WebOsEngineFsResolver.canResolveStream(stream)) {
      const result = await WebOsEngineFsResolver.resolve(stream, {});
      if (result?.status === "success" && result.stream) {
        return result;
      }
    }
    if (
      DirectDebridResolver.canResolveStream(stream, {
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null
      })
    ) {
      const result = await DirectDebridResolver.resolve(stream, {
        season: this.params?.season ?? null,
        episode: this.params?.episode ?? null
      });
      if (result?.status === "success" && result.stream) {
        return result;
      }
      return result || { status: "unavailable" };
    }
    return { status: "unavailable" };
  },

  buildWebOsNativePlayerLaunchParameters(stream = {}) {
    const appId = String(this.webOsNativePlayerAppId || "").trim();
    const launchUrl = this.getWebOsNativeLaunchUrl(stream);
    if (!appId || !launchUrl) {
      return null;
    }
    const filename = normalizeExternalLaunchFileName(
      stream?.behaviorHints?.filename ||
        stream?.raw?.behaviorHints?.filename ||
        stream?.title ||
        stream?.name ||
        this.params?.itemTitle ||
        this.params?.playerTitle
    );
    const mimeType = this.resolveStreamMimeType(stream, launchUrl);
    return {
      id: appId,
      params: {
        payload: [
          {
            fullPath: launchUrl,
            artist: "",
            subtitle: "",
            dlnaInfo: {
              flagVal: 4096,
              cleartextSize: "-1",
              contentLength: "-1",
              opVal: 1,
              protocolInfo: buildWebOsDlnaProtocolInfo(mimeType),
              duration: 0
            },
            mediaType: "VIDEO",
            thumbnail: "",
            deviceType: "DMR",
            album: "",
            fileName: filename,
            lastPlayPosition: -1
          }
        ]
      }
    };
  },

  async openStreamInNativePlayer(streamId) {
    if (!Environment.isWebOS() || !this.webOsNativePlayerAppId || !WebOsLunaService.isAvailable()) {
      return;
    }
    if (this.nativePlayerPendingStreamId) {
      return;
    }
    const selected =
      this.getFilteredStreams().find((stream) => stream.id === streamId) ||
      this.streams.find((stream) => stream.id === streamId) ||
      null;
    if (!selected) {
      return;
    }

    this.nativePlayerPendingStreamId = streamId;
    this.requestRender({ delayMs: 0 });
    try {
      const result = await this.resolveStreamForNativePlayer(selected);
      if (result?.status !== "success" || !result.stream) {
        this.showStreamToast(
          t(
            "player_external_launch_unavailable",
            {},
            "This stream cannot be opened in Native Player"
          )
        );
        return;
      }

      this.replaceStreamInList(streamId, result.stream);
      const launchParameters = this.buildWebOsNativePlayerLaunchParameters(result.stream);
      if (!launchParameters) {
        this.requestRender({ delayMs: 0 });
        this.showStreamToast(
          t(
            "player_external_launch_unavailable",
            {},
            "This stream cannot be opened in Native Player"
          )
        );
        return;
      }

      await WebOsLunaService.request("luna://com.webos.applicationManager", {
        method: "launch",
        parameters: launchParameters
      });
      this.showStreamToast(
        t("player_external_launching_media_player", {}, "Opening Native Player")
      );
    } catch (error) {
      console.warn("Failed to open stream in native player", { streamId, error });
      this.showStreamToast(t("player_external_launch_failed", {}, "Could not open Native Player"));
    } finally {
      this.nativePlayerPendingStreamId = "";
      this.requestRender({ delayMs: 0 });
    }
  },

  renderChip(name, selected, status) {
    const chipStatus = String(status || "success");
    const classes = [
      "stream-route-chip",
      "focusable",
      selected ? "selected" : "",
      chipStatus !== "success" ? chipStatus : ""
    ]
      .filter(Boolean)
      .join(" ");
    const spinner =
      chipStatus === "loading"
        ? '<span class="stream-route-chip-spinner" aria-hidden="true"></span>'
        : "";
    return `
      <button class="${classes}" data-action="setFilter" data-addon="${escapeHtml(name)}">
        ${spinner}
        <span>${escapeHtml(name === "all" ? t("common.all", {}, "All") : name)}</span>
      </button>
    `;
  },

  renderStreamCard(stream, index, streamBadgesEnabled = true, badgeSettings = null) {
    const headline = getStreamHeadline(stream);
    const quality = getStreamQuality(stream);
    const badges = renderStreamBadges(stream, streamBadgesEnabled, badgeSettings);
    const badgePlacement = resolveStreamBadgePlacement(badgeSettings);
    const topBadges = badgePlacement === "TOP" ? badges : "";
    const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
    const descriptionLines = getStreamDescriptionLines(stream);
    const addonLogoUrl =
      normalizeAddonLogoUrl(stream.addonLogo) ||
      resolveAddonLogo(stream.addonName, this.addonLogoLookup);
    const cachedAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
    let displayAddonLogoUrl = cachedAddonLogoUrl || "";
    if (addonLogoUrl && !displayAddonLogoUrl && !failedAddonLogoUrls.has(addonLogoUrl)) {
      requestAddonLogo(addonLogoUrl, () => this.requestRender({ delayMs: 160 }));
      if (Environment.isWebOS()) {
        displayAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
      }
    }
    const addonBadgeLabel = escapeHtml(getAddonBadgeLabel(stream.addonName || ""));
    const addonLogoLoading = Environment.isWebOS() || Environment.isTizen() ? "eager" : "lazy";
    const addonLogoDecoding = Environment.isWebOS() || Environment.isTizen() ? "sync" : "async";
    const addonBadge = displayAddonLogoUrl
      ? `<img src="${escapeHtml(displayAddonLogoUrl)}" alt="${escapeHtml(stream.addonName || "Addon")}" data-addon-logo="${escapeHtml(addonLogoUrl)}" decoding="${addonLogoDecoding}" loading="${addonLogoLoading}" referrerpolicy="no-referrer" /><span hidden>${addonBadgeLabel}</span>`
      : `<span>${addonBadgeLabel}</span>`;

    return `
      <div class="stream-route-card-row" data-stream-row="${index}">
        <article class="stream-route-card stream-route-card-action focusable${this.isCardActionFocused(index, "play") ? " focused" : ""}"
                 data-action="playStream"
                 data-card-action="play"
                 data-stream-id="${escapeHtml(stream.id)}"
                 data-stream-row="${index}">
          <div class="stream-route-card-copy">
            <div class="stream-route-card-heading">${escapeHtml(headline)}</div>
            ${topBadges || ""}
            ${!badges ? `<div class="stream-route-card-quality">${escapeHtml(quality)}</div>` : ""}
            ${descriptionLines.map((line, lineIndex) => `<div class="stream-route-card-line${lineIndex > 0 ? " secondary" : ""}">${escapeHtml(line)}</div>`).join("")}
            ${bottomBadges || ""}
          </div>
          <div class="stream-route-card-side">
            <div class="stream-route-addon-badge">${addonBadge}</div>
            <div class="stream-route-addon-name">${escapeHtml(stream.addonName || "Addon")}</div>
          </div>
        </article>
      </div>
    `;
  },

  renderLoadingCards(count = 3) {
    const safeCount = Math.max(1, Number(count || 0));
    return Array.from({ length: safeCount })
      .map(
        () => `
      <div class="stream-route-card skeleton">
        <div class="stream-route-skeleton-line wide"></div>
        <div class="stream-route-skeleton-line short"></div>
        <div class="stream-route-skeleton-line"></div>
        <div class="stream-route-skeleton-line"></div>
      </div>
    `
      )
      .join("");
  },

  render() {
    this.cancelScheduledRender();
    const { isSeries, title, subtitle, episodeLabel, detailLine } = this.getHeaderMeta();
    const backdrop = this.getBackdropUrl();
    const logo = this.params?.logo || "";
    const shellStableClass = this.hasRenderedStreamRouteShell ? " stable" : "";
    const orderedFilters = this.getOrderedFilterNames();
    const chips = [
      this.renderChip("all", this.addonFilter === "all", "success"),
      ...orderedFilters.map((name) => {
        const chip = this.sourceChips.find((entry) => entry.name === name) || {
          name,
          status: "success"
        };
        return this.renderChip(name, this.addonFilter === name, chip.status);
      })
    ].join("");
    const filtered = this.getFilteredStreams();
    const hasPendingForFilter = this.hasPendingSourceLoads();
    const hasAnyStreams = this.streams.length > 0;
    const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const addonLogosReady = !filtered.length || this.areAddonLogosReady(filtered);

    let body = "";
    if (filtered.length && addonLogosReady) {
      body = filtered
        .map((stream, index) =>
          this.renderStreamCard(stream, index, streamBadgesEnabled, badgeSettings)
        )
        .join("");
      if (hasPendingForFilter) {
        body += this.renderLoadingCards(1);
      }
    } else if (filtered.length) {
      this.requestAddonLogoPrerender(filtered);
      body = this.renderLoadingCards(Math.min(3, filtered.length));
    } else if ((this.loading && !hasAnyStreams) || hasPendingForFilter) {
      body = this.renderLoadingCards();
    } else if (this.error) {
      body = `<div class="stream-route-empty">${escapeHtml(this.error)}</div>`;
    } else if (!filtered.length) {
      body = `<div class="stream-route-empty">No sources found for this filter.</div>`;
    }

    this.container.innerHTML = `
      <div class="stream-route-shell${shellStableClass}">
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
              ${detailLine ? `<div class="stream-route-detail-line">${escapeHtml(detailLine)}</div>` : !isSeries && subtitle ? `<div class="stream-route-detail-line">${escapeHtml(subtitle)}</div>` : ""}
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
        ${this.renderAutoPlayOverlay()}
      </div>
    `;

    this.bindAddonLogoFallbacks();
    ScreenUtils.indexFocusables(this.container);
    this.restoreScrollPosition();
    this.applyFocus();
    this.bindListScrollState();
    this.hasRenderedStreamRouteShell = true;
  },

  bindListScrollState() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    list.addEventListener(
      "scroll",
      () => {
        this.listScrollTop = Number(list.scrollTop || 0);
      },
      { passive: true }
    );
  },

  bindAddonLogoFallbacks() {
    this.container
      ?.querySelectorAll(".stream-route-addon-badge img[data-addon-logo]")
      .forEach((node) => {
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
      });
  },

  async playStream(streamId) {
    this.cancelAutoPlayCountdown();
    const filtered = this.getFilteredStreams();
    const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
    if (!selected) {
      return;
    }
    const playerStreamCandidates = this.getFilteredStreams();
    const itemType = normalizeType(this.params?.itemType);
    const startFromBeginning = Boolean(this.params?.startFromBeginning);
    let resumePositionMs = startFromBeginning ? 0 : Number(this.params?.resumePositionMs || 0) || 0;
    let resumeProgressPercent = startFromBeginning ? null : this.params?.resumeProgressPercent;
    let resumeDurationMs = startFromBeginning ? 0 : Number(this.params?.resumeDurationMs || 0) || 0;
    if (!startFromBeginning && resumePositionMs <= 0 && !(Number(resumeProgressPercent) > 0)) {
      const resumeProgress = await watchProgressRepository
        .getResumeByContentId(this.params?.itemId, {
          videoId: this.params?.videoId || null,
          season: this.params?.season,
          episode: this.params?.episode
        })
        .catch((error) => {
          console.warn("Stream resume lookup failed", error);
          return null;
        });
      resumePositionMs = Number(resumeProgress?.positionMs || 0) || 0;
      resumeProgressPercent = resumeProgress?.progressPercent ?? resumeProgressPercent;
      resumeDurationMs = Number(resumeProgress?.durationMs || 0) || resumeDurationMs;
    }

    Router.navigate("player", {
      streamUrl: selected.url || selected.externalUrl || null,
      itemId: this.params?.itemId || null,
      itemType: itemType || "movie",
      imdbId: this.params?.imdbId || null,
      videoId: this.params?.videoId || null,
      resumePositionMs,
      resumeProgressPercent,
      resumeDurationMs,
      startFromBeginning,
      episodeLabel:
        this.params?.season && this.params?.episode
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
      streamCandidates: playerStreamCandidates,
      preferredStreamId: selected.id,
      playbackSourceContext: selected.streamOrigin || {
        addonId: selected.addonId || "",
        addonBaseUrl: selected.addonBaseUrl || "",
        addonName: selected.addonName || "",
        addonOrderIndex: Number.isFinite(Number(selected.addonOrderIndex))
          ? Number(selected.addonOrderIndex)
          : null,
        sourceProviderId: selected.sourceProviderId || "",
        sourceIds: Array.isArray(selected.sources) ? selected.sources : [],
        selectedStreamId: selected.id || ""
      },
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
    const { chips } = this.getFocusLists();
    const chipTarget = target.closest?.(".stream-route-chip.focusable") || target;
    const chipIndex = chips.indexOf(chipTarget);
    if (chipIndex >= 0) {
      this.focusState = { zone: "filter", index: chipIndex };
      this.focusList(chips, chipIndex);
      return true;
    }
    const cardAction = target.closest?.("[data-stream-row][data-card-action]");
    if (cardAction) {
      this.focusState = {
        zone: "card",
        row: Math.max(0, Number(cardAction.dataset.streamRow || 0)),
        action: String(cardAction.dataset.cardAction || "play")
      };
      this.focusElement(cardAction);
      return true;
    }
    return false;
  },

  onPointerActivate(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const actionTarget = target.closest?.("[data-action]") || target;
    this.onPointerFocus(actionTarget);
    const action = String(actionTarget.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(actionTarget.dataset.addon || "all");
      const { chips } = this.getFocusLists();
      this.setAddonFilter(addon, "filter", Math.max(0, chips.indexOf(actionTarget)));
      return true;
    }
    if (action === "playStream") {
      this.playStream(actionTarget.dataset.streamId);
      return true;
    }
    if (action === "openNativePlayer") {
      void this.openStreamInNativePlayer(actionTarget.dataset.streamId);
      return true;
    }
    return false;
  },

  onKeyDown(event) {
    // Any key during the auto-play countdown hands control back to the user.
    // Back just cancels and stays on the picker; other keys cancel and then do
    // their normal thing (OK on the highlighted stream plays it right away).
    if (this.autoPlayCountdown) {
      this.cancelAutoPlayCountdown();
      if (isBackEvent(event)) {
        event?.preventDefault?.();
        return;
      }
    }

    if (isBackEvent(event)) {
      event?.preventDefault?.();
      if (!this.navigateBackFromStream()) {
        Router.back();
      }
      return;
    }

    const direction = getDpadDirection(event);
    if (direction) {
      const { chips, rows } = this.getFocusLists();
      const zone = this.focusState?.zone || (rows.length ? "card" : "filter");
      let index = Number(this.focusState?.index || 0);
      event?.preventDefault?.();

      if (zone === "filter") {
        if (direction === "left") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition - 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index - 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "right") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition + 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index + 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "down" && rows.length) {
          this.focusState = { zone: "card", row: clamp(index, 0, rows.length - 1), action: "play" };
          this.applyFocus();
        }
        return;
      }

      if (zone === "card") {
        const rowIndex = clamp(Number(this.focusState?.row || 0), 0, Math.max(0, rows.length - 1));
        const currentRow = rows[rowIndex] || null;
        const currentAction = String(this.focusState?.action || "play");
        if (direction === "up") {
          if (rowIndex > 0) {
            const previousRow = rows[rowIndex - 1] || null;
            const target = this.resolveCardActionForRow(previousRow, currentAction);
            this.focusState = {
              zone: "card",
              row: rowIndex - 1,
              action: String(target?.dataset?.cardAction || "play")
            };
            this.applyFocus();
            return;
          }
          this.focusState = {
            zone: "filter",
            index: clamp(
              ["all", ...this.getOrderedFilterNames()].indexOf(this.addonFilter),
              0,
              Math.max(0, chips.length - 1)
            )
          };
          this.applyFocus();
          return;
        }
        if (direction === "down") {
          const nextRowIndex = clamp(rowIndex + 1, 0, Math.max(0, rows.length - 1));
          const nextRow = rows[nextRowIndex] || null;
          const target = this.resolveCardActionForRow(nextRow, currentAction);
          this.focusState = {
            zone: "card",
            row: nextRowIndex,
            action: String(target?.dataset?.cardAction || "play")
          };
          this.applyFocus();
          return;
        }
        if (direction === "left") {
          if (currentAction === "native" && currentRow?.play) {
            this.focusState = { zone: "card", row: rowIndex, action: "play" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex - 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
          return;
        }
        if (direction === "right") {
          if (currentAction === "play" && currentRow?.native) {
            this.focusState = { zone: "card", row: rowIndex, action: "native" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex + 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
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
      this.setAddonFilter(
        addon,
        "filter",
        Array.from(this.container.querySelectorAll(".stream-route-chip.focusable")).indexOf(current)
      );
      return;
    }
    if (action === "playStream") {
      this.playStream(current.dataset.streamId);
      return;
    }
    if (action === "openNativePlayer") {
      void this.openStreamInNativePlayer(current.dataset.streamId);
    }
  },

  cleanup() {
    this.cancelAutoPlayCountdown();
    this.loadToken = (this.loadToken || 0) + 1;
    this.playResolveToken = Number(this.playResolveToken || 0) + 1;
    this.nativePlayerRequestToken = Number(this.nativePlayerRequestToken || 0) + 1;
    this.cancelScheduledRender();
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
      this.streamToastTimer = null;
    }
    if (this.releaseImageProxyReadyListener) {
      this.releaseImageProxyReadyListener();
      this.releaseImageProxyReadyListener = null;
    }
    ScreenUtils.hide(this.container);
  }
};
