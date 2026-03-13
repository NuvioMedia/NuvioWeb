import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { TmdbService } from "../../../core/tmdb/tmdbService.js";
import { TmdbMetadataService } from "../../../core/tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { Environment } from "../../../platform/environment.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function toEpisodeEntry(video = {}) {
  const season = Number(video.season || 0);
  const episode = Number(video.episode || 0);
  const runtimeMinutes = Number(
    video.runtime
    || video.runtimeMinutes
    || video.durationMinutes
    || video.duration
    || 0
  );
  return {
    id: video.id || "",
    title: video.title || video.name || `S${season}E${episode}`,
    season,
    episode,
    thumbnail: video.thumbnail || null,
    overview: video.overview || video.description || "",
    runtimeMinutes: Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 ? runtimeMinutes : 0
  };
}

function normalizeEpisodes(videos = []) {
  return videos
    .map((video) => toEpisodeEntry(video))
    .filter((video) => video.id && video.season > 0 && video.episode > 0)
    .sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
}

function extractCast(meta = {}) {
  const toPhoto = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    if (raw.startsWith("//")) {
      return `https:${raw}`;
    }
    if (raw.startsWith("http://")) {
      return `https://${raw.slice("http://".length)}`;
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw;
    }
    if (raw.startsWith("/")) {
      return `https://image.tmdb.org/t/p/w300${raw}`;
    }
    return raw;
  };
  const members = Array.isArray(meta.castMembers) ? meta.castMembers : [];
  if (members.length) {
    return members
      .map((entry) => ({
        name: entry?.name || "",
        character: entry?.character || entry?.role || "",
        photo: toPhoto(
          entry?.photo
          || entry?.profilePath
          || entry?.profile_path
          || entry?.avatar
          || entry?.image
          || entry?.poster
          || ""
        ),
        tmdbId: entry?.tmdbId || entry?.id || null
      }))
      .filter((entry) => Boolean(entry?.name))
      .slice(0, 18);
  }

  const direct = Array.isArray(meta.cast) ? meta.cast : [];
  if (direct.length) {
    return direct
      .map((entry) => {
        if (typeof entry === "string") {
          return { name: entry, character: "", photo: "", tmdbId: null };
        }
        return {
          name: entry?.name || "",
          character: entry?.character || "",
          photo: toPhoto(
            entry?.photo
            || entry?.profilePath
            || entry?.profile_path
            || entry?.avatar
            || entry?.image
            || entry?.poster
            || ""
          ),
          tmdbId: entry?.tmdbId || entry?.id || null
        };
      })
      .filter((entry) => Boolean(entry?.name))
      .slice(0, 12);
  }

  const credits = meta.credits?.cast;
  if (Array.isArray(credits)) {
    return credits
      .map((entry) => ({
        name: entry?.name || entry?.character || "",
        character: entry?.character || "",
        photo: toPhoto(
          entry?.profile_path
          || entry?.photo
          || entry?.profilePath
          || entry?.avatar_path
          || entry?.avatar
          || entry?.image
          || ""
        ),
        tmdbId: entry?.id || null
      }))
      .filter((entry) => Boolean(entry.name))
      .slice(0, 12);
  }

  return [];
}

function hasCastPhotos(castItems = []) {
  return Array.isArray(castItems)
    && castItems.some((entry) => String(entry?.photo || "").trim().length > 0);
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
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

async function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4K";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  return "Auto";
}

function renderImdbBadge(rating) {
  const raw = String(rating ?? "").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(",", ".");
  const parsed = Number(normalized);
  const value = Number.isFinite(parsed) ? String(parsed.toFixed(1)).replace(".", ",") : raw;
  return `
    <span class="series-imdb-badge">
      <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
      <span>${value}</span>
    </span>
  `;
}

function resolveImdbRating(meta = {}) {
  if (meta?.imdbRating != null && String(meta.imdbRating).trim() !== "") {
    return meta.imdbRating;
  }
  if (meta?.imdb_score != null && String(meta.imdb_score).trim() !== "") {
    return meta.imdb_score;
  }
  if (meta?.ratings?.imdb != null && String(meta.ratings.imdb).trim() !== "") {
    return meta.ratings.imdb;
  }
  if (meta?.mdbListRatings?.imdb != null && String(meta.mdbListRatings.imdb).trim() !== "") {
    return meta.mdbListRatings.imdb;
  }
  return null;
}

function formatRuntimeMinutes(runtime) {
  const minutes = Number(runtime || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function resolveEpisodeRuntimeForSeason(episodes = [], season = null) {
  const seasonNumber = Number(season || 0);
  const inSeason = episodes.find((episode) => Number(episode.season || 0) === seasonNumber && Number(episode.runtimeMinutes || 0) > 0);
  if (inSeason) {
    return Number(inSeason.runtimeMinutes || 0);
  }
  const anyEpisode = episodes.find((episode) => Number(episode.runtimeMinutes || 0) > 0);
  return anyEpisode ? Number(anyEpisode.runtimeMinutes || 0) : 0;
}

function renderPlayGlyph() {
  return `<img class="series-btn-svg" src="assets/icons/ic_player_play.svg" alt="" aria-hidden="true" />`;
}

function renderTrailerGlyph() {
  return `<img class="series-btn-svg" src="assets/icons/trailer_play_button.svg" alt="" aria-hidden="true" />`;
}

function ratingToneClass(value) {
  const num = Number(value || 0);
  if (num >= 9) return "excellent";
  if (num >= 8) return "great";
  if (num >= 7.5) return "good";
  if (num >= 7) return "mixed";
  if (num >= 6) return "bad";
  if (num > 0) return "poor";
  return "normal";
}

function getAddonIconPath(addonName = "") {
  const value = String(addonName || "").toLowerCase();
  if (!value) {
    return "";
  }
  if (value.includes("trakt")) {
    return "assets/icons/trakt_tv_favicon.svg";
  }
  if (value.includes("letterboxd")) {
    return "assets/icons/mdblist_letterboxd.svg";
  }
  if (value.includes("tmdb")) {
    return "assets/icons/mdblist_tmdb.svg";
  }
  if (value.includes("tomato")) {
    return "assets/icons/mdblist_tomatoes.svg";
  }
  if (value.includes("mdblist")) {
    return "assets/icons/mdblist_trakt.svg";
  }
  return "";
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeSelectorValue(value = "") {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function normalizeCountryLabel(raw = "") {
  return String(raw || "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      return /^[A-Za-z]{2,3}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
    })
    .filter(Boolean)
    .join(", ");
}

function normalizePreviewItem(item = {}, fallbackType = "movie") {
  return {
    id: String(item.id || ""),
    name: item.name || item.title || "Untitled",
    type: item.type || item.apiType || fallbackType,
    poster: item.landscapePoster || item.background || item.poster || "",
    releaseInfo: item.releaseInfo || item.year || ""
  };
}

function resolveYoutubeId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  const watchMatch = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) {
    return watchMatch[1];
  }
  const shortMatch = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }
  const embedMatch = raw.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch?.[1]) {
    return embedMatch[1];
  }
  return "";
}

function buildYoutubeEmbedUrl(ytId = "") {
  const cleanId = String(ytId || "").trim();
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

  const ytId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!ytId) {
    return null;
  }
  return {
    kind: "youtube",
    ytId,
    embedUrl: buildYoutubeEmbedUrl(ytId)
  };
}

function formatCompactDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function captureHorizontalScrollMap(container) {
  const state = {};
  Array.from(container?.querySelectorAll("[data-scroll-key]") || []).forEach((node) => {
    const key = String(node.dataset.scrollKey || "").trim();
    if (!key) {
      return;
    }
    state[key] = Number(node.scrollLeft || 0);
  });
  return state;
}

