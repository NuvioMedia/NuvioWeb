import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { ContinueWatchingPreferences } from "../../../data/local/continueWatchingPreferences.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { Platform } from "../../../platform/index.js";
import { YOUTUBE_PROXY_URL } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
import { renderLogoLoadingMarkup } from "../../components/loadingIndicator.js";
import {
  buildModernNavigationRows,
  buildModernRowKey,
  MODERN_HOME_CONSTANTS,
  renderModernHomeLayout
} from "./modernHomeLayout.js";
import {
  buildCatalogDisableKey,
  buildCatalogOrderKey,
  isSearchOnlyCatalog
} from "../../../core/addons/homeCatalogs.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getLegacySidebarSelectedNode,
  getModernSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  isSelectedSidebarAction,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import { renderHoldMenuMarkup } from "../../components/holdMenu.js";

const HERO_ROTATE_FIRST_DELAY_MS = 20000;
const HERO_ROTATE_INTERVAL_MS = 10000;
const HOME_LAYOUT_SEQUENCE = ["modern", "grid", "classic"];
const DEFAULT_PROFILE_COLOR = "#1E88E5";
const CW_MAX_NEXT_UP_LOOKUPS = 24;
const CW_MAX_VISIBLE_ITEMS = 10;
const CW_DAYS_CAP = 60;
const CW_PROGRESS_START_THRESHOLD = 0.02;
const CW_PROGRESS_END_THRESHOLD = 0.85;
const CW_ENTER_DELAY_MS = 320;
const CW_HOLD_DELAY_MS = 650;
const HOME_INITIAL_CATALOG_LOAD = 10;
const HOME_ITEMS_BEFORE_SEE_ALL = 10;
const HOME_LOADING_ROW_ITEMS_DEFAULT = 10;
const HOME_LOADING_ROW_ITEMS_CONSTRAINED = 4;
const HOME_VISIBLE_ROWS_CONSTRAINED_INITIAL = 5;
const HOME_VISIBLE_ROWS_CONSTRAINED_INCREMENT = 3;
const HOME_ROW_TIMEOUT_MS = 3500;
const HOME_ROW_RETRY_TIMEOUT_MS = 12000;
const HOME_BOOT_PRELOAD_BUDGET_MS = 10000;
const HOME_BOOT_IMAGE_PRELOAD_MIN_MS = 800;
const HOME_BOOT_IMAGE_PRELOAD_MAX_MS = 2200;
const HOME_BACKGROUND_RENDER_DELAY_MS = 120;
const HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS = 180;
const YOUTUBE_TRAILER_REVEAL_DELAY_MS = 1400;
const CW_META_TIMEOUT_MS = 1800;
const CW_META_TIMEOUT_TV_MS = 4200;
const CW_NEXT_UP_META_TIMEOUT_MS = 2200;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatCatalogRowTitle(catalogName, type, showTypeSuffix = true) {
  const rawBase = String(catalogName || "").trim();
  const base = rawBase ? rawBase.charAt(0).toUpperCase() + rawBase.slice(1) : "";
  const typeLabel = toTitleCase(type || "movie") || "Movie";
  if (!base) {
    return typeLabel;
  }
  if (!showTypeSuffix) {
    return base;
  }
  return new RegExp(`\\b${typeLabel}$`, "i").test(base) ? base : `${base} - ${typeLabel}`;
}

function prettyId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Untitled";
  }
  if (raw.includes(":")) {
    return raw.split(":").pop() || raw;
  }
  return raw;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function limitTextToWordCount(value, maxWords = 0) {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(maxWords) || maxWords <= 0) {
    return { text, truncated: false };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { text, truncated: false };
  }
  return {
    text: words.slice(0, maxWords).join(" "),
    truncated: true
  };
}

