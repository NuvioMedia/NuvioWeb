import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { Platform } from "../../../platform/index.js";
import { YOUTUBE_PROXY_URL } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
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
const HOME_MAX_ITEMS_PER_ROW_DEFAULT = 15;
const HOME_MAX_ITEMS_PER_ROW_CONSTRAINED = 10;
const HOME_LOADING_ROW_ITEMS_DEFAULT = 10;
const HOME_LOADING_ROW_ITEMS_CONSTRAINED = 8;
const HOME_ROW_TIMEOUT_MS = 3500;
const HOME_ROW_RETRY_TIMEOUT_MS = 12000;
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

function buildYoutubeEmbedUrl(videoId, { muted = true } = {}) {
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
    proxyUrl.searchParams.set("autoplay", "1");
    proxyUrl.searchParams.set("muted", muted ? "1" : "0");
    proxyUrl.searchParams.set("controls", "0");
    proxyUrl.searchParams.set("loop", "1");
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
    const embedUrl = buildYoutubeEmbedUrl(source.ytId, { muted });
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
  return normalized === "series";
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
    return t("home.continueStatusNextUp", {}, "Next Up");
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
  const safeCount = Math.max(1, Math.min(HOME_MAX_ITEMS_PER_ROW_DEFAULT, Number(count || HOME_LOADING_ROW_ITEMS_DEFAULT)));
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
  return `
    <div class="home-modern-hero-meta-group">${left}</div>
    <div class="home-modern-hero-meta-group">${rightTokens.join('<span class="home-hero-dot">•</span>')}</div>
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
    rowItemLimit = HOME_MAX_ITEMS_PER_ROW_DEFAULT
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
      ? `from ${rowData.addonName}`
      : "";
    const maxItems = Math.max(1, Number(rowItemLimit || HOME_MAX_ITEMS_PER_ROW_DEFAULT));
    const hasSeeAll = !isLoading && items.length > maxItems;
    const gridLimit = Math.max(1, hasSeeAll ? maxItems - 1 : maxItems);
    const visibleItems = layoutMode === "grid"
      ? rowItems.slice(0, gridLimit)
      : rowItems.slice(0, maxItems);
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
        ${hasSeeAll ? createSeeAllCardMarkup(seeAllId, rowData) : ""}
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

function createSeeAllCardMarkup(seeAllId, rowData) {
  return `
    <article class="home-content-card home-seeall-card focusable"
             data-action="openCatalogSeeAll"
             data-see-all-id="${escapeAttribute(seeAllId)}"
             data-addon-base-url="${escapeAttribute(rowData.addonBaseUrl || "")}"
             data-addon-id="${escapeAttribute(rowData.addonId || "")}"
             data-addon-name="${escapeAttribute(rowData.addonName || "")}"
             data-catalog-id="${escapeAttribute(rowData.catalogId || "")}"
             data-catalog-name="${escapeAttribute(rowData.catalogName || "")}"
             data-catalog-type="${escapeAttribute(rowData.type || "")}">
      <div class="home-seeall-card-inner">
        <div class="home-seeall-arrow" aria-hidden="true">&#8594;</div>
        <div class="home-seeall-label">See All</div>
      </div>
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
    const viewport = layoutMode === "modern"
      ? this.container.querySelector(".home-modern-rows-viewport")
      : this.container.querySelector(".home-main");
    if (!viewport) {
      return null;
    }

    let focused = this.container.querySelector(".home-main .focusable.focused") || this.lastMainFocus || null;
    if (focused && !focused.isConnected) {
      focused = null;
    }
    if (!focused) {
      return null;
    }
    const trackStates = Object.fromEntries(
      Array.from(this.container.querySelectorAll("[data-track-row-key]"))
        .map((track) => [String(track.dataset.trackRowKey || ""), track.scrollLeft])
        .filter(([key]) => key)
    );
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

    if (this.layoutMode === "modern") {
      return this.restoreModernFocusState(focusState);
    }

    return this.restoreLegacyFocusState(focusState);
  },

  restoreModernFocusState(focusState) {
    if (!focusState || this.layoutMode !== "modern") {
      return false;
    }

    const viewport = this.container?.querySelector(".home-modern-rows-viewport");
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
    const desiredScrollTop = rowSection
      ? rowSection.offsetTop
      : Number(focusState.mainScrollTop || 0);
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));

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
    this.ensureMainVerticalVisibility(target);
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
  },

  animateScroll(container, axis, targetValue, duration = 150) {
    if (!container) {
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
    if (prefersReducedMotion) {
      container[property] = nextValue;
      return;
    }

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const map = this.scrollAnimations || (this.scrollAnimations = new WeakMap());
    const key = axis === "y" ? "y" : "x";
    const existing = map.get(container) || {};
    if (existing[key]) {
      cancelAnimationFrame(existing[key]);
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      container[property] = Math.round(startValue + ((nextValue - startValue) * easeOutCubic(progress)));
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

  isPerformanceConstrained() {
    return Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  },

  getRowItemLimit() {
    return this.isPerformanceConstrained()
      ? HOME_MAX_ITEMS_PER_ROW_CONSTRAINED
      : HOME_MAX_ITEMS_PER_ROW_DEFAULT;
  },

  getLoadingRowItemCount() {
    return this.isPerformanceConstrained()
      ? HOME_LOADING_ROW_ITEMS_CONSTRAINED
      : HOME_LOADING_ROW_ITEMS_DEFAULT;
  },

  getScrollDuration(base) {
    const baseline = Number.isFinite(base) ? base : 150;
    if (this.isPerformanceConstrained()) {
      return Math.min(baseline, 120);
    }
    return baseline + 40;
  },

  cancelScheduledRender() {
    if (this.homeRenderFrame) {
      cancelAnimationFrame(this.homeRenderFrame);
      this.homeRenderFrame = null;
    }
  },

  requestRender() {
    if (!this.container || Router.getCurrent() !== "home") {
      return;
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
    if (!contentId) {
      return;
    }
    const matchesItem = (entry) => {
      if (String(entry?.contentId || "") !== contentId) {
        return false;
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
    const delay = previous > 0 && (now - previous) < MODERN_HOME_CONSTANTS.heroRapidNavThresholdMs
      ? MODERN_HOME_CONSTANTS.heroRapidSettleMs
      : MODERN_HOME_CONSTANTS.heroFocusDelayMs;
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
      const backdrop = node.querySelector(".home-poster-expanded-backdrop[data-src]");
      if (backdrop) {
        const src = String(backdrop.dataset.src || "").trim();
        if (src && !backdrop.getAttribute("src")) {
          backdrop.setAttribute("src", src);
        }
        backdrop.removeAttribute("data-src");
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

  mountTrailerLayer(container, source, onReady = null) {
    if (!container || !source) {
      return;
    }
    this.clearTrailerLayer(container);
    if (source.kind === "youtube" && source.embedUrl) {
      const frame = document.createElement("iframe");
      frame.className = "home-inline-trailer-frame";
      frame.src = source.embedUrl;
      frame.title = "Trailer preview";
      frame.allow = "autoplay; encrypted-media; picture-in-picture";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.addEventListener("load", () => {
        container.classList.add("is-active");
        onReady?.();
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
        video.muted = shouldMute;
        video.defaultMuted = shouldMute;
        try {
          video.volume = shouldMute ? 0 : 1;
        } catch (_) {
        }
        const activate = () => {
          container.classList.add("is-active");
          onReady?.();
        };
        video.addEventListener("loadeddata", activate, { once: true });
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => { });
        }
      } else {
        container.classList.add("is-active");
        onReady?.();
      }
    }
  },

  collapseFocusedPoster(node = this.expandedPosterNode) {
    const target = node || null;
    if (target) {
      target.classList.remove("is-expanded", "is-trailer-active");
      this.clearTrailerLayer(target.querySelector(".home-poster-trailer-layer"));
    }
    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    this.clearTrailerLayer(heroLayer);
    this.container?.querySelector(".home-modern-hero-media")?.classList.remove("trailer-active");
    if (this.expandedPosterNode === target) {
      this.expandedPosterNode = null;
    }
  },

  expandFocusedPoster(node) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
    if (this.expandedPosterNode && this.expandedPosterNode !== node) {
      this.collapseFocusedPoster(this.expandedPosterNode);
    }
    node.classList.add("is-expanded");
    this.hydrateFocusedPosterAssets(node, { defer: true });
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
    const shouldPreviewTrailer = Boolean(prefs.focusedPosterBackdropTrailerEnabled);
    const trailerTarget = String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase();
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer) {
      return;
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

    if (trailerTarget === "expanded_card" && shouldExpand) {
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
    const root = this.homeTruncationScope || this.container;
    this.homeTruncationScope = null;
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
      const fullText = shouldRefresh ? currentText : storedText;
      if (!fullText) {
        return;
      }
      node.dataset.fullText = fullText;
      node.textContent = fullText;
      const fits = node.scrollWidth <= (node.clientWidth + 1)
        && node.scrollHeight <= (node.clientHeight + 1);
      if (fits) {
        node.classList.remove("is-truncated");
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
    const shouldRun = Boolean(shouldExpand || prefs.focusedPosterBackdropTrailerEnabled);
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
    const defaultDelayMs = Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
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

  ensureMainVerticalVisibility(target, direction = null, current = null) {
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
    const anchorTop = anchorRect.top - mainRect.top + main.scrollTop;
    const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop;

    if (this.layoutMode === "modern") {
      const currentAnchor = this.getMainFocusAnchor(current);
      const sameAnchor = Boolean(currentAnchor && currentAnchor === anchor);
      const isHorizontalMove = direction === "left" || direction === "right";
      const anchorFullyVisible = anchorRect.top >= visibleTop && anchorRect.bottom <= visibleBottom;
      if (isHorizontalMove && sameAnchor && anchorFullyVisible) {
        return;
      }
      const centeredScrollTop = anchorTop - Math.max(0, (main.clientHeight - anchor.offsetHeight) / 2);
      if (Math.abs(Number(main.scrollTop || 0) - centeredScrollTop) <= 1) {
        return;
      }
      this.animateScroll(main, "y", centeredScrollTop, this.getScrollDuration(150));
      return;
    }

    if (anchorRect.top < visibleTop) {
      this.animateScroll(main, "y", anchorTop - inset, this.getScrollDuration(150));
      return;
    }

    if (anchorRect.bottom > visibleBottom) {
      const targetScrollTop = anchorBottom - main.clientHeight + 24;
      this.animateScroll(main, "y", targetScrollTop, this.getScrollDuration(150));
    }
  },

  ensureTrackHorizontalVisibility(target, direction = null) {
    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return;
    }
    let leftPadding = this.getTrackEdgePadding();
    let rightPadding = leftPadding;
    const cachedLeft = Number.parseFloat(track.dataset.trackPadLeft || "");
    const cachedRight = Number.parseFloat(track.dataset.trackPadRight || "");
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
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const visibleLeft = track.scrollLeft + leftPadding;
    const visibleRight = track.scrollLeft + track.clientWidth - safeRightPadding;

    if (targetLeft < visibleLeft) {
      this.animateScroll(track, "x", targetLeft - leftPadding, this.getScrollDuration(160));
      return;
    }
    if (targetRight > visibleRight) {
      this.animateScroll(track, "x", targetRight - track.clientWidth + safeRightPadding, this.getScrollDuration(160));
      return;
    }
    if (this.layoutMode !== "modern" && !direction) {
      const targetCenter = targetLeft + (target.offsetWidth / 2);
      const centeredLeft = targetCenter - (track.clientWidth / 2);
      this.animateScroll(track, "x", centeredLeft, this.getScrollDuration(160));
    }
  },

  focusNode(current, target, direction = null) {
    if (!current || !target || current === target) {
      return false;
    }
    current.classList.remove("focused");
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target, { suppressDelegatedFocus: true });
    this.setSidebarExpanded(this.isSidebarNode(target));
    if (this.isMainNode(target)) {
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      this.ensureTrackHorizontalVisibility(target, direction);
      this.ensureMainVerticalVisibility(target, direction, current);
      this.scheduleModernHeroUpdate(target);
      this.scheduleFocusedPosterFlow(target);
    } else {
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
    this.lastMainFocus = rows[0]?.[0] || null;
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
    const current = this.container.querySelector(".focusable.focused")
      || this.container?.querySelector(".focusable")
      || null;
    if (!current) {
      return false;
    }
    const isSidebar = this.isSidebarNode(current);

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    if (event?.repeat) {
      const now = Date.now();
      if (Number(this.lastDirectionalKeyAt || 0) > 0 &&
        (now - Number(this.lastDirectionalKeyAt || 0)) < MODERN_HOME_CONSTANTS.keyRepeatThrottleMs
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
        return this.focusNode(current, target, direction) || true;
      }
      if (direction === "down") {
        const target = nav.sidebar[Math.min(nav.sidebar.length - 1, sidebarIndex + 1)] || current;
        return this.focusNode(current, target, direction) || true;
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
      if (this.focusNode(current, targetInRow, direction)) {
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
      return this.focusNode(current, sidebarFallback, direction) || true;
    }

    if (direction === "right") {
      const target = rowNodes[col + 1] || null;
      return this.focusNode(current, target, direction) || true;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRow = row + delta;
      const targetRowNodes = nav.rows[targetRow] || null;
      if (!targetRowNodes || !targetRowNodes.length) {
        return true;
      }
      const target = this.resolvePreferredNodeForRow(targetRowNodes, col);
      return this.focusNode(current, target, direction) || true;
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
    if (this.boundHomeEventContainer === this.container) {
      return;
    }
    if (this.boundHomeEventContainer) {
      this.boundHomeEventContainer.removeEventListener("focusin", this.boundHomeFocusInHandler);
      this.boundHomeEventContainer.removeEventListener("click", this.boundHomeClickHandler);
    }
    this.container.addEventListener("focusin", this.boundHomeFocusInHandler);
    this.container.addEventListener("click", this.boundHomeClickHandler);
    this.boundHomeEventContainer = this.container;
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
    this.container.innerHTML = `
      <div class="home-boot">
        <img src="assets/brand/app_logo_wordmark.png" class="home-boot-logo" alt="Nuvio" />
        <div class="home-boot-shimmer"></div>
      </div>
    `;
    const bootNode = this.container.querySelector(".home-boot");
    if (bootNode) {
      bootNode.style.background = bootBackground;
    }
    await this.loadData({ background: false });
  },

  async loadData({ background = false } = {}) {
    const token = this.homeLoadToken;
    const prefs = LayoutPreferences.get();
    this.layoutPrefs = prefs;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();

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

    const initialCatalogLoad = (Platform.isWebOS() || Platform.isTizen())
      ? Math.min(HOME_INITIAL_CATALOG_LOAD, 6)
      : HOME_INITIAL_CATALOG_LOAD;
    const initialDescriptors = catalogDescriptors.slice(0, initialCatalogLoad);
    const deferredDescriptors = catalogDescriptors.slice(initialCatalogLoad);

    const initialRows = await this.fetchCatalogRows(initialDescriptors, { allowLoading: true });
    if (token !== this.homeLoadToken) {
      return;
    }
    this.rows = this.sortAndFilterRows(initialRows);
    if (!preserveContinueWatching) {
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
    this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
    this.hasLoadedOnce = true;
    this.render();
    sidebarProfilePromise.then((profile) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      if (profile) {
        this.sidebarProfile = profile;
        this.requestRender();
      }
    });

    if (deferredDescriptors.length) {
      this.fetchCatalogRows(deferredDescriptors, { allowLoading: true }).then((extraRows) => {
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
        this.requestRender();
        this.retryPendingCatalogRows();
      }).catch((error) => {
        console.warn("Deferred home rows load failed", error);
      });
    }

    if (this.layoutMode !== "modern") {
      this.enrichHero(this.heroCandidates[0] || null).then(() => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.applyHeroToDom();
      }).catch((error) => {
        console.warn("Hero async enrichment failed", error);
      });
    }

    (async () => {
      const [allProgress, continueWatching] = await Promise.all([progressAllPromise, recentProgressPromise]);
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.allProgress = Array.isArray(allProgress) ? allProgress : [];
      this.continueWatching = Array.isArray(continueWatching) ? continueWatching : [];
      const needsNextUp = this.continueWatching.some((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        || this.allProgress.some((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type));
      this.watchedItems = needsNextUp ? await watchedItemsRepository.getAll(2000).catch(() => []) : [];
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.nextUpProgressCandidates = this.selectNextUpProgressCandidates(this.allProgress, this.continueWatching)
        .slice(0, CW_MAX_NEXT_UP_LOOKUPS);
      const shouldShowLoading = Boolean((this.continueWatching?.length || 0) + (this.nextUpProgressCandidates?.length || 0));
      if (!suppressContinueWatchingLoading) {
        this.continueWatchingLoading = shouldShowLoading;
        this.continueWatchingDisplay = [];
        this.requestRender();
      }

      if (!shouldShowLoading) {
        if (suppressContinueWatchingLoading && (progressAllError || recentProgressError)) {
          this.continueWatchingLoading = false;
          return;
        }
        if (preserveContinueWatching) {
          const nextSignature = "";
          if (nextSignature === previousContinueWatchingSignature) {
            this.continueWatchingLoading = false;
            return;
          }
        }
        this.continueWatchingLoading = false;
        this.continueWatchingDisplay = [];
        this.requestRender();
        return;
      }

      try {
        const enriched = await this.enrichContinueWatching(this.continueWatching, {
          allProgress: this.allProgress,
          watchedItems: this.watchedItems,
          nextUpProgressCandidates: this.nextUpProgressCandidates
        });
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        const nextDisplayStrict = buildVisibleContinueWatchingItems(enriched, { requireArtwork: true });
        const nextDisplay = nextDisplayStrict.length
          ? nextDisplayStrict
          : buildVisibleContinueWatchingItems(enriched, { requireArtwork: false });
        const nextSignature = preserveContinueWatching
          ? buildContinueWatchingSignature(nextDisplay)
          : "";
        if (preserveContinueWatching && nextSignature === previousContinueWatchingSignature) {
          this.continueWatchingLoading = false;
          return;
        }
        this.continueWatchingDisplay = nextDisplay;
        this.continueWatchingLoading = false;
        if (this.layoutMode === "modern" && this.continueWatchingDisplay.length) {
          this.heroItem = this.pickInitialHero();
          if (!background && !this.hasAppliedInitialContinueWatchingFocus) {
            this.forceInitialContinueWatchingFocus = true;
          }
        }
        this.requestRender();
      } catch (error) {
        console.warn("Continue watching async enrichment failed", error);
        this.continueWatchingLoading = false;
        if (!suppressContinueWatchingLoading) {
          this.requestRender();
        }
      }
    })().catch((error) => {
      console.warn("Continue watching load failed", error);
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.continueWatchingLoading = false;
      if (!suppressContinueWatchingLoading) {
        this.requestRender();
      }
    });

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
    const rowResults = await Promise.all((descriptors || []).map(async (catalog) => {
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
    return rowResults
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
    const attempts = pendingRows.map(async (row) => {
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
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        if (result?.status !== "success") {
          return;
        }
        const updatedRow = {
          ...row,
          result
        };
        const combinedByKey = new Map((this.rows || []).map((entry) => [entry.homeCatalogKey, entry]));
        combinedByKey.set(updatedRow.homeCatalogKey, updatedRow);
        this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()));
        this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
        if (!this.heroItem) {
          this.heroItem = this.pickInitialHero();
        }
        this.requestRender();
      } catch (error) {
        console.warn("Retry catalog row load failed", error);
      }
    });
    Promise.allSettled(attempts).finally(() => {
      if (token === this.homeLoadToken) {
        this.catalogRetryInFlight = false;
      }
    });
  },

  render() {
    this.cancelScheduledRender();
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
    const layoutClass = `home-layout-${this.layoutMode}`;
    const showPosterLabels = this.layoutPrefs?.posterLabelsEnabled !== false;
    const showCatalogAddonName = this.layoutPrefs?.catalogAddonNameEnabled !== false;
    const showCatalogTypeSuffix = this.layoutPrefs?.catalogTypeSuffixEnabled !== false;
    const modernLandscapePostersEnabled = this.layoutMode === "modern"
      && Boolean(this.layoutPrefs?.modernLandscapePostersEnabled);
    const focusState = retainedFocusState && retainedFocusState.focusKind === "item"
      ? retainedFocusState
      : null;
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
        rows: this.rows,
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
      const legacyRowsPayload = renderLegacyCatalogRowsMarkup(this.rows, {
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

    bindRootSidebarEvents(this.container, {
      currentRoute: "home",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    const canAttemptRestore = Boolean(retainedFocusState);
    let restoredFocus = false;
    if (this.continueWatchingMenu) {
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

  selectNextUpProgressCandidates(allProgress = [], inProgressItems = []) {
    const cutoffMs = Date.now() - (CW_DAYS_CAP * 24 * 60 * 60 * 1000);
    const inProgressSeriesIds = new Set(
      (Array.isArray(inProgressItems) ? inProgressItems : [])
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
        .map((item) => String(item?.contentId || "").trim())
        .filter(Boolean)
    );

    const latestCompletedByContent = new Map();
    (Array.isArray(allProgress) ? allProgress : []).forEach((entry) => {
      if (Number(entry?.updatedAt || 0) < cutoffMs) {
        return;
      }
      const contentId = String(entry?.contentId || "").trim();
      if (!contentId || inProgressSeriesIds.has(contentId)) {
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

  resolveNextUpEpisode(meta = {}, completedProgress = {}, allProgress = [], watchedEpisodeKeys = new Set()) {
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
      return candidate;
    }

    return null;
  },

  async buildNextUpItems({
    allProgress = [],
    inProgressItems = [],
    nextUpProgressCandidates = [],
    watchedItems = []
  } = {}) {
    const resolvedCandidates = (Array.isArray(nextUpProgressCandidates) && nextUpProgressCandidates.length)
      ? nextUpProgressCandidates
      : this.selectNextUpProgressCandidates(allProgress, inProgressItems);

    if (!resolvedCandidates.length) {
      return [];
    }

    const neededSlots = Math.max(0, CW_MAX_VISIBLE_ITEMS - Math.min(CW_MAX_VISIBLE_ITEMS, Number(inProgressItems?.length || 0)));
    const lookupCount = Math.min(CW_MAX_NEXT_UP_LOOKUPS, neededSlots || CW_MAX_VISIBLE_ITEMS);
    const limitedCandidates = resolvedCandidates.slice(0, lookupCount);
    const watchedEpisodeIndex = this.buildWatchedEpisodeIndex(watchedItems);

    const nextUpItems = await Promise.all(limitedCandidates.map(async (progressEntry) => {
      const contentType = String(progressEntry?.contentType || "series").toLowerCase();
      const contentId = String(progressEntry?.contentId || "").trim();
      if (!contentId || !isSeriesTypeForContinueWatching(contentType)) {
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
      const nextEpisode = this.resolveNextUpEpisode(meta, progressEntry, allProgress, watchedEpisodeKeys);
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
      watchedItems: options?.watchedItems || []
    });

    const inProgressSeriesIds = new Set(
      inProgressItems
        .filter((item) => isSeriesTypeForContinueWatching(item?.contentType || item?.type))
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
    this.stopHeroRotation();
    this.cancelPendingHeroFocus();
    this.cancelFocusedPosterFlow();
    this.clearFocusedPosterFlowState();
    this.collapseFocusedPoster();
    this.teardownGridStickyHeader();
    if (this.homeTruncationFrame) {
      cancelAnimationFrame(this.homeTruncationFrame);
      this.homeTruncationFrame = null;
    }
    this.homeTruncationScope = null;
    ScreenUtils.hide(this.container);
  }
};
