import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { Platform } from "../../../platform/index.js";
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

const HERO_ROTATE_FIRST_DELAY_MS = 20000;
const HERO_ROTATE_INTERVAL_MS = 10000;
const HOME_LAYOUT_SEQUENCE = ["modern", "grid", "classic"];

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
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
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

function buildYoutubeEmbedUrl(videoId) {
  const cleanId = resolveYoutubeId(videoId);
  if (!cleanId) {
    return "";
  }
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    vq: "hd2160"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  const href = String(globalThis?.location?.href || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  if (/^https?:\/\//i.test(href)) {
    params.set("widget_referrer", href);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

function scoreTrailerStream(entry = {}) {
  const text = [
    entry?.quality,
    entry?.label,
    entry?.name,
    entry?.title,
    entry?.description,
    entry?.resolution
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const width = Number(entry?.width || 0);
  const height = Number(entry?.height || entry?.resolutionHeight || 0);
  const bitrate = Number(entry?.bitrate || 0);
  let score = 0;

  if (width >= 3840 || height >= 2160 || /2160|4k|uhd/.test(text)) score += 120;
  else if (width >= 2560 || height >= 1440 || /1440|2k|qhd/.test(text)) score += 90;
  else if (width >= 1920 || height >= 1080 || /1080|full\s*hd|fhd/.test(text)) score += 70;
  else if (width >= 1280 || height >= 720 || /720|hd\b/.test(text)) score += 45;
  else if (width > 0 || height > 0) score += 20;

  score += Math.max(0, Math.min(20, Math.round(bitrate / 500000)));

  if (/hdr|dolby/.test(text)) score += 8;
  if (/hevc|h265|av1/.test(text)) score += 6;

  return score;
}

function resolveTrailerSource(meta = {}) {
  const trailerStreams = Array.isArray(meta?.trailerStreams) ? meta.trailerStreams : [];
  const directVideo = trailerStreams
    .filter((entry) => {
      const url = String(entry?.url || entry?.videoUrl || entry?.stream || "").trim();
      return /^https?:\/\//i.test(url);
    })
    .sort((left, right) => scoreTrailerStream(right) - scoreTrailerStream(left))[0];
  if (directVideo) {
    return {
      kind: "video",
      url: String(directVideo.url || directVideo.videoUrl || directVideo.stream || "").trim()
    };
  }

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
      return {
        kind: "youtube",
        ytId,
        embedUrl: buildYoutubeEmbedUrl(ytId)
      };
    }
  }

  const fallbackId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!fallbackId) {
    return null;
  }
  return {
    kind: "youtube",
    ytId: fallbackId,
    embedUrl: buildYoutubeEmbedUrl(fallbackId)
  };
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

function buildProgressStatus(item) {
  const durationMs = Number(item?.durationMs || 0);
  const positionMs = Number(item?.positionMs || 0);
  if (!durationMs || !positionMs) {
    return "Continue";
  }
  const remainingMinutes = Math.max(0, Math.round((durationMs - positionMs) / 60000));
  const progress = Math.max(0, Math.min(1, positionMs / durationMs));
  if (progress >= 0.85 || remainingMinutes <= 10) {
    return "Almost done";
  }
  if (remainingMinutes > 0) {
    return `${remainingMinutes}m left`;
  }
  return "Continue";
}

function buildProgressFraction(item) {
  const durationMs = Number(item?.durationMs || 0);
  const positionMs = Number(item?.positionMs || 0);
  if (!durationMs || !positionMs) {
    return 0;
  }
  return Math.max(0, Math.min(1, positionMs / durationMs));
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
  const isSeries = type.toLowerCase() === "series";
  return {
    ...item,
    heroSource: "continueWatching",
    id: String(item.contentId || item.id || "").trim(),
    contentId: String(item.contentId || item.id || "").trim(),
    type,
    apiType: type,
    name: title,
    title,
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
          ${display.backdrop ? `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}" alt="${escapeAttribute(display.title)}" />` : '<div class="home-hero-backdrop placeholder"></div>'}
        </div>
        <div class="home-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" />` : ""}
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
  return `
    <article class="home-content-card home-continue-card focusable"
             data-action="resumeProgress"
             data-cw-index="${index}"
             data-item-id="${escapeAttribute(normalized.contentId)}"
             data-item-type="${escapeAttribute(normalized.type || "movie")}"
             data-item-title="${escapeAttribute(normalized.title || "Untitled")}">
      <div class="home-continue-media"${normalized.poster ? ` style="background-image:url('${escapeAttribute(normalized.poster)}')"` : ""}>
        <span class="home-continue-badge">${escapeHtml(normalized.progressStatus || "Continue")}</span>
        <div class="home-continue-copy">
          ${normalized.episodeCode ? `<div class="home-continue-kicker">${escapeHtml(normalized.episodeCode)}</div>` : ""}
          <div class="home-continue-title">${escapeHtml(normalized.title)}</div>
          <div class="home-continue-subtitle">${escapeHtml(subtitle || "Continue watching")}</div>
        </div>
        <div class="home-continue-progress"><span style="width:${Math.round((normalized.progressFraction || 0) * 100)}%"></span></div>
      </div>
    </article>
  `;
}

function renderContinueWatchingSection(items = [], options = {}) {
  if (!items.length) {
    return "";
  }
  const rowKey = String(options?.rowKey || "").trim();
  return `
    <section class="home-row home-row-continue"${rowKey ? ` data-row-key="${escapeAttribute(rowKey)}"` : ""}>
      <div class="home-row-head">
        <h2 class="home-row-title">Continue Watching</h2>
      </div>
      <div class="home-track home-track-continue"${rowKey ? ` data-track-row-key="${escapeAttribute(rowKey)}"` : ""}>
        ${items.map((item, index) => renderContinueWatchingCard(item, index)).join("")}
      </div>
    </section>
  `;
}

function renderLegacyCatalogRowsMarkup(rows = [], options = {}) {
  const {
    layoutMode = "classic",
    showPosterLabels = true,
    showCatalogAddonName = true,
    showCatalogTypeSuffix = true
  } = options;
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];

  rows.forEach((rowData, rowIndex) => {
    const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
    if (!items.length) {
      return;
    }

    const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
    catalogSeeAllMap.set(seeAllId, {
      addonBaseUrl: rowData.addonBaseUrl || "",
      addonId: rowData.addonId || "",
      addonName: rowData.addonName || "",
      catalogId: rowData.catalogId || "",
      catalogName: rowData.catalogName || "",
      type: rowData.type || "movie",
      initialItems: items
    });

    const rowKey = buildModernRowKey(rowData);
    const rowTitle = formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
    const rowSubtitle = layoutMode === "classic" && showCatalogAddonName && rowData.addonName
      ? `from ${rowData.addonName}`
      : "";
    const hasSeeAll = items.length >= 15;
    const visibleItems = layoutMode === "grid"
      ? (hasSeeAll ? items.slice(0, 14) : items.slice(0, 15))
      : items.slice(0, 15);
    const cardsMarkup = visibleItems.map((item, itemIndex) => createPosterCardMarkup(
      item,
      rowIndex,
      itemIndex,
      rowData.type,
      showPosterLabels,
      layoutMode
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

function createPosterCardMarkup(item, rowIndex, itemIndex, itemType, showLabels = true, layoutMode = "classic") {
  const normalized = normalizeCatalogItem(item, itemType);
  const subtitle = buildPosterSubtitle(normalized, layoutMode);
  const expandedMeta = buildExpandedPosterMeta(normalized);
  const backdropSrc = firstNonEmpty(normalized.background, normalized.backdrop, normalized.backdropUrl, normalized.poster);
  const posterSrc = firstNonEmpty(normalized.poster, normalized.thumbnail, normalized.backdrop, normalized.backdropUrl);
  const expandedVisualSrc = firstNonEmpty(backdropSrc, posterSrc);
  return `
    <article class="home-content-card home-poster-card focusable"
             data-action="openDetail"
             data-row-index="${rowIndex}"
             data-item-index="${itemIndex}"
             data-item-id="${escapeAttribute(normalized.id)}"
             data-item-type="${escapeAttribute(normalized.type || itemType || "movie")}"
             data-item-title="${escapeAttribute(normalized.name || "Untitled")}"
             data-poster-src="${escapeAttribute(posterSrc || "")}"
             data-backdrop-src="${escapeAttribute(backdropSrc || "")}"
             data-logo-src="${escapeAttribute(normalized.logo || "")}">
      <div class="home-poster-frame">
        ${posterSrc
          ? `<img class="content-poster" src="${escapeAttribute(posterSrc)}" decoding="async" alt="${escapeAttribute(normalized.name || "content")}" />`
          : '<div class="content-poster placeholder"></div>'}
        ${expandedVisualSrc
          ? `<img class="home-poster-expanded-backdrop" data-src="${escapeAttribute(expandedVisualSrc)}" decoding="async" alt="" aria-hidden="true" />`
          : '<div class="home-poster-expanded-backdrop placeholder" aria-hidden="true"></div>'}
        <div class="home-poster-trailer-layer"></div>
        <div class="home-poster-expanded-gradient"></div>
        <div class="home-poster-expanded-brand">
          ${normalized.logo
            ? `<img class="home-poster-expanded-logo" data-src="${escapeAttribute(normalized.logo)}" decoding="async" alt="${escapeAttribute(normalized.name || "content")}" />`
            : `<div class="home-poster-expanded-title">${escapeHtml(normalized.name || "Untitled")}</div>`}
        </div>
      </div>
      <div class="home-poster-expanded-copy">
        ${expandedMeta ? `<div class="home-poster-expanded-meta">${escapeHtml(expandedMeta)}</div>` : ""}
        ${normalized.description ? `<div class="home-poster-expanded-description">${escapeHtml(normalized.description)}</div>` : ""}
      </div>
      ${showLabels ? `
        <div class="home-poster-copy">
          <div class="home-poster-title">${escapeHtml(normalized.name || "Untitled")}</div>
          ${subtitle ? `<div class="home-poster-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

export const HomeScreen = {
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

    const focused = this.container.querySelector(".home-main .focusable.focused");
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
    if (this.layoutMode === "modern") {
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
        brandNode.insertAdjacentHTML("afterbegin", `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title || "logo")}" />`);
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

  focusWithoutAutoScroll(target) {
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

  hydrateFocusedPosterAssets(node) {
    if (!this.isModernPosterNode(node)) {
      return;
    }
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
  },

  clearTrailerLayer(container) {
    if (!container) {
      return;
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

  mountTrailerLayer(container, source) {
    if (!container || !source) {
      return;
    }
    this.clearTrailerLayer(container);
    if (source.kind === "youtube" && source.embedUrl) {
      container.innerHTML = `
        <iframe class="home-inline-trailer-frame"
                src="${escapeAttribute(source.embedUrl)}"
                title="Trailer preview"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowfullscreen
                referrerpolicy="strict-origin-when-cross-origin"></iframe>
      `;
      container.classList.add("is-active");
      return;
    }
    if (source.kind === "video" && source.url) {
      container.innerHTML = `
        <video class="home-inline-trailer-video" autoplay muted loop playsinline>
          <source src="${escapeAttribute(source.url)}" />
        </video>
      `;
      const video = container.querySelector("video");
      if (video) {
        const activate = () => container.classList.add("is-active");
        video.addEventListener("loadeddata", activate, { once: true });
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => {});
        }
      } else {
        container.classList.add("is-active");
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
    this.hydrateFocusedPosterAssets(node);
    if (this.expandedPosterNode && this.expandedPosterNode !== node) {
      this.collapseFocusedPoster(this.expandedPosterNode);
    }
    node.classList.add("is-expanded");
    this.expandedPosterNode = node;
  },

  async getTrailerSourceForItem(item) {
    const itemId = String(item?.id || item?.contentId || "").trim();
    const itemType = String(item?.type || item?.apiType || "movie").trim() || "movie";
    if (!itemId) {
      return null;
    }
    const cache = this.trailerPreviewCache || (this.trailerPreviewCache = new Map());
    const cacheKey = `${itemType}:${itemId}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) || null;
    }
    try {
      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(itemType, itemId),
        2200,
        { status: "error", message: "timeout" }
      );
      const source = result?.status === "success" ? resolveTrailerSource(result?.data || {}) : null;
      cache.set(cacheKey, source || null);
      return source || null;
    } catch (error) {
      console.warn("Home trailer preview lookup failed", error);
      cache.set(cacheKey, null);
      return null;
    }
  },

  async activateFocusedPosterFlow(node) {
    if (!this.isModernPosterNode(node) || !node.classList.contains("focused")) {
      return;
    }
    const prefs = this.layoutPrefs || {};
    const shouldExpand = Boolean(prefs.focusedPosterBackdropExpandEnabled);
    const shouldPreviewTrailer = Boolean(prefs.focusedPosterBackdropTrailerEnabled);
    const trailerTarget = String(prefs.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase();
    if (shouldExpand) {
      this.expandFocusedPoster(node);
    }
    if (!shouldPreviewTrailer) {
      return;
    }

    const sourceItem = this.getNodeHeroSource(node);
    const source = await this.getTrailerSourceForItem(sourceItem);
    if (!source || !node.classList.contains("focused")) {
      return;
    }

    if (trailerTarget === "expanded_card" && shouldExpand) {
      const trailerLayer = node.querySelector(".home-poster-trailer-layer");
      if (trailerLayer) {
        this.mountTrailerLayer(trailerLayer, source);
        node.classList.add("is-trailer-active");
      }
      return;
    }

    const heroLayer = this.container?.querySelector(".home-hero-trailer-layer");
    const heroMedia = this.container?.querySelector(".home-modern-hero-media");
    if (heroLayer && heroMedia) {
      this.mountTrailerLayer(heroLayer, source);
      heroMedia.classList.add("trailer-active");
    }
  },

  cancelFocusedPosterFlow() {
    if (this.focusedPosterTimer) {
      clearTimeout(this.focusedPosterTimer);
      this.focusedPosterTimer = null;
    }
  },

  scheduleFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
    const prefs = this.layoutPrefs || {};
    const shouldExpand = Boolean(prefs.focusedPosterBackdropExpandEnabled);
    const shouldRun = Boolean(shouldExpand || prefs.focusedPosterBackdropTrailerEnabled);
    if (!shouldRun) {
      this.collapseFocusedPoster();
      return;
    }
    if (!this.isModernPosterNode(node)) {
      this.collapseFocusedPoster();
      return;
    }
    if (shouldExpand) {
      this.hydrateFocusedPosterAssets(node);
    }

    if (this.expandedPosterNode && this.expandedPosterNode !== node) {
      this.collapseFocusedPoster(this.expandedPosterNode);
    }
    const delayMs = Math.max(0, Number(prefs.focusedPosterBackdropExpandDelaySeconds ?? 3)) * 1000;
    this.focusedPosterTimer = setTimeout(() => {
      this.activateFocusedPosterFlow(node).catch((error) => {
        console.warn("Focused poster flow failed", error);
      });
    }, delayMs);
  },

  resetFocusedPosterFlow(node) {
    if (this.layoutMode !== "modern") {
      return;
    }
    this.cancelFocusedPosterFlow();
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

  ensureMainVerticalVisibility(target) {
    const main = this.layoutMode === "modern"
      ? this.container?.querySelector(".home-modern-rows-viewport")
      : this.container?.querySelector(".home-main");
    if (!main || !target || !this.container?.contains(target)) {
      return;
    }
    const row = target.closest(".home-row, .home-grid-section");
    const anchor = row || target.closest(".home-hero") || target;
    const mainRect = main.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inset = this.getRowFocusInset();
    const visibleTop = mainRect.top + inset;
    const visibleBottom = mainRect.bottom - 24;
    const anchorTop = anchorRect.top - mainRect.top + main.scrollTop;
    const anchorBottom = anchorRect.bottom - mainRect.top + main.scrollTop;

    if (this.layoutMode === "modern") {
      const centeredScrollTop = anchorTop - Math.max(0, (main.clientHeight - anchor.offsetHeight) / 2);
      this.animateScroll(main, "y", centeredScrollTop, 150);
      return;
    }

    if (anchorRect.top < visibleTop) {
      this.animateScroll(main, "y", anchorTop - inset, 150);
      return;
    }

    if (anchorRect.bottom > visibleBottom) {
      const targetScrollTop = anchorBottom - main.clientHeight + 24;
      this.animateScroll(main, "y", targetScrollTop, 150);
    }
  },

  ensureTrackHorizontalVisibility(target, direction = null) {
    const track = target?.closest?.(".home-track, .home-grid-track");
    if (!track) {
      return;
    }
    if (this.layoutMode !== "modern") {
      const targetCenter = target.offsetLeft + (target.offsetWidth / 2);
      const centeredLeft = targetCenter - (track.clientWidth / 2);
      this.animateScroll(track, "x", centeredLeft, 160);
      return;
    }
    const edgePadding = this.getTrackEdgePadding();
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const viewLeft = track.scrollLeft;
    const viewRight = viewLeft + track.clientWidth;
    const visibleLeft = viewLeft + edgePadding;
    const visibleRight = viewRight - edgePadding;

    if (targetRight > visibleRight) {
      const nextLeft = direction === "right"
        ? targetRight - track.clientWidth + edgePadding
        : targetLeft - edgePadding;
      this.animateScroll(track, "x", nextLeft, 140);
      return;
    }

    if (targetLeft < visibleLeft) {
      this.animateScroll(track, "x", targetLeft - edgePadding, 140);
    }
  },

  focusNode(current, target, direction = null) {
    if (!current || !target || current === target) {
      return false;
    }
    current.classList.remove("focused");
    target.classList.add("focused");
    this.focusWithoutAutoScroll(target);
    this.setSidebarExpanded(this.isSidebarNode(target));
    if (this.isMainNode(target)) {
      this.lastMainFocus = target;
      this.rememberMainRowFocus(target);
      this.ensureTrackHorizontalVisibility(target, direction);
      this.ensureMainVerticalVisibility(target);
      this.scheduleModernHeroUpdate(target);
      this.scheduleFocusedPosterFlow(target);
    } else {
      this.cancelPendingHeroFocus();
      this.cancelFocusedPosterFlow();
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
    const all = Array.from(this.container?.querySelectorAll(".focusable") || []);
    const current = this.container.querySelector(".focusable.focused") || all[0];
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
        const target = event?.target?.closest?.(".home-main .focusable");
        if (!target || !this.container?.contains(target)) {
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
          Router.navigate("detail", {
            itemId: target.dataset.itemId,
            itemType: target.dataset.itemType || "movie",
            fallbackTitle: target.dataset.itemTitle || target.dataset.itemId || "Untitled"
          });
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

  async mount() {
    this.container = document.getElementById("home");
    ScreenUtils.show(this.container);
    this.ensureDelegatedEventsBound();
    this.homeRouteEnterPending = true;
    const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
    const profileChanged = activeProfileId !== String(this.loadedProfileId || "");
    if (profileChanged) {
      this.hasLoadedOnce = false;
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
    this.container.innerHTML = `
      <div class="home-boot">
        <img src="assets/brand/app_logo_wordmark.png" class="home-boot-logo" alt="Nuvio" />
        <div class="home-boot-shimmer"></div>
      </div>
    `;
    await this.loadData({ background: false });
  },

  async loadData() {
    const token = this.homeLoadToken;
    const prefs = LayoutPreferences.get();
    this.layoutPrefs = prefs;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.layoutMode = String(prefs.homeLayout || "classic").toLowerCase();

    const addons = await addonRepository.getInstalledAddons();
    const catalogDescriptors = [];

    addons.forEach((addon) => {
      addon.catalogs
        .filter((catalog) => !isSearchOnlyCatalog(catalog))
        .slice(0, 8)
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

    const initialDescriptors = catalogDescriptors.slice(0, 8);
    const deferredDescriptors = catalogDescriptors.slice(8);

    const initialRows = await this.fetchCatalogRows(initialDescriptors);
    if (token !== this.homeLoadToken) {
      return;
    }
    this.rows = this.sortAndFilterRows(initialRows);
    this.continueWatching = await watchProgressRepository.getRecent(10);
    if (token !== this.homeLoadToken) {
      return;
    }
    this.continueWatchingDisplay = this.continueWatching.map((item) => ({
      ...item,
      title: prettyId(item.contentId)
    }));
    this.heroCandidates = uniqueById(this.collectHeroCandidates(this.rows).map((item) => normalizeCatalogItem(item)));
    this.heroIndex = 0;
    this.heroItem = this.pickInitialHero();
    this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
    this.sidebarProfile = await getSidebarProfileState();
    this.hasLoadedOnce = true;
    this.render();

    if (deferredDescriptors.length) {
      this.fetchCatalogRows(deferredDescriptors).then((extraRows) => {
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
        this.render();
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

    this.enrichContinueWatching(this.continueWatching).then((enriched) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.continueWatchingDisplay = enriched.map((item) => normalizeContinueWatchingItem(item));
      if (this.layoutMode === "modern" && (!this.heroItem || this.heroItem.heroSource === "continueWatching")) {
        this.heroItem = this.pickInitialHero();
      }
      this.render();
    }).catch((error) => {
      console.warn("Continue watching async enrichment failed", error);
    });
  },

  pickInitialHero() {
    if (this.layoutMode === "modern") {
      const continueHero = normalizeContinueWatchingItem(this.continueWatchingDisplay?.[0] || this.continueWatching?.[0] || null);
      if (continueHero) {
        return continueHero;
      }
    }
    return this.heroCandidates[0] || this.pickHeroItem(this.rows);
  },

  async fetchCatalogRows(descriptors = []) {
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
      }), 3500, { status: "error", message: "timeout" });
      return { ...catalog, result };
    }));
    return rowResults
      .filter((row) => row.result.status === "success")
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

  render() {
    const retainedFocusState = this.captureCurrentFocusState();
    this.cancelFocusedPosterFlow();
    this.expandedPosterNode = null;
    const heroItem = normalizeCatalogItem(this.heroItem || this.heroCandidates?.[this.heroIndex] || this.pickHeroItem(this.rows), "movie");
    const showHeroSection = Boolean(this.layoutPrefs?.heroSectionEnabled) && Boolean(heroItem);
    const layoutClass = `home-layout-${this.layoutMode}`;
    const showPosterLabels = this.layoutPrefs?.posterLabelsEnabled !== false;
    const showCatalogAddonName = this.layoutPrefs?.catalogAddonNameEnabled !== false;
    const showCatalogTypeSuffix = this.layoutPrefs?.catalogTypeSuffixEnabled !== false;
    this.teardownGridStickyHeader();

    let mainContentMarkup = "";
    let modernLayoutPayload = null;

    if (this.layoutMode === "modern") {
      modernLayoutPayload = renderModernHomeLayout({
        rows: this.rows,
        heroItem,
        heroCandidates: this.heroCandidates,
        continueWatchingItems: this.continueWatchingDisplay || [],
        showHeroSection,
        showPosterLabels,
        showCatalogTypeSuffix,
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
        rowKey: "continue_watching"
      });
      const legacyRowsPayload = renderLegacyCatalogRowsMarkup(this.rows, {
        layoutMode: this.layoutMode,
        showPosterLabels,
        showCatalogAddonName,
        showCatalogTypeSuffix
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
    `;

    bindRootSidebarEvents(this.container, {
      currentRoute: "home",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    const restoredFocus = this.restoreFocusState(retainedFocusState);
    if (!restoredFocus) {
      ScreenUtils.setInitialFocus(this.container, this.getInitialFocusSelector());
      const current = this.container.querySelector(".home-main .focusable.focused");
      if (current && this.isMainNode(current)) {
        this.lastMainFocus = current;
        this.scheduleModernHeroUpdate(current);
        this.scheduleFocusedPosterFlow(current);
      }
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

  async enrichContinueWatching(items = []) {
    const enriched = await Promise.all((items || []).map(async (item) => {
      try {
        const result = await withTimeout(
          metaRepository.getMetaFromAllAddons(item.contentType || "movie", item.contentId),
          1800,
          { status: "error", message: "timeout" }
        );
        if (result?.status === "success" && result?.data) {
          return {
            ...item,
            title: result.data.name || prettyId(item.contentId),
            poster: result.data.poster || result.data.thumbnail || result.data.background || result.data.backdrop || null,
            background: result.data.background || result.data.backdrop || result.data.thumbnail || result.data.poster || null,
            backdrop: result.data.backdrop || result.data.background || null,
            thumbnail: result.data.thumbnail || result.data.poster || null,
            logo: result.data.logo || null,
            description: result.data.description || "",
            releaseInfo: result.data.releaseInfo || "",
            imdbRating: resolveImdbRating(result.data),
            genres: Array.isArray(result.data.genres) ? result.data.genres : [],
            runtimeMinutes: Number(result.data.runtimeMinutes ?? result.data.runtime ?? 0) || 0,
            ageRating: firstNonEmpty(result.data.ageRating, result.data.age_rating),
            status: firstNonEmpty(result.data.status),
            language: firstNonEmpty(result.data.language),
            country: firstNonEmpty(result.data.country)
          };
        }
      } catch (error) {
        console.warn("Continue watching enrichment failed", error);
      }
      return {
        ...item,
        title: prettyId(item.contentId),
        poster: null,
        background: null,
        logo: null,
        description: "",
        releaseInfo: "",
        genres: [],
        runtimeMinutes: 0
      };
    }));
    return enriched;
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
    const code = Number(event?.keyCode || 0);
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
      Router.navigate("detail", {
        itemId: current.dataset.itemId,
        itemType: current.dataset.itemType || "movie",
        fallbackTitle: current.dataset.itemTitle || current.dataset.itemId || "Untitled"
      });
    }
  },

  cleanup() {
    this.persistCurrentFocusState();
    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this.stopHeroRotation();
    this.cancelPendingHeroFocus();
    this.cancelFocusedPosterFlow();
    this.collapseFocusedPoster();
    this.teardownGridStickyHeader();
    ScreenUtils.hide(this.container);
  }
};