function parseCssPx(value, fallback = 0) {
  const parsed = parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createCubicBezierEasing(x1, y1, x2, y2) {
  const newtonIterations = 4;
  const newtonMinSlope = 0.001;
  const subdivisionPrecision = 0.0000001;
  const subdivisionMaxIterations = 10;
  const splineTableSize = 11;
  const sampleStepSize = 1 / (splineTableSize - 1);

  const calcBezier = (t, a1, a2) => (((1 - (3 * a2) + (3 * a1)) * t + ((3 * a2) - (6 * a1))) * t + (3 * a1)) * t;
  const getSlope = (t, a1, a2) => (3 * (1 - (3 * a2) + (3 * a1)) * t * t) + (2 * ((3 * a2) - (6 * a1)) * t) + (3 * a1);
  const sampleValues = new Float32Array(splineTableSize);

  for (let index = 0; index < splineTableSize; index += 1) {
    sampleValues[index] = calcBezier(index * sampleStepSize, x1, x2);
  }

  const binarySubdivide = (x, lower, upper) => {
    let current = 0;
    let currentX = 0;
    let iteration = 0;
    do {
      current = lower + ((upper - lower) / 2);
      currentX = calcBezier(current, x1, x2) - x;
      if (currentX > 0) {
        upper = current;
      } else {
        lower = current;
      }
      iteration += 1;
    } while (Math.abs(currentX) > subdivisionPrecision && iteration < subdivisionMaxIterations);
    return current;
  };

  const newtonRaphsonIterate = (x, guess) => {
    let currentGuess = guess;
    for (let index = 0; index < newtonIterations; index += 1) {
      const currentSlope = getSlope(currentGuess, x1, x2);
      if (currentSlope === 0) {
        return currentGuess;
      }
      const currentX = calcBezier(currentGuess, x1, x2) - x;
      currentGuess -= currentX / currentSlope;
    }
    return currentGuess;
  };

  const getTForX = (x) => {
    let intervalStart = 0;
    let currentSample = 1;
    const lastSample = splineTableSize - 1;

    while (currentSample !== lastSample && sampleValues[currentSample] <= x) {
      intervalStart += sampleStepSize;
      currentSample += 1;
    }
    currentSample -= 1;

    const denominator = sampleValues[currentSample + 1] - sampleValues[currentSample];
    const dist = denominator === 0 ? 0 : (x - sampleValues[currentSample]) / denominator;
    const guess = intervalStart + (dist * sampleStepSize);
    const initialSlope = getSlope(guess, x1, x2);

    if (initialSlope >= newtonMinSlope) {
      return newtonRaphsonIterate(x, guess);
    }
    if (initialSlope === 0) {
      return guess;
    }
    return binarySubdivide(x, intervalStart, intervalStart + sampleStepSize);
  };

  return (x) => {
    if (x <= 0) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    return calcBezier(getTForX(x), y1, y2);
  };
}

const MODERN_CAMERA_PAN_EASING = createCubicBezierEasing(0.43, 0.70, 0.45, 1.00);

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id || item?.contentId || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(colorHex, fallback = { r: 30, g: 136, b: 229 }) {
  const value = String(colorHex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return fallback;
  }
  const normalized = match[1];
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function mixColors(baseColor, accentColor, weight) {
  const normalizedWeight = Math.min(1, Math.max(0, Number(weight) || 0));
  return {
    r: clampChannel((baseColor.r * (1 - normalizedWeight)) + (accentColor.r * normalizedWeight)),
    g: clampChannel((baseColor.g * (1 - normalizedWeight)) + (accentColor.g * normalizedWeight)),
    b: clampChannel((baseColor.b * (1 - normalizedWeight)) + (accentColor.b * normalizedWeight))
  };
}

function colorToRgba(color, alpha = 1) {
  const normalizedAlpha = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${normalizedAlpha})`;
}

function buildProfileBackgroundStyle(colorHex) {
  const rootStyles = getComputedStyle(document.documentElement);
  const background = parseHexColor(rootStyles.getPropertyValue("--bg-color"), { r: 13, g: 13, b: 13 });
  const elevated = parseHexColor(rootStyles.getPropertyValue("--bg-elevated"), { r: 26, g: 26, b: 26 });
  const accent = parseHexColor(colorHex, parseHexColor(DEFAULT_PROFILE_COLOR));
  const gradientTop = mixColors(elevated, accent, 0.3);
  const gradientMid = mixColors(background, accent, 0.14);
  return `
    linear-gradient(180deg, ${colorToRgba(gradientTop, 1)} 0%, ${colorToRgba(gradientMid, 1)} 42%, ${colorToRgba(background, 1)} 100%),
    linear-gradient(90deg, ${colorToRgba(accent, 0.26)} 0%, ${colorToRgba(accent, 0.08)} 45%, rgba(0, 0, 0, 0) 72%, rgba(0, 0, 0, 0) 100%)
  `;
}

function resolveImdbRating(item) {
  const direct = item?.imdbRating
    ?? item?.episodeImdbRating
    ?? item?.imdb_rating
    ?? item?.rating
    ?? null;
  if (direct == null || direct === "") {
    return null;
  }
  const value = Number(direct);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value.toFixed(1);
}

function extractYear(item) {
  const candidates = [
    item?.releaseInfo,
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.year
  ];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }
  return "";
}

function formatRuntimeText(item) {
  const value = Number(
    item?.runtimeMinutes
    ?? item?.runtime
    ?? item?.durationMinutes
    ?? item?.duration_minutes
    ?? 0
  );
  return formatDurationMinutes(value);
}

function formatDurationMinutes(totalMinutes) {
  const minutesValue = Number(totalMinutes || 0);
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
    return "";
  }
  const roundedMinutes = Math.max(0, Math.round(minutesValue));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatEpisodeCode(season, episode) {
  if (Number.isFinite(season) && Number.isFinite(episode)) {
    return `S${season}E${episode}`;
  }
  if (Number.isFinite(episode)) {
    return `E${episode}`;
  }
  return "";
}

function resolveYoutubeId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const directMatch = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function buildYoutubeEmbedUrl(videoId, { muted = true, autoplay = true } = {}) {
  const cleanId = resolveYoutubeId(videoId);
  if (!cleanId) {
    return "";
  }
  const proxyBase = String(YOUTUBE_PROXY_URL || "").trim();
  if (!proxyBase) {
    return "";
  }
  try {
    const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
    proxyUrl.searchParams.set("v", cleanId);
    proxyUrl.searchParams.set("autoplay", autoplay ? "1" : "0");
    proxyUrl.searchParams.set("muted", muted ? "1" : "0");
    proxyUrl.searchParams.set("controls", "0");
    proxyUrl.searchParams.set("disablekb", "1");
    proxyUrl.searchParams.set("fs", "0");
    proxyUrl.searchParams.set("iv_load_policy", "3");
    proxyUrl.searchParams.set("loop", "1");
    proxyUrl.searchParams.set("modestbranding", "1");
    proxyUrl.searchParams.set("playlist", cleanId);
    proxyUrl.searchParams.set("playsinline", "1");
    proxyUrl.searchParams.set("rel", "0");
    proxyUrl.searchParams.set("_cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return proxyUrl.toString();
  } catch (_) {
    return "";
  }
}

function resolveTrailerSource(meta = {}) {
  const trailerCandidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.videos) ? meta.videos : [])
  ];
  for (const entry of trailerCandidates) {
    const ytId = resolveYoutubeId(
      entry?.ytId
      || entry?.youtubeId
      || entry?.source
      || entry?.url
      || entry?.link
      || ""
    );
    if (ytId) {
      const embedUrl = buildYoutubeEmbedUrl(ytId);
      if (!embedUrl) {
        continue;
      }
      return {
        kind: "youtube",
        ytId,
        embedUrl
      };
    }
  }
  const fallbackId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!fallbackId) {
    return null;
  }
  const fallbackEmbedUrl = buildYoutubeEmbedUrl(fallbackId);
  if (!fallbackEmbedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId: fallbackId,
    embedUrl: fallbackEmbedUrl
  };
}

function applyTrailerAudioPreferences(source, prefs = {}) {
  if (!source) {
    return null;
  }
  const muted = Boolean(prefs.focusedPosterBackdropTrailerMuted);
  if (source.kind === "youtube") {
    const embedUrl = buildYoutubeEmbedUrl(source.ytId, { muted, autoplay: false });
    if (!embedUrl) {
      return null;
    }
    return {
      ...source,
      embedUrl,
      muted
    };
  }
  if (source.kind === "video") {
    return {
      ...source,
      muted
    };
  }
  return source;
}

function suppressBackgroundTrailerMediaControls(mediaElement = null) {
  if (mediaElement) {
    mediaElement.controls = false;
    mediaElement.removeAttribute("controls");
    mediaElement.setAttribute("controlslist", "nodownload nofullscreen noplaybackrate noremoteplayback");
    mediaElement.setAttribute("aria-hidden", "true");
    mediaElement.setAttribute("tabindex", "-1");
    try {
      mediaElement.disablePictureInPicture = true;
    } catch (_) {
    }
    try {
      mediaElement.disableRemotePlayback = true;
    } catch (_) {
    }
  }

  const mediaSession = globalThis.navigator?.mediaSession;
  if (!mediaSession) {
    return;
  }
  [
    "play",
    "pause",
    "stop",
    "seekbackward",
    "seekforward",
    "seekto",
    "previoustrack",
    "nexttrack"
  ].forEach((action) => {
    try {
      mediaSession.setActionHandler(action, null);
    } catch (_) {
    }
  });
  try {
    mediaSession.playbackState = "none";
  } catch (_) {
  }
}

function postBackgroundTrailerCommand(frame, command, payload = {}) {
  if (!frame?.contentWindow) {
    return;
  }
  try {
    frame.contentWindow.postMessage({
      source: "nuvio-detail-trailer",
      type: "command",
      command,
      payload
    }, "*");
  } catch (_) {
  }
}

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function remainingBudgetMs(deadlineMs = 0) {
  const deadline = Number(deadlineMs || 0);
  if (!Number.isFinite(deadline) || deadline <= 0) {
    return 0;
  }
  return Math.max(0, deadline - Date.now());
}

function mergeRowsByKey(rows = []) {
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row?.homeCatalogKey || buildCatalogOrderKey(row?.addonId, row?.type, row?.catalogId);
    if (!key) {
      return;
    }
    byKey.set(key, row);
  });
  return Array.from(byKey.values());
}

function preloadImageUrl(url) {
  const src = String(url || "").trim();
  if (!src || typeof Image !== "function") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
    if (typeof image.decode === "function") {
      image.decode().then(() => resolve(true)).catch(() => {
        if (image.complete) {
          resolve(true);
        }
      });
    }
  });
}

async function resolveTrailerMetaWithTmdbFallback(meta = {}, itemType = "movie") {
  const fallbackSource = resolveTrailerSource(meta);
  if (fallbackSource) {
    return fallbackSource;
  }
  const settings = TmdbSettingsStore.get();
  if (!settings.enabled || !settings.apiKey) {
    return fallbackSource;
  }
  try {
    const tmdbId = await withTimeout(TmdbService.ensureTmdbId(meta?.id, itemType), 1800, null);
    if (!tmdbId) {
      return null;
    }
    const enrichment = await withTimeout(TmdbMetadataService.fetchEnrichment({
      tmdbId,
      contentType: itemType,
      language: settings.language
    }), 2200, null);
    if (!enrichment) {
      return fallbackSource;
    }
    const mergedMeta = {
      ...meta,
      trailers: Array.isArray(meta?.trailers) && meta.trailers.length
        ? meta.trailers
        : (Array.isArray(enrichment?.trailers) ? enrichment.trailers : []),
      trailerYtIds: Array.isArray(meta?.trailerYtIds) && meta.trailerYtIds.length
        ? meta.trailerYtIds
        : (Array.isArray(enrichment?.trailerYtIds) ? enrichment.trailerYtIds : [])
    };
    const enrichedFallbackSource = resolveTrailerSource(mergedMeta);
    return enrichedFallbackSource || fallbackSource;
  } catch (_) {
    return fallbackSource;
  }
}

function getContinueWatchingMetaTimeout(timeoutMs) {
  const requestedTimeout = Math.max(500, Number(timeoutMs || 0) || CW_META_TIMEOUT_MS);
  if (Platform.isWebOS() || Platform.isTizen()) {
    return Math.max(requestedTimeout, CW_META_TIMEOUT_TV_MS);
  }
  return requestedTimeout;
}

function progressFractionForContinueWatching(item = {}) {
  const explicitPercent = Number(item.progressPercent);
  if (Number.isFinite(explicitPercent) && explicitPercent > 0) {
    return Math.max(0, Math.min(1, explicitPercent / 100));
  }
  const durationMs = Number(item.durationMs || 0);
  const positionMs = Number(item.positionMs || 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(positionMs) || positionMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, positionMs / durationMs));
}

function isSeriesTypeForContinueWatching(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

function isMalformedNextUpSeedContentId(contentId) {
  const normalized = String(contentId || "").trim().toLowerCase();
  return !normalized || normalized === "tmdb" || normalized === "imdb" || normalized === "trakt"
    || normalized === "tmdb:" || normalized === "imdb:" || normalized === "trakt:";
}

function normalizeNextUpDismissPart(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : -1;
}

function nextUpDismissKey(contentId, season, episode) {
  return `${String(contentId || "").trim()}|${normalizeNextUpDismissPart(season)}|${normalizeNextUpDismissPart(episode)}`;
}

function isCompletedForContinueWatching(item = {}) {
  return progressFractionForContinueWatching(item) >= CW_PROGRESS_END_THRESHOLD;
}

function isInProgressForContinueWatching(item = {}) {
  const fraction = progressFractionForContinueWatching(item);
  return fraction >= CW_PROGRESS_START_THRESHOLD && fraction < CW_PROGRESS_END_THRESHOLD;
}

function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isInProgressForContinueWatching(item)) {
    return true;
  }
  if (isCompletedForContinueWatching(item)) {
    return false;
  }
  const hasStartedPlayback = Number(item.positionMs || 0) > 0 || Number(item.progressPercent || 0) > 0;
  const source = String(item.source || "").toLowerCase();
  return hasStartedPlayback && source !== "trakt_history" && source !== "trakt_show_progress";
}

function episodeKey(season, episode) {
  return `${Number(season || 0)}:${Number(episode || 0)}`;
}

function normalizeEpisodeEntries(videos = []) {
  return (Array.isArray(videos) ? videos : [])
    .map((video) => ({
      id: String(video?.id || "").trim(),
      season: Number(video?.season || 0),
      episode: Number(video?.episode || 0),
      title: String(video?.title || video?.name || "").trim(),
      thumbnail: firstNonEmpty(video?.thumbnail),
      overview: firstNonEmpty(video?.overview, video?.description),
      released: firstNonEmpty(video?.released, video?.releaseInfo)
    }))
    .filter((entry) => entry.season > 0 && entry.episode > 0)
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

function hasEpisodeAiredForContinueWatching(released) {
  const raw = String(released || "").trim();
  if (!raw) {
    return true;
  }
  const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || raw;
  const parsedTime = Date.parse(datePortion);
  if (!Number.isFinite(parsedTime)) {
    return true;
  }
  return parsedTime <= Date.now();
}

function buildProgressStatus(item) {
  if (item?.isNextUp) {
    return t("home.continueStatusNextUp", {}, "Next episode");
  }
  const durationMs = Number(item?.durationMs || 0);
  const positionMs = Number(item?.positionMs || 0);
  if (!durationMs || !positionMs) {
    return t("home.continueStatusContinue", {}, "Continue");
  }
  const remainingMinutes = Math.max(0, Math.round((durationMs - positionMs) / 60000));
  const progress = Math.max(0, Math.min(1, positionMs / durationMs));
  if (progress >= 0.85 || remainingMinutes <= 10) {
    return t("home.continueStatusAlmostDone", {}, "Almost done");
  }
  if (remainingMinutes > 0) {
    const remainingLabel = formatDurationMinutes(remainingMinutes);
    return t("home.timeLeftDuration", { time: remainingLabel }, "{{time}} left");
  }
  return t("home.continueStatusContinue", {}, "Continue");
}

function buildProgressFraction(item) {
  if (item?.isNextUp) {
    return 0;
  }
  return progressFractionForContinueWatching(item);
}

function buildCatalogLoadingItems(rowKey, count = HOME_LOADING_ROW_ITEMS_DEFAULT) {
  const safeCount = Math.max(1, Math.min(HOME_ITEMS_BEFORE_SEE_ALL, Number(count || HOME_LOADING_ROW_ITEMS_DEFAULT)));
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `${rowKey || "row"}__loading_${index}`,
    name: t("common.loading", {}, "Loading"),
    isLoading: true
  }));
}

function normalizeCatalogItem(item, fallbackType = "movie") {
  if (!item) {
    return null;
  }
  return {
    ...item,
    id: String(item.id || "").trim(),
    type: String(item.type || item.apiType || fallbackType || "movie").trim() || "movie",
    apiType: String(item.apiType || item.type || fallbackType || "movie").trim() || "movie",
    name: firstNonEmpty(item.name, item.title, prettyId(item.id)),
    landscapePoster: firstNonEmpty(item.landscapePoster, item.backdrop, item.backdropUrl, item.background),
    poster: firstNonEmpty(item.poster, item.backdrop, item.backdropUrl, item.thumbnail),
    background: firstNonEmpty(item.background, item.backdrop, item.backdropUrl, item.poster, item.thumbnail),
    logo: firstNonEmpty(item.logo),
    description: firstNonEmpty(item.description, item.overview, item.plot),
    releaseInfo: firstNonEmpty(item.releaseInfo, item.released),
    genres: Array.isArray(item.genres) ? item.genres.filter(Boolean) : [],
    runtimeMinutes: Number(item.runtimeMinutes ?? item.runtime ?? 0) || 0,
    imdbRating: resolveImdbRating(item),
    ageRating: firstNonEmpty(item.ageRating, item.age_rating),
    status: firstNonEmpty(item.status),
    language: firstNonEmpty(item.language),
    country: firstNonEmpty(item.country)
  };
}

function normalizeContinueWatchingItem(item) {
  if (!item) {
    return null;
  }
  const title = firstNonEmpty(item.title, item.name, prettyId(item.contentId));
  const type = String(item.contentType || item.type || "movie").trim() || "movie";
  const isSeries = isSeriesTypeForContinueWatching(type);
  return {
    ...item,
    heroSource: "continueWatching",
    id: String(item.contentId || item.id || "").trim(),
    contentId: String(item.contentId || item.id || "").trim(),
    videoId: item.videoId || null,
    season: Number.isFinite(Number(item.season)) ? Number(item.season) : null,
    episode: Number.isFinite(Number(item.episode)) ? Number(item.episode) : null,
    positionMs: Number(item.positionMs || 0) || 0,
    durationMs: Number(item.durationMs || 0) || 0,
    type,
    apiType: type,
    name: title,
    title,
    landscapePoster: firstNonEmpty(item.landscapePoster, item.thumbnail, item.backdrop, item.background, item.poster),
    thumbnail: firstNonEmpty(item.thumbnail, item.episodeThumbnail, item.poster, item.backdrop, item.background),
    backdrop: firstNonEmpty(item.backdrop, item.background, item.thumbnail, item.poster, item.episodeThumbnail),
    episodeThumbnail: firstNonEmpty(item.episodeThumbnail, item.thumbnail, item.backdrop, item.background, item.poster),
    poster: isSeries
      ? firstNonEmpty(item.poster, item.episodeThumbnail, item.thumbnail, item.backdrop, item.background)
      : firstNonEmpty(item.poster, item.backdrop, item.background, item.thumbnail, item.episodeThumbnail),
    background: isSeries
      ? firstNonEmpty(item.background, item.backdrop, item.poster, item.episodeThumbnail, item.thumbnail)
      : firstNonEmpty(item.background, item.backdrop, item.poster, item.thumbnail, item.episodeThumbnail),
    logo: firstNonEmpty(item.logo),
    description: firstNonEmpty(item.description),
    releaseInfo: firstNonEmpty(item.releaseInfo),
    seedSeason: Number.isFinite(Number(item.seedSeason)) ? Number(item.seedSeason) : null,
    seedEpisode: Number.isFinite(Number(item.seedEpisode)) ? Number(item.seedEpisode) : null,
    genres: Array.isArray(item.genres) ? item.genres.filter(Boolean) : [],
    runtimeMinutes: Number(item.runtimeMinutes ?? item.runtime ?? 0) || 0,
    imdbRating: resolveImdbRating(item),
    ageRating: firstNonEmpty(item.ageRating, item.age_rating),
    status: firstNonEmpty(item.status),
    language: firstNonEmpty(item.language),
    country: firstNonEmpty(item.country),
    progressStatus: buildProgressStatus(item),
    progressFraction: buildProgressFraction(item),
    episodeCode: formatEpisodeCode(item.season, item.episode),
    episodeTitle: firstNonEmpty(item.episodeTitle, item.subtitle)
  };
}

function isRawContinueWatchingTitle(item) {
  const contentId = String(item?.contentId || item?.id || "").trim();
  const title = firstNonEmpty(item?.title, item?.name);
  return Boolean(title) && Boolean(contentId) && title === prettyId(contentId);
}

function hasContinueWatchingArtwork(item) {
  return Boolean(firstNonEmpty(
    item?.poster,
    item?.background,
    item?.backdrop,
    item?.backdropUrl,
    item?.thumbnail,
    item?.episodeThumbnail,
    item?.logo
  ));
}

function isPresentableContinueWatchingItem(item, { requireArtwork = false } = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized) {
    return false;
  }
  const hasMeaningfulTitle = Boolean(firstNonEmpty(normalized.title, normalized.name)) && !isRawContinueWatchingTitle(normalized);
  const hasArtwork = hasContinueWatchingArtwork(normalized);
  return requireArtwork ? (hasMeaningfulTitle && hasArtwork) : (hasMeaningfulTitle || hasArtwork);
}

function buildVisibleContinueWatchingItems(items = [], options = {}) {
  return (items || [])
    .map((item) => normalizeContinueWatchingItem(item))
    .filter((item) => isPresentableContinueWatchingItem(item, options));
}

function buildContinueWatchingSignature(items = []) {
  return (items || [])
    .map((item) => {
      const normalized = normalizeContinueWatchingItem(item);
      if (!normalized) {
        return "";
      }
      const position = Math.round(Number(normalized.positionMs || 0) / 1000);
      const duration = Math.round(Number(normalized.durationMs || 0) / 1000);
      return [
        normalized.contentId,
        normalized.videoId || "",
        normalized.season ?? "",
        normalized.episode ?? "",
        position,
        duration,
        normalized.progressStatus || "",
        normalized.progressFraction ?? ""
      ].join("|");
    })
    .join("::");
}

function buildSidebarProfileSignature(profile = null) {
  if (!profile || typeof profile !== "object") {
    return "";
  }
  return [
    profile.id || "",
    profile.name || "",
    profile.avatarColorHex || "",
    profile.avatarId || "",
    profile.imageUrl || ""
  ].join("|");
}

function buildHeroIdentity(item = null) {
  const normalized = normalizeCatalogItem(item || null, "movie");
  if (!normalized) {
    return "";
  }
  return [
    normalized.id || normalized.videoId || normalized.contentId || normalized.title || normalized.name || "",
    normalized.type || normalized.apiType || "",
    normalized.season ?? "",
    normalized.episode ?? ""
  ].join("|");
}

function buildHeroDisplayModel(hero, layoutMode) {
  const year = extractYear(hero);
  const imdb = resolveImdbRating(hero);
  const genres = Array.isArray(hero?.genres) ? hero.genres.filter(Boolean).slice(0, 3) : [];
  const typeLabel = toTitleCase(hero?.type || hero?.apiType || "movie") || "Movie";
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const metaPrimary = [];
  const metaSecondary = [];
  let chips = [];

  if (layoutMode === "modern") {
    if (isContinueWatchingHero) {
      const episodeLabel = [hero?.episodeCode, hero?.episodeTitle].filter(Boolean).join(" · ");
      metaPrimary.push(episodeLabel || typeLabel, genres[0], year);
      metaSecondary.push(String(hero?.progressStatus || "").toUpperCase());
      if (imdb) {
        metaSecondary.push({ imdb });
      }
    } else {
      metaPrimary.push(typeLabel, genres[0], formatRuntimeText(hero), year);
      if (imdb) {
        metaSecondary.push({ imdb });
      }
      chips = [];
    }
  } else {
    if (imdb) {
      metaPrimary.push({ imdb });
    }
    if (year) {
      metaPrimary.push(year);
    }
    chips = genres;
  }

  return {
    title: hero?.name || "Untitled",
    description: firstNonEmpty(hero?.description) || " ",
    logo: firstNonEmpty(hero?.logo),
    backdrop: firstNonEmpty(hero?.background, hero?.backdrop, hero?.backdropUrl, hero?.poster),
    metaPrimary: metaPrimary.filter(Boolean),
    metaSecondary: metaSecondary.filter(Boolean),
    chips
  };
}

function buildModernHeroPresentation(hero) {
  const isContinueWatchingHero = hero?.heroSource === "continueWatching";
  const normalized = isContinueWatchingHero
    ? normalizeContinueWatchingItem(hero)
    : normalizeCatalogItem(hero);
  if (!normalized) {
    return null;
  }

  const isSeries = String(normalized.type || normalized.apiType || "").toLowerCase() === "series";
  const genres = Array.isArray(normalized.genres) ? normalized.genres.filter(Boolean) : [];
  const contentTypeText = toTitleCase(normalized.type || normalized.apiType || "movie");
  const runtimeText = formatRuntimeText(normalized);
  const yearText = extractYear(normalized);
  const imdbText = resolveImdbRating(normalized);
  const statusBadge = firstNonEmpty(normalized.status).toUpperCase();
  const ageRatingBadge = firstNonEmpty(normalized.ageRating);
  const languageText = firstNonEmpty(normalized.language).toUpperCase();
  const secondaryHighlightText = isContinueWatchingHero
    ? firstNonEmpty(normalized.progressStatus).toUpperCase()
    : "";
  const leadingMeta = isContinueWatchingHero
    ? [[normalized.episodeCode, normalized.episodeTitle].filter(Boolean).join(" · ") || contentTypeText].filter(Boolean)
    : [contentTypeText, genres[0]].filter(Boolean);
  const trailingMeta = isContinueWatchingHero
    ? [yearText].filter(Boolean)
    : [runtimeText, yearText].filter(Boolean);
  const badges = isContinueWatchingHero ? [] : [ageRatingBadge, statusBadge].filter(Boolean);
  const showImdbPrimary = Boolean(imdbText) && !isSeries && !badges.length && !secondaryHighlightText;
  const showImdbSecondary = Boolean(imdbText) && !showImdbPrimary;

  return {
    title: normalized.name || "Untitled",
    logo: firstNonEmpty(normalized.logo),
    description: firstNonEmpty(normalized.description) || "",
    backdrop: firstNonEmpty(
      normalized.background,
      normalized.backdrop,
      normalized.backdropUrl,
      normalized.poster,
      normalized.thumbnail,
      normalized.episodeThumbnail
    ),
    leadingMeta,
    trailingMeta,
    secondaryHighlightText,
    badges,
    languageText,
    showImdbPrimary,
    showImdbSecondary,
    imdbText
  };
}

function renderModernHeroMetaGroup(tokens = []) {
  return tokens
    .filter(Boolean)
    .map((token) => `<span>${escapeHtml(token)}</span>`)
    .join('<span class="home-hero-dot">•</span>');
}

function renderModernHeroPrimary(display) {
  const left = renderModernHeroMetaGroup(display.leadingMeta);
  const rightTokens = display.trailingMeta
    .filter(Boolean)
    .map((token) => `<span>${escapeHtml(token)}</span>`);
  if (display.showImdbPrimary) {
    rightTokens.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  const hasRight = rightTokens.length > 0;
  return `
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-leading">${left}</div>
    ${left && hasRight ? '<span class="home-hero-dot">•</span>' : ""}
    <div class="home-modern-hero-meta-group home-modern-hero-meta-group-trailing">${rightTokens.join('<span class="home-hero-dot">•</span>')}</div>
  `;
}

function renderModernHeroSecondary(display) {
  const parts = [];
  if (display.secondaryHighlightText) {
    parts.push(`<span class="home-modern-hero-highlight">${escapeHtml(display.secondaryHighlightText)}</span>`);
  }
  display.badges.forEach((badge) => {
    parts.push(`<span class="home-modern-hero-badge">${escapeHtml(badge)}</span>`);
  });
  if (display.showImdbSecondary) {
    parts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  if (display.languageText) {
    parts.push(`<span class="home-modern-hero-secondary-detail">${escapeHtml(display.languageText)}</span>`);
  }
  return parts.join('<span class="home-hero-dot">•</span>');
}

function renderMetaTokens(tokens = []) {
  return tokens.map((token) => {
    if (token && typeof token === "object" && token.imdb) {
      return `
        <span class="home-hero-imdb">
          <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
          <span>${escapeHtml(token.imdb)}</span>
        </span>
      `;
    }
    return `<span>${escapeHtml(token)}</span>`;
  }).join('<span class="home-hero-dot">•</span>');
}

function buildHeroIndicators(items = [], activeItem) {
  if (!Array.isArray(items) || items.length <= 1) {
    return "";
  }
  const activeId = String(activeItem?.id || "");
  const matchedIndex = items.findIndex((item) => String(item?.id || "") === activeId);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
  return items.map((_, index) => `
    <span class="home-hero-indicator${index === activeIndex ? " is-active" : ""}"></span>
  `).join("");
}

function renderHeroMarkup(layoutMode, heroItem, heroCandidates) {
  const display = buildHeroDisplayModel(heroItem, layoutMode);
  const isInteractive = layoutMode !== "modern";
  return `
    <section class="home-hero home-hero-${escapeAttribute(layoutMode)}">
      <article class="home-hero-card${isInteractive ? " focusable" : ""}"
               ${isInteractive ? `data-action="openDetail"
               data-item-id="${escapeAttribute(heroItem?.id || "")}"
               data-item-type="${escapeAttribute(heroItem?.type || "movie")}"
               data-item-title="${escapeAttribute(heroItem?.name || "Untitled")}"` : ""}>
        <div class="home-hero-backdrop-wrap">
          ${display.backdrop ? `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : '<div class="home-hero-backdrop placeholder"></div>'}
        </div>
        <div class="home-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : ""}
            <h1 class="home-hero-title-text${display.logo ? " is-hidden" : ""}">${escapeHtml(display.title)}</h1>
          </div>
          <div class="home-hero-meta-primary${display.metaPrimary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaPrimary)}</div>
          <div class="home-hero-chip-row${display.chips.length ? "" : " is-empty"}">${display.chips.map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`).join("")}</div>
          <div class="home-hero-meta-secondary${display.metaSecondary.length ? "" : " is-empty"}">${renderMetaTokens(display.metaSecondary)}</div>
          <p class="home-hero-description">${escapeHtml(display.description)}</p>
        </div>
        <div class="home-hero-indicators">${buildHeroIndicators(heroCandidates, heroItem)}</div>
      </article>
    </section>
  `;
}

function buildPosterSubtitle(item, layoutMode) {
  const normalized = normalizeCatalogItem(item);
  if (layoutMode === "modern") {
    return firstNonEmpty(normalized.releaseInfo, "");
  }
  return firstNonEmpty(extractYear(normalized), normalized.releaseInfo, "");
}

function buildExpandedPosterMeta(item) {
  const normalized = normalizeCatalogItem(item);
  const parts = [];
  const typeLabel = toTitleCase(normalized.type || normalized.apiType || "movie");
  if (typeLabel) {
    parts.push(typeLabel);
  }
  if (normalized.genres?.[0]) {
    parts.push(normalized.genres[0]);
  }
  const year = extractYear(normalized);
  if (year) {
    parts.push(year);
  }
  const imdb = resolveImdbRating(normalized);
  if (imdb) {
    parts.push(`IMDb ${imdb}`);
  }
  return parts.join("  ·  ");
}

function renderRowHeader(title, subtitle = "") {
  return `
    <div class="home-row-head">
      <h2 class="home-row-title">${escapeHtml(title)}</h2>
      ${subtitle ? `<div class="home-row-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </div>
  `;
}

function renderContinueWatchingCard(item, index) {
  const normalized = normalizeContinueWatchingItem(item);
  const subtitle = firstNonEmpty(normalized.episodeTitle, normalized.releaseInfo, toTitleCase(normalized.type));
  const isNextUp = Boolean(normalized?.isNextUp);
  const hasAired = normalized?.hasAired !== false;
  const cardImage = !isNextUp
    ? firstNonEmpty(normalized.backdrop, normalized.poster)
    : (!hasAired
      ? firstNonEmpty(normalized.backdrop, normalized.poster, normalized.thumbnail)
      : firstNonEmpty(normalized.thumbnail, normalized.backdrop, normalized.poster));
  return `
    <article class="home-content-card home-continue-card focusable"
             data-action="resumeProgress"
             data-cw-index="${index}"
             data-item-id="${escapeAttribute(normalized.contentId)}"
             data-item-type="${escapeAttribute(normalized.type || "movie")}"
             data-item-title="${escapeAttribute(normalized.title || "Untitled")}">
      <div class="home-continue-media"${cardImage ? ` style="background-image:url('${escapeAttribute(cardImage)}')"` : ""}>
        <span class="home-continue-badge">${escapeHtml(normalized.progressStatus || t("home.continueStatusContinue", {}, "Continue"))}</span>
        <div class="home-continue-copy">
          ${normalized.episodeCode ? `<div class="home-continue-kicker">${escapeHtml(normalized.episodeCode)}</div>` : ""}
          <div class="home-continue-title">${escapeHtml(normalized.title)}</div>
          <div class="home-continue-subtitle">${escapeHtml(subtitle || t("home.continueWatchingSubtitle", {}, "Continue watching"))}</div>
        </div>
        <div class="home-continue-progress"><span style="width:${Math.round((normalized.progressFraction || 0) * 100)}%"></span></div>
      </div>
    </article>
  `;
}

function renderContinueWatchingLoadingCard(index = 0) {
  const titleWidths = [132, 148, 124, 156, 138, 144, 126, 152, 136, 142];
  const subtitleWidths = [108, 118, 96, 124, 110, 122, 102, 116, 106, 120];
  const safeIndex = Math.max(0, Number(index) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-continue-card home-continue-card-loading focusable"
              data-action="continueWatchingLoading"
             data-cw-loading-index="${index}"
              aria-disabled="true">
      <div class="home-continue-media home-continue-media-loading"
           style="--cw-skeleton-title:${titleWidth}px;--cw-skeleton-subtitle:${subtitleWidth}px;">
        <span class="home-continue-badge" aria-hidden="true">${escapeHtml(t("common.loading", {}, "Loading"))}</span>
        <div class="home-continue-copy home-continue-copy-skeleton" aria-hidden="true">
          <div class="home-continue-skeleton-line home-continue-skeleton-kicker"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-title"></div>
          <div class="home-continue-skeleton-line home-continue-skeleton-subtitle"></div>
        </div>
      </div>
    </article>
  `;
}

function renderContinueWatchingSection(items = [], options = {}) {
  const loading = Boolean(options?.loading);
  if (!items.length && !loading) {
    return "";
  }
  const rowKey = String(options?.rowKey || "").trim();
  const loadingCount = Math.max(1, Math.min(10, Number(options?.loadingCount || items.length || 3)));
  return `
    <section class="home-row home-row-continue"${rowKey ? ` data-row-key="${escapeAttribute(rowKey)}"` : ""}>
      <div class="home-row-head">
        <h2 class="home-row-title">${escapeHtml(t("home.continueWatching", {}, "Continue Watching"))}</h2>
      </div>
      <div class="home-track home-track-continue"${rowKey ? ` data-track-row-key="${escapeAttribute(rowKey)}"` : ""}>
        ${items.length
      ? items.map((item, index) => renderContinueWatchingCard(item, index)).join("")
      : Array.from({ length: loadingCount }, (_, index) => renderContinueWatchingLoadingCard(index)).join("")}
      </div>
    </section>
  `;
}

function continueWatchingStreamParams(item, options = {}) {
  const normalized = normalizeContinueWatchingItem(item);
  if (!normalized?.contentId) {
    return null;
  }
  const isSeries = isSeriesTypeForContinueWatching(normalized.type);
  return {
    itemId: normalized.contentId,
    itemType: normalized.type || "movie",
    itemTitle: normalized.title || normalized.contentId || "Untitled",
    playerTitle: normalized.title || normalized.contentId || "Untitled",
    playerEpisodeTitle: isSeries ? (normalized.episodeTitle || "") : "",
    playerReleaseYear: isSeries ? "" : (String(normalized.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || ""),
    // Do not turn contentId into a synthetic videoId; the player and sync layer should keep
    // progress identity stable across entry points.
    videoId: normalized.videoId || null,
    season: isSeries ? normalized.season : null,
    episode: isSeries ? normalized.episode : null,
    episodeTitle: isSeries ? (normalized.episodeTitle || "") : "",
    backdrop: firstNonEmpty(normalized.backdrop, normalized.background, normalized.landscapePoster, normalized.poster),
    landscapePoster: firstNonEmpty(normalized.landscapePoster, normalized.backdrop, normalized.background, normalized.poster),
    poster: firstNonEmpty(normalized.poster, normalized.backdrop, normalized.background),
    logo: firstNonEmpty(normalized.logo),
    resumePositionMs: options.startOver ? 0 : (Number(normalized.positionMs || 0) || 0)
  };
}

function renderLegacyCatalogRowsMarkup(rows = [], options = {}) {
  const {
    layoutMode = "classic",
    showPosterLabels = true,
    showCatalogAddonName = true,
    showCatalogTypeSuffix = true,
    focusedRowKey = "",
    focusedItemIndex = -1,
    expandFocusedPoster = false,
    rowItemLimit = HOME_ITEMS_BEFORE_SEE_ALL
  } = options;
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];

  rows.forEach((rowData, rowIndex) => {
    const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
    const isLoading = rowData?.result?.status === "loading";
    const rowKey = buildModernRowKey(rowData);
    const loadingItems = isLoading ? (rowData.loadingItems || buildCatalogLoadingItems(rowKey, rowItemLimit)) : [];
    const rowItems = items.length ? items : loadingItems;
    if (!rowItems.length) {
      return;
    }

    const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
    if (!isLoading) {
      catalogSeeAllMap.set(seeAllId, {
        addonBaseUrl: rowData.addonBaseUrl || "",
        addonId: rowData.addonId || "",
        addonName: rowData.addonName || "",
        catalogId: rowData.catalogId || "",
        catalogName: rowData.catalogName || "",
        type: rowData.type || "movie",
        initialItems: items
      });
    }

    const rowTitle = formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
    const rowSubtitle = layoutMode === "classic" && showCatalogAddonName && rowData.addonName
      ? t("catalog_from_addon", [rowData.addonName], "from %1$s")
      : "";
    const maxItems = Math.max(1, Number(rowItemLimit || HOME_ITEMS_BEFORE_SEE_ALL));
    const hasSeeAll = !isLoading && items.length > maxItems;
    const visibleItems = rowItems.slice(0, maxItems);
    const cardsMarkup = visibleItems.map((item, itemIndex) => createPosterCardMarkup(
      item,
      rowIndex,
      itemIndex,
      rowData.type,
      showPosterLabels,
      layoutMode,
      expandFocusedPoster && focusedRowKey === rowKey && focusedItemIndex === itemIndex
    )).join("");
    const trackMarkup = `
      <div class="${layoutMode === "grid" ? "home-grid-track" : "home-track"}" data-track-row-key="${escapeAttribute(rowKey)}">
        ${cardsMarkup}
        ${hasSeeAll ? createSeeAllCardMarkup(seeAllId, rowData, { layoutMode }) : ""}
      </div>
    `;

    if (layoutMode === "grid") {
      sectionsMarkup.push(`
        <section class="home-grid-section"
                 data-row-key="${escapeAttribute(rowKey)}"
                 data-row-index="${rowIndex}"
                 data-section-title="${escapeAttribute(rowTitle)}">
          <div class="home-grid-section-divider">${escapeHtml(rowTitle)}</div>
          ${trackMarkup}
        </section>
      `);
      return;
    }

    sectionsMarkup.push(`
      <section class="home-row"
               data-row-key="${escapeAttribute(rowKey)}"
               data-row-index="${rowIndex}">
        ${renderRowHeader(rowTitle, rowSubtitle)}
        ${trackMarkup}
      </section>
    `);
  });

  return {
    catalogSeeAllMap,
    markup: sectionsMarkup.join("")
  };
}

function createSeeAllCardMarkup(seeAllId, rowData, options = {}) {
  const label = t("action_see_all", {}, "See All");
  const layoutMode = String(options?.layoutMode || "").toLowerCase();
  const useLandscapePoster = layoutMode === "modern" && Boolean(options?.preferLandscapePoster);
  const landscapeClass = useLandscapePoster ? " is-landscape" : "";
  return `
    <article class="home-content-card home-poster-card${landscapeClass} focusable"
             data-action="openCatalogSeeAll"
             data-see-all-id="${escapeAttribute(seeAllId)}"
             data-addon-base-url="${escapeAttribute(rowData.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData.addonName || "")}"
             data-catalog-id="${escapeAttribute(rowData.catalogId || "")}"
             data-catalog-name="${escapeAttribute(rowData.catalogName || "")}"
             data-catalog-type="${escapeAttribute(rowData.type || "")}"
             aria-label="${escapeAttribute(label)}">
      <div class="home-poster-frame">
        <div class="content-poster placeholder"></div>
        ${useLandscapePoster ? `
          <div class="home-poster-landscape-copy" aria-hidden="true">
            <div class="home-poster-landscape-title">${escapeHtml(label)}</div>
          </div>
        ` : ""}
      </div>
      ${useLandscapePoster ? "" : `<div class="home-poster-copy">
        <div class="home-poster-title">${escapeHtml(label)}</div>
      </div>`}
    </article>
  `;
}

function groupNodesByOffsetTop(nodes = []) {
  const grouped = [];
  nodes.forEach((node) => {
    const top = Math.round(node.offsetTop);
    const bucket = grouped.find((entry) => Math.abs(entry.top - top) <= 6);
    if (bucket) {
      bucket.nodes.push(node);
      return;
    }
    grouped.push({ top, nodes: [node] });
  });
  grouped.sort((left, right) => left.top - right.top);
  return grouped.map((entry) => entry.nodes);
}

function createPosterCardMarkup(item, rowIndex, itemIndex, itemType, showLabels = true, layoutMode = "classic", isExpanded = false, preferLandscapePoster = false) {
  const isLoading = Boolean(item?.isLoading);
  const normalized = normalizeCatalogItem(item, itemType);
  const subtitle = buildPosterSubtitle(normalized, layoutMode);
  const expandedMeta = buildExpandedPosterMeta(normalized);
  const preferredLandscapePosterSrc = firstNonEmpty(normalized.landscapePoster);
  const useLandscapePoster = layoutMode === "modern" && preferLandscapePoster;
  const landscapeVisualSrc = firstNonEmpty(
    preferredLandscapePosterSrc,
    normalized.background,
    normalized.backdrop,
    normalized.backdropUrl,
    normalized.poster,
    normalized.thumbnail
  );
  const backdropSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(
      preferredLandscapePosterSrc,
      normalized.background,
      normalized.backdrop,
      normalized.backdropUrl,
      normalized.poster
    );
  const posterSrc = useLandscapePoster
    ? landscapeVisualSrc
    : firstNonEmpty(normalized.poster, normalized.thumbnail, preferredLandscapePosterSrc, normalized.backdrop, normalized.backdropUrl);
  const expandedVisualSrc = firstNonEmpty(backdropSrc, posterSrc);
  const expandedClass = isExpanded ? " is-expanded" : "";
  const landscapeClass = useLandscapePoster ? " is-landscape" : "";
  const focusableClass = isLoading ? "" : " focusable";
  const loadingClass = isLoading ? " home-poster-card-loading" : "";
  const shouldShowLabels = showLabels && !isLoading;
  const titleWidths = [116, 128, 104, 132, 120, 140, 110, 124, 136, 112];
  const subtitleWidths = [82, 96, 74, 90, 88, 100, 80, 94, 86, 92];
  const safeIndex = Math.max(0, Number(itemIndex) || 0);
  const titleWidth = titleWidths[safeIndex % titleWidths.length];
  const subtitleWidth = subtitleWidths[safeIndex % subtitleWidths.length];
  return `
    <article class="home-content-card home-poster-card${focusableClass}${expandedClass}${landscapeClass}${loadingClass}"
             ${isLoading ? 'aria-disabled="true"' : `data-action="openDetail"
             data-row-index="${rowIndex}"
             data-item-index="${itemIndex}"
             data-item-id="${escapeAttribute(normalized.id)}"
             data-item-type="${escapeAttribute(normalized.type || itemType || "movie")}"
             data-item-title="${escapeAttribute(normalized.name || "Untitled")}"
             data-poster-src="${escapeAttribute(posterSrc || "")}"
             data-backdrop-src="${escapeAttribute(backdropSrc || "")}"
             data-logo-src="${escapeAttribute(normalized.logo || "")}"`}>
      <div class="home-poster-frame">
        ${(!isLoading && posterSrc)
      ? `<img class="content-poster" src="${escapeAttribute(posterSrc)}" decoding="async" loading="lazy" alt="${escapeAttribute(normalized.name || "content")}" />`
      : '<div class="content-poster placeholder"></div>'}
        ${(!isLoading && expandedVisualSrc)
      ? `<img class="home-poster-expanded-backdrop" data-src="${escapeAttribute(expandedVisualSrc)}" decoding="async" loading="lazy" alt="" aria-hidden="true" />`
      : '<div class="home-poster-expanded-backdrop placeholder" aria-hidden="true"></div>'}
        <div class="home-poster-trailer-layer"></div>
        <div class="home-poster-expanded-gradient"></div>
        <div class="home-poster-expanded-brand">
          ${(!isLoading && normalized.logo)
      ? `<img class="home-poster-expanded-logo" data-src="${escapeAttribute(normalized.logo)}" decoding="async" loading="lazy" alt="${escapeAttribute(normalized.name || "content")}" />`
      : `<div class="home-poster-expanded-title">${escapeHtml(normalized.name || "Untitled")}</div>`}
        </div>
        ${(!isLoading && useLandscapePoster) ? `
          <div class="home-poster-landscape-copy" aria-hidden="true">
            ${normalized.logo
      ? `<img class="home-poster-landscape-logo" src="${escapeAttribute(normalized.logo)}" decoding="async" loading="lazy" alt="" />`
      : `<div class="home-poster-landscape-title">${escapeHtml(normalized.name || "Untitled")}</div>`}
            ${subtitle ? `<div class="home-poster-landscape-subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
        ` : ""}
      </div>
      <div class="home-poster-expanded-copy">
        ${(!isLoading && expandedMeta) ? `<div class="home-poster-expanded-meta">${escapeHtml(expandedMeta)}</div>` : ""}
        ${(!isLoading && normalized.description) ? `<div class="home-poster-expanded-description">${escapeHtml(normalized.description)}</div>` : ""}
      </div>
      ${shouldShowLabels ? `
        <div class="home-poster-copy">
          <div class="home-poster-title">${escapeHtml(normalized.name || "Untitled")}</div>
          ${subtitle ? `<div class="home-poster-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      ` : (isLoading ? `
        <div class="home-poster-copy home-poster-copy-skeleton" aria-hidden="true"
             style="--poster-skeleton-title:${titleWidth}px;--poster-skeleton-subtitle:${subtitleWidth}px;">
          <div class="home-poster-skeleton-line home-poster-skeleton-title"></div>
          <div class="home-poster-skeleton-line home-poster-skeleton-subtitle"></div>
        </div>
      ` : "")}
    </article>
  `;
}

export const HomeScreen = {
  getRouteStateKey() {
    return "home";
  },

  captureRouteState() {
    return this.captureCurrentFocusState();
  },

  captureCurrentFocusState() {
    const layoutMode = String(this.renderedLayoutMode || this.layoutMode || "").toLowerCase();
    if (!this.container || !layoutMode) {
      return null;
    }
    let focused = this.container.querySelector(".focusable.focused") || null;
    if (focused && !focused.isConnected) {
      focused = null;
    }
    if (focused && this.isSidebarNode(focused)) {
      return {
        layoutMode,
        focusZone: "sidebar",
        sidebarExpanded: Boolean(this.sidebarExpanded),
        sidebarAction: String(focused.dataset?.action || ""),
        sidebarSelectedRoute: String(this.container.querySelector(".home-sidebar, .modern-sidebar-shell")?.dataset?.selectedRoute || "")
      };
    }
    const viewport = layoutMode === "modern"
      ? this.container.querySelector(".home-modern-rows-viewport")
      : this.container.querySelector(".home-main");
    if (!viewport) {
      return null;
    }

    focused = this.container.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
    if (focused && !focused.isConnected) {
      focused = null;
    }
    if (!focused) {
      return null;
    }
    const trackStates = Array.from(
      this.container.querySelectorAll("[data-track-row-key]"),
    ).reduce((acc, track) => {
      const key = String(track.dataset.trackRowKey || "");
      if (key) acc[key] = track.scrollLeft;
      return acc;
    }, {});
    const section = focused?.closest?.("[data-row-key]") || null;
    const rowKey = String(section?.dataset?.rowKey || "");
    let itemIndex = -1;

    if (focused) {
      const track = focused.closest(".home-track, .home-grid-track");
      if (track) {
        itemIndex = Array.from(track.querySelectorAll(".home-content-card.focusable")).indexOf(focused);
      }
    }

    const focusKind = focused?.classList?.contains("home-hero-card")
      ? "hero"
      : (focused?.dataset?.action === "resumeProgress"
        ? "continue"
        : (focused?.dataset?.action === "openCatalogSeeAll" ? "seeAll" : "item"));

    return {
      layoutMode,
      focusZone: "main",
      mainScrollTop: viewport.scrollTop,
      rowKey,
      itemIndex,
      focusKind,
      trackStates
    };
  },

  persistCurrentFocusState() {
    const currentState = this.captureCurrentFocusState();
    if (!currentState?.layoutMode) {
      return;
    }
    this.savedFocusStates = {
      ...(this.savedFocusStates || {}),
      [currentState.layoutMode]: currentState
    };
  },

  restoreFocusState(state = null) {
    const focusState = state?.layoutMode === this.layoutMode
      ? state
      : (this.savedFocusStates?.[this.layoutMode] || null);
    if (!focusState) {
      return false;
    }
    if (focusState.focusZone === "sidebar") {
      return this.restoreSidebarFocusState(focusState);
    }

    if (this.layoutMode === "modern") {
      return this.restoreModernFocusState(focusState);
    }

    return this.restoreLegacyFocusState(focusState);
  },

  restoreSidebarFocusState(focusState) {
    if (!focusState || !this.container) {
      return false;
    }
    const desiredAction = String(focusState.sidebarAction || "");
    let target = null;

    if (this.layoutPrefs?.modernSidebar) {
      this.sidebarExpanded = Boolean(focusState.sidebarExpanded);
      setModernSidebarExpanded(this.container, this.sidebarExpanded);
      if (this.sidebarExpanded && desiredAction) {
        target = this.container.querySelector(`.modern-sidebar-panel .focusable[data-action="${desiredAction}"]`);
      }
      if (!target && this.sidebarExpanded) {
        target = getModernSidebarSelectedNode(this.container);
      }
      if (!target && desiredAction === "expandSidebar") {
        target = this.container.querySelector(".modern-sidebar-pill[data-action='expandSidebar']");
      }
      if (!target) {
        target = this.container.querySelector(".modern-sidebar-pill[data-action='expandSidebar']");
      }
    } else {
      setLegacySidebarExpanded(this.container, true);
      if (desiredAction) {
        target = this.container.querySelector(`.home-sidebar .focusable[data-action="${desiredAction}"]`);
      }
      if (!target) {
        target = getLegacySidebarSelectedNode(this.container);
      }
    }

    if (!target) {
      return false;
    }

    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    return true;
  },

  restoreModernFocusState(focusState) {
    if (!focusState || this.layoutMode !== "modern") {
      return false;
    }

    const viewport = this.getHomeViewport();
    if (!viewport) {
      return false;
    }

    Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.container.querySelector(`[data-track-row-key="${rowKey}"]`);
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });

    const rowSection = focusState.rowKey
      ? this.container.querySelector(`[data-row-key="${focusState.rowKey}"]`)
      : null;
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

    const targetTrack = rowSection?.querySelector?.(".home-track") || null;
    const targetNodes = Array.from(targetTrack?.querySelectorAll(".home-content-card.focusable") || []);
    const fallback = this.container.querySelector(".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable");
    const target = targetNodes[focusState.itemIndex] || targetNodes[0] || fallback;
    if (!target) {
      return false;
    }

    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!this.isNodeWithinMainViewport(target)) {
      this.ensureMainVerticalVisibility(target);
    }
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
    return true;
  },

  restoreLegacyFocusState(focusState) {
    if (!focusState || !["classic", "grid"].includes(this.layoutMode)) {
      return false;
    }

    const main = this.container?.querySelector(".home-main");
    if (!main) {
      return false;
    }

    Object.entries(focusState.trackStates || {}).forEach(([rowKey, scrollLeft]) => {
      const track = this.container.querySelector(`[data-track-row-key="${rowKey}"]`);
      if (track) {
        track.scrollLeft = Number(scrollLeft || 0);
      }
    });

    const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
    main.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(focusState.mainScrollTop || 0)));

    let target = null;
    if (focusState.focusKind === "hero") {
      target = this.container.querySelector(".home-hero-card.focusable");
    } else if (focusState.rowKey) {
      const rowSection = this.container.querySelector(`[data-row-key="${focusState.rowKey}"]`);
      const track = rowSection?.querySelector?.(".home-track") || rowSection?.querySelector?.(".home-grid-track") || null;
      const rowNodes = Array.from(track?.querySelectorAll(".home-content-card.focusable") || []);
      target = rowNodes[focusState.itemIndex] || rowNodes[0] || null;
    }

    const fallback = this.container.querySelector(this.getInitialFocusSelector());
    target = target || fallback;
    if (!target) {
      return false;
    }

    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (target.closest(".home-track, .home-grid-track")) {
      this.ensureTrackHorizontalVisibility(target);
    }
    this.ensureMainVerticalVisibility(target);
    return true;
  },

  focusInitialContinueWatchingCard() {
    const target = this.container?.querySelector(".home-row-continue .home-content-card.focusable") || null;
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    this.ensureTrackHorizontalVisibility(target);
    this.ensureMainVerticalVisibility(target);
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
    return true;
  },

  cancelScrollAnimation(container, axis = "x") {
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const state = map.get(container);
    const key = axis === "y" ? "y" : "x";
    if (state?.[key]) {
      cancelAnimationFrame(state[key]);
      state[key] = null;
    }
    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const springState = springMap.get(container);
    if (springState?.[key]?.raf) {
      cancelAnimationFrame(springState[key].raf);
      springState[key] = null;
      springMap.set(container, springState);
    }
  },

  animateScroll(container, axis, targetValue, duration = 150, options = {}) {
    if (!container) {
      return;
    }
    if (options?.mode === "spring") {
      this.animateSpringScroll(container, axis, targetValue, options?.spring || {});
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max = axis === "y"
      ? Math.max(0, container.scrollHeight - container.clientHeight)
      : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const startValue = Number(container[property] || 0);
    if (Math.abs(startValue - nextValue) <= 1) {
      container[property] = nextValue;
      return;
    }

    const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const effectiveDuration = Math.max(0, Number(duration || 0));
    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const springState = springMap.get(container);
    const key = axis === "y" ? "y" : "x";
    if (springState?.[key]?.raf) {
      cancelAnimationFrame(springState[key].raf);
      springState[key] = null;
      springMap.set(container, springState);
    }
    if (prefersReducedMotion || effectiveDuration <= 0) {
      container[property] = nextValue;
      return;
    }

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easing = typeof options?.easing === "function"
      ? options.easing
      : easeOutCubic;
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const existing = map.get(container) || {};
    if (existing[key]) {
      cancelAnimationFrame(existing[key]);
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / effectiveDuration);
      container[property] = Math.round(startValue + ((nextValue - startValue) * easing(progress)));
      if (progress < 1) {
        existing[key] = requestAnimationFrame(tick);
        map.set(container, existing);
      } else {
        existing[key] = null;
        map.set(container, existing);
      }
    };

    existing[key] = requestAnimationFrame(tick);
    map.set(container, existing);
  },

  animateSpringScroll(container, axis, targetValue, options = {}) {
    if (!container) {
      return;
    }
    const property = axis === "y" ? "scrollTop" : "scrollLeft";
    const max = axis === "y"
      ? Math.max(0, container.scrollHeight - container.clientHeight)
      : Math.max(0, container.scrollWidth - container.clientWidth);
    const nextValue = Math.max(0, Math.min(max, Math.round(targetValue)));
    const prefersReducedMotion = globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const tweenMap = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const tweenState = tweenMap.get(container);
    const key = axis === "y" ? "y" : "x";
    if (tweenState?.[key]) {
      cancelAnimationFrame(tweenState[key]);
      tweenState[key] = null;
      tweenMap.set(container, tweenState);
    }

    const springMap = this.springScrollAnimations || (this.springScrollAnimations = new WeakMap());
    const existing = springMap.get(container) || {};
    const active = existing[key];
    if (active) {
      active.target = nextValue;
      active.stiffness = Number(options?.stiffness ?? active.stiffness ?? 0.12);
      active.damping = Number(options?.damping ?? active.damping ?? 0.8);
      active.precision = Number(options?.precision ?? active.precision ?? 0.75);
      active.velocityEpsilon = Number(options?.velocityEpsilon ?? active.velocityEpsilon ?? 0.35);
      springMap.set(container, existing);
      return;
    }

    const state = {
      target: nextValue,
      velocity: 0,
      raf: null,
      lastTime: performance.now(),
      stiffness: Number(options?.stiffness ?? 0.12),
      damping: Number(options?.damping ?? 0.8),
      precision: Number(options?.precision ?? 0.75),
      velocityEpsilon: Number(options?.velocityEpsilon ?? 0.35)
    };

    const tick = (now) => {
      const current = Number(container[property] || 0);
      const delta = Number(state.target || 0) - current;
      const frameScale = Math.min(2.2, Math.max(0.85, (now - state.lastTime) / 16.6667));
      state.lastTime = now;
      state.velocity = (state.velocity + (delta * state.stiffness * frameScale)) * Math.pow(state.damping, frameScale);
      const next = current + state.velocity;
      container[property] = Math.round(next);

      const remaining = Number(state.target || 0) - Number(container[property] || 0);
      if (Math.abs(remaining) <= state.precision && Math.abs(state.velocity) <= state.velocityEpsilon) {
        container[property] = Math.round(state.target);
        existing[key] = null;
        springMap.set(container, existing);
        return;
      }

      state.raf = requestAnimationFrame(tick);
      existing[key] = state;
      springMap.set(container, existing);
    };

    state.raf = requestAnimationFrame(tick);
    existing[key] = state;
    springMap.set(container, existing);
  },

  getModernCameraPanEasing() {
    return MODERN_CAMERA_PAN_EASING;
  },

  shouldUseDelayedModernCameraFollow(target, direction = null) {
    if (this.layoutMode !== "modern" || !this.isMainNode(target) || !direction) {
      return false;
    }
    if (direction === "left" || direction === "right") {
      return false;
    }
    return !Boolean(globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  },

  cancelModernCameraFollow({ stopAnimations = false } = {}) {
    if (this.modernCameraFollowTimer) {
      clearTimeout(this.modernCameraFollowTimer);
      this.modernCameraFollowTimer = null;
    }
    const state = this.modernCameraFollowState || null;
    if (stopAnimations) {
      const horizontalContainers = [state?.horizontal?.container, this.modernCameraFollowLastHorizontalContainer];
      const verticalContainers = [state?.vertical?.container, this.modernCameraFollowLastVerticalContainer];
      horizontalContainers.forEach((container) => {
        if (container) {
          this.cancelScrollAnimation(container, "x");
        }
      });
      verticalContainers.forEach((container) => {
        if (container) {
          this.cancelScrollAnimation(container, "y");
        }
      });
    }
    this.modernCameraFollowState = null;
    this.modernCameraFollowLastHorizontalContainer = null;
    this.modernCameraFollowLastVerticalContainer = null;
  },

  isScrollAnimationActive(container, axis = "x") {
    if (!container) {
      return false;
    }
    const map = this.scrollAnimations || null;
    const state = map?.get?.(container) || null;
    const key = axis === "y" ? "y" : "x";
    return Boolean(state?.[key]);
  },

  shouldSuspendModernViewportFocusSync() {
    if (this.layoutMode !== "modern") {
      return false;
    }
    if (this.modernCameraFollowTimer) {
      return true;
    }
    return this.isScrollAnimationActive(this.modernCameraFollowLastVerticalContainer, "y")
      || this.isScrollAnimationActive(this.modernCameraFollowLastHorizontalContainer, "x");
  },

  getRowFocusInset() {
    if (this.layoutMode === "modern") {
      return MODERN_HOME_CONSTANTS.rowFocusInset;
    }
    if (this.layoutMode === "grid") {
      return 24;
    }
    return 32;
  },

  getTrackEdgePadding() {
    if (this.layoutMode === "modern") {
      return MODERN_HOME_CONSTANTS.trackEdgePadding;
    }
    if (this.layoutMode === "grid") {
      return 24;
    }
    return 48;
  },

  getCachedModernLandscapePosterMetrics(shell = null) {
    if (this.cachedModernLandscapePosterMetrics) {
      return this.cachedModernLandscapePosterMetrics;
    }
    const targetShell = shell instanceof HTMLElement
      ? shell
      : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
    if (!(targetShell instanceof HTMLElement)) {
      return null;
    }
    const main = targetShell.querySelector(".home-main");
    const shellStyles = getComputedStyle(targetShell);
    const contentStart = parseCssPx(shellStyles.getPropertyValue("--home-content-start"), 52);
    const trackEnd = parseCssPx(shellStyles.getPropertyValue("--home-track-end"), 52);
    const rowGap = parseCssPx(shellStyles.getPropertyValue("--home-row-gap"), 16);
    const visibleLandscapeCards = 4.25;
    const gapCount = 4;
    const shellWidth = main instanceof HTMLElement
      ? main.clientWidth
      : targetShell.clientWidth;
    const fallbackWidth = Math.max(
      Number(globalThis.innerWidth || 0),
      Number(globalThis.document?.documentElement?.clientWidth || 0),
      Number(shellWidth || 0)
    );
    const availableWidth = Math.max(
      0,
      Number(shellWidth || fallbackWidth) - contentStart - trackEnd - (rowGap * gapCount)
    );
    const fittedWidth = availableWidth > 0
      ? Math.floor(availableWidth / visibleLandscapeCards)
      : 336;
    const posterWidth = Math.max(272, Math.min(420, fittedWidth || 336));
    this.cachedModernLandscapePosterMetrics = {
      width: posterWidth,
      height: Math.round(posterWidth * 0.5625)
    };
    return this.cachedModernLandscapePosterMetrics;
  },

  applyCachedModernLandscapePosterMetrics(shell = null) {
    const targetShell = shell instanceof HTMLElement
      ? shell
      : this.container?.querySelector(".home-screen-shell.home-modern-landscape-posters");
    if (!(targetShell instanceof HTMLElement)) {
      return;
    }
    const metrics = this.getCachedModernLandscapePosterMetrics(targetShell);
    if (!metrics) {
      return;
    }
    targetShell.style.setProperty("--home-landscape-poster-width", `${metrics.width}px`);
    targetShell.style.setProperty("--home-landscape-poster-height", `${metrics.height}px`);
  },

  getCachedModernPortraitPosterMetrics(shell = null) {
    if (this.cachedModernPortraitPosterMetrics) {
      return this.cachedModernPortraitPosterMetrics;
    }
    const targetShell = shell instanceof HTMLElement
      ? shell
      : this.container?.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)");
    if (!(targetShell instanceof HTMLElement)) {
      return null;
    }
    const main = targetShell.querySelector(".home-main");
    const shellStyles = getComputedStyle(targetShell);
    const contentStart = parseCssPx(shellStyles.getPropertyValue("--home-content-start"), 52);
    const trackEnd = parseCssPx(shellStyles.getPropertyValue("--home-track-end"), 52);
    const rowGap = parseCssPx(shellStyles.getPropertyValue("--home-row-gap"), 12);
    const visiblePortraitCards = 7.25;
    const gapCount = 7;
    const shellWidth = main instanceof HTMLElement
      ? main.clientWidth
      : targetShell.clientWidth;
    const fallbackWidth = Math.max(
      Number(globalThis.innerWidth || 0),
      Number(globalThis.document?.documentElement?.clientWidth || 0),
      Number(shellWidth || 0)
    );
    const availableWidth = Math.max(
      0,
      Number(shellWidth || fallbackWidth) - contentStart - trackEnd - (rowGap * gapCount)
    );
    const fittedWidth = availableWidth > 0
      ? Math.floor(availableWidth / visiblePortraitCards)
      : 224;
    const posterWidth = Math.max(208, Math.min(280, fittedWidth || 224));
    this.cachedModernPortraitPosterMetrics = {
      width: posterWidth,
      height: Math.round(posterWidth * 1.5),
      expandedWidth: Math.round(posterWidth * 2.66)
    };
    return this.cachedModernPortraitPosterMetrics;
  },

  applyCachedModernPortraitPosterMetrics(shell = null) {
    const targetShell = shell instanceof HTMLElement
      ? shell
      : this.container?.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)");
    if (!(targetShell instanceof HTMLElement)) {
      return;
    }
    const metrics = this.getCachedModernPortraitPosterMetrics(targetShell);
    if (!metrics) {
      return;
    }
    targetShell.style.setProperty("--home-modern-portrait-poster-width", `${metrics.width}px`);
    targetShell.style.setProperty("--home-modern-portrait-poster-height", `${metrics.height}px`);
    targetShell.style.setProperty("--home-modern-portrait-expanded-width", `${metrics.expandedWidth}px`);
  },

  getHomeViewport() {
    return this.layoutMode === "modern"
      ? this.container?.querySelector(".home-modern-rows-viewport")
      : this.container?.querySelector(".home-main");
  },

  isLegacyTvRuntime() {
    if (Platform.isTizen()) {
      return true;
    }
    if (!Platform.isWebOS()) {
      return false;
    }
    const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
    return webOsMajor > 0 && webOsMajor <= 5;
  },

  shouldSuppressAutomaticTrailerPlayback() {
    return false;
  },

  getFocusedPosterTrailerDelayMs() {
    if (this.isLegacyTvRuntime()) {
      return 0;
    }
    if (this.isPerformanceConstrained()) {
      return 1400;
    }
    return 0;
  },

  isPerformanceConstrained() {
    return Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  },

  getRowItemLimit() {
    return HOME_ITEMS_BEFORE_SEE_ALL;
  },

  getLoadingRowItemCount() {
    return this.isPerformanceConstrained()
      ? HOME_LOADING_ROW_ITEMS_CONSTRAINED
      : HOME_LOADING_ROW_ITEMS_DEFAULT;
  },

  shouldWindowHomeRows() {
    return this.isPerformanceConstrained();
  },

  getInitialVisibleHomeRowCount() {
    return this.shouldWindowHomeRows()
      ? HOME_VISIBLE_ROWS_CONSTRAINED_INITIAL
      : Number.MAX_SAFE_INTEGER;
  },

  getVisibleHomeRows(rows = []) {
    const catalogRows = Array.isArray(rows) ? rows : [];
    if (!this.shouldWindowHomeRows()) {
      return catalogRows;
    }
    const requestedCount = Number.isFinite(this.visibleHomeRowCount)
      ? Number(this.visibleHomeRowCount)
      : this.getInitialVisibleHomeRowCount();
    const count = Math.max(1, Math.min(catalogRows.length, requestedCount));
    return catalogRows.slice(0, count);
  },

  ensureVisibleHomeRowsIncludeFocusState(focusState = null) {
    if (!this.shouldWindowHomeRows() || !focusState?.rowKey || !Array.isArray(this.rows)) {
      return;
    }
    const rowIndex = this.rows.findIndex((row) => buildModernRowKey(row) === focusState.rowKey);
    if (rowIndex < 0) {
      return;
    }
    const requiredCount = rowIndex + 1;
    if (!Number.isFinite(this.visibleHomeRowCount) || this.visibleHomeRowCount < requiredCount) {
      this.visibleHomeRowCount = requiredCount;
    }
  },

  revealMoreHomeRowsFromFocus(current, row, col) {
    if (!this.shouldWindowHomeRows() || !Array.isArray(this.rows)) {
      return false;
    }
    const currentCount = Number.isFinite(this.visibleHomeRowCount)
      ? Number(this.visibleHomeRowCount)
      : this.getInitialVisibleHomeRowCount();
    if (currentCount >= this.rows.length) {
      return false;
    }
    this.pendingHomeRevealFocus = {
      rowIndex: Math.max(0, Number(row || 0) + 1),
      colIndex: Math.max(0, Number(col || 0))
    };
    this.visibleHomeRowCount = Math.min(
      this.rows.length,
      currentCount + HOME_VISIBLE_ROWS_CONSTRAINED_INCREMENT
    );
    this.render();
    return true;
  },

  applyPendingHomeRevealFocus() {
    const pending = this.pendingHomeRevealFocus;
    this.pendingHomeRevealFocus = null;
    if (!pending || !this.navModel?.rows?.length) {
      return false;
    }
    const rowIndex = Math.max(0, Math.min(this.navModel.rows.length - 1, Number(pending.rowIndex || 0)));
    const rowNodes = this.navModel.rows[rowIndex] || [];
    const target = this.resolvePreferredNodeForRow(rowNodes, Number(pending.colIndex || 0));
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    this.ensureTrackHorizontalVisibility(target, "down");
    this.ensureMainVerticalVisibility(target, "down");
    this.scheduleModernHeroUpdate(target);
    this.scheduleFocusedPosterFlow(target);
    return true;
  },

  getInitialCatalogLoadCount() {
    if (this.isPerformanceConstrained()) {
      if (this.isLegacyTvRuntime()) {
        return 3;
      }
      return 4;
    }
    if (Platform.isWebOS()) {
      const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
      if (webOsMajor > 0 && webOsMajor <= 5) {
        return 4;
      }
      return Math.min(HOME_INITIAL_CATALOG_LOAD, 6);
    }
    if (Platform.isTizen()) {
      return Math.min(HOME_INITIAL_CATALOG_LOAD, 6);
    }
    return HOME_INITIAL_CATALOG_LOAD;
  },

  getDeferredCatalogBatchSize() {
    if (this.isPerformanceConstrained()) {
      return 3;
    }
    if (Platform.isWebOS()) {
      const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
      if (webOsMajor > 0 && webOsMajor <= 5) {
        return 4;
      }
      return 8;
    }
    if (Platform.isTizen()) {
      return 8;
    }
    return 0;
  },

  getBootCatalogBatchSize() {
    const deferredBatchSize = Number(this.getDeferredCatalogBatchSize() || 0);
    if (deferredBatchSize > 0) {
      return deferredBatchSize;
    }
    return this.isPerformanceConstrained() ? 3 : 8;
  },

  async resolveContinueWatchingState({
    allProgressPromise,
    recentProgressPromise,
    progressAllError = null,
    recentProgressError = null,
    preserveContinueWatching = false,
    previousContinueWatchingSignature = ""
  } = {}) {
    const [allProgress, continueWatching] = await Promise.all([
      allProgressPromise || Promise.resolve([]),
      recentProgressPromise || Promise.resolve([])
    ]);
    const normalizedAllProgress = Array.isArray(allProgress) ? allProgress : [];
    const normalizedContinueWatching = Array.isArray(continueWatching) ? continueWatching : [];
    const watchedItems = await watchedItemsRepository.getAll(2000).catch(() => []);
    const dismissedNextUpKeys = ContinueWatchingPreferences.getDismissedNextUpKeys();
    const showUnairedNextUp = LayoutPreferences.get().showUnairedNextUp !== false;
    const nextUpProgressCandidates = this.selectNextUpProgressCandidates(normalizedAllProgress, normalizedContinueWatching, watchedItems, dismissedNextUpKeys)
      .slice(0, CW_MAX_NEXT_UP_LOOKUPS);
    const shouldShowLoading = Boolean(normalizedContinueWatching.length + nextUpProgressCandidates.length);

    if (!shouldShowLoading) {
      if (preserveContinueWatching && (progressAllError || recentProgressError)) {
        return {
          allProgress: normalizedAllProgress,
          continueWatching: normalizedContinueWatching,
          watchedItems,
          dismissedNextUpKeys,
          showUnairedNextUp,
          nextUpProgressCandidates,
          continueWatchingDisplay: this.continueWatchingDisplay || [],
          continueWatchingLoading: false,
          preserveExistingDisplay: true
        };
      }
      return {
        allProgress: normalizedAllProgress,
        continueWatching: normalizedContinueWatching,
        watchedItems,
        dismissedNextUpKeys,
        showUnairedNextUp,
        nextUpProgressCandidates,
        continueWatchingDisplay: [],
        continueWatchingLoading: false
      };
    }

    const enriched = await this.enrichContinueWatching(normalizedContinueWatching, {
      allProgress: normalizedAllProgress,
      watchedItems,
      dismissedNextUpKeys,
      showUnairedNextUp,
      nextUpProgressCandidates
    });
    const nextDisplayStrict = buildVisibleContinueWatchingItems(enriched, { requireArtwork: true });
    const nextDisplay = nextDisplayStrict.length
      ? nextDisplayStrict
      : buildVisibleContinueWatchingItems(enriched, { requireArtwork: false });
    const nextSignature = preserveContinueWatching
      ? buildContinueWatchingSignature(nextDisplay)
      : "";

    return {
      allProgress: normalizedAllProgress,
      continueWatching: normalizedContinueWatching,
      watchedItems,
      dismissedNextUpKeys,
      showUnairedNextUp,
      nextUpProgressCandidates,
      continueWatchingDisplay: preserveContinueWatching && nextSignature === previousContinueWatchingSignature
        ? (this.continueWatchingDisplay || [])
        : nextDisplay,
      continueWatchingLoading: false,
      preserveExistingDisplay: Boolean(preserveContinueWatching && nextSignature === previousContinueWatchingSignature)
    };
  },

  applyContinueWatchingState(state = {}) {
    this.allProgress = Array.isArray(state.allProgress) ? state.allProgress : [];
    this.continueWatching = Array.isArray(state.continueWatching) ? state.continueWatching : [];
    this.watchedItems = Array.isArray(state.watchedItems) ? state.watchedItems : [];
    this.dismissedNextUpKeys = Array.isArray(state.dismissedNextUpKeys) ? state.dismissedNextUpKeys : [];
    this.showUnairedNextUp = state.showUnairedNextUp !== false;
    this.nextUpProgressCandidates = Array.isArray(state.nextUpProgressCandidates) ? state.nextUpProgressCandidates : [];
    this.continueWatchingDisplay = Array.isArray(state.continueWatchingDisplay) ? state.continueWatchingDisplay : [];
    this.continueWatchingLoading = Boolean(state.continueWatchingLoading);
  },

  collectBootImageUrls() {
    const urls = [];
    const pushUrl = (value) => {
      const url = String(value || "").trim();
      if (url && !urls.includes(url)) {
        urls.push(url);
      }
    };
    const pushItemImages = (item = {}) => {
      const source = item && typeof item === "object" ? item : {};
      pushUrl(source.backdrop);
      pushUrl(source.background);
      pushUrl(source.landscapePoster);
      pushUrl(source.poster);
      pushUrl(source.thumbnail);
      pushUrl(source.episodeThumbnail);
      pushUrl(source.logo);
    };

    pushItemImages(normalizeCatalogItem(this.heroItem || null));
    (this.continueWatchingDisplay || []).slice(0, CW_MAX_VISIBLE_ITEMS).forEach((item) => {
      pushItemImages(normalizeContinueWatchingItem(item));
    });
    this.getVisibleHomeRows(this.rows || []).slice(0, this.getInitialVisibleHomeRowCount()).forEach((row) => {
      (row?.result?.data?.items || []).slice(0, this.getRowItemLimit()).forEach((item) => {
        pushItemImages(normalizeCatalogItem(item, row?.type || "movie"));
      });
    });
    return urls.slice(0, this.isPerformanceConstrained() ? 24 : 60);
  },

  async preloadBootImages(deadlineMs = 0) {
    const budgetMs = Math.min(
      HOME_BOOT_IMAGE_PRELOAD_MAX_MS,
      Math.max(0, remainingBudgetMs(deadlineMs))
    );
    if (budgetMs < HOME_BOOT_IMAGE_PRELOAD_MIN_MS) {
      return;
    }
    const urls = this.collectBootImageUrls();
    if (!urls.length) {
      return;
    }
    await withTimeout(
      Promise.allSettled(urls.map((url) => preloadImageUrl(url))),
      budgetMs,
      null
    );
  },

  getScrollDuration(base) {
    const baseline = Number.isFinite(base) ? base : 150;
    if (this.isLegacyTvRuntime()) {
      return 0;
    }
    if (this.isPerformanceConstrained()) {
      return Math.min(baseline, 90);
    }
    return baseline + 40;
  },

  getBackgroundRenderDelay() {
    const focusedNode = this.container?.querySelector?.(".focusable.focused") || null;
    const sidebarFocused = Boolean(focusedNode && this.isSidebarNode(focusedNode));
    if (this.isLegacyTvRuntime()) {
      return sidebarFocused
        ? HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS + 80
        : HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS;
    }
    if (this.isPerformanceConstrained()) {
      return sidebarFocused
        ? HOME_BACKGROUND_RENDER_DELAY_MS + 80
        : HOME_BACKGROUND_RENDER_DELAY_MS;
    }
    return sidebarFocused ? 40 : 0;
  },

  shouldProgressivelyRenderDeferredRows() {
    return !this.isPerformanceConstrained();
  },

  getDirectionalRepeatThrottleMs() {
    if (this.isLegacyTvRuntime()) {
      return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 120);
    }
    if (this.isPerformanceConstrained()) {
      return Math.max(MODERN_HOME_CONSTANTS.keyRepeatThrottleMs, 100);
    }
    return MODERN_HOME_CONSTANTS.keyRepeatThrottleMs;
  },

  getHeroFocusDelay({ rapid = false } = {}) {
    if (this.isLegacyTvRuntime()) {
      return rapid ? 260 : 150;
    }
    if (this.isPerformanceConstrained()) {
      return rapid ? 220 : 120;
    }
    return rapid ? MODERN_HOME_CONSTANTS.heroRapidSettleMs : MODERN_HOME_CONSTANTS.heroFocusDelayMs;
  },

  cancelScheduledRender() {
    if (this.homeRenderTimer) {
      clearTimeout(this.homeRenderTimer);
      this.homeRenderTimer = null;
    }
    if (this.homeRenderFrame) {
      cancelAnimationFrame(this.homeRenderFrame);
      this.homeRenderFrame = null;
    }
  },

  requestRender(options = {}) {
    if (!this.container || Router.getCurrent() !== "home") {
      return;
    }
    const delayMs = Math.max(0, Number(options?.delayMs || 0));
    if (delayMs > 0) {
      if (this.homeRenderFrame || this.homeRenderTimer) {
        return;
      }
      this.homeRenderTimer = setTimeout(() => {
        this.homeRenderTimer = null;
        this.requestRender();
      }, delayMs);
      return;
    }
    if (this.homeRenderTimer) {
      clearTimeout(this.homeRenderTimer);
      this.homeRenderTimer = null;
    }
    if (this.homeRenderFrame) {
      return;
    }
    this.homeRenderFrame = requestAnimationFrame(() => {
      this.homeRenderFrame = null;
      if (!this.container || Router.getCurrent() !== "home") {
        return;
      }
      this.render();
    });
  },

  requestBackgroundRender() {
    this.requestRender({ delayMs: this.getBackgroundRenderDelay() });
  },

  stopHeroRotation() {
    if (this.heroRotateTimer) {
      clearInterval(this.heroRotateTimer);
      this.heroRotateTimer = null;
    }
    if (this.heroRotateTimeout) {
      clearTimeout(this.heroRotateTimeout);
      this.heroRotateTimeout = null;
    }
  },

  cancelPendingHeroFocus() {
    if (this.heroFocusDelayTimer) {
      clearTimeout(this.heroFocusDelayTimer);
      this.heroFocusDelayTimer = null;
    }
  },

  startHeroRotation() {
    this.stopHeroRotation();
    if (this.layoutMode === "modern" || this.isPerformanceConstrained()) {
      return;
    }
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    this.heroRotateTimeout = setTimeout(() => {
      if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
        this.rotateHero(1);
      }
      this.heroRotateTimer = setInterval(() => {
        if (!this.container?.querySelector(".home-hero-card.focusable.focused")) {
          this.rotateHero(1);
        }
      }, HERO_ROTATE_INTERVAL_MS);
    }, HERO_ROTATE_FIRST_DELAY_MS);
  },

  rotateHero(step = 1) {
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    const total = this.heroCandidates.length;
    this.heroIndex = (Number(this.heroIndex || 0) + step + total) % total;
    this.heroItem = this.heroCandidates[this.heroIndex];
    this.applyHeroToDom();
  },

  applyHeroToDom() {
    const heroNode = this.container?.querySelector(".home-hero-card");
    if (!heroNode) {
      return;
    }
    const hero = this.heroItem || this.heroCandidates?.[0] || null;
    if (!hero) {
      return;
    }

    const display = this.layoutMode === "modern"
      ? buildModernHeroPresentation(hero)
      : buildHeroDisplayModel(hero, this.layoutMode);
    if (!display) {
      return;
    }
    heroNode.dataset.itemId = hero?.id || "";
    heroNode.dataset.itemType = hero?.type || "movie";
    heroNode.dataset.itemTitle = hero?.name || "Untitled";

    const backdrop = heroNode.querySelector(".home-hero-backdrop");
    if (backdrop) {
      const src = display.backdrop || "";
      if (src) {
        backdrop.setAttribute("src", src);
        backdrop.setAttribute("alt", display.title || "featured");
        backdrop.classList.remove("placeholder");
      } else {
        backdrop.removeAttribute("src");
        backdrop.classList.add("placeholder");
      }
    }

    const logoNode = heroNode.querySelector(".home-hero-logo");
    const brandNode = heroNode.querySelector(".home-hero-brand");
    if (display.logo) {
      if (logoNode) {
        logoNode.setAttribute("src", display.logo);
        logoNode.setAttribute("alt", display.title || "logo");
      } else if (brandNode) {
        brandNode.insertAdjacentHTML("afterbegin", `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title || "logo")}" decoding="async" fetchpriority="high" />`);
      }
    } else if (logoNode) {
      logoNode.remove();
    }

    const titleNode = heroNode.querySelector(".home-hero-title-text");
    if (titleNode) {
      titleNode.textContent = display.title || "Untitled";
      titleNode.classList.toggle("is-hidden", Boolean(display.logo));
    }

    if (this.layoutMode === "modern") {
      const primaryNode = heroNode.querySelector(".home-modern-hero-meta-line");
      if (primaryNode) {
        primaryNode.innerHTML = renderModernHeroPrimary(display);
        primaryNode.classList.toggle(
          "is-empty",
          !display.leadingMeta.length && !display.trailingMeta.length && !display.showImdbPrimary
        );
      }

      const secondaryNode = heroNode.querySelector(".home-modern-hero-secondary");
      if (secondaryNode) {
        secondaryNode.innerHTML = renderModernHeroSecondary(display);
        secondaryNode.classList.toggle(
          "is-empty",
          !display.secondaryHighlightText && !display.badges.length && !display.showImdbSecondary && !display.languageText
        );
      }
    } else {
      const primaryNode = heroNode.querySelector(".home-hero-meta-primary");
      if (primaryNode) {
        primaryNode.innerHTML = renderMetaTokens(display.metaPrimary);
        primaryNode.classList.toggle("is-empty", !display.metaPrimary.length);
      }

      const secondaryNode = heroNode.querySelector(".home-hero-meta-secondary");
      if (secondaryNode) {
        secondaryNode.innerHTML = renderMetaTokens(display.metaSecondary);
        secondaryNode.classList.toggle("is-empty", !display.metaSecondary.length);
      }

      const chipNode = heroNode.querySelector(".home-hero-chip-row");
      if (chipNode) {
        chipNode.innerHTML = display.chips.map((chip) => `<span class="home-hero-chip">${escapeHtml(chip)}</span>`).join("");
        chipNode.classList.toggle("is-empty", !display.chips.length);
      }
    }

    const descriptionNode = heroNode.querySelector(".home-hero-description");
    if (descriptionNode) {
      descriptionNode.textContent = display.description || " ";
    }
    this.scheduleHomeTruncationUpdate({ scope: heroNode });

    const indicators = heroNode.querySelector(".home-hero-indicators");
    if (indicators) {
      indicators.innerHTML = buildHeroIndicators(this.heroCandidates, hero);
    }
  },

  setSidebarExpanded(expanded) {
    if (this.layoutPrefs?.modernSidebar) {
      this.sidebarExpanded = Boolean(expanded);
      return;
    }
    setLegacySidebarExpanded(this.container, expanded);
  },

  isSidebarNode(node) {
    return String(node?.dataset?.navZone || "") === "sidebar";
  },

  isMainNode(node) {
    return String(node?.dataset?.navZone || "") === "main";
  },

  getNodeRowKey(node) {
    if (!node) {
      return "";
    }
    if (node.classList?.contains("home-hero-card")) {
      return "__hero__";
    }
    return String(
      node.dataset?.navRowKey
      || node.dataset?.rowKey
      || node.closest?.("[data-row-key]")?.dataset?.rowKey
      || ""
    );
  },

  rememberMainRowFocus(node) {
    if (!this.isMainNode(node)) {
      return;
    }
    const rowKey = this.getNodeRowKey(node);
    if (!rowKey || rowKey === "__hero__") {
      return;
    }
    this.lastFocusedItemIndexByRowKey = {
      ...(this.lastFocusedItemIndexByRowKey || {}),
      [rowKey]: Math.max(0, Number(node.dataset?.navCol || 0))
    };
  },

  resolvePreferredNodeForRow(rowNodes = [], fallbackCol = 0) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowKey = this.getNodeRowKey(rowNodes[0]);
    const storedIndex = rowKey
      ? Number(this.lastFocusedItemIndexByRowKey?.[rowKey])
      : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusWithoutAutoScroll(target, { suppressDelegatedFocus = false } = {}) {
    if (suppressDelegatedFocus && target) {
      this.pendingDelegatedFocusTarget = target;
    }
    focusWithoutAutoScroll(target);
  },

  patchSidebarProfileDom(profile = null) {
    if (!this.container || !profile) {
      return false;
    }
    let updated = false;
    const profileName = String(profile.activeProfileName || t("sidebar.profileFallback")).trim() || t("sidebar.profileFallback");
    const profileInitial = String(profile.activeProfileInitial || "P").trim() || "P";
    const profileColor = String(profile.activeProfileColorHex || DEFAULT_PROFILE_COLOR).trim() || DEFAULT_PROFILE_COLOR;
    const profileAvatarUrl = String(profile.activeProfileAvatarUrl || "").trim();

    this.container.querySelectorAll(".home-profile-name, .modern-sidebar-profile-name").forEach((node) => {
      if (node.textContent !== profileName) {
        node.textContent = profileName;
        updated = true;
      }
    });

    this.container.querySelectorAll(".home-profile-avatar, .modern-sidebar-profile-avatar").forEach((node) => {
      if (node.style.background !== profileColor) {
        node.style.background = profileColor;
        updated = true;
      }
      const existingImage = node.querySelector(".sidebar-profile-avatar-image");
      if (profileAvatarUrl) {
        if (existingImage) {
          if (existingImage.getAttribute("src") !== profileAvatarUrl) {
            existingImage.setAttribute("src", profileAvatarUrl);
            existingImage.setAttribute("alt", profileName);
            updated = true;
          }
        } else {
          node.innerHTML = `<img class="sidebar-profile-avatar-image" src="${escapeAttribute(profileAvatarUrl)}" alt="${escapeAttribute(profileName)}" />`;
          updated = true;
        }
      } else if (existingImage) {
        node.textContent = profileInitial;
        updated = true;
      } else if (node.textContent !== profileInitial) {
        node.textContent = profileInitial;
        updated = true;
      }
    });

    return updated;
  },

  getInitialFocusSelector() {
    if (this.layoutMode === "grid") {
      return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-grid-track .home-content-card.focusable";
    }
    if (this.layoutMode === "classic") {
      return ".home-main .home-hero-card.focusable, .home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
    }
    if (this.layoutMode === "modern") {
      return ".home-main .home-continue-card.focusable, .home-main .home-poster-card.focusable";
    }
    return ".home-main .focusable";
  },

  getNodeHeroSource(node) {
    if (!node) {
      return null;
    }
    if (node.classList.contains("home-hero-card")) {
      return this.heroItem || this.heroCandidates?.[0] || null;
    }
    if (node.dataset.cwIndex != null) {
      return normalizeContinueWatchingItem(this.continueWatchingDisplay?.[Number(node.dataset.cwIndex)] || null);
    }
    if (node.dataset.rowIndex != null && node.dataset.itemIndex != null) {
      const row = this.rows?.[Number(node.dataset.rowIndex)] || null;
      const item = row?.result?.data?.items?.[Number(node.dataset.itemIndex)] || null;
      return normalizeCatalogItem(item, row?.type || "movie");
    }
    return null;
  },

  getContinueWatchingItemFromNode(node) {
    const index = Number(node?.dataset?.cwIndex ?? -1);
    if (!Number.isFinite(index) || index < 0) {
      return null;
    }
    return normalizeContinueWatchingItem(this.continueWatchingDisplay?.[index] || this.continueWatching?.[index] || null);
  },

  getContinueWatchingMenuItem() {
    const menu = this.continueWatchingMenu;
    if (!menu) {
      return null;
    }
    return normalizeContinueWatchingItem(
      this.continueWatchingDisplay?.find((item) => {
        return String(item?.contentId || "") === String(menu.contentId || "")
          && String(item?.videoId || "") === String(menu.videoId || "");
      })
      || menu.item
      || null
    );
  },

  isContinueWatchingItemWatched(item) {
    const contentId = String(item?.contentId || "");
    if (!contentId) {
      return false;
    }
    return Boolean((this.watchedItems || []).some((entry) => String(entry?.contentId || "") === contentId));
  },

  getContinueWatchingMenuOptions() {
    const item = this.getContinueWatchingMenuItem();
    if (!item) {
      return [];
    }
    const watched = this.isContinueWatchingItemWatched(item);
    return [
      { action: "resume", label: t("common.resume", {}, "Resume") },
      { action: "startOver", label: t("common.startOver", {}, "Start Over") },
      { action: "details", label: t("common.viewDetails", {}, "View Details") },
      { action: "toggleWatched", label: watched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched") },
      { action: "remove", label: t("home.removeContinueWatching", {}, "Remove from Continue Watching") }
    ];
  },

  renderContinueWatchingMenu() {
    const item = this.getContinueWatchingMenuItem();
    if (!item) {
      return "";
    }
    const options = this.getContinueWatchingMenuOptions();
    const subtitle = firstNonEmpty(item.episodeCode, item.episodeTitle, item.releaseInfo, toTitleCase(item.type));
    return renderHoldMenuMarkup({
      kicker: t("home.continueWatching", {}, "Continue Watching"),
      title: item.title || "Untitled",
      subtitle,
      focusedIndex: Number(this.continueWatchingMenu?.optionIndex || 0),
      options: options.map((option) => ({
        ...option,
        danger: option.action === "remove"
      }))
    });
  },

  applyContinueWatchingMenuFocus() {
    const buttons = Array.from(this.container?.querySelectorAll(".hold-menu-button.focusable") || []);
    if (!buttons.length) {
      return false;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (!node.classList.contains("hold-menu-button")) {
        node.classList.remove("focused");
      }
    });
    const currentIndex = Math.max(0, Math.min(buttons.length - 1, Number(this.continueWatchingMenu?.optionIndex || 0)));
    buttons.forEach((node, index) => node.classList.toggle("focused", index === currentIndex));
    const target = buttons[currentIndex] || buttons[0] || null;
    if (!target) {
      return false;
    }
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    return true;
  },

  moveContinueWatchingMenuFocus(delta) {
    if (!this.continueWatchingMenu) {
      return false;
    }
    const options = this.getContinueWatchingMenuOptions();
    if (!options.length) {
      return false;
    }
    this.continueWatchingMenu = {
      ...this.continueWatchingMenu,
      optionIndex: Math.max(0, Math.min(options.length - 1, Number(this.continueWatchingMenu.optionIndex || 0) + delta))
    };
    this.applyContinueWatchingMenuFocus();
    return true;
  },

  openContinueWatchingMenu(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.continueWatchingMenu = {
      contentId: item.contentId,
      videoId: item.videoId || "",
      index: Number(node?.dataset?.cwIndex || 0),
      optionIndex: 0,
      item
    };
    this.render();
    return true;
  },

  closeContinueWatchingMenu() {
    if (!this.continueWatchingMenu) {
      return false;
    }
    this.pendingContinueWatchingFocusIndex = Math.max(0, Number(this.continueWatchingMenu.index || 0));
    this.continueWatchingMenu = null;
    this.render();
    return true;
  },

  cancelPendingContinueWatchingEnter() {
    if (this.pendingContinueWatchingEnterTimer) {
      clearTimeout(this.pendingContinueWatchingEnterTimer);
      this.pendingContinueWatchingEnterTimer = null;
    }
    this.pendingContinueWatchingEnterTarget = null;
  },

  isContinueWatchingHoldTarget(node) {
    return Boolean(node?.matches?.(".home-continue-card.focusable"));
  },

  cancelPendingContinueWatchingHold() {
    if (this.pendingContinueWatchingHoldTimer) {
      clearTimeout(this.pendingContinueWatchingHoldTimer);
      this.pendingContinueWatchingHoldTimer = null;
    }
    this.pendingContinueWatchingHoldTarget = null;
  },

  hasPendingContinueWatchingHold(node) {
    const pending = this.pendingContinueWatchingHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.itemId || "") === String(pending.itemId || "")
      && String(node.dataset.videoId || "") === String(pending.videoId || "");
  },

  startPendingContinueWatchingHold(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.cancelPendingContinueWatchingHold();
    this.pendingContinueWatchingHoldTarget = {
      itemId: String(item.contentId || ""),
      videoId: String(item.videoId || ""),
      holdTriggered: false
    };
    this.pendingContinueWatchingHoldTimer = setTimeout(() => {
      this.pendingContinueWatchingHoldTimer = null;
      const pending = this.pendingContinueWatchingHoldTarget;
      if (!pending || Router.getCurrent() !== "home") {
        return;
      }
      const current = this.container?.querySelector(".home-continue-card.focusable.focused") || null;
      if (!this.hasPendingContinueWatchingHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      this.openContinueWatchingMenu(current);
    }, CW_HOLD_DELAY_MS);
    return true;
  },

  completePendingContinueWatchingHold(node) {
    const pending = this.pendingContinueWatchingHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    this.cancelPendingContinueWatchingHold();
    if (holdTriggered) {
      return true;
    }
    if (!this.isContinueWatchingHoldTarget(node)) {
      return false;
    }
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.openContinueWatchingFromItem(item);
    return true;
  },

  scheduleContinueWatchingEnter(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    if (!item?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.pendingContinueWatchingEnterTarget = {
      contentId: item.contentId,
      videoId: String(item.videoId || "")
    };
    this.pendingContinueWatchingEnterTimer = setTimeout(() => {
      this.pendingContinueWatchingEnterTimer = null;
      const pending = this.pendingContinueWatchingEnterTarget;
      this.pendingContinueWatchingEnterTarget = null;
      if (!pending || Router.getCurrent() !== "home") {
        return;
      }
      const current = this.container?.querySelector(".home-continue-card.focusable.focused") || null;
      const focusedItem = this.getContinueWatchingItemFromNode(current);
      if (!focusedItem?.contentId) {
        return;
      }
      if (String(focusedItem.contentId) !== String(pending.contentId)
        || String(focusedItem.videoId || "") !== String(pending.videoId || "")) {
        return;
      }
      this.openContinueWatchingFromItem(focusedItem);
    }, CW_ENTER_DELAY_MS);
    return true;
  },

  openContinueWatchingFromItem(item, options = {}) {
    const params = continueWatchingStreamParams(item, options);
    if (!params) {
      return false;
    }
    const normalized = normalizeContinueWatchingItem(item);
    this.cancelPendingContinueWatchingEnter();
    this.continueWatchingMenu = null;

    Router.navigate("detail", {
      itemId: normalized.contentId,
      itemType: normalized.type || (isSeriesTypeForContinueWatching(normalized?.type) ? "series" : "movie"),
      fallbackTitle: normalized.title || normalized.contentId || "Untitled",
      autoOpenContinueWatching: true,
      returnHomeOnBack: true,
      resumeProgressMs: Number(params.resumePositionMs || 0) || 0,
      resumeVideoId: normalized.videoId || null,
      resumeSeason: normalized.season ?? null,
      resumeEpisode: normalized.episode ?? null
    });
    return true;
  },

  openContinueWatchingDetails(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    this.cancelPendingContinueWatchingEnter();
    this.continueWatchingMenu = null;
    Router.navigate("detail", {
      itemId: normalized.contentId,
      itemType: normalized.type || "movie",
      fallbackTitle: normalized.title || normalized.contentId || "Untitled"
    });
    return true;
  },

  pruneContinueWatchingItem(item) {
    const normalized = normalizeContinueWatchingItem(item);
    const contentId = String(normalized?.contentId || "");
    const videoId = String(normalized?.videoId || "");
    const nextUpKey = normalized?.isNextUp
      ? nextUpDismissKey(contentId, normalized.seedSeason ?? normalized.season, normalized.seedEpisode ?? normalized.episode)
      : "";
    if (!contentId) {
      return;
    }
    const matchesItem = (entry) => {
      if (String(entry?.contentId || "") !== contentId) {
        return false;
      }
      if (nextUpKey) {
        const entryKey = nextUpDismissKey(
          entry?.contentId,
          entry?.seedSeason ?? entry?.season,
          entry?.seedEpisode ?? entry?.episode
        );
        return entryKey === nextUpKey;
      }
      if (!videoId) {
        return true;
      }
      const entryVideoId = String(entry?.videoId || "");
      return !entryVideoId || entryVideoId === videoId;
    };
    this.allProgress = Array.isArray(this.allProgress) ? this.allProgress.filter((entry) => !matchesItem(entry)) : [];
    this.continueWatching = Array.isArray(this.continueWatching) ? this.continueWatching.filter((entry) => !matchesItem(entry)) : [];
    this.continueWatchingDisplay = Array.isArray(this.continueWatchingDisplay)
      ? this.continueWatchingDisplay.filter((entry) => !matchesItem(entry))
      : [];
    this.nextUpProgressCandidates = Array.isArray(this.nextUpProgressCandidates)
      ? this.nextUpProgressCandidates.filter((entry) => !matchesItem(entry))
      : [];
    this.continueWatchingLoading = false;
    if (this.layoutMode === "modern") {
      this.heroItem = this.pickInitialHero();
    }
  },

  async toggleContinueWatchingWatched(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    if (this.isContinueWatchingItemWatched(normalized)) {
      await watchedItemsRepository.unmark(normalized.contentId);
      this.watchedItems = Array.isArray(this.watchedItems)
        ? this.watchedItems.filter((entry) => String(entry?.contentId || "") !== String(normalized.contentId))
        : [];
      return true;
    }
    await watchedItemsRepository.mark({
      contentId: normalized.contentId,
      contentType: normalized.type || "movie",
      title: normalized.title || normalized.contentId || "Untitled",
      watchedAt: Date.now()
    });
    await watchProgressRepository.saveProgress({
      contentId: normalized.contentId,
      contentType: normalized.type || "movie",
      videoId: normalized.videoId || null,
      season: normalized.season,
      episode: normalized.episode,
      positionMs: 100,
      durationMs: 100,
      updatedAt: Date.now()
    });
    this.watchedItems = [
      {
        contentId: normalized.contentId,
        contentType: normalized.type || "movie",
        title: normalized.title || normalized.contentId || "Untitled",
        watchedAt: Date.now()
      },
      ...(Array.isArray(this.watchedItems) ? this.watchedItems.filter((entry) => String(entry?.contentId || "") !== String(normalized.contentId)) : [])
    ];
    this.pruneContinueWatchingItem(normalized);
    return true;
  },

  async removeContinueWatchingItem(item) {
    const normalized = normalizeContinueWatchingItem(item);
    if (!normalized?.contentId) {
      return false;
    }
    if (normalized.isNextUp) {
      const seedSeason = normalized.seedSeason ?? normalized.season ?? null;
      const seedEpisode = normalized.seedEpisode ?? normalized.episode ?? null;
      const dismissKey = nextUpDismissKey(normalized.contentId, seedSeason, seedEpisode);
      ContinueWatchingPreferences.addDismissedNextUpKey(dismissKey);
      this.dismissedNextUpKeys = ContinueWatchingPreferences.getDismissedNextUpKeys();
      this.pruneContinueWatchingItem(normalized);
      return true;
    }
    await watchProgressRepository.removeProgress(normalized.contentId, normalized.videoId || null);
    this.pruneContinueWatchingItem(normalized);
    return true;
  },

  async activateContinueWatchingMenuOption() {
    const item = this.getContinueWatchingMenuItem();
    const options = this.getContinueWatchingMenuOptions();
    const option = options[Math.max(0, Math.min(options.length - 1, Number(this.continueWatchingMenu?.optionIndex || 0)))];
    if (!item || !option) {
      return false;
    }
    const anchorIndex = Math.max(0, Number(this.continueWatchingMenu?.index || 0));
    if (option.action === "resume") {
      return this.openContinueWatchingFromItem(item);
    }
    if (option.action === "startOver") {
      return this.openContinueWatchingFromItem(item, { startOver: true });
    }
    if (option.action === "details") {
      return this.openContinueWatchingDetails(item);
    }
    if (option.action === "toggleWatched") {
      await this.toggleContinueWatchingWatched(item);
    } else if (option.action === "remove") {
      await this.removeContinueWatchingItem(item);
    } else {
      return false;
    }
    this.continueWatchingMenu = null;
    this.pendingContinueWatchingFocusIndex = anchorIndex;
    this.render();
    return true;
  },

  openContinueWatchingFromNode(node) {
    const item = this.getContinueWatchingItemFromNode(node);
    this.openContinueWatchingFromItem(item);
  },

  scheduleModernHeroUpdate(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    const hero = this.getNodeHeroSource(node);
    if (!hero || !hero.id) {
      return;
    }
    this.cancelPendingHeroFocus();
    const now = Date.now();
    const previous = Number(this.lastModernHeroNavAt || 0);
    const isRapidNav = previous > 0 && (now - previous) < MODERN_HOME_CONSTANTS.heroRapidNavThresholdMs;
    const delay = this.getHeroFocusDelay({ rapid: isRapidNav });
    this.lastModernHeroNavAt = now;
    this.heroFocusDelayTimer = setTimeout(() => {
      this.heroItem = hero;
      const matchedIndex = this.heroCandidates.findIndex((item) => String(item?.id || "") === String(hero.id || ""));
      if (matchedIndex >= 0) {
        this.heroIndex = matchedIndex;
      }
      this.applyHeroToDom();
    }, delay);
  },

  isModernPosterNode(node) {
    return this.layoutMode === "modern" && Boolean(node?.classList?.contains("home-poster-card"));
  },

  hydrateFocusedPosterAssets(node, { defer = false } = {}) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
    const hydrate = () => {
      const backdrop = node.querySelector(".home-poster-expanded-backdrop");
      if (backdrop?.tagName === "IMG") {
        const src = String(backdrop.dataset.src || backdrop.getAttribute("src") || "").trim();
        const markBackdropReady = () => {
          if (node.isConnected) {
            node.classList.add("is-expanded-backdrop-ready");
          }
          backdrop.dataset.loadState = "ready";
        };
        const markBackdropPending = () => {
          node.classList.remove("is-expanded-backdrop-ready");
          backdrop.dataset.loadState = src ? "pending" : "";
        };
        if (src && !backdrop.getAttribute("src")) {
          backdrop.setAttribute("src", src);
        }
        if (backdrop.complete && Number(backdrop.naturalWidth || 0) > 0) {
          markBackdropReady();
        } else if (src) {
          markBackdropPending();
          if (backdrop.dataset.loadBound !== "true") {
            backdrop.dataset.loadBound = "true";
            backdrop.addEventListener("load", () => {
              markBackdropReady();
            }, { once: true });
            backdrop.addEventListener("error", () => {
              if (node.isConnected) {
                node.classList.remove("is-expanded-backdrop-ready");
              }
              backdrop.dataset.loadState = "error";
              backdrop.dataset.loadBound = "false";
            }, { once: true });
          }
        } else {
          markBackdropPending();
        }
        backdrop.removeAttribute("data-src");
      } else {
        node.classList.remove("is-expanded-backdrop-ready");
      }
      const logo = node.querySelector(".home-poster-expanded-logo[data-src]");
      if (logo) {
        const src = String(logo.dataset.src || "").trim();
        if (src && !logo.getAttribute("src")) {
          logo.setAttribute("src", src);
        }
        logo.removeAttribute("data-src");
      }
    };
    if (!defer) {
      hydrate();
      return;
    }
    const run = () => {
      if (!node.isConnected || !node.classList.contains("is-expanded")) {
        return;
      }
      hydrate();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 400 });
    } else {
      setTimeout(run, 0);
    }
  },

  promotePosterCardAssets(node, { includeNeighbors = false } = {}) {
    const promoteCard = (card, isPrimary = false) => {
      if (!this.isModernPosterNode(card)) {
        return;
      }
      const poster = card.querySelector(".content-poster");
      if (poster instanceof HTMLImageElement) {
        poster.loading = "eager";
        poster.decoding = "async";
        if (isPrimary) {
          try {
            poster.fetchPriority = "high";
          } catch (_) {
          }
        }
      }
      if (isPrimary) {
        this.hydrateFocusedPosterAssets(card);
      }
    };

    promoteCard(node, true);
    if (!includeNeighbors) {
      return;
    }
    const siblings = Array.from(node?.closest(".home-track")?.querySelectorAll(".home-poster-card") || []);
    const index = siblings.indexOf(node);
    [siblings[index - 1], siblings[index + 1]].forEach((sibling) => {
      if (sibling) {
        promoteCard(sibling, false);
      }
    });
  },

  clearTrailerLayer(container) {
    if (!container) {
      return;
    }
    const activeFrame = container.querySelector("iframe");
    if (activeFrame) {
      try {
        activeFrame.src = "about:blank";
      } catch (_) {
      }
      try {
        activeFrame.removeAttribute("src");
      } catch (_) {
      }
    }
    const activeVideo = container.querySelector("video");
    if (activeVideo) {
      try {
        activeVideo.pause();
        activeVideo.removeAttribute("src");
        activeVideo.load?.();
      } catch (_) {
      }
    }
    container.innerHTML = "";
    container.classList.remove("is-active");
  },

  restorePersistentHeroTrailer(node, options = {}) {
    if (!this.isModernPosterNode(node)) {
      return false;
    }
    const shouldExpand = Boolean(options?.shouldExpand);
    const shouldPreviewTrailer = Boolean(options?.shouldPreviewTrailer);
    const trailerTarget = String(options?.trailerTarget || "hero_media").toLowerCase();
    const flowKey = String(options?.flowKey || this.getFocusedPosterFlowKey(node) || "");
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer || trailerTarget !== "hero_media" || !flowKey) {
      return false;
    }
    const cachedState = this.heroTrailerPlaybackState;
    if (!cachedState?.source || String(cachedState.key || "") !== flowKey) {
      return false;
    }
    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    if (!heroLayer || !heroMedia) {
      return false;
    }
    heroMedia.classList.add("trailer-active");
    this.mountTrailerLayer(heroLayer, cachedState.source, () => {
      if (
        node.classList.contains("focused")
        && String(this.getFocusedPosterFlowKey(node) || "") === flowKey
      ) {
        heroMedia.classList.add("trailer-active");
      }
    });
    return true;
  },

  mountTrailerLayer(container, source, onReady = null) {
    if (!container || !source) {
      return;
    }
    this.clearTrailerLayer(container);
    if (source.kind === "youtube" && source.embedUrl) {
      suppressBackgroundTrailerMediaControls();
      const frame = document.createElement("iframe");
      frame.className = "home-inline-trailer-frame";
      frame.src = source.embedUrl;
      frame.title = "Trailer preview";
      frame.allow = "autoplay; encrypted-media";
      frame.allowFullscreen = false;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
      frame.addEventListener("load", () => {
        suppressBackgroundTrailerMediaControls();
        setTimeout(() => {
          if (!frame.isConnected || !container.contains(frame)) {
            return;
          }
          suppressBackgroundTrailerMediaControls();
          postBackgroundTrailerCommand(frame, "seekTo", { seconds: 0 });
          postBackgroundTrailerCommand(frame, "play");
          container.classList.add("is-active");
          onReady?.();
        }, YOUTUBE_TRAILER_REVEAL_DELAY_MS);
      }, { once: true });
      container.appendChild(frame);
      return;
    }
    if (source.kind === "video" && source.url) {
      const shouldMute = source.muted !== false;
      container.innerHTML = `
        <video class="home-inline-trailer-video" autoplay loop playsinline>
          <source src="${escapeAttribute(source.url)}" />
        </video>
      `;
      const video = container.querySelector("video");
      if (video) {
        suppressBackgroundTrailerMediaControls(video);
        video.muted = shouldMute;
        video.defaultMuted = shouldMute;
        try {
          video.volume = shouldMute ? 0 : 1;
        } catch (_) {
        }
        const activate = () => {
          suppressBackgroundTrailerMediaControls(video);
          container.classList.add("is-active");
          onReady?.();
        };
        video.addEventListener("loadeddata", activate, { once: true });
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => { });
        }
        suppressBackgroundTrailerMediaControls(video);
      } else {
        container.classList.add("is-active");
        onReady?.();
      }
    }
  },

  collapseFocusedPoster(node = this.expandedPosterNode, options = {}) {
    const instant = Boolean(options?.instant);
    const excludeNode = options?.excludeNode instanceof HTMLElement ? options.excludeNode : null;
    const targets = new Set();
    if (node instanceof HTMLElement && node !== excludeNode) {
      targets.add(node);
    }
    Array.from(this.container?.querySelectorAll(".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active") || [])
      .forEach((card) => {
        if (card !== excludeNode) {
          targets.add(card);
        }
      });
    targets.forEach((target) => {
      const frame = target?.querySelector?.(".home-poster-frame") || null;
      const previousCardTransition = instant && target instanceof HTMLElement ? target.style.transition : "";
      const previousFrameTransition = instant && frame instanceof HTMLElement ? frame.style.transition : "";
      if (instant && target instanceof HTMLElement) {
        target.style.transition = "none";
      }
      if (instant && frame instanceof HTMLElement) {
        frame.style.transition = "none";
      }
      target.closest(".home-track")?.classList.remove("has-expanded-landscape");
      target.classList.remove("is-expanded", "is-trailer-active", "is-expanded-backdrop-ready");
      this.clearTrailerLayer(target.querySelector(".home-poster-trailer-layer"));
      if (instant && target instanceof HTMLElement) {
        void target.offsetWidth;
        requestAnimationFrame(() => {
          if (target.isConnected) {
            target.style.transition = previousCardTransition;
          }
          if (frame instanceof HTMLElement && frame.isConnected) {
            frame.style.transition = previousFrameTransition;
          }
        });
      }
    });
    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    this.clearTrailerLayer(heroLayer);
    this.container?.querySelector(".home-modern-hero-media")?.classList.remove("trailer-active");
    this.heroTrailerPlaybackState = null;
    if (!this.expandedPosterNode?.isConnected || !this.expandedPosterNode?.classList?.contains("is-expanded")) {
      this.expandedPosterNode = null;
    }
  },

  expandFocusedPoster(node) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
    const hasOtherExpandedPosters = Array.from(
      this.container?.querySelectorAll(".home-main .home-poster-card.is-expanded, .home-main .home-poster-card.is-trailer-active") || []
    ).some((card) => card !== node);
    if ((this.expandedPosterNode && this.expandedPosterNode !== node) || hasOtherExpandedPosters) {
      this.collapseFocusedPoster(this.expandedPosterNode, { excludeNode: node });
    }
    if (node.classList.contains("is-landscape")) {
      node.closest(".home-track")?.classList.add("has-expanded-landscape");
    }
    node.classList.add("is-expanded");
    this.hydrateFocusedPosterAssets(node);
    this.expandedPosterNode = node;
    requestAnimationFrame(() => {
      if (node.classList.contains("focused")) {
        this.ensureTrackHorizontalVisibility(node);
      }
    });
  },

  async getTrailerSourceForItem(item) {
    const itemId = String(item?.id || item?.contentId || "").trim();
    const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
    if (!itemId) {
      return null;
    }
    try {
      const inlineSource = await withTimeout(
        resolveTrailerMetaWithTmdbFallback(
          { ...(item || {}), id: itemId, type: itemType },
          itemType
        ),
        2200,
        null
      );
      if (inlineSource) {
        return inlineSource;
      }

      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(itemType, itemId),
        3200,
        { status: "error", message: "timeout" }
      );
      const source = result?.status === "success"
        ? await resolveTrailerMetaWithTmdbFallback(
          { ...(result?.data || {}), id: itemId, type: itemType },
          itemType
        )
        : null;
      return source || null;
    } catch (error) {
      console.warn("Home trailer preview lookup failed", error);
      return null;
    }
  },

  async activateFocusedPosterFlow(node, flowToken = Number(this.focusedPosterFlowToken || 0)) {
    if (!this.isModernPosterNode(node) || !node.classList.contains("focused")) {
      return;
    }
    const prefs = this.layoutPrefs || {};
    const shouldExpand = Boolean(prefs.focusedPosterBackdropExpandEnabled || prefs.modernLandscapePostersEnabled);
    const shouldPreviewTrailer = Boolean(prefs.focusedPosterBackdropTrailerEnabled) && !this.shouldSuppressAutomaticTrailerPlayback();
    const trailerTarget = String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase();
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer) {
      return;
    }
    const trailerDelayMs = this.getFocusedPosterTrailerDelayMs();
    if (trailerDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, trailerDelayMs);
      });
      if (
        Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)
        || !node.classList.contains("focused")
      ) {
        return;
      }
    }

    const sourceItem = this.getNodeHeroSource(node);
    const baseSource = await this.getTrailerSourceForItem(sourceItem);
    if (Number(this.focusedPosterFlowToken || 0) !== Number(flowToken || 0)) {
      return;
    }
    const source = applyTrailerAudioPreferences(baseSource, prefs);
    if (!source || !node.classList.contains("focused")) {
      return;
    }
    const flowKey = this.getFocusedPosterFlowKey(node);

    if (trailerTarget === "expanded_card" && shouldExpand) {
      this.heroTrailerPlaybackState = null;
      const trailerLayer = node.querySelector(".home-poster-trailer-layer");
      if (trailerLayer) {
        this.mountTrailerLayer(trailerLayer, source, () => {
          if (node.classList.contains("focused") && Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)) {
            node.classList.add("is-trailer-active");
          }
        });
      }
      return;
    }

    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    if (heroLayer && heroMedia) {
      this.heroTrailerPlaybackState = {
        key: flowKey,
        source
      };
      this.mountTrailerLayer(heroLayer, source, () => {
        if (node.classList.contains("focused") && Number(this.focusedPosterFlowToken || 0) === Number(flowToken || 0)) {
          heroMedia.classList.add("trailer-active");
        }
      });
    }
  },

  cancelFocusedPosterFlow() {
    if (this.focusedPosterTimer) {
      clearTimeout(this.focusedPosterTimer);
      this.focusedPosterTimer = null;
    }
    this.focusedPosterFlowToken = Number(this.focusedPosterFlowToken || 0) + 1;
  },

  clearFocusedPosterFlowState() {
    this.focusedPosterFlowState = null;
  },

  getFocusedPosterFlowKey(node) {
    const itemId = String(
      node?.dataset?.itemId
      || node?.dataset?.contentId
      || this.getNodeHeroSource(node)?.id
      || ""
    ).trim();
    const itemType = String(
      node?.dataset?.itemType
      || this.getNodeHeroSource(node)?.type
      || ""
    ).trim().toLowerCase();
    if (!itemId) {
      return "";
    }
    return `${itemType}:${itemId}`;
  },

  scheduleHomeTruncationUpdate({ scope = null } = {}) {
    if (!this.container) {
      return;
    }
    if (this.isPerformanceConstrained()) {
      this.homeTruncationScope = null;
      if (this.homeTruncationFrame) {
        cancelAnimationFrame(this.homeTruncationFrame);
        this.homeTruncationFrame = null;
      }
      return;
    }
    this.homeTruncationScope = scope || null;
    if (this.homeTruncationFrame) {
      cancelAnimationFrame(this.homeTruncationFrame);
    }
    this.homeTruncationFrame = requestAnimationFrame(() => {
      this.homeTruncationFrame = null;
      this.applyHomeTruncationState();
    });
  },

  applyHomeTruncationState() {
    if (!this.container || this.isPerformanceConstrained()) {
      return;
    }
    const modernHeroDescriptionWordLimit = 40;
    const root = this.homeTruncationScope || this.container;
    this.homeTruncationScope = null;
    this.applyModernHeroDescriptionBounds(root);
    const nodes = root.querySelectorAll(
      ".home-hero-description, .home-poster-title, .home-poster-subtitle, .home-poster-expanded-meta, .home-poster-expanded-description"
    );
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const currentText = node.textContent ?? "";
      const storedText = node.dataset.fullText || "";
      const shouldRefresh = !storedText || (currentText && currentText !== storedText && !currentText.trim().endsWith("..."));
      const sourceText = shouldRefresh ? currentText : storedText;
      const isModernHeroDescription = node.classList.contains("home-hero-description")
        && Boolean(node.closest(".home-modern-hero-copy"));
      const { text: fullText, truncated: wordTrimmed } = isModernHeroDescription
        ? limitTextToWordCount(sourceText, modernHeroDescriptionWordLimit)
        : { text: sourceText, truncated: false };
      if (!fullText) {
        return;
      }
      node.dataset.fullText = fullText;
      node.textContent = wordTrimmed ? `${fullText}...` : fullText;
      const fits = node.scrollWidth <= (node.clientWidth + 1)
        && node.scrollHeight <= (node.clientHeight + 1);
      if (fits) {
        node.classList.toggle("is-truncated", wordTrimmed);
        return;
      }

      const ellipsis = "...";
      let low = 0;
      let high = fullText.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        node.textContent = `${fullText.slice(0, mid).trimEnd()}${ellipsis}`;
        const overflows = node.scrollWidth > (node.clientWidth + 1)
          || node.scrollHeight > (node.clientHeight + 1);
        if (overflows) {
          high = mid - 1;
        } else {
          low = mid;
        }
      }
      const finalText = `${fullText.slice(0, Math.max(0, low)).trimEnd()}${ellipsis}`;
      node.textContent = finalText;
      node.classList.add("is-truncated");
    });
  },

  applyModernHeroDescriptionBounds(root = null) {
    if (!this.container || this.layoutMode !== "modern") {
      return;
    }
    const modernHeroDescriptionMaxLines = 5;
    const scope = root instanceof HTMLElement ? root : this.container;
    const heroNodes = scope.classList?.contains("home-hero-card")
      ? [scope]
      : Array.from(scope.querySelectorAll(".home-hero-card"));
    heroNodes.forEach((heroNode) => {
      const copy = heroNode.querySelector(".home-modern-hero-copy");
      const description = heroNode.querySelector(".home-hero-description");
      if (!(copy instanceof HTMLElement) || !(description instanceof HTMLElement)) {
        return;
      }

      description.style.maxHeight = "";
      if (description.classList.contains("is-empty")) {
        return;
      }

      const visibleSiblings = Array.from(copy.children).filter((node) => {
        if (!(node instanceof HTMLElement) || node === description) {
          return false;
        }
        return node.offsetHeight > 0 || node.offsetWidth > 0;
      });
      const gapValue = parseFloat(getComputedStyle(copy).rowGap || getComputedStyle(copy).gap || "0") || 0;
      const reservedHeight = visibleSiblings.reduce((total, node) => total + node.offsetHeight, 0);
      const visibleCount = visibleSiblings.length + 1;
      const gapCount = Math.max(0, visibleCount - 1);
      const availableHeight = Math.floor(copy.clientHeight - reservedHeight - (gapCount * gapValue));
      const lineHeight = parseFloat(getComputedStyle(description).lineHeight || "0") || 0;
      if (availableHeight <= 0) {
        description.style.maxHeight = lineHeight > 0 ? `${lineHeight}px` : "0px";
        return;
      }
      const maxDescriptionHeight = lineHeight > 0
        ? (lineHeight * modernHeroDescriptionMaxLines)
        : availableHeight;
      const constrainedHeight = Math.min(availableHeight, maxDescriptionHeight);
      description.style.maxHeight = `${Math.max(lineHeight, constrainedHeight)}px`;
    });
  },

  ensureHomeTruncationObservers() {
    if (this.homeTruncationObserversBound || this.isPerformanceConstrained()) {
      return;
    }
    this.homeTruncationObserversBound = true;
    if (globalThis?.document?.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.scheduleHomeTruncationUpdate();
      }).catch(() => { });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => {
        this.scheduleHomeTruncationUpdate();
      });
    }
  },

  scheduleFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
    const prefs = this.layoutPrefs || {};
    const shouldExpand = Boolean(prefs.focusedPosterBackdropExpandEnabled || prefs.modernLandscapePostersEnabled);
    const shouldPreviewTrailer = Boolean(prefs.focusedPosterBackdropTrailerEnabled)
      && !this.shouldSuppressAutomaticTrailerPlayback();
    const trailerTarget = String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase();
    const shouldRun = Boolean(shouldExpand || shouldPreviewTrailer);
    if (!shouldRun) {
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
      return;
    }
    if (!this.isModernPosterNode(node)) {
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
      return;
    }
    if (this.expandedPosterNode && this.expandedPosterNode !== node) {
      this.collapseFocusedPoster(this.expandedPosterNode);
    }
    const flowKey = this.getFocusedPosterFlowKey(node);
    if (this.focusedPosterFlowState?.key && this.focusedPosterFlowState.key !== flowKey) {
      this.collapseFocusedPoster();
    }
    this.promotePosterCardAssets(node, { includeNeighbors: false });
    const defaultDelayMs = this.isPerformanceConstrained()
      ? 0
      : Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
    const existingState = this.focusedPosterFlowState;
    const canReuseExistingState = Boolean(flowKey && existingState?.key === flowKey);
    const now = Date.now();
    const delayMs = canReuseExistingState
      ? Math.max(0, Number(existingState.activated ? 0 : ((existingState.activateAt || now) - now)))
      : defaultDelayMs;
    const flowToken = Number(this.focusedPosterFlowToken || 0) + 1;
    this.focusedPosterFlowToken = flowToken;
    this.focusedPosterFlowState = {
      key: flowKey,
      activateAt: now + delayMs,
      activated: Boolean(canReuseExistingState && existingState.activated),
      token: flowToken
    };
    if (
      canReuseExistingState
      && existingState.activated
      && this.restorePersistentHeroTrailer(node, {
        shouldExpand,
        shouldPreviewTrailer,
        trailerTarget,
        flowKey
      })
    ) {
      return;
    }
    this.focusedPosterTimer = setTimeout(() => {
      if (this.focusedPosterFlowState?.key === flowKey && this.focusedPosterFlowState?.token === flowToken) {
        this.focusedPosterFlowState = {
          key: flowKey,
          activateAt: Date.now(),
          activated: true,
          token: flowToken
        };
      }
      this.activateFocusedPosterFlow(node, flowToken).catch((error) => {
        console.warn("Focused poster flow failed", error);
      });
    }, delayMs);
  },

  resetFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
    this.clearFocusedPosterFlowState();
    if (this.isModernPosterNode(node)) {
      this.collapseFocusedPoster(node);
      this.scheduleFocusedPosterFlow(node);
      return;
    }
    this.collapseFocusedPoster();
  },

  openSidebar() {
    if (this.layoutPrefs?.modernSidebar) {
      if (this.sidebarExpanded) {
        return true;
      }
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
      const target = getModernSidebarSelectedNode(this.container);
      const current = this.container?.querySelector(".focusable.focused") || null;
      return this.focusNode(current, target) || true;
    }
    const target = getLegacySidebarSelectedNode(this.container);
    if (target) {
      this.container?.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      this.focusWithoutAutoScroll(target);
      this.setSidebarExpanded(true);
      return true;
    }
    return false;
  },

  closeSidebarToContent() {
    if (this.layoutPrefs?.modernSidebar) {
      if (!this.sidebarExpanded) {
        return false;
      }
      const target = (this.lastMainFocus && this.isMainNode(this.lastMainFocus))
        ? this.lastMainFocus
        : (this.navModel?.rows?.[0]?.[0] || null);
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
      const current = this.container?.querySelector(".focusable.focused") || null;
      return this.focusNode(current, target, "right") || true;
    }
    const current = this.container?.querySelector(".home-sidebar .focusable.focused");
    const target = (this.lastMainFocus && this.isMainNode(this.lastMainFocus))
      ? this.lastMainFocus
      : (this.navModel?.rows?.[0]?.[0] || null);
    return this.focusNode(current, target, "right") || true;
  },

  getMainFocusAnchor(node) {
    if (!node) {
      return null;
    }
    return node.closest(".home-row, .home-grid-section")
      || node.closest(".home-hero")
      || node;
  },

  getTrackViewportMetrics(track) {
    let leftPadding = this.getTrackEdgePadding();
    let rightPadding = leftPadding;
    const cachedLeft = Number.parseFloat(track?.dataset?.trackPadLeft || "");
    const cachedRight = Number.parseFloat(track?.dataset?.trackPadRight || "");
    if (Number.isFinite(cachedLeft) && cachedLeft >= 0) {
      leftPadding = cachedLeft;
    }
    if (Number.isFinite(cachedRight) && cachedRight >= 0) {
      rightPadding = cachedRight;
    }
    if ((!Number.isFinite(cachedLeft) || !Number.isFinite(cachedRight)) && typeof window !== "undefined" && window.getComputedStyle) {
      const computed = window.getComputedStyle(track);
      const paddingLeft = Number.parseFloat(computed?.paddingLeft || "");
      const paddingRight = Number.parseFloat(computed?.paddingRight || "");
      if (Number.isFinite(paddingLeft) && paddingLeft >= 0) {
        leftPadding = paddingLeft;
        track.dataset.trackPadLeft = String(paddingLeft);
      }
      if (Number.isFinite(paddingRight) && paddingRight >= 0) {
        rightPadding = paddingRight;
        track.dataset.trackPadRight = String(paddingRight);
      }
    }
    const safeRightPadding = Math.min(rightPadding, Math.max(24, leftPadding));
    const visibleLeft = track.scrollLeft + leftPadding;
    const visibleRight = track.scrollLeft + track.clientWidth - safeRightPadding;
    return {
      leftPadding,
      safeRightPadding,
      visibleLeft,
      visibleRight,
      visibleCenter: visibleLeft + Math.max(0, (visibleRight - visibleLeft) / 2)
    };
  },

  getExpandedPosterScrollAdjustments(current, target, direction = null) {
    const expanded = this.layoutMode === "modern" ? this.expandedPosterNode : null;
    if (!expanded || expanded !== current || expanded === target || !expanded.classList.contains("is-expanded")) {
      return { horizontal: 0, vertical: 0 };
    }
    const targetShell = this.container?.querySelector(".home-screen-shell");
    if (!(targetShell instanceof HTMLElement)) {
      return { horizontal: 0, vertical: 0 };
    }
    const shellStyles = getComputedStyle(targetShell);
    const expandedFrame = expanded.querySelector(".home-poster-frame");
    const isLandscape = expanded.classList.contains("is-landscape");
    const collapsedHeight = isLandscape
      ? parseCssPx(shellStyles.getPropertyValue("--home-landscape-poster-height"), expandedFrame?.offsetHeight || 0)
      : parseCssPx(shellStyles.getPropertyValue("--home-modern-portrait-poster-height"), expandedFrame?.offsetHeight || 0);

    const vertical = direction === "down" && isLandscape
      ? Math.max(0, Number(expandedFrame?.offsetHeight || 0) - collapsedHeight)
      : 0;

    return { horizontal: 0, vertical };
  },

  getModernVerticalScrollOffset(main) {
    return Math.max(
      10,
      Math.min(
        18,
        Math.round(Number(main?.clientHeight || 0) * 0.025)
      )
    );
  },

  getModernTrackAlignedScrollTarget(target, layoutAdjustment = 0) {
    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return null;
    }
    const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
    const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
    const trackRect = track.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetLeft = ((targetRect.left - trackRect.left) + Number(track.scrollLeft || 0)) - Number(layoutAdjustment || 0);
    const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
    return {
      container: track,
      value: Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad))
    };
  },

  getModernMainAlignedScrollTarget(target, direction = null, current = null, layoutAdjustment = 0) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (!main || !target || !this.container?.contains(target)) {
      return null;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
    const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
    const currentAnchor = this.getMainFocusAnchor(current);
    const sameAnchor = Boolean(currentAnchor && currentAnchor === anchor);
    const isHorizontalMove = direction === "left" || direction === "right";
    const isVerticalMove = direction === "up" || direction === "down";

    if (isHorizontalMove && sameAnchor) {
      return null;
    }

    let nextValue = null;
    if (isVerticalMove) {
      nextValue = anchorTop - inset + this.getModernVerticalScrollOffset(main);
    } else if (adjustedTop < visibleTop) {
      nextValue = anchorTop - inset;
    } else if (adjustedBottom > visibleBottom) {
      nextValue = anchorBottom - main.clientHeight + 24;
    } else {
      nextValue = anchorTop - Math.max(0, (main.clientHeight - anchor.offsetHeight) / 2);
    }

    const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
    return {
      container: main,
      value: Math.max(0, Math.min(maxScrollTop, nextValue))
    };
  },

  getModernMainSafetyScrollTarget(target, layoutAdjustment = 0) {
    const main = this.container?.querySelector(".home-modern-rows-viewport");
    if (!main || !target || !this.container?.contains(target)) {
      return null;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const adjustedTop = mainRect.top + anchorTop - main.scrollTop;
    const adjustedBottom = mainRect.top + anchorBottom - main.scrollTop;
    const minVisible = Math.max(
      32,
      Math.min(
        72,
        Math.round(Number(anchor.offsetHeight || 0) * 0.22)
      )
    );
    let nextValue = null;
    if (adjustedBottom <= visibleTop + minVisible) {
      nextValue = anchorBottom - inset - minVisible;
    } else if (adjustedTop >= visibleBottom - minVisible) {
      nextValue = anchorTop - main.clientHeight + 24 + minVisible;
    }
    if (!Number.isFinite(nextValue)) {
      return null;
    }
    const maxScrollTop = Math.max(0, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
    return {
      container: main,
      value: Math.max(0, Math.min(maxScrollTop, nextValue))
    };
  },

  applyModernCameraFollowTargets(horizontal = null, vertical = null) {
    const easing = this.getModernCameraPanEasing();
    if (horizontal?.container?.isConnected) {
      if (Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1) {
        this.animateScroll(
          horizontal.container,
          "x",
          horizontal.value,
          MODERN_HOME_CONSTANTS.cameraFollowDurationXMs,
          { easing }
        );
      }
      this.modernCameraFollowLastHorizontalContainer = horizontal.container;
    }
    if (vertical?.container?.isConnected) {
      if (Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1) {
        this.animateScroll(
          vertical.container,
          "y",
          vertical.value,
          MODERN_HOME_CONSTANTS.cameraFollowDurationYMs,
          { easing }
        );
      }
      this.modernCameraFollowLastVerticalContainer = vertical.container;
    }
  },

  flushModernCameraFollow() {
    const state = this.modernCameraFollowState || null;
    this.modernCameraFollowTimer = null;
    this.modernCameraFollowState = null;
    if (!state || Router.getCurrent() !== "home" || this.layoutMode !== "modern") {
      return;
    }
    this.applyModernCameraFollowTargets(state.horizontal, state.vertical);
  },

  scheduleModernCameraFollow(target, direction = null, current = null, layoutAdjustment = {}, inputMeta = {}) {
    if (!this.shouldUseDelayedModernCameraFollow(target, direction)) {
      return false;
    }
    this.cancelModernCameraFollow({ stopAnimations: true });
    const isVerticalMove = direction === "up" || direction === "down";
    const shouldFollowVerticalHoldImmediately = isVerticalMove && Boolean(inputMeta?.repeat);
    const horizontalAdjustment = Number(layoutAdjustment?.horizontal || 0);
    const verticalAdjustment = Number(layoutAdjustment?.vertical || 0);
    const horizontal = this.getModernTrackAlignedScrollTarget(target, horizontalAdjustment);
    const vertical = this.getModernMainAlignedScrollTarget(target, direction, current, verticalAdjustment);
    const hasHorizontal = Boolean(horizontal?.container && Math.abs(Number(horizontal.container.scrollLeft || 0) - Number(horizontal.value || 0)) > 1);
    const hasVertical = Boolean(vertical?.container && Math.abs(Number(vertical.container.scrollTop || 0) - Number(vertical.value || 0)) > 1);

    if (!hasHorizontal && !hasVertical) {
      this.modernCameraFollowLastHorizontalContainer = horizontal?.container || this.modernCameraFollowLastHorizontalContainer;
      this.modernCameraFollowLastVerticalContainer = vertical?.container || this.modernCameraFollowLastVerticalContainer;
      return true;
    }

    if (shouldFollowVerticalHoldImmediately) {
      this.applyModernCameraFollowTargets(horizontal, vertical);
      return true;
    }

    this.modernCameraFollowState = {
      horizontal: hasHorizontal ? horizontal : null,
      vertical: hasVertical ? vertical : null
    };
    this.modernCameraFollowTimer = setTimeout(() => {
      this.flushModernCameraFollow();
    }, MODERN_HOME_CONSTANTS.cameraFollowDelayMs);
    return true;
  },

  isNodeWithinMainViewport(node) {
    const main = this.getHomeViewport();
    if (!main || !node || !this.container?.contains(node)) {
      return false;
    }
    const anchor = this.getMainFocusAnchor(node);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    return anchorRect.bottom > visibleTop && anchorRect.top < visibleBottom;
  },

  resolveBestVisibleNodeForRow(rowNodes = []) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const preferred = this.resolvePreferredNodeForRow(rowNodes);
    const track = rowNodes[0]?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return preferred || rowNodes[0] || null;
    }
    const metrics = this.getTrackViewportMetrics(track);
    const visibleNodes = rowNodes
      .map((node) => {
        const left = Number(node.offsetLeft || 0);
        const right = left + Number(node.offsetWidth || 0);
        return {
          node,
          overlap: Math.min(right, metrics.visibleRight) - Math.max(left, metrics.visibleLeft),
          distance: Math.abs(((left + right) / 2) - metrics.visibleCenter)
        };
      })
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }
        return left.distance - right.distance;
      });
    if (preferred && visibleNodes.some((entry) => entry.node === preferred)) {
      return preferred;
    }
    return visibleNodes[0]?.node || preferred || rowNodes[0] || null;
  },

  syncMainFocusToViewport({ suppressFlows = false } = {}) {
    if (!this.container || !this.navModel?.rows?.length) {
      return null;
    }
    const current = this.container.querySelector(".home-main .focusable.focused");
    if (current && this.isMainNode(current) && this.isNodeWithinMainViewport(current)) {
      return current;
    }
    const main = this.getHomeViewport();
    if (!main) {
      return current || null;
    }
    const mainRect = main.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const visibleCenter = visibleTop + Math.max(0, (visibleBottom - visibleTop) / 2);
    const bestRow = this.navModel.rows
      .map((rowNodes) => {
        const anchor = this.getMainFocusAnchor(rowNodes[0]);
        if (!anchor) {
          return null;
        }
        const rect = anchor.getBoundingClientRect();
        const overlap = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
        if (overlap <= 0) {
          return null;
        }
        return {
          rowNodes,
          overlap,
          distance: Math.abs((((rect.top + rect.bottom) / 2) - visibleCenter))
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.overlap !== left.overlap) {
          return right.overlap - left.overlap;
        }
        return left.distance - right.distance;
      })[0];
    const target = this.resolveBestVisibleNodeForRow(bestRow?.rowNodes || []);
    if (!(target instanceof HTMLElement)) {
      return current || null;
    }
    if (current !== target) {
      this.container.querySelectorAll(".home-main .focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      this.focusWithoutAutoScroll(target, { suppressDelegatedFocus: true });
    }
    this.lastMainFocus = target;
    this.rememberMainRowFocus(target);
    if (!suppressFlows) {
      this.scheduleModernHeroUpdate(target);
      this.scheduleFocusedPosterFlow(target);
    }
    return target;
  },

  scheduleHomeViewportFocusSync() {
    if (this.homeViewportFocusSyncTimer) {
      clearTimeout(this.homeViewportFocusSyncTimer);
    }
    this.homeViewportFocusSyncTimer = setTimeout(() => {
      this.homeViewportFocusSyncTimer = null;
      if (Router.getCurrent() !== "home") {
        return;
      }
      this.syncMainFocusToViewport({ suppressFlows: true });
    }, 120);
  },

  ensureMainVerticalVisibility(target, direction = null, current = null, layoutAdjustment = 0) {
    if (this.layoutMode === "modern") {
      const next = this.getModernMainAlignedScrollTarget(target, direction, current, layoutAdjustment);
      if (!next?.container) {
        return;
      }
      const delta = Math.abs(Number(next.container.scrollTop || 0) - Number(next.value || 0));
      if (delta <= 1) {
        return;
      }
      const duration = direction === "up" || direction === "down"
        ? this.getScrollDuration(220)
        : this.getScrollDuration(180);
      this.animateScroll(next.container, "y", next.value, duration);
      return;
    }

    const main = this.layoutMode === "modern"
      ? this.container?.querySelector(".home-modern-rows-viewport")
      : this.container?.querySelector(".home-main");
    if (!main || !target || !this.container?.contains(target)) {
      return;
    }
    const anchor = this.getMainFocusAnchor(target);
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop = anchorRect.top - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);
    const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop - Number(layoutAdjustment || 0);

    if (anchorRect.top < visibleTop) {
      this.animateScroll(main, "y", anchorTop - inset, this.getScrollDuration(150));
      return;
    }

    if (anchorRect.bottom > visibleBottom) {
      const targetScrollTop = anchorBottom - main.clientHeight + 24;
      this.animateScroll(main, "y", targetScrollTop, this.getScrollDuration(150));
    }
  },

  ensureTrackHorizontalVisibility(target, direction = null, layoutAdjustment = 0) {
    if (this.layoutMode === "modern") {
      const next = this.getModernTrackAlignedScrollTarget(target, layoutAdjustment);
      if (!next?.container) {
        return;
      }
      if (Math.abs(Number(next.container.scrollLeft || 0) - Number(next.value || 0)) <= 1) {
        return;
      }
      this.animateScroll(next.container, "x", next.value, 140);
      return;
    }

    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return;
    }
    const metrics = this.getTrackViewportMetrics(track);
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const visibleLeft = metrics.visibleLeft;
    const visibleRight = metrics.visibleRight;

    if (targetLeft < visibleLeft) {
      this.animateScroll(track, "x", targetLeft - metrics.leftPadding, this.getScrollDuration(160));
      return;
    }
    if (targetRight > visibleRight) {
      this.animateScroll(track, "x", targetRight - track.clientWidth + metrics.safeRightPadding, this.getScrollDuration(160));
      return;
    }
    if (this.layoutMode !== "modern" && !direction) {
      const targetCenter = targetLeft + (target.offsetWidth / 2);
      const centeredLeft = targetCenter - (track.clientWidth / 2);
      this.animateScroll(track, "x", centeredLeft, this.getScrollDuration(160));
    }
  },

  focusNode(current, target, direction = null, inputMeta = null) {
    if (!current || !target || current === target) {
      return false;
    }
    const scrollAdjustments = this.getExpandedPosterScrollAdjustments(current, target, direction);
    const shouldInstantCollapseExpandedPoster = this.layoutMode === "modern"
      && (direction === "left" || direction === "right");
    if (this.layoutMode === "modern" && this.expandedPosterNode && this.expandedPosterNode !== target) {
      this.collapseFocusedPoster(this.expandedPosterNode, {
        instant: shouldInstantCollapseExpandedPoster
      });
    }
    current.classList.remove("focused");
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target, { suppressDelegatedFocus: true });
    this.setSidebarExpanded(this.isSidebarNode(target));
    if (this.isMainNode(target)) {
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      const usingDelayedCameraFollow = this.scheduleModernCameraFollow(target, direction, current, scrollAdjustments, inputMeta);
      if (!usingDelayedCameraFollow) {
        this.ensureTrackHorizontalVisibility(target, direction, scrollAdjustments.horizontal);
        this.ensureMainVerticalVisibility(target, direction, current, scrollAdjustments.vertical);
      }
      this.scheduleModernHeroUpdate(target);
      if (this.isPerformanceConstrained()) {
        this.promotePosterCardAssets(target, { includeNeighbors: false });
      }
      this.scheduleFocusedPosterFlow(target);
    } else {
      this.cancelModernCameraFollow({ stopAnimations: true });
      this.cancelPendingHeroFocus();
      this.cancelFocusedPosterFlow();
      this.clearFocusedPosterFlowState();
      this.collapseFocusedPoster();
    }
    return true;
  },

  buildNavigationModel() {
    const sidebar = this.layoutPrefs?.modernSidebar
      ? Array.from(this.container?.querySelectorAll(".modern-sidebar-panel .focusable") || [])
      : Array.from(this.container?.querySelectorAll(".home-sidebar .focusable") || []);
    const rows = [];

    if (this.layoutMode === "modern") {
      rows.push(...buildModernNavigationRows(this.container));
    } else {
      const hero = this.container?.querySelector(".home-hero-card.focusable");
      if (hero) {
        rows.push([hero]);
      }

      const trackSections = Array.from(this.container?.querySelectorAll(".home-main .home-row") || []);
      trackSections.forEach((section) => {
        const track = section.querySelector(".home-track");
        if (!track) {
          return;
        }
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        if (cards.length) {
          rows.push(cards);
        }
      });
    }

    if (this.layoutMode === "grid") {
      const gridTracks = Array.from(this.container?.querySelectorAll(".home-grid-track") || []);
      gridTracks.forEach((track) => {
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        groupNodesByOffsetTop(cards).forEach((rowNodes) => {
          if (rowNodes.length) {
            rows.push(rowNodes);
          }
        });
      });
    }

    sidebar.forEach((node, index) => {
      node.dataset.navZone = "sidebar";
      node.dataset.navIndex = String(index);
    });

    rows.forEach((rowNodes, rowIndex) => {
      const rowKey = this.getNodeRowKey(rowNodes[0]);
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navZone = "main";
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
        if (rowKey) {
          node.dataset.navRowKey = rowKey;
        }
      });
    });

    this.navModel = { sidebar, rows };
    if (!this.lastMainFocus || !this.container?.contains(this.lastMainFocus) || !this.isMainNode(this.lastMainFocus)) {
      this.lastMainFocus = rows[0]?.[0] || null;
    }
  },

  handleHomeDpad(event) {
    const keyCode = Number(event?.keyCode || 0);
    const direction = keyCode === 38 ? "up"
      : keyCode === 40 ? "down"
        : keyCode === 37 ? "left"
          : keyCode === 39 ? "right"
            : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel;
    if (!nav) {
      return false;
    }
    let current = this.container.querySelector(".focusable.focused")
      || this.container?.querySelector(".focusable")
      || null;
    if (!current) {
      return false;
    }
    if (
      this.isMainNode(current)
      && !this.isNodeWithinMainViewport(current)
      && !this.shouldSuspendModernViewportFocusSync()
    ) {
      current = this.syncMainFocusToViewport({ suppressFlows: true }) || current;
    }
    const isSidebar = this.isSidebarNode(current);

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const inputMeta = {
      repeat: Boolean(event?.repeat)
    };

    if (event?.repeat) {
      const now = Date.now();
      const repeatThrottleMs = this.getDirectionalRepeatThrottleMs();
      if (Number(this.lastDirectionalKeyAt || 0) > 0 &&
        (now - Number(this.lastDirectionalKeyAt || 0)) < repeatThrottleMs
      ) {
        return true;
      }
      this.lastDirectionalKeyAt = now;
    }

    if (!isSidebar && current.classList.contains("home-hero-card") && (direction === "left" || direction === "right")) {
      if (this.heroCandidates?.length > 1) {
        this.rotateHero(direction === "right" ? 1 : -1);
      }
      return true;
    }

    if (isSidebar) {
      const sidebarIndex = Number(current.dataset.navIndex || 0);
      if (direction === "up") {
        const target = nav.sidebar[Math.max(0, sidebarIndex - 1)] || current;
        return this.focusNode(current, target, direction, inputMeta) || true;
      }
      if (direction === "down") {
        const target = nav.sidebar[Math.min(nav.sidebar.length - 1, sidebarIndex + 1)] || current;
        return this.focusNode(current, target, direction, inputMeta) || true;
      }
      if (direction === "right") {
        return this.closeSidebarToContent() || true;
      }
      return true;
    }

    const row = Number(current.dataset.navRow || 0);
    const col = Number(current.dataset.navCol || 0);
    const rowNodes = nav.rows[row] || [];

    if (direction === "left") {
      const targetInRow = rowNodes[col - 1] || null;
      if (this.focusNode(current, targetInRow, direction, inputMeta)) {
        return true;
      }
      const sidebarFallback = getLegacySidebarSelectedNode(this.container)
        || getModernSidebarSelectedNode(this.container)
        || nav.sidebar[0]
        || null;
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        this.lastMainFocus = current;
        return this.openSidebar();
      }
      return this.focusNode(current, sidebarFallback, direction, inputMeta) || true;
    }

    if (direction === "right") {
      const target = rowNodes[col + 1] || null;
      return this.focusNode(current, target, direction, inputMeta) || true;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRow = row + delta;
      const targetRowNodes = nav.rows[targetRow] || null;
      if (!targetRowNodes || !targetRowNodes.length) {
        if (direction === "down" && this.revealMoreHomeRowsFromFocus(current, row, col)) {
          return true;
        }
        return true;
      }
      const target = this.resolvePreferredNodeForRow(targetRowNodes, col);
      return this.focusNode(current, target, direction, inputMeta) || true;
    }

    return false;
  },

  ensureDelegatedEventsBound() {
    if (!this.container) {
      return;
    }
    if (!this.boundHomeFocusInHandler) {
      this.boundHomeFocusInHandler = (event) => {
        const target = event?.target?.closest?.(".focusable");
        if (!target || !this.container?.contains(target)) {
          return;
        }
        if (this.pendingDelegatedFocusTarget) {
          const isSuppressedProgrammaticFocus = this.pendingDelegatedFocusTarget === target;
          this.pendingDelegatedFocusTarget = null;
          if (isSuppressedProgrammaticFocus) {
            return;
          }
        }
        if (target.closest(".home-sidebar .focusable, .modern-sidebar-panel .focusable")) {
          this.setSidebarExpanded(true);
          return;
        }
        if (!target.closest(".home-main .focusable")) {
          return;
        }
        if (this.isMainNode(target)) {
          this.lastMainFocus = target;
        }
        this.scheduleModernHeroUpdate(target);
        this.scheduleFocusedPosterFlow(target);
      };
    }
    if (!this.boundHomeClickHandler) {
      this.boundHomeClickHandler = (event) => {
        const target = event?.target?.closest?.(".home-main .focusable, .hold-menu .focusable");
        if (!target || !this.container?.contains(target)) {
          return;
        }
        if (target.closest(".hold-menu")) {
          const optionIndex = Number(target.dataset.holdIndex || 0);
          this.continueWatchingMenu = {
            ...(this.continueWatchingMenu || {}),
            optionIndex
          };
          void this.activateContinueWatchingMenuOption();
          return;
        }
        const action = String(target.dataset.action || "");
        if (action === "openDetail") {
          this.openDetailFromNode(target);
          return;
        }
        if (action === "openCatalogSeeAll") {
          this.openCatalogSeeAllFromNode(target);
          return;
        }
        if (action === "resumeProgress") {
          this.openContinueWatchingFromNode(target);
        }
      };
    }
    if (!this.boundHomeWheelHandler) {
      this.boundHomeWheelHandler = (event) => {
        const main = this.getHomeViewport();
        const target = event?.target;
        if (!(target instanceof HTMLElement) || !main?.contains(target)) {
          return;
        }
        this.cancelPendingHeroFocus();
        this.cancelFocusedPosterFlow();
        this.scheduleHomeViewportFocusSync();
      };
    }
    if (this.boundHomeEventContainer === this.container) {
      return;
    }
    if (this.boundHomeEventContainer) {
      this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
      this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
      this.boundHomeEventContainer.removeEventListener("wheel", this.boundHomeWheelHandler);
    }
    this.container.addEventListener("focusin", this.boundHomeFocusInHandler);
    this.container.addEventListener("click", this.boundHomeClickHandler);
    this.container.addEventListener("wheel", this.boundHomeWheelHandler, { passive: true });
    this.boundHomeEventContainer = this.container;
  },

  bindHomeViewportEvents() {
    const viewport = this.getHomeViewport();
    if (this.boundHomeViewport === viewport) {
      return;
    }
    if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
      this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler);
    }
    this.boundHomeViewport = viewport || null;
    if (!viewport) {
      return;
    }
    if (!this.boundHomeViewportScrollHandler) {
      this.boundHomeViewportScrollHandler = () => {
        if (this.shouldSuspendModernViewportFocusSync()) {
          return;
        }
        const current = this.container?.querySelector(".home-main .focusable.focused") || null;
        if (current && this.isMainNode(current) && this.isNodeWithinMainViewport(current)) {
          return;
        }
        this.scheduleHomeViewportFocusSync();
      };
    }
    viewport.addEventListener("scroll", this.boundHomeViewportScrollHandler, { passive: true });
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("home");
    ScreenUtils.show(this.container);
    this.ensureDelegatedEventsBound();
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.homeRouteEnterPending = true;
    this.continueWatchingMenu = null;
    this.pendingContinueWatchingFocusIndex = null;
    this.pendingHomeRevealFocus = null;
    this.cancelPendingContinueWatchingEnter();
    this.forceInitialContinueWatchingFocus = false;
    this.continueWatchingLoading = false;
    this.isRestoringFocusFromBack = Boolean(navigationContext?.isBackNavigation);
    if (navigationContext?.restoredState?.layoutMode) {
      this.savedFocusStates = {
        ...(this.savedFocusStates || {}),
        [navigationContext.restoredState.layoutMode]: navigationContext.restoredState
      };
    }
    const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
    const profileChanged = activeProfileId !== String(this.loadedProfileId || "");
    if (profileChanged) {
      this.hasLoadedOnce = false;
      this.hasAppliedInitialContinueWatchingFocus = false;
      this.sidebarProfile = null;
    }

    if (this.hasLoadedOnce && Array.isArray(this.rows) && this.rows.length) {
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.render();
      this.loadData({ background: true }).catch((error) => {
        console.warn("Home background refresh failed", error);
      });
      return;
    }

    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this.hasAppliedInitialContinueWatchingFocus = false;
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((entry) => String(entry.id) === activeProfileId) || profiles[0] || null;
    const bootBackground = buildProfileBackgroundStyle(activeProfile?.avatarColorHex || DEFAULT_PROFILE_COLOR);
    this.container.innerHTML = renderLogoLoadingMarkup({ className: "home-boot", label: "Loading home" });
    const bootNode = this.container.querySelector(".app-loading-screen");
    if (bootNode) {
      bootNode.style.background = bootBackground;
    }
    await this.loadData({ background: false });
  },

  async loadData({ background = false } = {}) {
    const token = this.homeLoadToken;
    const bootPreloadDeadline = background ? 0 : Date.now() + HOME_BOOT_PRELOAD_BUDGET_MS;
    const prefs = LayoutPreferences.get();
    this.layoutPrefs = prefs;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();
    if (!background || !Number.isFinite(this.visibleHomeRowCount)) {
      this.visibleHomeRowCount = this.getInitialVisibleHomeRowCount();
    }

    const preserveContinueWatching = Boolean(background && this.continueWatchingDisplay?.length);
    const suppressContinueWatchingLoading = preserveContinueWatching;
    const previousContinueWatchingSignature = preserveContinueWatching
      ? buildContinueWatchingSignature(this.continueWatchingDisplay)
      : "";

    let progressAllError = null;
    let recentProgressError = null;
    const sidebarProfilePromise = getSidebarProfileState().catch(() => null);
    const progressAllPromise = watchProgressRepository.getAll().catch((error) => {
      progressAllError = error;
      return [];
    });
    const recentProgressPromise = watchProgressRepository.getRecent(10).catch((error) => {
      recentProgressError = error;
      return [];
    });
    const bootContinueWatchingPromise = background ? null : this.resolveContinueWatchingState({
      allProgressPromise: progressAllPromise,
      recentProgressPromise,
      progressAllError,
      recentProgressError,
      preserveContinueWatching,
      previousContinueWatchingSignature
    }).catch((error) => {
      console.warn("Home boot continue watching warmup failed", error);
      return null;
    });

    const addons = await addonRepository.getInstalledAddons();
    const catalogDescriptors = [];

    addons.forEach((addon) => {
      addon.catalogs
        .filter((catalog) => !isSearchOnlyCatalog(catalog))
        .forEach((catalog) => {
          catalogDescriptors.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
    });

    const initialCatalogLoad = this.getInitialCatalogLoadCount();
    const initialDescriptors = catalogDescriptors.slice(0, initialCatalogLoad);
    const deferredDescriptors = catalogDescriptors.slice(initialCatalogLoad);
    let bootDeferredRowsPromise = null;
    let bootDeferredRowsApplied = false;
    if (!background && deferredDescriptors.length) {
      bootDeferredRowsPromise = this.fetchCatalogRows(deferredDescriptors, {
        allowLoading: true,
        batchSize: this.getBootCatalogBatchSize(),
        timeoutMs: HOME_ROW_TIMEOUT_MS
      }).catch((error) => {
        console.warn("Home boot deferred rows warmup failed", error);
        return [];
      });
    }

    const initialRows = await this.fetchCatalogRows(initialDescriptors, { allowLoading: true });
    if (token !== this.homeLoadToken) {
      return;
    }
    let bootRows = initialRows;
    if (bootDeferredRowsPromise) {
      const bootDeferredRows = await withTimeout(
        bootDeferredRowsPromise,
        remainingBudgetMs(bootPreloadDeadline),
        null
      );
      if (Array.isArray(bootDeferredRows)) {
        bootRows = mergeRowsByKey([...initialRows, ...bootDeferredRows]);
        bootDeferredRowsApplied = true;
      }
    }
    this.rows = this.sortAndFilterRows(bootRows);

    let bootContinueWatchingState = null;
    if (bootContinueWatchingPromise) {
      bootContinueWatchingState = await withTimeout(
        bootContinueWatchingPromise,
        remainingBudgetMs(bootPreloadDeadline),
        null
      );
    }
    const bootContinueWatchingApplied = Boolean(bootContinueWatchingState);
    if (bootContinueWatchingState) {
      this.applyContinueWatchingState(bootContinueWatchingState);
    } else if (!preserveContinueWatching) {
      this.continueWatchingDisplay = [];
      this.continueWatchingLoading = true;
      this.allProgress = [];
      this.continueWatching = [];
      this.watchedItems = [];
      this.nextUpProgressCandidates = [];
    } else {
      this.continueWatchingLoading = false;
    }
    this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
    this.heroIndex = 0;
    this.heroItem = this.pickInitialHero();
    let bootHeroEnriched = false;
    if (!background && this.layoutMode !== "modern" && remainingBudgetMs(bootPreloadDeadline) > 500) {
      bootHeroEnriched = await withTimeout(
        this.enrichHero(this.heroCandidates[0] || null).then(() => true),
        Math.min(remainingBudgetMs(bootPreloadDeadline), 2600),
        false
      );
    }
    if (!background) {
      await this.preloadBootImages(bootPreloadDeadline);
    }
    this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
    this.hasLoadedOnce = true;
    this.render();
    const previousSidebarProfileSignature = buildSidebarProfileSignature(this.sidebarProfile);
    sidebarProfilePromise.then((profile) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      if (profile && buildSidebarProfileSignature(profile) !== previousSidebarProfileSignature) {
        this.sidebarProfile = profile;
        if (!this.patchSidebarProfileDom(profile)) {
          this.requestBackgroundRender();
        }
      }
    });

    if (deferredDescriptors.length && !bootDeferredRowsApplied) {
      const progressiveDeferredRows = this.shouldProgressivelyRenderDeferredRows();
      const allowDeferredLoadingRows = !this.isPerformanceConstrained();
      const deferredRowsPromise = bootDeferredRowsPromise || this.fetchCatalogRows(deferredDescriptors, {
        allowLoading: allowDeferredLoadingRows,
        batchSize: this.getDeferredCatalogBatchSize(),
        onBatch: progressiveDeferredRows
          ? (batchRows) => {
            if (token !== this.homeLoadToken || Router.getCurrent() !== "home" || !Array.isArray(batchRows) || !batchRows.length) {
              return;
            }
            const combinedByKey = new Map((this.rows || []).map((row) => [row.homeCatalogKey, row]));
            batchRows.forEach((row) => {
              combinedByKey.set(row.homeCatalogKey, row);
            });
            this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()));
            this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
            if (!this.heroItem) {
              this.heroItem = this.pickInitialHero();
            }
            this.requestBackgroundRender();
          }
          : null
      });
      deferredRowsPromise.then((extraRows) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        const combinedByKey = new Map();
        [...this.rows, ...extraRows].forEach((row) => {
          combinedByKey.set(row.homeCatalogKey, row);
        });
        this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()));
        this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
        if (!this.heroItem) {
          this.heroItem = this.pickInitialHero();
        }
        this.requestBackgroundRender();
        this.retryPendingCatalogRows();
      }).catch((error) => {
        console.warn("Deferred home rows load failed", error);
      });
    }

    if (this.layoutMode !== "modern" && !bootHeroEnriched) {
      this.enrichHero(this.heroCandidates[0] || null).then(() => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.applyHeroToDom();
      }).catch((error) => {
        console.warn("Hero async enrichment failed", error);
      });
    }

    if (!bootContinueWatchingApplied) {
      const fallbackContinueWatchingState = () => this.resolveContinueWatchingState({
        allProgressPromise: progressAllPromise,
        recentProgressPromise,
        progressAllError,
        recentProgressError,
        preserveContinueWatching,
        previousContinueWatchingSignature
      });
      const continueWatchingStatePromise = bootContinueWatchingPromise
        ? bootContinueWatchingPromise.then((state) => state || fallbackContinueWatchingState())
        : fallbackContinueWatchingState();
      continueWatchingStatePromise.then((state) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home" || !state) {
          return;
        }
      const previousDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
      const previousHeroIdentity = buildHeroIdentity(this.heroItem);
      const previousLoadingState = Boolean(this.continueWatchingLoading);
        this.applyContinueWatchingState(state);
        if (this.layoutMode === "modern" && this.continueWatchingDisplay.length) {
          this.heroItem = this.pickInitialHero();
          if (!background && !this.hasAppliedInitialContinueWatchingFocus) {
            this.forceInitialContinueWatchingFocus = true;
          }
        }
        const nextDisplaySignature = buildContinueWatchingSignature(this.continueWatchingDisplay);
        const nextHeroIdentity = buildHeroIdentity(this.heroItem);
        if (previousLoadingState !== this.continueWatchingLoading
          || previousDisplaySignature !== nextDisplaySignature
          || previousHeroIdentity !== nextHeroIdentity) {
          this.requestBackgroundRender();
        }
      }).catch((error) => {
        console.warn("Continue watching load failed", error);
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.continueWatchingLoading = false;
        if (!suppressContinueWatchingLoading) {
          this.requestBackgroundRender();
        }
      });
    }

    this.retryPendingCatalogRows();
  },

  pickInitialHero() {
    if (this.layoutMode === "modern") {
      if (this.continueWatchingLoading && Array.isArray(this.continueWatching) && this.continueWatching.length && !this.continueWatchingDisplay?.length) {
        return null;
      }
      const continueHero = normalizeContinueWatchingItem(this.continueWatchingDisplay?.[0] || null);
      if (continueHero && isPresentableContinueWatchingItem(continueHero, { requireArtwork: true })) {
        return continueHero;
      }
    }
    return this.heroCandidates[0] || this.pickHeroItem(this.rows);
  },

  async fetchCatalogRows(descriptors = [], options = {}) {
    const allowLoading = Boolean(options?.allowLoading);
    const timeoutMs = Number(options?.timeoutMs || HOME_ROW_TIMEOUT_MS);
    const loadingCount = this.getLoadingRowItemCount();
    const batchSize = Math.max(0, Number(options?.batchSize || 0));
    const onBatch = typeof options?.onBatch === "function" ? options.onBatch : null;
    const fetchedRows = [];
    const normalizedDescriptors = Array.isArray(descriptors) ? descriptors : [];

    const fetchBatch = async (batchDescriptors = []) => {
      const rowResults = await Promise.all(batchDescriptors.map(async (catalog) => {
        const result = await withTimeout(catalogRepository.getCatalog({
          addonBaseUrl: catalog.addonBaseUrl,
          addonId: catalog.addonId,
          addonName: catalog.addonName,
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          type: catalog.type,
          skip: 0,
          supportsSkip: true
        }), timeoutMs, { status: "error", message: "timeout" });
        const rowKey = buildModernRowKey(catalog);
        return {
          ...catalog,
          result: result?.status === "success" ? result : (allowLoading ? { status: "loading" } : result),
          loadingItems: allowLoading && result?.status !== "success"
            ? buildCatalogLoadingItems(rowKey, loadingCount)
            : null
        };
      }));
      const mappedRows = rowResults
        .filter((row) => row.result?.status === "success" || allowLoading)
        .map((row) => ({
          ...row,
          homeCatalogKey: buildCatalogOrderKey(row.addonId, row.type, row.catalogId),
          homeCatalogDisableKey: buildCatalogDisableKey(
            row.addonBaseUrl,
            row.type,
            row.catalogId,
            row.catalogName
          )
        }));
      fetchedRows.push(...mappedRows);
      if (onBatch && mappedRows.length) {
        onBatch(mappedRows);
      }
    };

    if (batchSize > 0 && normalizedDescriptors.length > batchSize) {
      for (let index = 0; index < normalizedDescriptors.length; index += batchSize) {
        await fetchBatch(normalizedDescriptors.slice(index, index + batchSize));
        if ((index + batchSize) < normalizedDescriptors.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return fetchedRows;
    }

    await fetchBatch(normalizedDescriptors);
    return fetchedRows;
  },

  sortAndFilterRows(rows = []) {
    const allKeys = rows.map((row) => row.homeCatalogKey);
    const orderedKeys = HomeCatalogStore.ensureOrderKeys(allKeys);
    const enabledRows = rows.filter((row) => !HomeCatalogStore.isDisabled(row.homeCatalogDisableKey));
    const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
    enabledRows.sort((left, right) => {
      const l = orderIndex.has(left.homeCatalogKey) ? orderIndex.get(left.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
      const r = orderIndex.has(right.homeCatalogKey) ? orderIndex.get(right.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
      return l - r;
    });
    return enabledRows;
  },

  retryPendingCatalogRows() {
    if (this.catalogRetryInFlight) {
      return;
    }
    const pendingRows = (this.rows || []).filter((row) => row?.result?.status === "loading");
    if (!pendingRows.length) {
      return;
    }
    const token = this.homeLoadToken;
    this.catalogRetryInFlight = true;
    const retryBatchSize = Math.max(1, Number(this.getDeferredCatalogBatchSize() || pendingRows.length || 1));
    const progressiveRetryRendering = this.shouldProgressivelyRenderDeferredRows();
    let hasBufferedUpdates = false;
    (async () => {
      for (let index = 0; index < pendingRows.length; index += retryBatchSize) {
        const batch = pendingRows.slice(index, index + retryBatchSize);
        const settled = await Promise.all(batch.map(async (row) => {
          try {
            const result = await withTimeout(catalogRepository.getCatalog({
              addonBaseUrl: row.addonBaseUrl,
              addonId: row.addonId,
              addonName: row.addonName,
              catalogId: row.catalogId,
              catalogName: row.catalogName,
              type: row.type,
              skip: 0,
              supportsSkip: true
            }), HOME_ROW_RETRY_TIMEOUT_MS, { status: "error", message: "timeout" });

            if (result?.status !== "success") {
              throw new Error(result?.message || "Catalog status error");
            }
            
            return { 
              status: "fulfilled", 
              value: { ...row, result } 
            };
          } catch (err) {
            return { status: "rejected", reason: err };
          }
        }));
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        const updatedRows = settled
          .filter((entry) => entry?.status === "fulfilled" && entry.value)
          .map((entry) => entry.value);
        settled
          .filter((entry) => entry?.status === "rejected")
          .forEach((entry) => console.warn("Retry catalog row load failed", entry.reason));
        if (updatedRows.length) {
          const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
          updatedRows.forEach((row) => {
            combinedByKey.set(row.homeCatalogKey, row);
          });
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()));
          this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
          if (!this.heroItem) {
            this.heroItem = this.pickInitialHero();
          }
          if (progressiveRetryRendering) {
            this.requestBackgroundRender();
          } else {
            hasBufferedUpdates = true;
          }
        }
        if ((index + retryBatchSize) < pendingRows.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (hasBufferedUpdates && token === this.homeLoadToken && Router.getCurrent() === "home") {
        this.requestBackgroundRender();
      }
    })().finally(() => {
      if (token === this.homeLoadToken) {
        this.catalogRetryInFlight = false;
      }
    });
  },

  render() {
    this.cancelScheduledRender();
    this.cancelModernCameraFollow({ stopAnimations: true });
    const retainedFocusState = this.captureCurrentFocusState() || this.savedFocusStates?.[this.layoutMode] || null;
    this.cancelFocusedPosterFlow();
    this.expandedPosterNode = null;
    const shouldHoldHeroForContinueWatching = this.layoutMode === "modern"
      && Boolean(this.continueWatchingLoading)
      && !this.continueWatchingDisplay?.length
      && !this.heroItem;
    const heroItem = shouldHoldHeroForContinueWatching
      ? null
      : normalizeCatalogItem(this.heroItem || this.heroCandidates?.[this.heroIndex] || this.pickHeroItem(this.rows), "movie");
    const showHeroSection = Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(heroItem);
    const modernLandscapePostersEnabled = this.layoutMode === "modern"
      && Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
    const modernLandscapeLayoutClass = modernLandscapePostersEnabled
      ? " home-modern-landscape-posters"
      : "";
    const layoutClass = `home-layout-${this.layoutMode}${modernLandscapeLayoutClass}`;
    const showPosterLabels = this.layoutPrefs?.posterLabelsEnabled !== false;
    const showCatalogAddonName = this.layoutPrefs?.catalogAddonNameEnabled !== false;
    const showCatalogTypeSuffix = this.layoutPrefs?.catalogTypeSuffixEnabled !== false;
    const focusState = retainedFocusState && retainedFocusState.focusKind === "item"
      ? retainedFocusState
      : null;
    this.ensureVisibleHomeRowsIncludeFocusState(focusState || retainedFocusState);
    const visibleRows = this.getVisibleHomeRows(this.rows);
    const expandFocusedPoster = this.layoutMode === "modern"
      && Boolean(this.layoutPrefs?.focusedPosterBackdropExpandEnabled || modernLandscapePostersEnabled)
      && Number(this.layoutPrefs?.focusedPosterBackdropExpandDelaySeconds ?? 3) <= 0
      && Boolean(focusState);
    const rowItemLimit = this.getRowItemLimit();
    const loadingRowItemCount = this.getLoadingRowItemCount();
    const continueWatchingLoadingCount = Math.min(
      Math.max(
        Number(this.continueWatching?.length || 0),
        Number(this.nextUpProgressCandidates?.length || 0)
      ),
      loadingRowItemCount
    );
    const effectiveContinueWatchingLoadingCount = (this.continueWatchingLoading && continueWatchingLoadingCount === 0)
      ? loadingRowItemCount
      : continueWatchingLoadingCount;
    this.teardownGridStickyHeader();

    let mainContentMarkup = "";
    let modernLayoutPayload = null;

    if (this.layoutMode === "modern") {
      modernLayoutPayload = renderModernHomeLayout({
        rows: visibleRows,
        heroItem,
        heroCandidates: this.heroCandidates,
        continueWatchingItems: this.continueWatchingDisplay || [],
        continueWatchingLoading: Boolean(this.continueWatchingLoading),
        continueWatchingLoadingCount: effectiveContinueWatchingLoadingCount,
        rowItemLimit,
        showHeroSection,
        showPosterLabels,
        showCatalogTypeSuffix,
        preferLandscapePosters: modernLandscapePostersEnabled,
        focusedRowKey: focusState?.rowKey || "",
        focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
        expandFocusedPoster,
        buildModernHeroPresentation,
        renderContinueWatchingSection,
        createPosterCardMarkup,
        createSeeAllCardMarkup,
        formatCatalogRowTitle,
        escapeHtml,
        escapeAttribute
      });
      this.catalogSeeAllMap = modernLayoutPayload.catalogSeeAllMap;
      mainContentMarkup = modernLayoutPayload.markup;
    } else {
      const continueHtml = renderContinueWatchingSection(this.continueWatchingDisplay || [], {
        rowKey: "continue_watching",
        loading: Boolean(this.continueWatchingLoading),
        loadingCount: effectiveContinueWatchingLoadingCount
      });
      const legacyRowsPayload = renderLegacyCatalogRowsMarkup(visibleRows, {
        layoutMode: this.layoutMode,
        showPosterLabels,
        showCatalogAddonName,
        showCatalogTypeSuffix,
        focusedRowKey: focusState?.rowKey || "",
        focusedItemIndex: Number.isFinite(focusState?.itemIndex) ? focusState.itemIndex : -1,
        expandFocusedPoster: false,
        rowItemLimit
      });
      this.catalogSeeAllMap = legacyRowsPayload.catalogSeeAllMap;
      mainContentMarkup = `
        ${showHeroSection ? renderHeroMarkup(this.layoutMode, heroItem, this.heroCandidates) : ""}
        ${continueHtml}
        ${this.layoutMode === "grid" ? '<div class="home-grid-sticky" id="homeGridSticky"></div>' : ""}
        <section class="home-catalogs${this.layoutMode === "grid" ? " home-grid-catalogs" : ""}" id="homeCatalogRows">${legacyRowsPayload.markup}</section>
      `;
    }

    this.container.innerHTML = `
      <div class="home-shell home-screen-shell ${layoutClass}">
        ${renderRootSidebar({
      selectedRoute: "home",
      profile: this.sidebarProfile,
      layout: this.layoutPrefs,
      expanded: Boolean(this.sidebarExpanded),
      pillIconOnly: Boolean(this.pillIconOnly)
    })}

        <main class="home-main home-screen-main">
          <div class="home-route-content${this.homeRouteEnterPending ? " home-route-content-enter" : ""}">
            ${mainContentMarkup}
          </div>
        </main>
      </div>
      ${this.renderContinueWatchingMenu()}
    `;

    if (modernLandscapePostersEnabled) {
      this.applyCachedModernLandscapePosterMetrics(this.container.querySelector(".home-screen-shell.home-modern-landscape-posters"));
    } else if (this.layoutMode === "modern") {
      this.applyCachedModernPortraitPosterMetrics(this.container.querySelector(".home-screen-shell.home-layout-modern:not(.home-modern-landscape-posters)"));
    }

    bindRootSidebarEvents(this.container, {
      currentRoute: "home",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindHomeViewportEvents();
    const canAttemptRestore = Boolean(retainedFocusState);
    let restoredFocus = false;
    if (this.pendingHomeRevealFocus) {
      restoredFocus = this.applyPendingHomeRevealFocus();
    } else if (this.continueWatchingMenu) {
      restoredFocus = this.applyContinueWatchingMenuFocus();
    } else if (Number.isFinite(this.pendingContinueWatchingFocusIndex)) {
      const cards = Array.from(this.container?.querySelectorAll(".home-row-continue .home-content-card.focusable") || []);
      const target = cards[Math.max(0, Math.min(cards.length - 1, Number(this.pendingContinueWatchingFocusIndex || 0)))]
        || cards[cards.length - 1]
        || null;
      this.pendingContinueWatchingFocusIndex = null;
      if (target) {
        restoredFocus = true;
        this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
        target.classList.add("focused");
        this.focusWithoutAutoScroll(target);
        this.lastMainFocus = target;
        this.rememberMainRowFocus(target);
        this.ensureTrackHorizontalVisibility(target);
        this.ensureMainVerticalVisibility(target);
      } else {
        ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
        const current = this.container.querySelector(".home-main .focusable.focused");
        if (current && this.isMainNode(current)) {
          this.lastMainFocus = current;
          this.scheduleModernHeroUpdate(current);
          this.scheduleFocusedPosterFlow(current);
        }
      }
    } else if (canAttemptRestore) {
      restoredFocus = this.restoreFocusState(retainedFocusState);
      if (restoredFocus) {
        this.isRestoringFocusFromBack = false;
      }
    }
    if (!restoredFocus && !this.isRestoringFocusFromBack && shouldHoldHeroForContinueWatching && this.layoutMode === "modern") {
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      this.lastMainFocus = null;
      this.hasAppliedInitialContinueWatchingFocus = this.focusInitialContinueWatchingCard();
    } else if (!restoredFocus && !this.isRestoringFocusFromBack && this.forceInitialContinueWatchingFocus && this.layoutMode === "modern") {
      this.forceInitialContinueWatchingFocus = false;
      this.hasAppliedInitialContinueWatchingFocus = this.focusInitialContinueWatchingCard();
    } else if (!restoredFocus) {
      ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
      const current = this.container.querySelector(".home-main .focusable.focused");
      if (current && this.isMainNode(current)) {
        this.lastMainFocus = current;
        this.scheduleModernHeroUpdate(current);
        this.scheduleFocusedPosterFlow(current);
      }
      this.isRestoringFocusFromBack = false;
    }
    if (!this.container?.querySelector(".home-poster-card.focused")) {
      this.clearFocusedPosterFlowState();
    }
    if (!this.layoutPrefs?.modernSidebar) {
      this.setSidebarExpanded(false);
    }
    if (this.layoutMode === "grid") {
      this.setupGridStickyHeader(showHeroSection);
    }
    this.startHeroRotation();
    this.homeRouteEnterPending = false;
    this.renderedLayoutMode = this.layoutMode;
    this.ensureHomeTruncationObservers();
    this.scheduleHomeTruncationUpdate();
  },

  teardownGridStickyHeader() {
    if (this.gridStickyCleanup) {
      this.gridStickyCleanup();
      this.gridStickyCleanup = null;
    }
  },

  setupGridStickyHeader(showHeroSection) {
    const main = this.container?.querySelector(".home-main");
    const sticky = this.container?.querySelector("#homeGridSticky");
    const sections = Array.from(this.container?.querySelectorAll(".home-grid-section[data-section-title]") || []);
    if (!main || !sticky || !sections.length) {
      return;
    }
    const hero = showHeroSection ? this.container?.querySelector(".home-hero") : null;
    const heroHeight = hero ? hero.offsetHeight : 0;
    const update = () => {
      const threshold = main.scrollTop + 72;
      let activeTitle = "";
      sections.forEach((section) => {
        if (section.offsetTop <= threshold) {
          activeTitle = String(section.dataset.sectionTitle || "");
        }
      });
      const shouldShow = activeTitle && (!showHeroSection || main.scrollTop > Math.max(0, heroHeight - 48));
      sticky.textContent = activeTitle;
      sticky.classList.toggle("is-visible", Boolean(shouldShow));
    };
    main.addEventListener("scroll", update, { passive: true });
    update();
    this.gridStickyCleanup = () => {
      main.removeEventListener("scroll", update);
    };
  },

  buildNextUpProgressCandidatesFromWatchedItems(watchedItems = [], inProgressItems = [], dismissedNextUpKeys = []) {
    const cutoffMs = Date.now() - (CW_DAYS_CAP * 24 * 60 * 60 * 1000);
    const dismissed = new Set(Array.isArray(dismissedNextUpKeys) ? dismissedNextUpKeys : []);
    const inProgressSeriesIds = new Set(
      (Array.isArray(inProgressItems) ? inProgressItems : [])
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .filter((item) => shouldTreatAsInProgressForContinueWatching(item))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    const latestWatchedByContent = new Map();
    (Array.isArray(watchedItems) ? watchedItems : []).forEach((entry) => {
      const watchedAt = Number(entry?.watchedAt || entry?.updatedAt || 0);
      if (watchedAt < cutoffMs) {
        return;
      }
      const contentId = String(entry?.contentId || "").trim();
      if (isMalformedNextUpSeedContentId(contentId) || inProgressSeriesIds.has(contentId)) {
        return;
      }
      const contentType = String(entry?.contentType || "series").toLowerCase();
      if (!isSeriesTypeForContinueWatching(contentType)) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (season <= 0 || episode <= 0) {
        return;
      }
      if (dismissed.has(nextUpDismissKey(contentId, season, episode))) {
        return;
      }

      const existing = latestWatchedByContent.get(contentId);
      if (!existing) {
        latestWatchedByContent.set(contentId, entry);
        return;
      }

      const existingUpdated = Number(existing.watchedAt || existing.updatedAt || 0);
      const incomingUpdated = watchedAt;
      if (incomingUpdated > existingUpdated) {
        latestWatchedByContent.set(contentId, entry);
        return;
      }
      if (incomingUpdated === existingUpdated) {
        const existingKey = (Number(existing.season || 0) * 1000) + Number(existing.episode || 0);
        const incomingKey = (season * 1000) + episode;
        if (incomingKey > existingKey) {
          latestWatchedByContent.set(contentId, entry);
        }
      }
    });

    return Array.from(latestWatchedByContent.values())
      .map((entry) => ({
        contentId: String(entry?.contentId || "").trim(),
        contentType: isSeriesTypeForContinueWatching(entry?.contentType) ? String(entry.contentType).toLowerCase() : "series",
        videoId: String(entry?.videoId || entry?.contentId || "").trim(),
        season: Number(entry?.season || 0),
        episode: Number(entry?.episode || 0),
        title: firstNonEmpty(entry?.title, entry?.name, entry?.contentId),
        episodeTitle: firstNonEmpty(entry?.episodeTitle),
        positionMs: 1,
        durationMs: 1,
        progressPercent: 100,
        updatedAt: Number(entry?.watchedAt || entry?.updatedAt || Date.now()),
        source: "watched_items"
      }))
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  },

  selectNextUpProgressCandidates(allProgress = [], inProgressItems = [], watchedItems = [], dismissedNextUpKeys = []) {
    const watchedItemSeeds = this.buildNextUpProgressCandidatesFromWatchedItems(watchedItems, inProgressItems, dismissedNextUpKeys);
    if (watchedItemSeeds.length) {
      return watchedItemSeeds;
    }

    const cutoffMs = Date.now() - (CW_DAYS_CAP * 24 * 60 * 60 * 1000);
    const dismissed = new Set(Array.isArray(dismissedNextUpKeys) ? dismissedNextUpKeys : []);
    const inProgressSeriesIds = new Set(
      (Array.isArray(inProgressItems) ? inProgressItems : [])
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .filter((item) => shouldTreatAsInProgressForContinueWatching(item))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    const latestCompletedByContent = new Map();
    (Array.isArray(allProgress) ? allProgress : []).forEach((entry) => {
      if (Number(entry?.updatedAt || 0) < cutoffMs) {
        return;
      }
      const contentId = String(entry?.contentId || "").trim();
      if (isMalformedNextUpSeedContentId(contentId) || inProgressSeriesIds.has(contentId)) {
        return;
      }
      if (!isSeriesTypeForContinueWatching(entry?.contentType)) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (season <= 0 || episode <= 0 || !isCompletedForContinueWatching(entry)) {
        return;
      }
      if (dismissed.has(nextUpDismissKey(contentId, season, episode))) {
        return;
      }

      const existing = latestCompletedByContent.get(contentId);
      if (!existing) {
        latestCompletedByContent.set(contentId, entry);
        return;
      }

      const existingUpdated = Number(existing.updatedAt || 0);
      const incomingUpdated = Number(entry.updatedAt || 0);
      if (incomingUpdated > existingUpdated) {
        latestCompletedByContent.set(contentId, entry);
        return;
      }
      if (incomingUpdated === existingUpdated) {
        const existingKey = (Number(existing.season || 0) * 1000) + Number(existing.episode || 0);
        const incomingKey = (season * 1000) + episode;
        if (incomingKey > existingKey) {
          latestCompletedByContent.set(contentId, entry);
        }
      }
    });

    return Array.from(latestCompletedByContent.values())
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  },

  buildWatchedEpisodeIndex(watchedItems = []) {
    const byContent = new Map();
    (Array.isArray(watchedItems) ? watchedItems : []).forEach((entry) => {
      const contentId = String(entry?.contentId || "").trim();
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (!contentId || season <= 0 || episode <= 0) {
        return;
      }
      if (!byContent.has(contentId)) {
        byContent.set(contentId, new Set());
      }
      byContent.get(contentId).add(episodeKey(season, episode));
    });
    return byContent;
  },

  buildEpisodeProgressIndex(allProgress = [], contentId = "") {
    const targetContentId = String(contentId || "").trim();
    const byEpisode = new Map();
    if (!targetContentId) {
      return byEpisode;
    }

    (Array.isArray(allProgress) ? allProgress : []).forEach((entry) => {
      if (String(entry?.contentId || "").trim() !== targetContentId) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (season <= 0 || episode <= 0) {
        return;
      }
      const key = episodeKey(season, episode);
      const existing = byEpisode.get(key);
      if (!existing || Number(entry?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
        byEpisode.set(key, entry);
      }
    });

    return byEpisode;
  },

  async fetchMetaForContinueWatching(contentType, contentId, timeoutMs = CW_META_TIMEOUT_MS) {
    const effectiveTimeoutMs = getContinueWatchingMetaTimeout(timeoutMs);
    const normalizedType = String(contentType || "").trim().toLowerCase();
    const typeCandidates = [];
    if (normalizedType) {
      typeCandidates.push(normalizedType);
    }
    if (isSeriesTypeForContinueWatching(normalizedType)) {
      typeCandidates.push("series", "tv");
    } else {
      typeCandidates.push("movie");
    }

    const seenTypes = new Set();
    for (const type of typeCandidates) {
      const normalizedCandidate = String(type || "").trim().toLowerCase();
      if (!normalizedCandidate || seenTypes.has(normalizedCandidate)) {
        continue;
      }
      seenTypes.add(normalizedCandidate);
      try {
        const result = await withTimeout(
          metaRepository.getMetaFromAllAddons(normalizedCandidate, contentId),
          effectiveTimeoutMs,
          { status: "error", message: "timeout" }
        );
        if (result?.status === "success" && result?.data) {
          return result.data;
        }
      } catch (_) { }
    }

    return null;
  },

  resolveNextUpEpisode(meta = {}, completedProgress = {}, allProgress = [], watchedEpisodeKeys = new Set(), { showUnairedNextUp = true } = {}) {
    const episodes = normalizeEpisodeEntries(meta?.videos || []);
    if (!episodes.length) {
      return null;
    }

    const progressByEpisode = this.buildEpisodeProgressIndex(allProgress, completedProgress?.contentId);
    const anchorVideoId = String(completedProgress?.videoId || "").trim();
    let anchorIndex = anchorVideoId
      ? episodes.findIndex((entry) => String(entry?.id || "") === anchorVideoId)
      : -1;

    const anchorSeason = Number(completedProgress?.season || 0);
    const anchorEpisode = Number(completedProgress?.episode || 0);
    if (anchorIndex < 0 && anchorSeason > 0 && anchorEpisode > 0) {
      anchorIndex = episodes.findIndex((entry) => Number(entry.season || 0) === anchorSeason && Number(entry.episode || 0) === anchorEpisode);
    }

    if (anchorIndex < 0 && anchorSeason === 1 && anchorEpisode > 0) {
      const seasonCount = new Set(episodes.map((entry) => Number(entry.season || 0))).size;
      const globalIndex = anchorEpisode - 1;
      if (seasonCount > 1 && globalIndex >= 0 && globalIndex < episodes.length) {
        anchorIndex = globalIndex;
      }
    }

    if (anchorIndex < 0) {
      let latestCompleted = null;
      progressByEpisode.forEach((entry) => {
        if (!isCompletedForContinueWatching(entry)) {
          return;
        }
        if (!latestCompleted || Number(entry.updatedAt || 0) > Number(latestCompleted.updatedAt || 0)) {
          latestCompleted = entry;
        }
      });
      if (latestCompleted) {
        anchorIndex = episodes.findIndex((entry) => (
          Number(entry.season || 0) === Number(latestCompleted.season || 0)
          && Number(entry.episode || 0) === Number(latestCompleted.episode || 0)
        ));
      }
    }

    if (anchorIndex < 0) {
      return null;
    }

    for (let index = anchorIndex + 1; index < episodes.length; index += 1) {
      const candidate = episodes[index];
      const key = episodeKey(candidate.season, candidate.episode);
      const candidateProgress = progressByEpisode.get(key);
      if (watchedEpisodeKeys?.has?.(key)) {
        continue;
      }
      if (candidateProgress && isCompletedForContinueWatching(candidateProgress)) {
        continue;
      }
      if (candidateProgress && shouldTreatAsInProgressForContinueWatching(candidateProgress)) {
        return null;
      }
      if (!showUnairedNextUp && !hasEpisodeAiredForContinueWatching(candidate.released)) {
        continue;
      }
      return candidate;
    }

    return null;
  },

  async buildNextUpItems({
    allProgress = [],
    inProgressItems = [],
    nextUpProgressCandidates = [],
    watchedItems = [],
    dismissedNextUpKeys = [],
    showUnairedNextUp = true
  } = {}) {
    const resolvedCandidates = (Array.isArray(nextUpProgressCandidates) && nextUpProgressCandidates.length)
      ? nextUpProgressCandidates
      : this.selectNextUpProgressCandidates(allProgress, inProgressItems, watchedItems, dismissedNextUpKeys);

    if (!resolvedCandidates.length) {
      return [];
    }

    const neededSlots = Math.max(0, CW_MAX_VISIBLE_ITEMS - Math.min(CW_MAX_VISIBLE_ITEMS, Number(inProgressItems?.length || 0)));
    const lookupCount = Math.min(CW_MAX_NEXT_UP_LOOKUPS, neededSlots || CW_MAX_VISIBLE_ITEMS);
    const limitedCandidates = resolvedCandidates.slice(0, lookupCount);
    const watchedEpisodeIndex = this.buildWatchedEpisodeIndex(watchedItems);
    const dismissed = new Set(Array.isArray(dismissedNextUpKeys) ? dismissedNextUpKeys : []);

    const nextUpItems = await Promise.all(limitedCandidates.map(async (progressEntry) => {
      const contentType = String(progressEntry?.contentType || "series").toLowerCase();
      const contentId = String(progressEntry?.contentId || "").trim();
      if (!contentId || !isSeriesTypeForContinueWatching(contentType)) {
        return null;
      }
      const seedSeason = Number(progressEntry?.season || 0) || null;
      const seedEpisode = Number(progressEntry?.episode || 0) || null;
      if (dismissed.has(nextUpDismissKey(contentId, seedSeason, seedEpisode))) {
        return null;
      }

      let meta = null;
      try {
        meta = await this.fetchMetaForContinueWatching(contentType, contentId, CW_NEXT_UP_META_TIMEOUT_MS);
      } catch (error) {
        console.warn("Next up meta lookup failed", error);
      }

      if (!meta) {
        return null;
      }

      const watchedEpisodeKeys = watchedEpisodeIndex.get(contentId) || new Set();
      const nextEpisode = this.resolveNextUpEpisode(meta, progressEntry, allProgress, watchedEpisodeKeys, { showUnairedNextUp });
      if (!nextEpisode) {
        return null;
      }
      const hasAired = hasEpisodeAiredForContinueWatching(nextEpisode.released);

      return {
        contentId,
        contentType,
        videoId: nextEpisode.id || null,
        season: Number(nextEpisode.season || 0) || null,
        episode: Number(nextEpisode.episode || 0) || null,
        seedSeason,
        seedEpisode,
        episodeTitle: firstNonEmpty(nextEpisode.title),
        positionMs: 0,
        durationMs: 0,
        updatedAt: Number(progressEntry?.updatedAt || Date.now()),
        isNextUp: true,
        hasAired,
        title: meta.name || prettyId(contentId),
        landscapePoster: firstNonEmpty(meta.landscapePoster, meta.thumbnail, meta.backdrop, meta.background, nextEpisode.thumbnail, meta.poster),
        episodeThumbnail: firstNonEmpty(nextEpisode.thumbnail),
        poster: firstNonEmpty(meta.poster, nextEpisode.thumbnail, meta.thumbnail, meta.background, meta.backdrop),
        background: firstNonEmpty(meta.background, meta.backdrop, nextEpisode.thumbnail, meta.poster),
        backdrop: firstNonEmpty(meta.backdrop, meta.background, nextEpisode.thumbnail),
        thumbnail: firstNonEmpty(nextEpisode.thumbnail, meta.thumbnail, meta.poster, meta.background),
        logo: firstNonEmpty(meta.logo),
        description: firstNonEmpty(nextEpisode.overview, meta.description),
        releaseInfo: firstNonEmpty(nextEpisode.released, meta.releaseInfo),
        imdbRating: resolveImdbRating(meta),
        genres: Array.isArray(meta.genres) ? meta.genres : [],
        runtimeMinutes: Number(meta.runtimeMinutes ?? meta.runtime ?? 0) || 0,
        ageRating: firstNonEmpty(meta.ageRating, meta.age_rating),
        status: firstNonEmpty(meta.status),
        language: firstNonEmpty(meta.language),
        country: firstNonEmpty(meta.country)
      };
    }));

    return nextUpItems
      .filter(Boolean)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  },

  async enrichContinueWatching(items = [], options = {}) {
    const inProgressItems = await Promise.all((items || []).map(async (item) => {
      try {
        const meta = await this.fetchMetaForContinueWatching(item.contentType || "movie", item.contentId, 1800);
        if (meta) {
          return {
            ...item,
            title: meta.name || prettyId(item.contentId),
            landscapePoster: meta.landscapePoster || meta.thumbnail || meta.backdrop || meta.background || null,
            episodeThumbnail: meta.episodeThumbnail || null,
            poster: meta.poster || meta.thumbnail || meta.background || meta.backdrop || null,
            background: meta.background || meta.backdrop || meta.thumbnail || meta.poster || null,
            backdrop: meta.backdrop || meta.background || null,
            thumbnail: meta.thumbnail || meta.poster || null,
            logo: meta.logo || null,
            description: meta.description || "",
            releaseInfo: meta.releaseInfo || "",
            imdbRating: resolveImdbRating(meta),
            genres: Array.isArray(meta.genres) ? meta.genres : [],
            runtimeMinutes: Number(meta.runtimeMinutes ?? meta.runtime ?? 0) || 0,
            ageRating: firstNonEmpty(meta.ageRating, meta.age_rating),
            status: firstNonEmpty(meta.status),
            language: firstNonEmpty(meta.language),
            country: firstNonEmpty(meta.country)
          };
        }
      } catch (error) {
        console.warn("Continue watching enrichment failed", error);
      }
      return {
        ...item,
        title: firstNonEmpty(item.title, item.name),
        landscapePoster: item.landscapePoster || item.thumbnail || item.backdrop || item.background || null,
        episodeThumbnail: item.episodeThumbnail || null,
        poster: item.poster || item.thumbnail || null,
        background: item.background || item.backdrop || item.poster || null,
        backdrop: item.backdrop || item.background || null,
        thumbnail: item.thumbnail || item.poster || null,
        logo: item.logo || null,
        description: item.description || "",
        releaseInfo: item.releaseInfo || "",
        genres: Array.isArray(item.genres) ? item.genres : [],
        runtimeMinutes: Number(item.runtimeMinutes ?? item.runtime ?? 0) || 0,
        ageRating: firstNonEmpty(item.ageRating, item.age_rating),
        status: firstNonEmpty(item.status),
        language: firstNonEmpty(item.language),
        country: firstNonEmpty(item.country),
        episodeTitle: firstNonEmpty(item.episodeTitle, item.subtitle)
      };
    }));

    const nextUpItems = await this.buildNextUpItems({
      allProgress: options?.allProgress || [],
      inProgressItems,
      nextUpProgressCandidates: options?.nextUpProgressCandidates || [],
      watchedItems: options?.watchedItems || [],
      dismissedNextUpKeys: options?.dismissedNextUpKeys || [],
      showUnairedNextUp: options?.showUnairedNextUp !== false
    });

    const inProgressSeriesIds = new Set(
      inProgressItems
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .filter((item) => shouldTreatAsInProgressForContinueWatching(item))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    return [...inProgressItems, ...nextUpItems.filter((item) => !inProgressSeriesIds.has(String(item?.contentId || "").trim()))]
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, CW_MAX_VISIBLE_ITEMS);
  },

  pickHeroItem(rows) {
    for (const row of rows) {
      const first = row.result?.data?.items?.[0];
      if (first) {
        return normalizeCatalogItem(first, row.type || "movie");
      }
    }
    return null;
  },

  collectHeroCandidates(rows) {
    const flat = [];
    rows.forEach((row) => {
      (row?.result?.data?.items || []).slice(0, 4).forEach((item) => {
        if (!item?.id || flat.some((entry) => entry.id === item.id)) {
          return;
        }
        flat.push(item);
      });
    });
    return flat.slice(0, 10);
  },

  async enrichHero(baseHero = null) {
    const hero = normalizeCatalogItem(baseHero || this.pickHeroItem(this.rows), "movie");
    if (!hero) {
      this.heroItem = null;
      return;
    }

    const settings = TmdbSettingsStore.get();
    if (!settings.enabled || !settings.apiKey) {
      this.heroItem = hero;
      return;
    }

    try {
      const tmdbId = await withTimeout(TmdbService.ensureTmdbId(hero.id, hero.type), 2200, null);
      if (!tmdbId) {
        this.heroItem = hero;
        return;
      }

      const enriched = await withTimeout(TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: hero.type,
        language: settings.language
      }), 2400, null);

      if (!enriched) {
        this.heroItem = hero;
        return;
      }

      this.heroItem = normalizeCatalogItem({
        ...hero,
        name: settings.useBasicInfo ? (enriched.localizedTitle || hero.name) : hero.name,
        description: settings.useBasicInfo ? (enriched.description || hero.description) : hero.description,
        background: settings.useArtwork ? (enriched.backdrop || hero.background) : hero.background,
        poster: settings.useArtwork ? (enriched.poster || hero.poster) : hero.poster,
        logo: settings.useArtwork ? (enriched.logo || hero.logo) : hero.logo,
        genres: settings.useBasicInfo ? (enriched.genres || hero.genres) : hero.genres,
        releaseInfo: settings.useBasicInfo ? (enriched.releaseInfo || hero.releaseInfo) : hero.releaseInfo
      }, hero.type || "movie");
    } catch (error) {
      console.warn("Hero TMDB enrichment failed", error);
      this.heroItem = hero;
    }
  },

  openDetailFromNode(node) {
    const itemId = node.dataset.itemId;
    if (!itemId) {
      return;
    }
    Router.navigate("detail", {
      itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  openCatalogSeeAllFromNode(node) {
    if (!node) {
      return;
    }
    const seeAllId = String(node.dataset.seeAllId || "");
    const mapped = this.catalogSeeAllMap?.get?.(seeAllId) || null;
    if (mapped) {
      Router.navigate("catalogSeeAll", mapped);
      return;
    }
    Router.navigate("catalogSeeAll", {
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogId: node.dataset.catalogId || "",
      catalogName: node.dataset.catalogName || "",
      type: node.dataset.catalogType || "movie",
      initialItems: []
    });
  },

  onKeyDown(event) {
    const currentFocusedNode = this.container?.querySelector(".focusable.focused") || null;
    const code = Number(event?.keyCode || 0);
    const originalKeyCode = Number(event?.originalKeyCode || code || 0);
    const isTizenHoldTarget = Platform.isTizen() && this.isContinueWatchingHoldTarget(currentFocusedNode);
    if (!isTizenHoldTarget || code !== 13) {
      this.cancelPendingContinueWatchingEnter();
      this.cancelPendingContinueWatchingHold();
    }
    if (this.continueWatchingMenu) {
      if (Platform.isBackEvent(event)) {
        event.preventDefault?.();
        this.closeContinueWatchingMenu();
        return;
      }
      if (code === 38 || code === 40) {
        event.preventDefault?.();
        this.moveContinueWatchingMenuFocus(code === 38 ? -1 : 1);
        return;
      }
      if (code === 13) {
        event.preventDefault?.();
        void this.activateContinueWatchingMenuOption();
        return;
      }
      return;
    }
    if (Platform.isBackEvent(event)) {
      event.preventDefault?.();
      if (this.layoutMode === "modern") {
        this.cancelFocusedPosterFlow();
        this.collapseFocusedPoster();
      }
      const sidebarFocused = Boolean(
        this.container?.querySelector(".modern-sidebar-panel .focusable.focused")
        || this.container?.querySelector(".home-sidebar .focusable.focused")
      );
      if (sidebarFocused) {
        Platform.exitApp();
      } else {
        this.openSidebar();
      }
      return;
    }
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === 40) {
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === 38) {
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
      }
    }
    if (this.layoutMode === "modern" && [37, 38, 39, 40].includes(code)) {
      this.cancelFocusedPosterFlow();
    }
    if (this.handleHomeDpad(event)) {
      return;
    }
    const isContinueWatchingHoldTarget = this.isContinueWatchingHoldTarget(currentFocusedNode);
    const wantsContinueWatchingMenu = isContinueWatchingHoldTarget
      && ((code === 13 && event?.repeat) || originalKeyCode === 82 || code === 93);
    if (wantsContinueWatchingMenu) {
      event.preventDefault?.();
      this.cancelPendingContinueWatchingEnter();
      this.cancelPendingContinueWatchingHold();
      this.openContinueWatchingMenu(currentFocusedNode);
      return;
    }
    if (Platform.isTizen() && code === 13 && isContinueWatchingHoldTarget) {
      event.preventDefault?.();
      if (!event?.repeat && !this.hasPendingContinueWatchingHold(currentFocusedNode)) {
        this.startPendingContinueWatchingHold(currentFocusedNode);
      }
      return;
    }
    if (code === 76) {
      this.persistCurrentFocusState();
      const currentIndex = HOME_LAYOUT_SEQUENCE.indexOf(this.layoutMode);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % HOME_LAYOUT_SEQUENCE.length : 0;
      this.layoutMode = HOME_LAYOUT_SEQUENCE[nextIndex];
      LayoutPreferences.set({ homeLayout: this.layoutMode });
      this.heroItem = this.pickInitialHero();
      this.render();
      return;
    }
    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = current.dataset.action;
    if (String(current.dataset.navZone || "") === "sidebar") {
      activateLegacySidebarAction(action, "home");
      return;
    }
    if (action === "openDetail") this.openDetailFromNode(current);
    if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
    if (action === "resumeProgress") {
      this.scheduleContinueWatchingEnter(current);
    }
  },

  onKeyUp(event) {
    if (!Platform.isTizen()) {
      return;
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".home-continue-card.focusable.focused") || null;
    if (this.completePendingContinueWatchingHold(current)) {
      event.preventDefault?.();
    }
  },

  consumeBackRequest() {
    if (this.continueWatchingMenu) {
      this.closeContinueWatchingMenu();
      return true;
    }
    return false;
  },

  cleanup() {
    this.cancelPendingContinueWatchingEnter();
    this.cancelPendingContinueWatchingHold();
    this.continueWatchingMenu = null;
    this.persistCurrentFocusState();
    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this.cancelScheduledRender();
    this.cancelModernCameraFollow({ stopAnimations: true });
    this.stopHeroRotation();
    this.cancelPendingHeroFocus();
    this.cancelFocusedPosterFlow();
    this.clearFocusedPosterFlowState();
    this.collapseFocusedPoster();
    this.teardownGridStickyHeader();
    if (this.homeViewportFocusSyncTimer) {
      clearTimeout(this.homeViewportFocusSyncTimer);
      this.homeViewportFocusSyncTimer = null;
    }
    if (this.boundHomeViewport && this.boundHomeViewportScrollHandler) {
      this.boundHomeViewport.removeEventListener("scroll", this.boundHomeViewportScrollHandler);
    }
    this.boundHomeViewport = null;
    if (this.homeTruncationFrame) {
      cancelAnimationFrame(this.homeTruncationFrame);
      this.homeTruncationFrame = null;
    }
    this.homeTruncationScope = null;
    this.cachedModernPortraitPosterMetrics = null;
    this.cachedModernLandscapePosterMetrics = null;
    ScreenUtils.hide(this.container);
  }
};