export const MetaDetailsScreen = {

  getRouteStateKey(params = {}) {
    const itemId = String(params?.itemId || "").trim();
    if (!itemId) {
      return null;
    }
    return `detail:${String(params?.itemType || "movie").trim() || "movie"}:${itemId}`;
  },

  captureRouteState() {
    const content = this.container?.querySelector(".series-detail-content");
    return {
      params: this.params ? { ...this.params } : {},
      meta: this.meta ? { ...this.meta } : null,
      isSavedInLibrary: Boolean(this.isSavedInLibrary),
      isMarkedWatched: Boolean(this.isMarkedWatched),
      episodes: Array.isArray(this.episodes) ? [...this.episodes] : [],
      castItems: Array.isArray(this.castItems) ? [...this.castItems] : [],
      moreLikeThisItems: Array.isArray(this.moreLikeThisItems) ? [...this.moreLikeThisItems] : [],
      collectionItems: Array.isArray(this.collectionItems) ? [...this.collectionItems] : [],
      collectionName: String(this.collectionName || ""),
      seriesRatingsBySeason: this.seriesRatingsBySeason ? { ...this.seriesRatingsBySeason } : {},
      nextEpisodeToWatch: this.nextEpisodeToWatch ? { ...this.nextEpisodeToWatch } : null,
      trailerSource: this.trailerSource ? { ...this.trailerSource } : null,
      selectedSeason: Number(this.selectedSeason || 0),
      selectedRatingSeason: Number(this.selectedRatingSeason || 0),
      seriesInsightTab: String(this.seriesInsightTab || "cast"),
      movieInsightTab: String(this.movieInsightTab || "cast"),
      pendingFocusRestore: this.captureDetailFocus(),
      contentScrollTop: Number(content?.scrollTop || 0),
      trackScrollLeftByKey: captureHorizontalScrollMap(this.container),
      episodeProgressEntries: Array.from(this.episodeProgressMap?.entries?.() || []),
      watchedEpisodeKeys: Array.from(this.watchedEpisodeKeys || [])
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    const restoredItemId = String(snapshot?.params?.itemId || "").trim();
    const nextItemId = String(params?.itemId || "").trim();
    if (!snapshot?.meta || !restoredItemId || restoredItemId !== nextItemId) {
      return false;
    }
    this.params = params || {};
    this.meta = { ...snapshot.meta };
    this.isSavedInLibrary = Boolean(snapshot.isSavedInLibrary);
    this.isMarkedWatched = Boolean(snapshot.isMarkedWatched);
    this.episodes = Array.isArray(snapshot.episodes) ? [...snapshot.episodes] : [];
    this.castItems = Array.isArray(snapshot.castItems) ? [...snapshot.castItems] : [];
    this.moreLikeThisItems = Array.isArray(snapshot.moreLikeThisItems) ? [...snapshot.moreLikeThisItems] : [];
    this.collectionItems = Array.isArray(snapshot.collectionItems) ? [...snapshot.collectionItems] : [];
    this.collectionName = String(snapshot.collectionName || "");
    this.seriesRatingsBySeason = snapshot.seriesRatingsBySeason ? { ...snapshot.seriesRatingsBySeason } : {};
    this.nextEpisodeToWatch = snapshot.nextEpisodeToWatch ? { ...snapshot.nextEpisodeToWatch } : null;
    this.trailerSource = snapshot.trailerSource ? { ...snapshot.trailerSource } : resolveTrailerSource(this.meta);
    this.selectedSeason = Number(snapshot.selectedSeason || this.episodes[0]?.season || 1);
    this.selectedRatingSeason = Number(snapshot.selectedRatingSeason || this.selectedSeason || 1);
    this.seriesInsightTab = String(snapshot.seriesInsightTab || "cast");
    this.movieInsightTab = String(snapshot.movieInsightTab || "cast");
    this.pendingFocusRestore = snapshot.pendingFocusRestore ? { ...snapshot.pendingFocusRestore } : null;
    this.restoredContentScrollTop = Number(snapshot.contentScrollTop || 0);
    this.restoredTrackScrollLeftByKey = snapshot.trackScrollLeftByKey && typeof snapshot.trackScrollLeftByKey === "object"
      ? { ...snapshot.trackScrollLeftByKey }
      : {};
    this.episodeProgressMap = new Map(Array.isArray(snapshot.episodeProgressEntries) ? snapshot.episodeProgressEntries : []);
    this.watchedEpisodeKeys = new Set(Array.isArray(snapshot.watchedEpisodeKeys) ? snapshot.watchedEpisodeKeys : []);
    return true;
  },

  bindBackHandler() {
    if (this.backHandler) {
      document.removeEventListener("keydown", this.backHandler, true);
    }
    this.backHandler = (event) => {
      if (!isBackEvent(event)) {
        return;
      }
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (this.consumeBackRequest()) {
        return;
      }
      Router.back();
    };
    document.addEventListener("keydown", this.backHandler, true);
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("detail");
    ScreenUtils.show(this.container);
    this.stopTrailerPlayback({ keepDom: false });
    this.params = params;
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.streamChooserFocus = null;
    this.streamChooserLoadToken = 0;
    this.isLoadingDetail = true;
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.seriesInsightTab = "cast";
    this.movieInsightTab = "cast";
    this.selectedRatingSeason = 1;
    this.selectedSeason = 1;
    this.collectionItems = [];
    this.collectionName = "";
    this.trailerSource = null;
    this.isTrailerPlaying = false;
    this.episodeProgressMap = new Map();
    this.watchedEpisodeKeys = new Set();
    this.restoredContentScrollTop = 0;
    this.restoredTrackScrollLeftByKey = {};
    this.bindBackHandler();

    if (this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
      this.isLoadingDetail = false;
      this.render(this.meta, this.pendingFocusRestore);
      return;
    }

    this.container.innerHTML = `
      <div class="detail-loading-shell" aria-label="Loading detail">
        <div class="detail-loading-top">
          <div class="detail-loading-block detail-loading-poster"></div>
        </div>
        <div class="detail-loading-meta">
          <div class="detail-loading-block detail-loading-pill"></div>
          <div class="detail-loading-block detail-loading-pill short"></div>
        </div>
        <div class="detail-loading-copy">
          <div class="detail-loading-block detail-loading-line"></div>
          <div class="detail-loading-block detail-loading-line wide"></div>
          <div class="detail-loading-block detail-loading-line mid"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-chip"></div>
          <div class="detail-loading-block detail-loading-chip"></div>
        </div>
      </div>
    `;

    await this.loadDetail();
  },

  async loadDetail() {
    const token = this.detailLoadToken;
    const { itemId, itemType = "movie", fallbackTitle = "Untitled" } = this.params || {};
    if (!itemId) {
      this.renderError("Item id mancante.");
      return;
    }

    const metaResult = await withTimeout(
      metaRepository.getMetaFromAllAddons(itemType, itemId),
      4500,
      { status: "error", message: "timeout" }
    );
    const meta = metaResult.status === "success"
      ? metaResult.data
      : { id: itemId, type: itemType, name: fallbackTitle, description: "" };

    const [isSaved, progress, watchedItem, allProgressItems, allWatchedItems] = await Promise.all([
      savedLibraryRepository.isSaved(itemId),
      watchProgressRepository.getProgressByContentId(itemId),
      watchedItemsRepository.isWatched(itemId),
      watchProgressRepository.getAll(),
      watchedItemsRepository.getAll()
    ]);
    if (token !== this.detailLoadToken) {
      return;
    }
    this.isSavedInLibrary = isSaved;
    this.isMarkedWatched = Boolean(
      watchedItem
      || (progress && Number(progress.durationMs || 0) > 0 && Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
    );

    // Fast first paint with base metadata.
    this.meta = meta;
    this.episodes = normalizeEpisodes(meta?.videos || []);
    this.castItems = extractCast(meta);
    this.buildEpisodeState(allProgressItems, allWatchedItems);
    this.selectedSeason = this.selectedSeason || this.episodes[0]?.season || 1;
    this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
    this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
    this.moreLikeThisItems = [];
    this.collectionItems = [];
    this.collectionName = "";
    this.streamItems = [];
    this.trailerSource = resolveTrailerSource(meta);
    if (itemType === "series" || itemType === "tv") {
      this.seriesRatingsBySeason = {};
    } else {
      this.seriesRatingsBySeason = {};
    }
    this.render(meta);
    this.isLoadingDetail = false;

    // Background enrichments: do not block initial screen rendering.
    (async () => {
      const enrichedMeta = await withTimeout(this.enrichMeta(meta), 4000, meta);
      if (token !== this.detailLoadToken) {
        return;
      }

      this.meta = enrichedMeta || meta;
      this.episodes = normalizeEpisodes(this.meta?.videos || []);
      this.castItems = extractCast(this.meta);
      this.buildEpisodeState(allProgressItems, allWatchedItems);
      this.trailerSource = resolveTrailerSource(this.meta);
      if (!this.castItems.length || !hasCastPhotos(this.castItems)) {
        const fallbackCast = await withTimeout(this.fetchTmdbCastFallback(this.meta), 3200, []);
        if (Array.isArray(fallbackCast) && fallbackCast.length) {
          this.castItems = fallbackCast;
        }
      }
      this.selectedSeason = this.selectedSeason || this.episodes[0]?.season || 1;
      this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
      this.render(this.meta);

      const tasks = [
        withTimeout(this.fetchMoreLikeThis(this.meta), 5000, [])
      ];
      if (itemType === "series" || itemType === "tv") {
        tasks.push(withTimeout(this.fetchSeriesRatingsBySeason(this.meta), 5000, {}));
      } else {
        tasks.push(withTimeout(this.fetchMovieCollection(this.meta), 5000, { items: [], name: "" }));
      }
      const results = await Promise.all(tasks);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.moreLikeThisItems = Array.isArray(results[0]) ? results[0] : [];
      if (itemType === "series" || itemType === "tv") {
        this.seriesRatingsBySeason = results[1] || {};
      } else {
        this.collectionItems = Array.isArray(results[1]?.items) ? results[1].items : [];
        this.collectionName = results[1]?.name || "";
      }
      this.render(this.meta);
    })().catch((error) => {
      console.warn("Detail background enrichment failed", error);
    });
  },

  async fetchMoreLikeThis(meta) {
    try {
      const sourceTitle = String(meta?.name || "").trim();
      if (!sourceTitle) {
        return [];
      }
      const terms = sourceTitle.split(/\s+/).filter((word) => word.length > 2).slice(0, 3).join(" ");
      if (!terms) {
        return [];
      }

      const wantedType = meta?.type === "tv" ? "series" : (meta?.type || "movie");
      const addons = await addonRepository.getInstalledAddons();
      const searchableCatalogs = [];

      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
          if (!requiresSearch || catalog.apiType !== wantedType) {
            return;
          }
          searchableCatalogs.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
      });

      const responses = await Promise.all(searchableCatalogs.slice(0, 6).map(async (catalog) => {
        const result = await catalogRepository.getCatalog({
          addonBaseUrl: catalog.addonBaseUrl,
          addonId: catalog.addonId,
          addonName: catalog.addonName,
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          type: catalog.type,
          extraArgs: { search: terms },
          supportsSkip: true,
          skip: 0
        });
        return result?.status === "success" ? (result.data?.items || []) : [];
      }));

      const flat = responses.flat();
      const unique = [];
      const seen = new Set();
      flat.forEach((item) => {
        if (!item?.id || item.id === meta?.id || seen.has(item.id)) {
          return;
        }
        seen.add(item.id);
        unique.push(item);
      });
      return unique.slice(0, 12);
    } catch (error) {
      console.warn("More like this load failed", error);
      return [];
    }
  },

  computeNextEpisodeToWatch(progress) {
    if (!this.episodes?.length) {
      return null;
    }
    const currentVideoId = progress?.videoId || null;
    if (!currentVideoId) {
      return this.episodes[0];
    }
    const currentIndex = this.episodes.findIndex((episode) => episode.id === currentVideoId);
    if (currentIndex < 0) {
      return this.episodes[0];
    }
    return this.episodes[currentIndex + 1] || this.episodes[currentIndex] || this.episodes[0];
  },

  buildEpisodeState(progressItems = [], watchedItems = []) {
    const progressMap = new Map();
    const watchedKeys = new Set();
    const contentId = String(this.params?.itemId || "");

    (Array.isArray(progressItems) ? progressItems : []).forEach((entry) => {
      if (String(entry?.contentId || "") !== contentId) {
        return;
      }
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (!season || !episode) {
        return;
      }
      const key = `${season}:${episode}`;
      progressMap.set(key, entry);
      const position = Number(entry?.positionMs || 0);
      const duration = Number(entry?.durationMs || 0);
      if (duration > 0 && position >= duration) {
        watchedKeys.add(key);
      }
    });

    (Array.isArray(watchedItems) ? watchedItems : []).forEach((entry) => {
      const season = Number(entry?.season || 0);
      const episode = Number(entry?.episode || 0);
      if (String(entry?.contentId || "") === contentId && season && episode) {
        watchedKeys.add(`${season}:${episode}`);
      }
    });

    this.episodeProgressMap = progressMap;
    this.watchedEpisodeKeys = watchedKeys;
  },

  async fetchMovieCollection(meta = {}) {
    try {
      const collectionId = meta?.collectionId || meta?.belongsToCollection?.id || meta?.belongs_to_collection?.id;
      if (!collectionId) {
        return { name: "", items: [] };
      }
      const items = await TmdbMetadataService.fetchMovieCollection({
        collectionId,
        language: TmdbSettingsStore.get().language
      });
      const normalized = (Array.isArray(items) ? items : [])
        .map((item) => normalizePreviewItem(item, "movie"))
        .filter((item) => item.id && item.id !== String(meta.id || ""))
        .slice(0, 18);
      return {
        name: meta?.collectionName || meta?.belongsToCollection?.name || meta?.belongs_to_collection?.name || "",
        items: normalized
      };
    } catch (error) {
      console.warn("Movie collection enrichment failed", error);
      return { name: "", items: [] };
    }
  },

  async enrichMeta(meta) {
    const settings = TmdbSettingsStore.get();
    if (!settings.enabled || !settings.apiKey || !meta?.id) {
      return meta;
    }

    try {
      const tmdbId = await TmdbService.ensureTmdbId(meta.id, meta.type);
      if (!tmdbId) {
        return meta;
      }
      const enrichment = await TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: meta.type,
        language: settings.language
      });
      if (!enrichment) {
        return meta;
      }

      return {
        ...meta,
        name: settings.useBasicInfo ? (enrichment.localizedTitle || meta.name) : meta.name,
        description: settings.useBasicInfo ? (enrichment.description || meta.description) : meta.description,
        background: settings.useArtwork ? (enrichment.backdrop || meta.background) : meta.background,
        poster: settings.useArtwork ? (enrichment.poster || meta.poster) : meta.poster,
        logo: settings.useArtwork ? (enrichment.logo || meta.logo) : meta.logo,
        genres: settings.useDetails && enrichment.genres?.length ? enrichment.genres : meta.genres,
        releaseInfo: settings.useDetails ? (enrichment.releaseInfo || meta.releaseInfo) : meta.releaseInfo,
        runtime: settings.useDetails ? (enrichment.runtime || meta.runtime) : meta.runtime,
        country: settings.useDetails ? (enrichment.country || meta.country) : meta.country,
        language: settings.useDetails ? (enrichment.language || meta.language) : meta.language,
        tmdbRating: typeof enrichment.rating === "number" ? Number(enrichment.rating.toFixed(1)) : (meta.tmdbRating || null),
        credits: enrichment.credits || meta.credits || null,
        companies: Array.isArray(enrichment.companies) ? enrichment.companies : (meta.companies || []),
        productionCompanies: Array.isArray(enrichment.productionCompanies)
          ? enrichment.productionCompanies
          : (Array.isArray(meta.productionCompanies) ? meta.productionCompanies : []),
        networks: Array.isArray(enrichment.networks)
          ? enrichment.networks
          : (Array.isArray(meta.networks) ? meta.networks : []),
        collectionId: enrichment.collectionId || meta.collectionId || meta?.belongsToCollection?.id || meta?.belongs_to_collection?.id || null,
        collectionName: enrichment.collectionName || meta.collectionName || meta?.belongsToCollection?.name || meta?.belongs_to_collection?.name || "",
        belongsToCollection: enrichment.collectionId
          ? { id: enrichment.collectionId, name: enrichment.collectionName || "" }
          : (meta.belongsToCollection || meta.belongs_to_collection || null)
      };
    } catch (error) {
      console.warn("Meta TMDB enrichment failed", error);
      return meta;
    }
  },

  async searchTmdbIdByTitle(meta = {}, contentType = "movie") {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || "").trim();
    if (!settings.enabled || !apiKey) {
      return null;
    }
    const name = String(meta?.name || "").trim();
    if (!name) {
      return null;
    }
    const type = contentType === "series" || contentType === "tv" ? "tv" : "movie";
    const releaseYear = String(meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const yearParam = releaseYear
      ? (type === "tv" ? `&first_air_date_year=${encodeURIComponent(releaseYear)}` : `&year=${encodeURIComponent(releaseYear)}`)
      : "";
    const url = `${TMDB_BASE_URL}/search/${type}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.language || "it-IT")}&query=${encodeURIComponent(name)}${yearParam}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    return first?.id ? String(first.id) : null;
  },

  async fetchTmdbCastFallback(meta = {}) {
    const contentType = String(meta?.type || this.params?.itemType || "movie").toLowerCase();
    const normalizedType = contentType === "tv" ? "series" : contentType;
    let tmdbId = await TmdbService.ensureTmdbId(meta?.id, normalizedType);
    if (!tmdbId) {
      tmdbId = await this.searchTmdbIdByTitle(meta, normalizedType);
    }
    if (!tmdbId) {
      return [];
    }
    const enrichment = await TmdbMetadataService.fetchEnrichment({
      tmdbId,
      contentType: normalizedType,
      language: TmdbSettingsStore.get().language
    });
    const fallbackCast = extractCast({ credits: enrichment?.credits || null });
    return Array.isArray(fallbackCast) ? fallbackCast : [];
  },

  async fetchSeriesRatingsBySeason(meta) {
    try {
      if (!meta?.id || !this.episodes?.length) {
        return {};
      }
      const tmdbId = await TmdbService.ensureTmdbId(meta.id, "series");
      if (!tmdbId) {
        return {};
      }
      const seasons = Array.from(new Set(this.episodes.map((episode) => Number(episode.season || 0)).filter((value) => value > 0)));
      const entries = await Promise.all(seasons.map(async (season) => {
        const ratings = await TmdbMetadataService.fetchSeasonRatings({
          tmdbId,
          seasonNumber: season,
          language: TmdbSettingsStore.get().language
        });
        return [season, ratings];
      }));
      return Object.fromEntries(entries);
    } catch (error) {
      console.warn("Series ratings enrichment failed", error);
      return {};
    }
  },

  flattenStreams(streamResult) {
    if (!streamResult || streamResult.status !== "success") {
      return [];
    }

    return (streamResult.data || []).flatMap((group) => {
      const groupName = group.addonName || "Addon";
      return (group.streams || []).map((stream, index) => ({
        id: `${groupName}-${index}-${stream.url || ""}`,
        label: stream.title || stream.name || `${groupName} stream`,
        description: stream.description || stream.name || "",
        addonName: groupName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      })).filter((stream) => Boolean(stream.url));
    });
  },

  mergeStreamItems(existing = [], incoming = []) {
    const byKey = new Set();
    const merged = [];
    const push = (item) => {
      if (!item?.url) {
        return;
      }
      const key = [
        String(item.addonName || "Addon"),
        String(item.url || ""),
        String(item.sourceType || ""),
        String(item.label || "")
      ].join("::");
      if (byKey.has(key)) {
        return;
      }
      byKey.add(key);
      merged.push(item);
    };
    (existing || []).forEach(push);
    (incoming || []).forEach(push);
    return merged;
  },

  render(meta, focusRestore = undefined) {
    if (focusRestore !== undefined) {
      this.pendingFocusRestore = focusRestore;
    } else if (!this.pendingFocusRestore) {
      this.pendingFocusRestore = this.captureDetailFocus();
    }
    const isSeries = meta.type === "series" || meta.type === "tv";
    if (isSeries) {
      this.renderSeriesLayout(meta);
      if (this.pendingEpisodeSelection) {
        this.renderEpisodeStreamChooser();
      }
      return;
    }
    this.renderMovieLayout(meta);
    if (this.pendingMovieSelection) {
      this.renderMovieStreamChooser();
    }
  },

  renderSeriesLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
    const nextEpisodeLabel = this.nextEpisodeToWatch
      ? `Next S${this.nextEpisodeToWatch.season}E${this.nextEpisodeToWatch.episode}`
      : "Play";
    const creditLine = Array.isArray(meta.director) && meta.director.length
      ? meta.director.slice(0, 2).join(", ")
      : Array.isArray(meta.writer) && meta.writer.length
        ? meta.writer.slice(0, 2).join(", ")
        : (meta.director || meta.writer || "");
    const creditPrefix = Array.isArray(meta.director) && meta.director.length
      ? "Creator"
      : "Writer";
    if (!this.selectedRatingSeason || !this.seriesRatingsBySeason?.[this.selectedRatingSeason]) {
      this.selectedRatingSeason = this.selectedSeason || this.episodes?.[0]?.season || 1;
    }

    this.container.innerHTML = `
      <div class="series-detail-shell${this.isTrailerPlaying ? " detail-trailer-active" : ""}">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-trailer-layer"></div>
        <div class="series-detail-vignette"></div>
        <div class="detail-bottom-shadow"></div>

        <div class="series-detail-content">
          ${this.renderHeroSection({
            meta,
            playLabel: nextEpisodeLabel,
            creditLine,
            creditPrefix,
            showWatchedButton: false
          })}
          <div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>
          <div class="series-episode-track" data-scroll-key="episodes:${this.selectedSeason || 1}">${this.renderEpisodeCards()}</div>
          ${this.renderSeriesInsightSection()}
          ${this.renderCompanySections(meta)}
        </div>

        <div id="episodeStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    if (!this.pendingFocusRestore) {
      ScreenUtils.setInitialFocus(this.container);
    }
    this.bindDetailChrome();
  },
  renderHeroSection({ meta, playLabel, creditLine = "", creditPrefix = "", showWatchedButton = false }) {
    const logoOrTitle = meta.logo
      ? `<img src="${meta.logo}" class="series-detail-logo" alt="${escapeHtml(meta.name || "logo")}" />`
      : `<h1 class="series-detail-title">${escapeHtml(meta.name || "Untitled")}</h1>`;
    const externalRatings = this.renderExternalRatingsRow(meta);
    const trailerButton = this.trailerSource
      ? `
          <button class="series-circle-btn focusable" data-action="toggleTrailer" aria-label="Play trailer">
            ${renderTrailerGlyph()}
          </button>
        `
      : "";
    return `
      <section class="detail-hero-section">
        <div class="detail-hero-brand">
          ${logoOrTitle}
          <p class="detail-trailer-hint">Press back to return to details</p>
        </div>
        <div class="series-detail-actions">
          <button class="series-primary-btn focusable" data-action="playDefault">
            <span class="series-btn-icon">${renderPlayGlyph()}</span>
            <span>${escapeHtml(playLabel)}</span>
          </button>
          <button class="series-circle-btn focusable" data-action="toggleLibrary">
            ${this.isSavedInLibrary ? "&#10003;" : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`}
          </button>
          ${showWatchedButton ? `<button class="series-circle-btn focusable" data-action="toggleWatched">${this.isMarkedWatched ? "&#10003;" : "&#9675;"}</button>` : ""}
          ${trailerButton}
        </div>
        ${creditLine ? `<p class="series-detail-support">${escapeHtml(creditPrefix)}: ${escapeHtml(creditLine)}</p>` : ""}
        ${externalRatings}
        <p class="series-detail-description">${escapeHtml(meta.description || "No description.")}</p>
        ${this.renderHeroMetaRows(meta)}
      </section>
    `;
  },

  renderHeroMetaRows(meta) {
    const genresText = Array.isArray(meta?.genres) ? meta.genres.filter(Boolean).join(" • ") : "";
    const yearText = String(meta?.releaseInfo || "").split("-")[0] || "";
    const imdbValue = resolveImdbRating(meta);
    const imdbText = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue).replace(",", ".") : "";
    const runtimeText = String(meta?.runtime || "").trim()
      || formatRuntimeMinutes(meta?.runtimeMinutes || resolveEpisodeRuntimeForSeason(this.episodes, this.selectedSeason));
    const countryText = normalizeCountryLabel(Array.isArray(meta?.country) ? meta.country.join(", ") : (meta?.country || ""));
    const languageText = String(meta?.language || "").trim().toUpperCase();
    const ageRating = String(meta?.ageRating || "").trim();
    const status = String(meta?.status || "").trim().toUpperCase();
    const primaryParts = [
      genresText ? `<span>${escapeHtml(genresText)}</span>` : "",
      yearText ? `<span>${escapeHtml(yearText)}</span>` : "",
      imdbText ? renderImdbBadge(imdbText) : ""
    ].filter(Boolean);
    const secondaryParts = [];
    if (ageRating && status) {
      secondaryParts.push(`
        <span class="detail-meta-badge combined">
          <span>${escapeHtml(ageRating)}</span>
          <span class="detail-meta-badge-divider"></span>
          <span class="strong">${escapeHtml(status)}</span>
        </span>
      `);
    } else {
      if (ageRating) {
        secondaryParts.push(`<span class="detail-meta-badge">${escapeHtml(ageRating)}</span>`);
      }
      if (status) {
        secondaryParts.push(`<span class="detail-meta-badge strong">${escapeHtml(status)}</span>`);
      }
    }
    [runtimeText, countryText, languageText].filter(Boolean).forEach((value) => {
      secondaryParts.push(`<span>${escapeHtml(value)}</span>`);
    });

    return `
      <div class="detail-meta-stack">
        ${primaryParts.length ? `<div class="detail-meta-row">${primaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
        ${secondaryParts.length ? `<div class="detail-meta-row secondary">${secondaryParts.join('<span class="detail-meta-dot"></span>')}</div>` : ""}
      </div>
    `;
  },

  renderExternalRatingsRow(meta = {}) {
    const ratings = meta?.mdbListRatings || {};
    const items = [
      ["trakt", getAddonIconPath("trakt"), ratings.trakt],
      ["imdb", "assets/icons/imdb_logo_2016.svg", ratings.imdb],
      ["tmdb", "assets/icons/mdblist_tmdb.svg", ratings.tmdb],
      ["letterboxd", "assets/icons/mdblist_letterboxd.svg", ratings.letterboxd],
      ["tomatoes", "assets/icons/mdblist_tomatoes.svg", ratings.tomatoes]
    ].filter(([, , value]) => value != null && String(value).trim() !== "");
    if (!items.length) {
      return "";
    }
    return `
      <div class="detail-ratings-row">
        ${items.map(([label, icon, value]) => `
          <span class="detail-rating-item">
            <img src="${icon}" alt="${escapeHtml(label)}" />
            <span>${escapeHtml(Number.isFinite(Number(value)) ? Number(value).toFixed(label === "trakt" || label === "tomatoes" ? 0 : 1).replace(/\.0$/, label === "trakt" || label === "tomatoes" ? "" : ".0") : String(value))}</span>
          </span>
        `).join("")}
      </div>
    `;
  },

  renderCompanySections(meta = {}) {
    const production = this.renderCompanyLogosSection(meta.productionCompanies || meta.production_companies || [], "Production");
    const networks = this.renderCompanyLogosSection(meta.networks || [], "Network");
    if (meta.type === "series" || meta.type === "tv") {
      return `${networks}${production}`;
    }
    return `${production}${networks}`;
  },
  renderDefaultLayout(meta, streamItems) {
    const isSeries = meta.type === "series" || meta.type === "tv";
    const seasonButtons = this.renderSeasonButtons();
    const episodeCards = this.renderEpisodeCards();
    const castCards = this.renderCastCards();
    const moreLikeCards = this.renderMoreLikeCards();

    this.container.innerHTML = `
      <div class="row">
        <h2>${meta.name || "Untitled"}</h2>
        <p>${meta.description || "No description."}</p>
        <p style="opacity:0.8;">Type: ${meta.type || "unknown"} | Id: ${meta.id || "-"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="playDefault">${isSeries ? "Play Next Episode" : "Play"}</div>
        <div class="card focusable" data-action="toggleLibrary">${this.isSavedInLibrary ? "Remove from Library" : "Add to Library"}</div>
        <div class="card focusable" data-action="toggleWatched">${this.isMarkedWatched ? "Mark Unwatched" : "Mark Watched"}</div>
        <div class="card focusable" data-action="openSearch">Search Similar</div>
        <div class="card focusable" data-action="goBack">Back</div>
      </div>
      ${isSeries ? `
      <div class="row">
        <h3>Seasons</h3>
        <div id="detailSeasons">${seasonButtons}</div>
      </div>
      <div class="row">
        <h3>Episodes</h3>
        <div id="detailEpisodes">${episodeCards}</div>
      </div>
      ` : ""}
      ${castCards ? `
      <div class="row">
        <h3>Cast</h3>
        <div id="detailCast">${castCards}</div>
      </div>
      ` : ""}
      ${moreLikeCards ? `
      <div class="row">
        <h3>More Like This</h3>
        <div id="detailMoreLike">${moreLikeCards}</div>
      </div>
      ` : ""}
      <div class="row">
        <h3>Streams (${streamItems.length})</h3>
        <div id="detailStreams"></div>
      </div>
    `;

    const streamWrap = this.container.querySelector("#detailStreams");
    streamItems.slice(0, 30).forEach((stream, index) => {
      const node = document.createElement("div");
      node.className = "card focusable";
      node.dataset.action = "playStream";
      node.dataset.streamUrl = stream.url;
      node.dataset.streamIndex = String(index);
      node.innerHTML = `
        <div style="font-weight:700;">${stream.label}</div>
        <div style="opacity:0.8;">${stream.addonName}</div>
      `;
      streamWrap.appendChild(node);
    });

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  renderMovieLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
    const directorLine = Array.isArray(meta.director)
      ? meta.director.slice(0, 2).join(", ")
      : (meta.director || "");

    this.container.innerHTML = `
      <div class="series-detail-shell movie-detail-shell${this.isTrailerPlaying ? " detail-trailer-active" : ""}">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-trailer-layer"></div>
        <div class="series-detail-vignette"></div>
        <div class="detail-bottom-shadow"></div>

        <div class="series-detail-content movie-detail-content">
          ${this.renderHeroSection({
            meta,
            playLabel: "Play",
            creditLine: directorLine,
            creditPrefix: "Director",
            showWatchedButton: true
          })}
          ${this.renderMovieInsightSection(meta)}
          ${this.renderCompanySections(meta)}
        </div>
        <div id="movieStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    if (!this.pendingFocusRestore) {
      ScreenUtils.setInitialFocus(this.container, ".movie-detail-content .focusable");
    }
    this.bindDetailChrome();
  },
  renderMovieInsightSection(meta) {
    const tabItems = [
      ["cast", "Creator and Cast"],
      ["ratings", "Ratings"],
      ...(this.moreLikeThisItems.length ? [["morelike", "More Like This"]] : []),
      ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
    ];
    const tabs = tabItems.length > 1 ? this.renderPeopleTabs("movie", this.movieInsightTab, tabItems) : "";
    if (this.movieInsightTab === "ratings") {
      const imdbValue = resolveImdbRating(meta);
      const imdb = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue) : "-";
      const tmdb = Number.isFinite(Number(meta?.tmdbRating)) ? String(meta.tmdbRating) : "-";
      return `
        <section class="series-insight-section">
          ${tabs}
          <div class="movie-ratings-row">
            <article class="movie-rating-card">
              <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
              <div class="movie-rating-value">${imdb}</div>
            </article>
            <article class="movie-rating-card">
              <img src="assets/icons/mdblist_tmdb.svg" alt="TMDB" />
              <div class="movie-rating-value">${tmdb}</div>
            </article>
          </div>
        </section>
      `;
    }
    if (this.movieInsightTab === "collection") {
      return `
        <section class="series-insight-section">
          ${tabs}
          ${this.renderPreviewRail(this.collectionItems, "movie", "collection:movie")}
        </section>
      `;
    }
    if (this.movieInsightTab === "morelike") {
      return `
        <section class="series-insight-section">
          ${tabs}
          ${this.renderPreviewRail(this.moreLikeThisItems, "movie", "morelike:movie")}
        </section>
      `;
    }
    return `
      <section class="series-insight-section movie-cast-section">
        ${tabs}
        ${this.renderSeriesCastTrack("movie")}
      </section>
    `;
  },

  renderSeriesInsightSection() {
    const tabItems = [
      ["cast", "Creator and Cast"],
      ["ratings", "Ratings"],
      ...(this.moreLikeThisItems.length ? [["morelike", "More Like This"]] : []),
      ...(this.collectionItems.length ? [["collection", this.collectionName || "Collection"]] : [])
    ];
    const tabs = tabItems.length > 1 ? this.renderPeopleTabs("series", this.seriesInsightTab, tabItems) : "";
    return `
      <section class="series-insight-section">
        ${tabs}
        ${this.seriesInsightTab === "ratings"
          ? this.renderSeriesRatingsPanel()
          : this.seriesInsightTab === "collection"
            ? this.renderPreviewRail(this.collectionItems, "series", "collection:series")
          : this.seriesInsightTab === "morelike"
            ? this.renderPreviewRail(this.moreLikeThisItems, "series", "morelike:series")
            : this.renderSeriesCastTrack("series")}
      </section>
    `;
  },

  renderPeopleTabs(kind, activeTab, items = []) {
    const normalized = items.filter(([, label]) => Boolean(label));
    return `
      <div class="series-insight-tabs" data-scroll-key="people-tabs:${kind}">
        ${normalized.map(([tab, label], index) => `
          ${index > 0 ? '<span class="series-insight-divider">|</span>' : ""}
          <button class="series-insight-tab focusable${activeTab === tab ? " selected" : ""}"
                  data-action="${kind === "series" ? "setSeriesInsightTab" : "setMovieInsightTab"}"
                  data-tab="${tab}">${escapeHtml(label)}</button>
        `).join("")}
      </div>
    `;
  },

  renderSeriesCastTrack(kind = "series") {
    if (!Array.isArray(this.castItems) || !this.castItems.length) {
      return `<div class="series-insight-empty">No cast information.</div>`;
    }
    const className = kind === "movie" ? "movie-cast-track" : "series-cast-track";
    const cards = this.castItems.slice(0, 18).map((person) => `
      <article class="movie-cast-card focusable series-cast-card"
               data-action="openCastDetail"
               data-cast-id="${person.tmdbId || ""}"
               data-cast-key="${escapeHtml(String(person.tmdbId || `${person.name || ""}:${person.character || ""}`))}"
               data-cast-name="${escapeHtml(person.name || "")}"
               data-cast-role="${escapeHtml(person.character || "")}"
               data-cast-photo="${person.photo || ""}">
        <div class="movie-cast-avatar"${person.photo ? ` style="background-image:url('${String(person.photo).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="movie-cast-name">${escapeHtml(person.name || "")}</div>
        <div class="movie-cast-role">${escapeHtml(person.character || "")}</div>
      </article>
    `).join("");
    return `<div class="${className}" data-scroll-key="cast:${kind}">${cards}</div>`;
  },

  renderSeriesRatingsPanel() {
    const seasonKeys = Object.keys(this.seriesRatingsBySeason || {}).map((key) => Number(key)).filter((value) => value > 0).sort((a, b) => a - b);
    if (!seasonKeys.length) {
      return `<div class="series-insight-empty">Ratings not available.</div>`;
    }
    if (!seasonKeys.includes(Number(this.selectedRatingSeason))) {
      this.selectedRatingSeason = seasonKeys[0];
    }
    const ratings = this.seriesRatingsBySeason?.[this.selectedRatingSeason] || [];
    const seasonButtons = seasonKeys.map((season) => `
      <button class="series-rating-season focusable${season === this.selectedRatingSeason ? " selected" : ""}"
              data-action="selectRatingSeason"
              data-season="${season}">S${season}</button>
    `).join("");
    const chips = ratings.length
      ? ratings.map((entry) => `
          <div class="series-episode-rating-chip focusable ${ratingToneClass(entry.rating)}"
               data-rating-episode="${Number(entry.episode || 0)}">
            <span class="series-episode-rating-ep">E${entry.episode}</span>
            <span class="series-episode-rating-val">${entry.rating != null ? String(entry.rating).replace(".", ".") : "-"}</span>
          </div>
        `).join("")
      : `<div class="series-insight-empty">No episode ratings in this season.</div>`;
    return `
      <div class="series-rating-seasons" data-scroll-key="rating-seasons">${seasonButtons}</div>
      <div class="series-rating-summary">Season ${this.selectedRatingSeason} • ${ratings.length} episodes</div>
      <div class="series-episode-ratings-grid" data-scroll-key="rating-chips:${this.selectedRatingSeason}">${chips}</div>
    `;
  },

  renderSeasonButtons() {
    if (!this.episodes?.length) {
      return "<p>No episodes found.</p>";
    }
    const seasons = Array.from(new Set(this.episodes.map((episode) => episode.season)));
    return seasons.map((season) => `
      <button class="series-season-btn focusable${season === this.selectedSeason ? " selected" : ""}"
              data-action="selectSeason"
              data-season="${season}">
        Season ${season}
      </button>
    `).join("");
  },

  renderEpisodeCards() {
    if (!this.episodes?.length) {
      return "<p>No episodes found.</p>";
    }
    const selectedSeasonEpisodes = this.episodes.filter((episode) => episode.season === this.selectedSeason);
    if (!selectedSeasonEpisodes.length) {
      return "<p>No episodes for selected season.</p>";
    }
    return selectedSeasonEpisodes.map((episode) => {
      const progress = this.episodeProgressMap.get(`${episode.season}:${episode.episode}`) || null;
      const position = Number(progress?.positionMs || 0);
      const duration = Number(progress?.durationMs || 0);
      const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
      const isWatched = this.watchedEpisodeKeys.has(`${episode.season}:${episode.episode}`);
      const rating = this.seriesRatingsBySeason?.[episode.season]?.find((entry) => Number(entry?.episode || 0) === Number(episode.episode || 0))?.rating ?? null;
      const dateLabel = formatCompactDate(episode.released || "");
      const metaParts = [
        episode.runtimeMinutes > 0 ? `<span>${escapeHtml(formatRuntimeMinutes(episode.runtimeMinutes))}</span>` : "",
        rating != null ? `<span class="series-episode-rating-inline">${renderImdbBadge(String(Number(rating).toFixed(1)))}</span>` : "",
        dateLabel ? `<span class="series-episode-date">${escapeHtml(dateLabel)}</span>` : ""
      ].filter(Boolean).join("");
      return `
        <article class="series-episode-card focusable${isWatched ? " watched" : ""}"
             data-action="openEpisodeStreams"
             data-video-id="${episode.id}">
          <div class="series-episode-thumb"${episode.thumbnail ? ` style="background-image:url('${episode.thumbnail.replace(/'/g, "%27")}')"` : ""}>
            <div class="series-episode-overlay"></div>
            ${isWatched ? `<div class="series-episode-status complete">&#10003;</div>` : progressRatio < 0.02 ? `<div class="series-episode-status idle"></div>` : ""}
            <div class="series-episode-copy">
              <div class="series-episode-badge">EPISODE ${Number(episode.episode || 0)}</div>
              <div class="series-episode-title">${escapeHtml(episode.title)}</div>
              <div class="series-episode-overview">${escapeHtml(episode.overview || "Episode")}</div>
              ${metaParts ? `<div class="series-episode-meta">${metaParts}</div>` : ""}
              ${progressRatio > 0.02 && progressRatio < 0.98 ? `<div class="series-episode-progress"><span style="width:${Math.round(progressRatio * 100)}%"></span></div>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
  },

  renderCastCards() {
    if (!Array.isArray(this.castItems) || !this.castItems.length) {
      return "";
    }
    return this.castItems.map((person) => `
      <div class="card focusable">
        <div style="font-weight:700;">${person.name}</div>
        <div style="opacity:0.8;">Cast</div>
      </div>
    `).join("");
  },

  renderPreviewRail(items = [], fallbackType = "movie", railKey = "morelike") {
    if (!Array.isArray(items) || !items.length) {
      return "";
    }
    const cards = items.map((rawItem) => {
      const item = normalizePreviewItem(rawItem, fallbackType);
      return `
      <article class="detail-morelike-card focusable"
           data-action="openMoreLikeDetail"
           data-item-id="${item.id}"
           data-item-type="${item.type || this.params?.itemType || "movie"}"
           data-item-title="${escapeHtml(item.name || "Untitled")}">
        <div class="detail-morelike-poster"${item.poster ? ` style="background-image:url('${item.poster.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-morelike-name">${escapeHtml(item.name || "Untitled")}</div>
        ${item.releaseInfo ? `<div class="detail-morelike-type">${escapeHtml(item.releaseInfo)}</div>` : ""}
      </article>
    `;
    }).join("");
    return `<div class="detail-morelike-track" data-scroll-key="${escapeHtml(railKey)}">${cards}</div>`;
  },

  renderMoreLikeCards() {
    return this.renderPreviewRail(this.moreLikeThisItems, this.params?.itemType || "movie");
  },

  renderCompanyLogosSection(rawCompanies = [], title = "Studios") {
    const toLogo = (logo) => {
      const value = String(logo || "").trim();
      if (!value) {
        return "";
      }
      if (value.startsWith("http://") || value.startsWith("https://")) {
        return value;
      }
      if (value.startsWith("/")) {
        return `https://image.tmdb.org/t/p/w500${value}`;
      }
      return value;
    };
    const companies = rawCompanies
      .map((entry) => ({
        name: entry?.name || "",
        logo: toLogo(entry?.logo || entry?.logoPath || entry?.logo_path || "")
      }))
      .filter((entry) => entry.logo || entry.name);
    if (!companies.length) {
      return "";
    }
    const logos = companies.slice(0, 10).map((company) => `
      <article class="detail-company-card focusable"
               data-company-name="${escapeHtml(company.name || "")}">
        ${company.logo ? `<img src="${company.logo}" alt="${escapeHtml(company.name || "Company")}" />` : `<span>${escapeHtml(company.name || "")}</span>`}
      </article>
    `).join("");
    return `
      <section class="detail-company-section">
        <h3 class="detail-company-title">${escapeHtml(title)}</h3>
        <div class="detail-company-track" data-scroll-key="company:${escapeHtml(String(title || "").toLowerCase())}">${logos}</div>
      </section>
    `;
  },

  bindDetailChrome() {
    const content = this.container?.querySelector(".series-detail-content");
    if (!content) {
      return;
    }
    if (this.detailScrollHandler) {
      content.removeEventListener("scroll", this.detailScrollHandler);
    }
    this.detailScrollHandler = () => {
      const shell = this.container?.querySelector(".series-detail-shell");
      if (!shell) {
        return;
      }
      shell.classList.toggle("detail-scrolled", content.scrollTop > 160);
    };
    content.addEventListener("scroll", this.detailScrollHandler, { passive: true });
    if (this.detailFocusHandler) {
      this.container.removeEventListener("focusin", this.detailFocusHandler, true);
    }
    this.detailFocusHandler = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement) || !this.container?.contains(target)) {
        return;
      }
      if (target.matches(".series-season-btn.focusable")) {
        const season = Number(target.dataset.season || 0);
        if (season > 0 && season !== this.selectedSeason) {
          this.selectedSeason = season;
          this.render(this.meta, { selector: `.series-season-btn[data-season="${season}"]` });
        }
        return;
      }
      if (target.matches(".series-insight-tab.focusable")) {
        const tab = String(target.dataset.tab || "");
        if (!tab) {
          return;
        }
        if ((this.meta?.type === "series" || this.meta?.type === "tv") && tab !== this.seriesInsightTab) {
          this.seriesInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
          this.render(this.meta, { selector: `.series-insight-tab[data-tab="${this.seriesInsightTab}"]` });
          return;
        }
        if (this.meta?.type !== "series" && this.meta?.type !== "tv" && tab !== this.movieInsightTab) {
          this.movieInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
          this.render(this.meta, { selector: `.series-insight-tab[data-tab="${this.movieInsightTab}"]` });
        }
        return;
      }
      if (target.matches(".series-rating-season.focusable")) {
        const season = Number(target.dataset.season || 0);
        if (season > 0 && season !== this.selectedRatingSeason) {
          this.selectedRatingSeason = season;
          this.render(this.meta, { selector: `.series-rating-season[data-season="${season}"]` });
        }
      }
    };
    this.container.addEventListener("focusin", this.detailFocusHandler, true);
    this.detailScrollHandler();
    this.restoreChromeState();
    this.syncTrailerDom();
    this.restartTrailerAutoplayTimer();
    this.restorePendingFocus();
  },

  restoreChromeState() {
    const content = this.container?.querySelector(".series-detail-content");
    if (content) {
      content.scrollTop = Number(this.restoredContentScrollTop || 0);
    }
    Array.from(this.container?.querySelectorAll("[data-scroll-key]") || []).forEach((node) => {
      const key = String(node.dataset.scrollKey || "");
      if (!key) {
        return;
      }
      node.scrollLeft = Number(this.restoredTrackScrollLeftByKey?.[key] || 0);
    });
  },

  captureDetailFocus() {
    if (!this.container) {
      return null;
    }
    const current = this.container.querySelector(".focusable.focused");
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = current || (active && this.container.contains(active) ? active : null);
    if (!(target instanceof HTMLElement) || !target.closest(".series-detail-content")) {
      return null;
    }
    const action = String(target.dataset.action || "");
    if (action === "selectSeason") {
      const season = Number(target.dataset.season || 0);
      return season > 0 ? { selector: `.series-season-btn[data-season="${season}"]` } : null;
    }
    if (action === "setSeriesInsightTab" || action === "setMovieInsightTab") {
      const tab = String(target.dataset.tab || "");
      return tab ? { selector: `.series-insight-tab[data-tab="${tab}"]` } : null;
    }
    if (action === "selectRatingSeason") {
      const season = Number(target.dataset.season || 0);
      return season > 0 ? { selector: `.series-rating-season[data-season="${season}"]` } : null;
    }
    if (action === "openEpisodeStreams") {
      const videoId = String(target.dataset.videoId || "");
      return videoId ? { selector: `.series-episode-card[data-video-id="${escapeSelectorValue(videoId)}"]` } : null;
    }
    if (action === "openCastDetail") {
      const castKey = String(target.dataset.castKey || "");
      return castKey ? { selector: `.series-cast-card[data-cast-key="${escapeSelectorValue(castKey)}"]` } : null;
    }
    if (action === "openMoreLikeDetail") {
      const itemId = String(target.dataset.itemId || "");
      return itemId ? { selector: `.detail-morelike-card[data-item-id="${escapeSelectorValue(itemId)}"]` } : null;
    }
    if (target.matches(".detail-company-card.focusable")) {
      const companyName = String(target.dataset.companyName || "");
      return companyName ? { selector: `.detail-company-card[data-company-name="${escapeSelectorValue(companyName)}"]` } : null;
    }
    if (target.matches(".series-episode-rating-chip.focusable")) {
      const episode = Number(target.dataset.ratingEpisode || 0);
      return episode > 0 ? { selector: `.series-episode-rating-chip[data-rating-episode="${episode}"]` } : null;
    }
    if (action) {
      return { selector: `.series-detail-actions [data-action="${action}"]` };
    }
    return null;
  },

  restorePendingFocus() {
    const descriptor = this.pendingFocusRestore;
    this.pendingFocusRestore = null;
    if (!descriptor?.selector || !this.container) {
      return false;
    }
    const target = this.container.querySelector(descriptor.selector);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return this.focusInList([target], 0);
  },

  restartTrailerAutoplayTimer() {
    if (this.trailerAutoplayTimer) {
      clearTimeout(this.trailerAutoplayTimer);
      this.trailerAutoplayTimer = null;
    }
    if (
      !this.trailerSource
      || this.isTrailerPlaying
      || this.pendingEpisodeSelection
      || this.pendingMovieSelection
      || !PlayerSettingsStore.get().trailerAutoplay
    ) {
      return;
    }
    this.trailerAutoplayTimer = setTimeout(() => {
      this.playTrailer();
    }, 7000);
  },

  syncTrailerDom() {
    const shell = this.container?.querySelector(".series-detail-shell");
    const layer = this.container?.querySelector(".detail-trailer-layer");
    if (!shell || !layer) {
      return;
    }
    shell.classList.toggle("detail-trailer-active", Boolean(this.isTrailerPlaying));
    if (!this.isTrailerPlaying || !this.trailerSource) {
      layer.innerHTML = "";
      return;
    }
    if (this.trailerSource.kind === "youtube") {
      layer.innerHTML = `
        <iframe
          class="detail-trailer-frame"
          src="${this.trailerSource.embedUrl}"
          title="Trailer"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerpolicy="origin-when-cross-origin"
          allowfullscreen
        ></iframe>
      `;
      return;
    }
    layer.innerHTML = `
      <video class="detail-trailer-video" autoplay muted loop playsinline>
        <source src="${this.trailerSource.url}" />
      </video>
    `;
  },

  playTrailer() {
    if (!this.trailerSource) {
      return;
    }
    this.isTrailerPlaying = true;
    this.syncTrailerDom();
  },

  stopTrailerPlayback({ keepDom = false } = {}) {
    if (this.trailerAutoplayTimer) {
      clearTimeout(this.trailerAutoplayTimer);
      this.trailerAutoplayTimer = null;
    }
    this.isTrailerPlaying = false;
    if (!keepDom) {
      const layer = this.container?.querySelector(".detail-trailer-layer");
      if (layer) {
        layer.innerHTML = "";
      }
    }
    const shell = this.container?.querySelector(".series-detail-shell");
    if (shell) {
      shell.classList.remove("detail-trailer-active");
    }
  },

  async openEpisodeStreamChooser(videoId) {
    if (!videoId || !this.meta) {
      return;
    }
    this.stopTrailerPlayback({ keepDom: false });
    const episode = this.episodes.find((entry) => entry.id === videoId) || null;
    if (!episode) {
      return;
    }
    this.navigateToStreamScreenForEpisode(episode);
  },

  async openMovieStreamChooser() {
    this.stopTrailerPlayback({ keepDom: false });
    this.navigateToStreamScreenForMovie();
  },

  getActivePendingSelection() {
    return this.pendingEpisodeSelection || this.pendingMovieSelection || null;
  },

  getFilteredEpisodeStreams() {
    const pending = this.getActivePendingSelection();
    if (!pending || !pending.streams.length) {
      return [];
    }
    if (pending.addonFilter === "all") {
      return pending.streams;
    }
    return pending.streams.filter((stream) => stream.addonName === pending.addonFilter);
  },

  renderEpisodeStreamChooser() {
    const mount = this.container.querySelector("#episodeStreamChooserMount");
    if (!mount) {
      return;
    }
    const pending = this.pendingEpisodeSelection;
    if (!pending) {
      mount.innerHTML = "";
      return;
    }

    const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
    const filtered = this.getFilteredEpisodeStreams();
    const filterTabs = [
      `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
      ...addons.map((addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
    ].join("");

    const streamCards = filtered.length
      ? filtered.map((stream) => `
          <article class="series-stream-card focusable"
                   data-action="playEpisodeStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${getAddonIconPath(stream.addonName) ? `<img class="series-stream-addon-icon" src="${getAddonIconPath(stream.addonName)}" alt="" aria-hidden="true" />` : ""}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("")
      : pending.loading
        ? `<div class="series-stream-empty">Loading streams...</div>`
        : `<div class="series-stream-empty">No streams found for this filter.</div>`;

    mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Series"}</div>`}
            <div class="series-stream-episode">${pending.episode ? `S${pending.episode.season} E${pending.episode.episode}` : ""}</div>
            <div class="series-stream-episode-title">${pending.episode?.title || ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyStreamChooserFocus();
  },

  renderMovieStreamChooser() {
    const mount = this.container.querySelector("#movieStreamChooserMount");
    if (!mount) {
      return;
    }
    const pending = this.pendingMovieSelection;
    if (!pending) {
      mount.innerHTML = "";
      return;
    }

    const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
    const filtered = this.getFilteredEpisodeStreams();
    const filterTabs = [
      `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
      ...addons.map((addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
    ].join("");

    const streamCards = filtered.length
      ? filtered.map((stream) => `
          <article class="series-stream-card focusable"
                   data-action="playPendingStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${getAddonIconPath(stream.addonName) ? `<img class="series-stream-addon-icon" src="${getAddonIconPath(stream.addonName)}" alt="" aria-hidden="true" />` : ""}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("")
      : pending.loading
        ? `<div class="series-stream-empty">Loading streams...</div>`
        : `<div class="series-stream-empty">No streams found for this filter.</div>`;

    mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${this.meta?.logo ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${this.meta?.name || "Movie"}</div>`}
            <div class="series-stream-episode">${this.meta?.name || ""}</div>
            <div class="series-stream-episode-title">${Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).join(" • ") : ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyStreamChooserFocus();
  },

  closeEpisodeStreamChooser() {
    this.streamChooserLoadToken = (this.streamChooserLoadToken || 0) + 1;
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.streamChooserFocus = null;
    this.render(this.meta);
  },

  consumeBackRequest() {
    if (this.isTrailerPlaying) {
      this.stopTrailerPlayback();
      this.restartTrailerAutoplayTimer();
      return true;
    }
    if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
      this.closeEpisodeStreamChooser();
      return true;
    }
    if (this.isLoadingDetail) {
      Router.navigate("home");
      return true;
    }
    return false;
  },

  playEpisodeFromSelectedStream(streamId) {
    const pending = this.pendingEpisodeSelection;
    if (!pending) {
      return;
    }
    const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
    if (!selectedStream?.url) {
      return;
    }
    const currentIndex = this.episodes.findIndex((entry) => entry.id === pending.videoId);
    const nextEpisode = currentIndex >= 0 ? (this.episodes[currentIndex + 1] || null) : null;
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType: this.params?.itemType || "series",
      videoId: pending.videoId,
      season: pending.episode?.season ?? null,
      episode: pending.episode?.episode ?? null,
      episodeLabel: pending.episode ? `S${pending.episode.season}E${pending.episode.episode}` : null,
      playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerSubtitle: pending.episode
        ? `S${pending.episode.season}E${pending.episode.episode} - ${pending.episode.title || ""}`.replace(/\s+-\s*$/, "")
        : "",
      playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
      playerLogoUrl: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      episodes: this.episodes || [],
      streamCandidates: pending.streams || [],
      nextEpisodeVideoId: nextEpisode?.id || null,
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
    });
  },

  navigateToStreamScreenForEpisode(episode) {
    if (!episode?.id) {
      return;
    }
    const currentIndex = this.episodes.findIndex((entry) => entry.id === episode.id);
    const nextEpisode = currentIndex >= 0 ? (this.episodes[currentIndex + 1] || null) : null;
    const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType: "series",
      itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      backdrop: streamBackdrop,
      poster: this.meta?.poster || null,
      logo: this.meta?.logo || null,
      runtime: episode.runtimeMinutes || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      videoId: episode.id,
      season: episode.season,
      episode: episode.episode,
      episodeTitle: episode.title || "",
      episodes: this.episodes || [],
      nextEpisodeVideoId: nextEpisode?.id || null,
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
    });
  },

  navigateToStreamScreenForMovie() {
    const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType: "movie",
      itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      itemSubtitle: "",
      genres: Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).join(" • ") : "",
      year: releaseYear,
      backdrop: streamBackdrop,
      poster: this.meta?.poster || null,
      logo: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      videoId: this.params?.itemId || null,
      episodes: []
    });
  },

  playMovieFromSelectedStream(streamId) {
    const pending = this.pendingMovieSelection;
    if (!pending) {
      return;
    }
    const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
    if (!selectedStream?.url) {
      return;
    }
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType: this.params?.itemType || "movie",
      season: null,
      episode: null,
      playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerSubtitle: "",
      playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
      playerLogoUrl: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      episodes: [],
      streamCandidates: pending.streams || []
    });
  },

  renderError(message) {
    this.isLoadingDetail = false;
    this.container.innerHTML = `
      <div class="row">
        <h2>Detail</h2>
        <p>${message}</p>
        <div class="card focusable" data-action="goBack">Back</div>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  focusInList(list, targetIndex) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const index = Math.max(0, Math.min(list.length - 1, targetIndex));
    const target = list[index];
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    target.focus();
    const horizontalTrack = target.closest(".series-episode-track, .series-cast-track, .movie-cast-track, .home-track, .series-episode-ratings-grid, .series-rating-seasons, .detail-morelike-track, .detail-company-track, .series-season-row, .series-insight-tabs");
    if (horizontalTrack) {
      const targetLeft = target.offsetLeft;
      const targetRight = targetLeft + target.offsetWidth;
      const viewLeft = horizontalTrack.scrollLeft;
      const viewRight = viewLeft + horizontalTrack.clientWidth;
      const isStrictEdgeTrack = horizontalTrack.classList.contains("series-episode-track")
        || horizontalTrack.classList.contains("home-track");
      const edgePadding = isStrictEdgeTrack ? 0 : 24;
      if (targetRight > (viewRight - edgePadding)) {
        horizontalTrack.scrollLeft = Math.max(0, targetRight - horizontalTrack.clientWidth + edgePadding);
      } else if (targetLeft < (viewLeft + edgePadding)) {
        horizontalTrack.scrollLeft = Math.max(0, targetLeft - edgePadding);
      }
      const detailContent = this.container?.querySelector(".series-detail-content");
      if (detailContent && detailContent.contains(horizontalTrack)) {
        const rect = horizontalTrack.getBoundingClientRect();
        const contentRect = detailContent.getBoundingClientRect();
        const topPad = 72;
        const bottomPad = 120;
        if (rect.bottom > contentRect.bottom - bottomPad) {
          detailContent.scrollTop += Math.ceil(rect.bottom - contentRect.bottom + bottomPad);
        } else if (rect.top < contentRect.top + topPad) {
          detailContent.scrollTop -= Math.ceil(contentRect.top + topPad - rect.top);
        }
      }
    } else if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return true;
  },

  resolvePopupFocusNode() {
    let current = this.container.querySelector(".focusable.focused");
    if (current) {
      return current;
    }
    const active = document.activeElement;
    if (active && active.classList?.contains("focusable") && this.container.contains(active)) {
      active.classList.add("focused");
      return active;
    }
    const first = this.container.querySelector(".series-stream-filter.focusable, .series-stream-card.focusable");
    if (first) {
      this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
      first.classList.add("focused");
      first.focus();
      return first;
    }
    return null;
  },

  getStreamChooserLists() {
    const filters = Array.from(this.container.querySelectorAll(".series-stream-filter.focusable"));
    const cards = Array.from(this.container.querySelectorAll(".series-stream-card.focusable"));
    const selectedFilterIndex = Math.max(0, filters.findIndex((node) => node.classList.contains("selected")));
    return { filters, cards, selectedFilterIndex };
  },

  syncStreamChooserFocusFromDom() {
    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    const activeElement = document.activeElement;
    const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === activeElement);
    if (focusedFilterIndex >= 0) {
      this.streamChooserFocus = { zone: "filter", index: focusedFilterIndex };
      return this.streamChooserFocus;
    }
    const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === activeElement);
    if (focusedCardIndex >= 0) {
      this.streamChooserFocus = { zone: "card", index: focusedCardIndex };
      return this.streamChooserFocus;
    }
    this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
    return this.streamChooserFocus;
  },

  applyStreamChooserFocus() {
    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    if (!filters.length && !cards.length) {
      this.streamChooserFocus = null;
      return false;
    }

    if (!this.streamChooserFocus) {
      this.syncStreamChooserFocusFromDom();
    }
    let zone = this.streamChooserFocus?.zone || "filter";
    let index = Number(this.streamChooserFocus?.index || 0);

    if (zone === "filter" && !filters.length && cards.length) {
      zone = "card";
      index = 0;
    } else if (zone === "card" && !cards.length && filters.length) {
      zone = "filter";
      index = selectedFilterIndex;
    }

    if (zone === "filter") {
      index = Math.max(0, Math.min(filters.length - 1, index));
      this.streamChooserFocus = { zone, index };
      return this.focusInList(filters, index);
    }

    index = Math.max(0, Math.min(cards.length - 1, index));
    this.streamChooserFocus = { zone: "card", index };
    return this.focusInList(cards, index);
  },

  handleStreamChooserDpad(event) {
    if (!this.pendingEpisodeSelection && !this.pendingMovieSelection) {
      return false;
    }
    const pending = this.getActivePendingSelection();
    if (pending?.loading && !pending?.streams?.length) {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
      return true;
    }
    const direction = getDpadDirection(event);
    if (!direction) {
      return false;
    }

    const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
    const hasValidLocalFocus =
      this.streamChooserFocus
      && ((this.streamChooserFocus.zone === "filter" && filters.length && Number(this.streamChooserFocus.index) >= 0 && Number(this.streamChooserFocus.index) < filters.length)
        || (this.streamChooserFocus.zone === "card" && cards.length && Number(this.streamChooserFocus.index) >= 0 && Number(this.streamChooserFocus.index) < cards.length));
    const focusState = hasValidLocalFocus
      ? this.streamChooserFocus
      : this.syncStreamChooserFocusFromDom();
    let zone = focusState?.zone || (filters.length ? "filter" : "card");
    let index = Number(focusState?.index || 0);
    if (zone === "filter" && !filters.length && cards.length) {
      zone = "card";
      index = Math.max(0, Math.min(cards.length - 1, index));
    } else if (zone === "card" && !cards.length && filters.length) {
      zone = "filter";
      index = selectedFilterIndex;
    }
    if (zone === "filter" && filters.length) {
      const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
      if (focusedFilterIndex >= 0) {
        index = focusedFilterIndex;
      }
    } else if (zone === "card" && cards.length) {
      const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
      if (focusedCardIndex >= 0) {
        index = focusedCardIndex;
      }
    }

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.streamChooserFocus = { zone, index: Math.max(0, index - 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "right") {
        this.streamChooserFocus = { zone, index: Math.min(filters.length - 1, index + 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "down" && cards.length) {
        this.streamChooserFocus = { zone: "card", index: Math.min(index, cards.length - 1) };
        return this.applyStreamChooserFocus() || true;
      }
      return true;
    }

    if (zone === "card") {
      if (direction === "up") {
        if (index > 0) {
          this.streamChooserFocus = { zone: "card", index: index - 1 };
          return this.applyStreamChooserFocus() || true;
        }
        if (filters.length) {
          this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
          return this.applyStreamChooserFocus() || true;
        }
        return true;
      }
      if (direction === "down") {
        this.streamChooserFocus = { zone: "card", index: Math.min(cards.length - 1, index + 1) };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "left" || direction === "right") {
        return true;
      }
      return true;
    }

    if (direction === "up" && filters.length) {
      this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
      return this.applyStreamChooserFocus() || true;
    }
    if (direction === "down" && cards.length) {
      this.streamChooserFocus = { zone: "card", index: 0 };
      return this.applyStreamChooserFocus() || true;
    }

    return true;
  },

  handleSeriesDpad(event) {
    if (!this.meta || (this.meta.type !== "series" && this.meta.type !== "tv") || this.pendingEpisodeSelection || this.pendingMovieSelection) {
      return false;
    }
    const keyCode = Number(event?.keyCode || 0);
    const direction = keyCode === 37 ? "left"
      : keyCode === 39 ? "right"
        : keyCode === 38 ? "up"
          : keyCode === 40 ? "down"
            : null;
    if (!direction) {
      return false;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return false;
    }

    const actions = Array.from(this.container.querySelectorAll(".series-detail-actions .focusable"));
    const seasons = Array.from(this.container.querySelectorAll(".series-season-row .series-season-btn.focusable"));
    const episodes = Array.from(this.container.querySelectorAll(".series-episode-track .series-episode-card.focusable"));
    const insightTabs = Array.from(this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable"));
    const castCards = Array.from(this.container.querySelectorAll(".series-cast-track .series-cast-card.focusable"));
    const ratingSeasons = Array.from(this.container.querySelectorAll(".series-rating-seasons .series-rating-season.focusable"));
    const ratingChips = Array.from(this.container.querySelectorAll(".series-episode-ratings-grid .series-episode-rating-chip.focusable"));
    const moreLikeCards = Array.from(this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable"));
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) => Array.from(track.querySelectorAll(".detail-company-card.focusable")));

    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    const actionIndex = actions.indexOf(current);
    if (actionIndex >= 0) {
      if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
      if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
      if (direction === "down") {
        if (seasons.length) {
          return this.focusInList(seasons, Math.min(actionIndex, seasons.length - 1)) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, actionIndex) || true;
        }
      }
      return true;
    }

    const seasonIndex = seasons.indexOf(current);
    if (seasonIndex >= 0) {
      if (direction === "left") return this.focusInList(seasons, seasonIndex - 1) || true;
      if (direction === "right") return this.focusInList(seasons, seasonIndex + 1) || true;
      if (direction === "up") {
        if (actions.length) {
          return this.focusInList(actions, Math.min(seasonIndex, actions.length - 1)) || true;
        }
      }
      if (direction === "down") {
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(seasonIndex, episodes.length - 1)) || true;
        }
      }
      return true;
    }

    const episodeIndex = episodes.indexOf(current);
    if (episodeIndex >= 0) {
      if (direction === "left") return this.focusInList(episodes, episodeIndex - 1) || true;
      if (direction === "right") return this.focusInList(episodes, episodeIndex + 1) || true;
      if (direction === "up") {
        if (seasons.length) {
          return this.focusInList(seasons, Math.min(episodeIndex, seasons.length - 1)) || true;
        }
        if (actions.length) {
          return this.focusInList(actions, Math.min(episodeIndex, actions.length - 1)) || true;
        }
      }
      if (direction === "down" && insightTabs.length) {
        return this.focusInList(insightTabs, 0) || true;
      }
      if (direction === "down") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, 0) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, 0) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
      }
      return true;
    }

    const tabIndex = insightTabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left") return this.focusInList(insightTabs, tabIndex - 1) || true;
      if (direction === "right") return this.focusInList(insightTabs, tabIndex + 1) || true;
      if (direction === "up") {
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(tabIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, Math.min(tabIndex, ratingSeasons.length - 1)) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(tabIndex, castCards.length - 1)) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, 0) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], 0) || true;
        }
      }
      return true;
    }

    const castIndex = castCards.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(castCards, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(castCards, castIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          return this.focusInList(insightTabs, 0) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(castIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(castIndex, moreLikeCards.length - 1)) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], Math.min(castIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    const ratingSeasonIndex = ratingSeasons.indexOf(current);
    if (ratingSeasonIndex >= 0) {
      if (direction === "left") return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
      if (direction === "right") return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          return this.focusInList(insightTabs, 1) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(ratingSeasonIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down" && ratingChips.length) {
        return this.focusInList(ratingChips, Math.min(ratingSeasonIndex, ratingChips.length - 1)) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(ratingSeasonIndex, moreLikeCards.length - 1)) || true;
      }
      return true;
    }

    const ratingChipIndex = ratingChips.indexOf(current);
    if (ratingChipIndex >= 0) {
      if (direction === "left") return this.focusInList(ratingChips, ratingChipIndex - 1) || true;
      if (direction === "right") return this.focusInList(ratingChips, ratingChipIndex + 1) || true;
      if (direction === "up") {
        if (ratingSeasons.length) {
          return this.focusInList(ratingSeasons, Math.min(ratingChipIndex, ratingSeasons.length - 1)) || true;
        }
        if (insightTabs.length) {
          return this.focusInList(insightTabs, 1) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(ratingChipIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(ratingChipIndex, moreLikeCards.length - 1)) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], Math.min(ratingChipIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (this.seriesInsightTab === "ratings" && ratingChips.length) {
          return this.focusInList(ratingChips, Math.min(moreLikeIndex, ratingChips.length - 1)) || true;
        }
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, Math.min(moreLikeIndex, ratingSeasons.length - 1)) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(moreLikeIndex, castCards.length - 1)) || true;
        }
        if (insightTabs.length) {
          return this.focusInList(insightTabs, 0) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(moreLikeIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], Math.min(moreLikeIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    for (let trackIndex = 0; trackIndex < companyCards.length; trackIndex += 1) {
      const cards = companyCards[trackIndex];
      const companyIndex = cards.indexOf(current);
      if (companyIndex < 0) {
        continue;
      }
      if (direction === "left") return this.focusInList(cards, companyIndex - 1) || true;
      if (direction === "right") return this.focusInList(cards, companyIndex + 1) || true;
      if (direction === "up") {
        if (trackIndex > 0 && companyCards[trackIndex - 1]?.length) {
          return this.focusInList(companyCards[trackIndex - 1], Math.min(companyIndex, companyCards[trackIndex - 1].length - 1)) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, Math.min(companyIndex, moreLikeCards.length - 1)) || true;
        }
        if (this.seriesInsightTab === "ratings" && ratingChips.length) {
          return this.focusInList(ratingChips, Math.min(companyIndex, ratingChips.length - 1)) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(companyIndex, castCards.length - 1)) || true;
        }
        if (insightTabs.length) {
          return this.focusInList(insightTabs, 0) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, Math.min(companyIndex, episodes.length - 1)) || true;
        }
      }
      if (direction === "down" && trackIndex < companyCards.length - 1 && companyCards[trackIndex + 1]?.length) {
        return this.focusInList(companyCards[trackIndex + 1], Math.min(companyIndex, companyCards[trackIndex + 1].length - 1)) || true;
      }
      return true;
    }

    return false;
  },

  handleMovieDpad(event) {
    if (!this.meta || this.meta.type === "series" || this.meta.type === "tv" || this.pendingEpisodeSelection || this.pendingMovieSelection) {
      return false;
    }
    const keyCode = Number(event?.keyCode || 0);
    const direction = keyCode === 37 ? "left"
      : keyCode === 39 ? "right"
        : keyCode === 38 ? "up"
          : keyCode === 40 ? "down"
            : null;
    if (!direction) {
      return false;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return false;
    }
    const actions = Array.from(this.container.querySelectorAll(".series-detail-actions .focusable"));
    const tabs = Array.from(this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable"));
    const cast = Array.from(this.container.querySelectorAll(".movie-cast-track .movie-cast-card.focusable"));
    const moreLikeCards = Array.from(this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable"));
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) => Array.from(track.querySelectorAll(".detail-company-card.focusable")));

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const actionIndex = actions.indexOf(current);
    if (actionIndex >= 0) {
      if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
      if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
      if (direction === "down") {
        if (tabs.length) {
          return this.focusInList(tabs, 0) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, actionIndex) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, actionIndex) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], Math.min(actionIndex, companyCards[0].length - 1)) || true;
        }
      }
      return true;
    }

    const tabIndex = tabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left") return this.focusInList(tabs, tabIndex - 1) || true;
      if (direction === "right") return this.focusInList(tabs, tabIndex + 1) || true;
      if (direction === "up") return this.focusInList(actions, Math.min(tabIndex, actions.length - 1)) || true;
      if (direction === "down") {
        if (cast.length) return this.focusInList(cast, Math.min(tabIndex, cast.length - 1)) || true;
        if (moreLikeCards.length) return this.focusInList(moreLikeCards, Math.min(tabIndex, moreLikeCards.length - 1)) || true;
        if (companyCards[0]?.length) return this.focusInList(companyCards[0], Math.min(tabIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    const castIndex = cast.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(cast, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(cast, castIndex + 1) || true;
      if (direction === "up") {
        if (tabs.length) {
          return this.focusInList(tabs, 0) || true;
        }
        return this.focusInList(actions, Math.min(castIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(castIndex, moreLikeCards.length - 1)) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], Math.min(castIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (cast.length) {
          return this.focusInList(cast, Math.min(moreLikeIndex, cast.length - 1)) || true;
        }
        if (tabs.length) {
          return this.focusInList(tabs, 0) || true;
        }
        return this.focusInList(actions, Math.min(moreLikeIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], Math.min(moreLikeIndex, companyCards[0].length - 1)) || true;
      }
      return true;
    }

    for (let trackIndex = 0; trackIndex < companyCards.length; trackIndex += 1) {
      const cards = companyCards[trackIndex];
      const companyIndex = cards.indexOf(current);
      if (companyIndex < 0) {
        continue;
      }
      if (direction === "left") return this.focusInList(cards, companyIndex - 1) || true;
      if (direction === "right") return this.focusInList(cards, companyIndex + 1) || true;
      if (direction === "up") {
        if (trackIndex > 0 && companyCards[trackIndex - 1]?.length) {
          return this.focusInList(companyCards[trackIndex - 1], Math.min(companyIndex, companyCards[trackIndex - 1].length - 1)) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, Math.min(companyIndex, moreLikeCards.length - 1)) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, Math.min(companyIndex, cast.length - 1)) || true;
        }
        if (tabs.length) {
          return this.focusInList(tabs, 0) || true;
        }
        return this.focusInList(actions, Math.min(companyIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && trackIndex < companyCards.length - 1 && companyCards[trackIndex + 1]?.length) {
        return this.focusInList(companyCards[trackIndex + 1], Math.min(companyIndex, companyCards[trackIndex + 1].length - 1)) || true;
      }
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }

    if (isBackEvent(event)) {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        this.closeEpisodeStreamChooser();
        return;
      }
      Router.back();
      return;
    }

    if (this.isTrailerPlaying) {
      if (getDpadDirection(event) || event.keyCode === 13) {
        event?.preventDefault?.();
        return;
      }
    } else {
      this.restartTrailerAutoplayTimer();
    }

    if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
      if (this.handleStreamChooserDpad(event)) {
        return;
      }
      if (getDpadDirection(event)) {
        event?.preventDefault?.();
        return;
      }
    }

    if (this.handleSeriesDpad(event)) {
      return;
    }

    if (this.handleMovieDpad(event)) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (event.keyCode !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const action = current.dataset.action;
    if (action === "goBack") {
      Router.back();
      return;
    }

    if (action === "openSearch") {
      Router.navigate("search", {
        query: this.params?.fallbackTitle || this.params?.itemId || ""
      });
      return;
    }

    if (action === "playDefault") {
      if (this.params?.itemType === "series" || this.params?.itemType === "tv") {
        const targetEpisode = this.nextEpisodeToWatch
          || this.episodes?.find((entry) => entry.season === this.selectedSeason)
          || this.episodes?.[0]
          || null;
        if (targetEpisode?.id) {
          await this.openEpisodeStreamChooser(targetEpisode.id);
        }
        return;
      }
      await this.openMovieStreamChooser();
      return;
    }

    if (action === "toggleTrailer") {
      if (this.isTrailerPlaying) {
        this.stopTrailerPlayback();
        this.restartTrailerAutoplayTimer();
      } else {
        this.playTrailer();
      }
      return;
    }

    if (action === "selectSeason") {
      const season = Number(current.dataset.season || 1);
      if (season !== this.selectedSeason) {
        this.selectedSeason = season;
        this.render(this.meta);
      }
      return;
    }

    if (action === "setSeriesInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.seriesInsightTab) {
        this.seriesInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
        this.render(this.meta);
      }
      return;
    }

    if (action === "setMovieInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.movieInsightTab) {
        this.movieInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
        this.render(this.meta);
      }
      return;
    }

    if (action === "selectRatingSeason") {
      const season = Number(current.dataset.season || this.selectedRatingSeason || 1);
      if (season !== this.selectedRatingSeason) {
        this.selectedRatingSeason = season;
        this.render(this.meta);
      }
      return;
    }

    if (action === "openEpisodeStreams") {
      const selectedEpisode = this.episodes.find((entry) => entry.id === current.dataset.videoId);
      if (selectedEpisode) {
        await this.openEpisodeStreamChooser(selectedEpisode.id);
      }
      return;
    }

    if (action === "setStreamFilter") {
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        const addon = current.dataset.addon || "all";
        if (this.pendingEpisodeSelection) {
          this.pendingEpisodeSelection.addonFilter = addon;
          const addons = Array.from(new Set(this.pendingEpisodeSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
          const order = ["all", ...addons];
          this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
          this.renderEpisodeStreamChooser();
        } else {
          this.pendingMovieSelection.addonFilter = addon;
          const addons = Array.from(new Set(this.pendingMovieSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
          const order = ["all", ...addons];
          this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
          this.renderMovieStreamChooser();
        }
      }
      return;
    }

    if (action === "playEpisodeStream" || action === "playPendingStream") {
      if (this.pendingEpisodeSelection) {
        this.playEpisodeFromSelectedStream(current.dataset.streamId);
      } else if (this.pendingMovieSelection) {
        this.playMovieFromSelectedStream(current.dataset.streamId);
      }
      return;
    }

    if (action === "openCastDetail") {
      Router.navigate("castDetail", {
        castId: current.dataset.castId || "",
        castName: current.dataset.castName || "",
        castRole: current.dataset.castRole || "",
        castPhoto: current.dataset.castPhoto || ""
      });
      return;
    }

    if (action === "toggleLibrary") {
      await savedLibraryRepository.toggle({
        contentId: this.params?.itemId,
        contentType: this.params?.itemType || "movie",
        title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        poster: this.meta?.poster || null,
        background: this.meta?.background || null
      });
      await this.loadDetail();
      return;
    }

    if (action === "toggleWatched") {
      if (this.isMarkedWatched) {
        await watchedItemsRepository.unmark(this.params?.itemId);
        await watchProgressRepository.removeProgress(this.params?.itemId);
      } else {
        await watchedItemsRepository.mark({
          contentId: this.params?.itemId,
          contentType: this.params?.itemType || "movie",
          title: this.meta?.name || this.params?.fallbackTitle || "Untitled",
          watchedAt: Date.now()
        });
        await watchProgressRepository.saveProgress({
          contentId: this.params?.itemId,
          contentType: this.params?.itemType || "movie",
          videoId: null,
          positionMs: 100,
          durationMs: 100,
          updatedAt: Date.now()
        });
      }
      await this.loadDetail();
      return;
    }

    if (action === "playStream" && current.dataset.streamUrl) {
      Router.navigate("player", {
        streamUrl: current.dataset.streamUrl,
        itemId: this.params?.itemId,
        itemType: this.params?.itemType,
        season: this.nextEpisodeToWatch?.season ?? null,
        episode: this.nextEpisodeToWatch?.episode ?? null,
        playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        playerSubtitle: this.params?.itemType === "series" ? (this.nextEpisodeToWatch?.title || "") : "",
        playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
        playerLogoUrl: this.meta?.logo || null,
        episodes: this.episodes || [],
        streamCandidates: this.streamItems || []
      });
      return;
    }

    if (action === "openMoreLikeDetail") {
      Router.navigate("detail", {
        itemId: current.dataset.itemId,
        itemType: current.dataset.itemType || "movie",
        fallbackTitle: current.dataset.itemTitle || "Untitled"
      });
    }
  },

  cleanup() {
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.stopTrailerPlayback({ keepDom: false });
    if (this.detailScrollHandler && this.container) {
      const content = this.container.querySelector(".series-detail-content");
      if (content) {
        content.removeEventListener("scroll", this.detailScrollHandler);
      }
      this.detailScrollHandler = null;
    }
    if (this.detailFocusHandler && this.container) {
      this.container.removeEventListener("focusin", this.detailFocusHandler, true);
      this.detailFocusHandler = null;
    }
    if (this.backHandler) {
      document.removeEventListener("keydown", this.backHandler, true);
      this.backHandler = null;
    }
    ScreenUtils.hide(this.container);
  }

};
