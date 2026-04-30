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
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { imdbEpisodeRatingsRepository } from "../../../data/repository/imdbEpisodeRatingsRepository.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import { YOUTUBE_PROXY_URL } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
import { renderHoldMenuMarkup } from "../../components/holdMenu.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const EPISODE_HOLD_DELAY_MS = 650;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

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

function isSeriesDetailMeta(meta = {}, episodes = null) {
  const normalizedType = String(meta?.type || "").trim().toLowerCase();
  if (normalizedType === "series") {
    return true;
  }
  if (normalizedType !== "tv") {
    return false;
  }
  const resolvedEpisodes = Array.isArray(episodes) ? episodes : normalizeEpisodes(meta?.videos || []);
  return resolvedEpisodes.length > 0;
}

function resolvePlayableDetailType(itemType, meta = {}) {
  const normalizedType = String(itemType || meta?.type || "movie").trim().toLowerCase();
  if (normalizedType === "tv") {
    return "tv";
  }
  if (normalizedType === "series") {
    return "series";
  }
  return "movie";
}

function resolveMetaImdbId(meta = {}, params = {}) {
  const candidates = [
    meta?.imdbId,
    meta?.imdb_id,
    meta?.externalIds?.imdb,
    meta?.external_ids?.imdb_id,
    meta?.id,
    params?.itemId
  ];
  return candidates
    .map((value) => String(value || "").trim().split(":")[0])
    .find((value) => /^tt\d+$/i.test(value)) || null;
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
  const normalizeCastValue = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const selectBetterCastEntry = (current, candidate) => {
    if (!candidate) {
      return current;
    }
    if (!current) {
      return candidate;
    }
    const currentScore = Number(Boolean(current.photo)) + Number(Boolean(current.tmdbId));
    const candidateScore = Number(Boolean(candidate.photo)) + Number(Boolean(candidate.tmdbId));
    return candidateScore > currentScore ? candidate : current;
  };
  const mergeCastEntries = (primary = [], supplemental = []) => {
    if (!primary.length) {
      return supplemental;
    }
    if (!supplemental.length) {
      return primary;
    }

    const exactMatches = new Map();
    const nameMatches = new Map();
    supplemental.forEach((entry) => {
      const normalizedName = normalizeCastValue(entry?.name);
      if (!normalizedName) {
        return;
      }
      const normalizedCharacter = normalizeCastValue(entry?.character);
      if (normalizedCharacter) {
        const exactKey = `${normalizedName}|${normalizedCharacter}`;
        exactMatches.set(exactKey, selectBetterCastEntry(exactMatches.get(exactKey), entry));
      }
      nameMatches.set(normalizedName, selectBetterCastEntry(nameMatches.get(normalizedName), entry));
    });

    return primary.map((entry) => {
      const normalizedName = normalizeCastValue(entry?.name);
      const normalizedCharacter = normalizeCastValue(entry?.character);
      const exactKey = normalizedName && normalizedCharacter ? `${normalizedName}|${normalizedCharacter}` : "";
      const match = (exactKey ? exactMatches.get(exactKey) : null) || (normalizedName ? nameMatches.get(normalizedName) : null);
      return {
        ...entry,
        character: entry?.character || match?.character || "",
        photo: entry?.photo || match?.photo || "",
        tmdbId: entry?.tmdbId || match?.tmdbId || null
      };
    });
  };
  const mapCastEntries = (items = [], mapper) => (Array.isArray(items) ? items : [])
    .map(mapper)
    .filter((entry) => Boolean(entry?.name));

  const members = Array.isArray(meta.castMembers) ? meta.castMembers : [];
  const memberEntries = mapCastEntries(members, (entry) => ({
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
  }));

  const direct = Array.isArray(meta.cast) ? meta.cast : [];
  const directEntries = mapCastEntries(direct, (entry) => {
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
  });

  const credits = meta.credits?.cast;
  const creditEntries = mapCastEntries(credits, (entry) => ({
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
  }));

  if (memberEntries.length) {
    return mergeCastEntries(memberEntries, [...directEntries, ...creditEntries]).slice(0, 18);
  }
  if (directEntries.length) {
    return mergeCastEntries(directEntries, creditEntries).slice(0, 12);
  }
  if (creditEntries.length) {
    return creditEntries.slice(0, 12);
  }

  return [];
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
  return formatDurationMinutes(runtime);
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

function renderLibraryGlyph(isSaved = false) {
  return isSaved
    ? "&#10003;"
    : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`;
}

function renderWatchedGlyph(isWatched = false) {
  return `<img class="series-btn-svg" src="assets/icons/${isWatched ? "visibility" : "visibility_off"}.svg" alt="" aria-hidden="true" />`;
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

function escapeAttribute(value = "") {
  return escapeHtml(value);
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
    poster: item.poster || "",
    landscapePoster: item.landscapePoster || item.background || item.poster || "",
    releaseInfo: item.releaseInfo || item.year || ""
  };
}

function normalizeEpisodeTitle(rawTitle, episodeNumber) {
  const label = t("episodes_episode", {}, "Episode");
  const trimmed = String(rawTitle || "").trim();
  const number = Number(episodeNumber || 0);
  if (!trimmed) {
    return number > 0 ? `${label} ${number}` : label;
  }
  const match = trimmed.match(/^episode\s*(\d+)$/i);
  if (match) {
    return `${label} ${match[1]}`;
  }
  return trimmed;
}

function extractPreviewYear(value = "") {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
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
  const proxyBase = String(YOUTUBE_PROXY_URL || "").trim();
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, globalThis?.location?.href || "https://example.com/");
      proxyUrl.searchParams.set("v", cleanId);
      proxyUrl.searchParams.set("autoplay", "1");
      proxyUrl.searchParams.set("muted", "1");
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
  if (!Environment.isBrowser()) {
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
    enablejsapi: "1"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

function buildInlineYoutubePlayerUrl(ytId = "", { muted = true } = {}) {
  const cleanId = String(ytId || "").trim();
  if (!cleanId) {
    return "";
  }
  const proxyBase = String(YOUTUBE_PROXY_URL || "").trim();
  if (proxyBase) {
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
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: cleanId,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1"
  });
  const origin = String(globalThis?.location?.origin || "").trim();
  if (/^https?:\/\//i.test(origin)) {
    params.set("origin", origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
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
  const ytId = resolveYoutubeId(Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds[0] : "");
  if (!ytId) {
    return null;
  }
  const embedUrl = buildYoutubeEmbedUrl(ytId);
  if (!embedUrl) {
    return null;
  }
  return {
    kind: "youtube",
    ytId,
    embedUrl
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

function formatPlaybackTime(value = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTrailerProxyStatePayload(payload, fallbackMuted = false) {
  const source = payload && typeof payload === "object" ? payload : {};
  const nestedState = source.state && typeof source.state === "object" ? source.state : null;
  const candidate = nestedState || source;
  return {
    currentTime: Number(candidate.currentTime || 0),
    duration: Number(candidate.duration || 0),
    paused: Boolean(candidate.paused),
    muted: candidate.muted == null ? Boolean(fallbackMuted) : Boolean(candidate.muted),
    loading: Boolean(candidate.loading),
    controllable: candidate.controllable !== false
  };
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
      episodeFocusIndexBySeason: this.episodeFocusIndexBySeason ? { ...this.episodeFocusIndexBySeason } : {},
      railFocusIndexByKey: this.railFocusIndexByKey ? { ...this.railFocusIndexByKey } : {},
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
    this.episodeFocusIndexBySeason = snapshot.episodeFocusIndexBySeason && typeof snapshot.episodeFocusIndexBySeason === "object"
      ? { ...snapshot.episodeFocusIndexBySeason }
      : {};
    this.railFocusIndexByKey = snapshot.railFocusIndexByKey && typeof snapshot.railFocusIndexByKey === "object"
      ? { ...snapshot.railFocusIndexByKey }
      : {};
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

  bindTrailerProxyMessaging() {
    if (this.trailerProxyMessageHandler) {
      window.removeEventListener("message", this.trailerProxyMessageHandler);
    }
    let trustedProxyOrigin = "";
    try {
      trustedProxyOrigin = new URL(String(YOUTUBE_PROXY_URL || "").trim(), globalThis?.location?.href || "https://example.com/").origin;
    } catch (_) {
      trustedProxyOrigin = "";
    }
    this.trailerProxyMessageHandler = (event) => {
      const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
      const data = event?.data;
      if (!data || typeof data !== "object" || data.source !== "nuvio-youtube-proxy") {
        return;
      }
      const eventOrigin = String(event?.origin || "").trim();
      const sourceMatchesFrame = Boolean(frameWindow && event?.source === frameWindow);
      const originMatchesProxy = Boolean(trustedProxyOrigin && eventOrigin === trustedProxyOrigin);
      if (!sourceMatchesFrame && !originMatchesProxy) {
        return;
      }
      if (data.type === "ready") {
        this.stopTrailerProxyLoadingTimer();
        this.trailerProxyState = {
          currentTime: 0,
          duration: 0,
          paused: false,
          muted: Boolean(this.trailerMuted),
          loading: true,
          controllable: true
        };
        this.postTrailerProxyCommand("getState");
        this.updateTrailerOverlay();
        return;
      }
      if (data.type === "state") {
        const nextState = normalizeTrailerProxyStatePayload(data, this.trailerMuted);
        if (nextState.loading === false || Number(nextState.duration || 0) > 0 || Number(nextState.currentTime || 0) > 0) {
          this.stopTrailerProxyLoadingTimer();
        }
        this.trailerProxyState = nextState;
        this.trailerYoutubeFallbackActive = nextState.controllable === false;
        this.updateTrailerOverlay();
      }
    };
    window.addEventListener("message", this.trailerProxyMessageHandler);
  },

  postTrailerProxyCommand(command, payload = {}) {
    const frameWindow = this.trailerUiRefs?.frame?.contentWindow;
    if (!frameWindow) {
      return false;
    }
    const src = String(this.trailerUiRefs?.frame?.src || this.trailerSource?.embedUrl || "");
    let targetOrigin = "*";
    try {
      targetOrigin = new URL(src, globalThis?.location?.href || "https://example.com/").origin;
    } catch (_) {
      targetOrigin = "*";
    }
    frameWindow.postMessage({
      source: "nuvio-detail-trailer",
      type: "command",
      command: String(command || ""),
      payload: payload && typeof payload === "object" ? payload : {}
    }, targetOrigin);
    return true;
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("detail");
    ScreenUtils.show(this.container);
    this.stopTrailerPlayback({ keepDom: false, restartAutoplay: false });
    this.params = params;
    this.isBackNavigation = Boolean(navigationContext?.isBackNavigation);
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.episodeHoldMenu = null;
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
    this.trailerMuted = false;
    this.trailerMediaListeners = [];
    this.trailerUiRefs = null;
    this.trailerProgressTimer = null;
    this.trailerControlsTimer = null;
    this.trailerProxyLoadingTimer = null;
    this.trailerControlsVisible = true;
    this.trailerProxyState = null;
    this.trailerProxyMessageHandler = null;
    this.trailerYoutubeFallbackActive = false;
    this.episodeProgressMap = new Map();
    this.episodeFocusIndexBySeason = {};
    this.railFocusIndexByKey = {};
    this.watchedEpisodeKeys = new Set();
    this.autoOpenedContinueWatchingStream = false;
    this.restoredContentScrollTop = 0;
    this.restoredTrackScrollLeftByKey = {};
    this.bindBackHandler();
    this.bindTrailerProxyMessaging();

    if (this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
      this.isLoadingDetail = false;
      this.render(this.meta, this.pendingFocusRestore);
      this.maybeAutoOpenContinueWatchingStream();
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

    const metaPromise = withTimeout(
      metaRepository.getMetaFromAllAddons(itemType, itemId),
      4500,
      { status: "error", message: "timeout" }
    );
    const isSavedPromise = savedLibraryRepository.isSaved(itemId);
    const progressPromise = watchProgressRepository.getProgressByContentId(itemId);
    const watchedItemPromise = watchedItemsRepository.isWatched(itemId);
    const allProgressPromise = watchProgressRepository.getAll();
    const allWatchedPromise = watchedItemsRepository.getAll();

    const [
      metaResult,
      isSaved,
      progress,
      watchedItem,
      allProgressItems,
      allWatchedItems
    ] = await Promise.all([
      metaPromise,
      isSavedPromise,
      progressPromise,
      watchedItemPromise,
      allProgressPromise,
      allWatchedPromise
    ]);
    const meta = metaResult.status === "success"
      ? metaResult.data
      : { id: itemId, type: itemType, name: fallbackTitle, description: "" };
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
    if (isSeriesDetailMeta(meta, this.episodes)) {
      this.seriesRatingsBySeason = {};
    } else {
      this.seriesRatingsBySeason = {};
    }
    this.render(meta);
    this.isLoadingDetail = false;
    this.maybeAutoOpenContinueWatchingStream();
    void this.refreshTrailerSource(meta, token);

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
      if (!this.castItems.length) {
        const fallbackCast = await withTimeout(this.fetchTmdbCastFallback(this.meta), 3200, []);
        if (Array.isArray(fallbackCast) && fallbackCast.length) {
          this.castItems = fallbackCast;
        }
      }
      this.selectedSeason = this.selectedSeason || this.episodes[0]?.season || 1;
      this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
      this.updateRenderedDetailSections(this.meta);
      void this.refreshTrailerSource(this.meta, token);

      const tasks = [
        withTimeout(this.fetchMoreLikeThis(this.meta), 5000, [])
      ];
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        tasks.push(withTimeout(this.fetchSeriesRatingsBySeason(this.meta), 5000, {}));
      } else {
        tasks.push(withTimeout(this.fetchMovieCollection(this.meta), 5000, { items: [], name: "" }));
      }
      const results = await Promise.all(tasks);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.moreLikeThisItems = Array.isArray(results[0]) ? results[0] : [];
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
        this.seriesRatingsBySeason = results[1] || {};
      } else {
        this.collectionItems = Array.isArray(results[1]?.items) ? results[1].items : [];
        this.collectionName = results[1]?.name || "";
      }
      this.updateRenderedDetailSections(this.meta);
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

      const wantedType = isSeriesDetailMeta(meta)
        ? (meta?.type === "tv" ? "series" : (meta?.type || "movie"))
        : (meta?.type || "movie");
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

      const flat = [];
      responses.forEach((items) => {
        if (Array.isArray(items) && items.length) {
          flat.push(...items);
        }
      });
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

  findContinueWatchingEpisodeTarget() {
    const resumeVideoId = String(this.params?.resumeVideoId || "").trim();
    if (resumeVideoId) {
      const directMatch = this.episodes.find((entry) => String(entry?.id || "") === resumeVideoId);
      if (directMatch) {
        return directMatch;
      }
    }
    const resumeSeason = Number(this.params?.resumeSeason || 0);
    const resumeEpisode = Number(this.params?.resumeEpisode || 0);
    if (resumeSeason > 0 && resumeEpisode > 0) {
      const episodeMatch = this.episodes.find((entry) => Number(entry?.season || 0) === resumeSeason && Number(entry?.episode || 0) === resumeEpisode);
      if (episodeMatch) {
        return episodeMatch;
      }
    }
    return this.nextEpisodeToWatch || this.episodes[0] || null;
  },

  maybeAutoOpenContinueWatchingStream() {
    if (!this.params?.autoOpenContinueWatching || this.autoOpenedContinueWatchingStream || this.isBackNavigation) {
      return;
    }
    this.autoOpenedContinueWatchingStream = true;
    const extraParams = {
      resumePositionMs: Number(this.params?.resumeProgressMs || 0) || 0,
      returnToDetail: true,
      continueWatchingBackHome: true
    };
    if (isSeriesDetailMeta(this.meta, this.episodes)) {
      const episode = this.findContinueWatchingEpisodeTarget();
      if (episode) {
        this.navigateToStreamScreenForEpisode(episode, extraParams);
        return;
      }
    }
    this.navigateToStreamScreenForMovie(extraParams);
  },

  navigateBackFromDetail() {
    if (this.params?.returnHomeOnBack) {
      Router.navigate("home", {}, {
        skipStackPush: true,
        replaceHistory: true
      });
      return true;
    }
    return false;
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
        imdbId: enrichment.imdbId || meta.imdbId || meta.imdb_id || null,
        tmdbRating: typeof enrichment.rating === "number" ? Number(enrichment.rating.toFixed(1)) : (meta.tmdbRating || null),
        credits: enrichment.credits || meta.credits || null,
        companies: Array.isArray(enrichment.companies) ? enrichment.companies : (meta.companies || []),
        productionCompanies: Array.isArray(enrichment.productionCompanies)
          ? enrichment.productionCompanies
          : (Array.isArray(meta.productionCompanies) ? meta.productionCompanies : []),
        networks: Array.isArray(enrichment.networks)
          ? enrichment.networks
          : (Array.isArray(meta.networks) ? meta.networks : []),
        trailers: Array.isArray(meta.trailers) && meta.trailers.length
          ? meta.trailers
          : (Array.isArray(enrichment.trailers) ? enrichment.trailers : []),
        trailerYtIds: Array.isArray(meta.trailerYtIds) && meta.trailerYtIds.length
          ? meta.trailerYtIds
          : (Array.isArray(enrichment.trailerYtIds) ? enrichment.trailerYtIds : []),
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
    const url = `${TMDB_BASE_URL}/search/${type}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.language || "en-US")}&query=${encodeURIComponent(name)}${yearParam}`;
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
      const directRatings = await imdbEpisodeRatingsRepository.getSeasonRatingsByTmdbId(tmdbId);
      if (Object.keys(directRatings || {}).length) {
        return directRatings;
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

  async resolvePreferredTrailerSource(meta = this.meta) {
    if (!meta) {
      return null;
    }
    return resolveTrailerSource(meta);
  },

  async refreshTrailerSource(meta = this.meta, token = this.detailLoadToken) {
    const nextSource = await this.resolvePreferredTrailerSource(meta);
    if (token !== this.detailLoadToken) {
      return;
    }
    const currentKey = JSON.stringify(this.trailerSource || null);
    const nextKey = JSON.stringify(nextSource || null);
    if (currentKey === nextKey) {
      return;
    }
    this.trailerSource = nextSource;
    if (!this.isTrailerPlaying) {
      this.updateRenderedDetailSections(this.meta || meta);
    }
  },

  flattenStreams(streamResult) {
    if (!streamResult || streamResult.status !== "success") {
      return [];
    }

    const flattened = [];
    (streamResult.data || []).forEach((group) => {
      const groupName = group.addonName || "Addon";
      (group.streams || []).forEach((stream, index) => {
        const entry = {
          id: `${groupName}-${index}-${stream.url || ""}`,
          label: stream.title || stream.name || `${groupName} stream`,
          description: stream.description || stream.name || "",
          addonName: groupName,
          addonLogo: group.addonLogo || stream.addonLogo || null,
          sourceType: stream.type || stream.source || "",
          url: stream.url,
          raw: stream
        };
        if (entry.url) {
          flattened.push(entry);
        }
      });
    });
    return flattened;
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
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
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

  renderSeriesHeroMarkup(meta) {
    const nextEpisodeLabel = this.nextEpisodeToWatch
      ? t(
        "detail.nextEpisodeShort",
        { season: this.nextEpisodeToWatch.season, episode: this.nextEpisodeToWatch.episode },
        "Next S{{season}}E{{episode}}"
      )
      : t("detail.play", {}, "Play");
    const creditLine = Array.isArray(meta.director) && meta.director.length
      ? meta.director.slice(0, 2).join(", ")
      : Array.isArray(meta.writer) && meta.writer.length
        ? meta.writer.slice(0, 2).join(", ")
        : (meta.director || meta.writer || "");
    const creditPrefix = Array.isArray(meta.director) && meta.director.length
      ? t("detail.creator", {}, "Creator")
      : t("detail.writer", {}, "Writer");
    return this.renderHeroSection({
      meta,
      playLabel: nextEpisodeLabel,
      creditLine,
      creditPrefix,
      showWatchedButton: false
    });
  },

  renderMovieHeroMarkup(meta) {
    const directorLine = Array.isArray(meta.director)
      ? meta.director.slice(0, 2).join(", ")
      : (meta.director || "");
    const playableType = resolvePlayableDetailType(this.params?.itemType || meta?.type, meta);
    return this.renderHeroSection({
      meta,
      playLabel: t("detail.play", {}, "Play"),
      creditLine: directorLine,
      creditPrefix: t("detail.director", {}, "Director"),
      showWatchedButton: playableType !== "tv"
    });
  },

  renderSeriesLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
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
          <div id="detailHeroSection">${this.renderSeriesHeroMarkup(meta)}</div>
          <div id="detailSeasonRowMount">
            <div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>
          </div>
          <div id="detailEpisodeTrackMount">
            <div class="series-episode-track" data-scroll-key="episodes:${this.selectedSeason || 1}">${this.renderEpisodeCards()}</div>
          </div>
          <div id="detailInsightSectionMount">${this.renderSeriesInsightSection()}</div>
          <div id="detailCompanySectionsMount">${this.renderCompanySections(meta)}</div>
        </div>

        <div id="episodeStreamChooserMount"></div>
      </div>
      ${this.renderEpisodeHoldMenu()}
    `;

    ScreenUtils.indexFocusables(this.container);
    if (!this.pendingFocusRestore) {
      ScreenUtils.setInitialFocus(this.container);
    }
    this.bindDetailChrome();
    if (this.episodeHoldMenu) {
      this.applyEpisodeHoldMenuFocus();
    }
  },
  renderHeroSection({ meta, playLabel, creditLine = "", creditPrefix = "", showWatchedButton = false }) {
    const logoOrTitle = meta.logo
      ? `<img src="${meta.logo}" class="series-detail-logo" alt="${escapeHtml(meta.name || "logo")}" decoding="async" fetchpriority="high" />`
      : `<h1 class="series-detail-title">${escapeHtml(meta.name || "Untitled")}</h1>`;
    const externalRatings = this.renderExternalRatingsRow(meta);
    const trailerSource = this.trailerSource || resolveTrailerSource(meta);
    const hasTrailerCandidate = Boolean(trailerSource);
    if (!this.trailerSource && trailerSource) {
      this.trailerSource = trailerSource;
    }
    const trailerButtonEnabled = Boolean(LayoutPreferences.get().detailPageTrailerButtonEnabled);
    const trailerButton = trailerButtonEnabled && hasTrailerCandidate
      ? `
          <button class="series-circle-btn focusable" data-action="toggleTrailer" aria-label="${escapeAttribute(t("detail.playTrailer", {}, "Play trailer"))}">
            ${renderTrailerGlyph()}
          </button>
        `
      : "";
    return `
      <section class="detail-hero-section">
        <div class="detail-hero-brand">
          ${logoOrTitle}
          <p class="detail-trailer-hint">${escapeHtml(t("detail.pressBackToReturn", {}, "Press back to return to details"))}</p>
        </div>
        <div class="series-detail-actions">
          <button class="series-primary-btn focusable" data-action="playDefault">
            <span class="series-btn-icon">${renderPlayGlyph()}</span>
            <span>${escapeHtml(playLabel)}</span>
          </button>
          <button class="series-circle-btn focusable" data-action="toggleLibrary">
            ${renderLibraryGlyph(this.isSavedInLibrary)}
          </button>
          ${showWatchedButton ? `<button class="series-circle-btn focusable${this.isMarkedWatched ? " is-selected" : ""}" data-action="toggleWatched" aria-label="${escapeAttribute(this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched"))}">${renderWatchedGlyph(this.isMarkedWatched)}</button>` : ""}
          ${trailerButton}
        </div>
        ${creditLine ? `<p class="series-detail-support">${escapeHtml(creditPrefix)}: ${escapeHtml(creditLine)}</p>` : ""}
        ${externalRatings}
        <p class="series-detail-description">${escapeHtml(meta.description || t("detail.noDescription", {}, "No description."))}</p>
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
    const production = this.renderCompanyLogosSection(
      meta.productionCompanies || meta.production_companies || [],
      t("detail.productionCompanies", {}, "Production")
    );
    const networks = this.renderCompanyLogosSection(meta.networks || [], t("detail.networks", {}, "Network"));
    if (meta.type === "series" || meta.type === "tv") {
      return `${networks}${production}`;
    }
    return `${production}${networks}`;
  },
  renderDefaultLayout(meta, streamItems) {
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    const seasonButtons = this.renderSeasonButtons();
    const episodeCards = this.renderEpisodeCards();
    const castCards = this.renderCastCards();
    const moreLikeCards = this.renderMoreLikeCards();

    this.container.innerHTML = `
      <div class="row">
        <h2>${meta.name || "Untitled"}</h2>
        <p>${meta.description || t("detail.noDescription", {}, "No description.")}</p>
        <p style="opacity:0.8;">Type: ${meta.type || "unknown"} | Id: ${meta.id || "-"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="playDefault">${isSeries ? t("detail.playNextEpisode", {}, "Play Next Episode") : t("detail.play", {}, "Play")}</div>
        <div class="card focusable" data-action="toggleLibrary">${this.isSavedInLibrary ? t("detail.removeFromLibrary", {}, "Remove from Library") : t("detail.addToLibrary", {}, "Add to Library")}</div>
        <div class="card focusable" data-action="toggleWatched">${this.isMarkedWatched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched")}</div>
        <div class="card focusable" data-action="openSearch">${t("detail.searchSimilar", {}, "Search Similar")}</div>
        <div class="card focusable" data-action="goBack">${t("common.back", {}, "Back")}</div>
      </div>
      ${isSeries ? `
      <div class="row">
        <h3>${t("detail.seasons", {}, "Seasons")}</h3>
        <div id="detailSeasons">${seasonButtons}</div>
      </div>
      <div class="row">
        <h3>${t("detail.episodes", {}, "Episodes")}</h3>
        <div id="detailEpisodes">${episodeCards}</div>
      </div>
      ` : ""}
      ${castCards ? `
      <div class="row">
        <h3>${t("detail.cast", {}, "Cast")}</h3>
        <div id="detailCast">${castCards}</div>
      </div>
      ` : ""}
      ${moreLikeCards ? `
      <div class="row">
        <h3>${t("detail.moreLikeThis", {}, "More Like This")}</h3>
        <div id="detailMoreLike">${moreLikeCards}</div>
      </div>
      ` : ""}
      <div class="row">
        <h3>${t("detail.streams", {}, "Streams")} (${streamItems.length})</h3>
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

    this.container.innerHTML = `
      <div class="series-detail-shell movie-detail-shell${this.isTrailerPlaying ? " detail-trailer-active" : ""}">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop.replace(/'/g, "%27")}')"` : ""}></div>
        <div class="detail-trailer-layer"></div>
        <div class="series-detail-vignette"></div>
        <div class="detail-bottom-shadow"></div>

        <div class="series-detail-content movie-detail-content">
          <div id="detailHeroSection">${this.renderMovieHeroMarkup(meta)}</div>
          <div id="detailInsightSectionMount">${this.renderMovieInsightSection(meta)}</div>
          <div id="detailCompanySectionsMount">${this.renderCompanySections(meta)}</div>
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

  captureRenderedChromeState() {
    const content = this.getDetailContentScroller();
    this.restoredContentScrollTop = Number(content?.scrollTop || 0);
    this.restoredTrackScrollLeftByKey = captureHorizontalScrollMap(this.container);
  },

  updateRenderedDetailSections(meta) {
    if (!this.container || !meta || !this.container.querySelector(".series-detail-shell")) {
      this.render(meta);
      return;
    }

    const focusRestore = this.captureDetailFocus();
    this.captureRenderedChromeState();
    const isSeries = isSeriesDetailMeta(meta, this.episodes);
    const backdropNode = this.container.querySelector(".series-detail-backdrop");
    if (backdropNode instanceof HTMLElement) {
      const backdrop = meta.background || meta.poster || "";
      backdropNode.style.backgroundImage = backdrop ? `url('${backdrop.replace(/'/g, "%27")}')` : "";
    }

    const heroMount = this.container.querySelector("#detailHeroSection");
    if (heroMount) {
      heroMount.innerHTML = isSeries ? this.renderSeriesHeroMarkup(meta) : this.renderMovieHeroMarkup(meta);
    }

    const seasonMount = this.container.querySelector("#detailSeasonRowMount");
    if (isSeries && seasonMount) {
      seasonMount.innerHTML = `<div class="series-season-row" data-scroll-key="season-tabs">${this.renderSeasonButtons()}</div>`;
    }

    const episodeMount = this.container.querySelector("#detailEpisodeTrackMount");
    if (isSeries && episodeMount) {
      episodeMount.innerHTML = `<div class="series-episode-track" data-scroll-key="episodes:${this.selectedSeason || 1}">${this.renderEpisodeCards()}</div>`;
    }

    const insightMount = this.container.querySelector("#detailInsightSectionMount");
    if (insightMount) {
      insightMount.innerHTML = isSeries ? this.renderSeriesInsightSection() : this.renderMovieInsightSection(meta);
    }

    const companyMount = this.container.querySelector("#detailCompanySectionsMount");
    if (companyMount) {
      companyMount.innerHTML = this.renderCompanySections(meta);
    }

    ScreenUtils.indexFocusables(this.container);
    this.pendingFocusRestore = focusRestore;
    this.bindDetailChrome();
  },
  renderMovieInsightSection(meta) {
    const tabItems = [
      ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
      ["ratings", t("detail.ratings", {}, "Ratings")],
      ...(this.moreLikeThisItems.length ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]] : []),
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
      ["cast", t("detail.creatorCast", {}, "Creator and Cast")],
      ["ratings", t("detail.ratings", {}, "Ratings")],
      ...(this.moreLikeThisItems.length ? [["morelike", t("detail.moreLikeThis", {}, "More Like This")]] : []),
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
               data-cast-photo="${escapeHtml(person.photo || "")}">
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
      return `<div class="series-insight-empty">${escapeHtml(t("detail.ratingsNotAvailable", {}, "Ratings not available."))}</div>`;
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
      : `<div class="series-insight-empty">${escapeHtml(t("detail.noEpisodeRatings", {}, "No episode ratings in this season."))}</div>`;
    return `
      <div class="series-rating-seasons" data-scroll-key="rating-seasons">${seasonButtons}</div>
      <div class="series-rating-summary">${escapeHtml(t("detail.seasonSummary", { season: this.selectedRatingSeason, count: ratings.length }, "Season {{season}} • {{count}} episodes"))}</div>
      <div class="series-episode-ratings-grid" data-scroll-key="rating-chips:${this.selectedRatingSeason}">${chips}</div>
    `;
  },

  renderSeasonButtons() {
    if (!this.episodes?.length) {
      return `<p>${escapeHtml(t("detail.noEpisodesFound", {}, "No episodes found."))}</p>`;
    }
    const seasons = Array.from(new Set(this.episodes.map((episode) => episode.season)));
    return seasons.map((season) => `
      <button class="series-season-btn focusable${season === this.selectedSeason ? " selected" : ""}"
              data-action="selectSeason"
              data-season="${season}">
        ${escapeHtml(t("detail.seasonLabel", { season }, "Season {{season}}"))}
      </button>
    `).join("");
  },

  renderEpisodeCards() {
    if (!this.episodes?.length) {
      return `<p>${escapeHtml(t("detail.noEpisodesFound", {}, "No episodes found."))}</p>`;
    }
    const selectedSeasonEpisodes = this.episodes.filter((episode) => episode.season === this.selectedSeason);
    if (!selectedSeasonEpisodes.length) {
      return `<p>${escapeHtml(t("episodes_panel_no_episodes", {}, "No episodes available"))}</p>`;
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
              <div class="series-episode-badge">${escapeHtml(t("episodes_episode", {}, "Episode").toUpperCase())} ${Number(episode.episode || 0)}</div>
              <div class="series-episode-title">${escapeHtml(normalizeEpisodeTitle(episode.title, episode.episode))}</div>
             <div class="series-episode-overview">${escapeHtml(episode.overview || t("episodes_episode", {}, "Episode"))}</div>
              ${metaParts ? `<div class="series-episode-meta">${metaParts}</div>` : ""}
              ${progressRatio > 0.02 && progressRatio < 0.98 ? `<div class="series-episode-progress"><span style="width:${Math.round(progressRatio * 100)}%"></span></div>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
  },

  getEpisodeByVideoId(videoId) {
    const wanted = String(videoId || "").trim();
    if (!wanted) {
      return null;
    }
    return this.episodes.find((episode) => String(episode?.id || "") === wanted) || null;
  },

  getEpisodeFocusDescriptor(videoId) {
    const value = String(videoId || "").trim();
    return value ? { selector: `.series-episode-card[data-video-id="${escapeSelectorValue(value)}"]` } : null;
  },

  getEpisodeMenuProgress(episode) {
    if (!episode) {
      return null;
    }
    return this.episodeProgressMap.get(`${Number(episode.season || 0)}:${Number(episode.episode || 0)}`) || null;
  },

  isEpisodeMarkedWatched(episode) {
    if (!episode) {
      return false;
    }
    return this.watchedEpisodeKeys.has(`${Number(episode.season || 0)}:${Number(episode.episode || 0)}`);
  },

  getEpisodeHoldMenuEpisode() {
    return this.getEpisodeByVideoId(this.episodeHoldMenu?.videoId) || this.episodeHoldMenu?.episode || null;
  },

  getEpisodeHoldMenuOptions() {
    const episode = this.getEpisodeHoldMenuEpisode();
    if (!episode) {
      return [];
    }
    const progress = this.getEpisodeMenuProgress(episode);
    const watched = this.isEpisodeMarkedWatched(episode);
    const hasResume = !watched && Number(progress?.positionMs || 0) > 0;
    return [
      { action: hasResume ? "resume" : "play", label: hasResume ? t("common.resume", {}, "Resume") : t("detail.play", {}, "Play") },
      { action: "startOver", label: t("common.startOver", {}, "Start Over") },
      { action: "toggleWatched", label: watched ? t("common.markUnwatched", {}, "Mark Unwatched") : t("common.markWatched", {}, "Mark Watched") }
    ];
  },

  renderEpisodeHoldMenu() {
    const episode = this.getEpisodeHoldMenuEpisode();
    if (!episode) {
      return "";
    }
    const subtitle = [`S${Number(episode.season || 0)}E${Number(episode.episode || 0)}`, episode.title || ""].filter(Boolean).join(" - ");
    return renderHoldMenuMarkup({
      kicker: t("detail.episodeOptions", {}, "Episode Options"),
      title: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      subtitle,
      focusedIndex: Number(this.episodeHoldMenu?.optionIndex || 0),
      options: this.getEpisodeHoldMenuOptions()
    });
  },

  applyEpisodeHoldMenuFocus() {
    const buttons = Array.from(this.container?.querySelectorAll(".hold-menu-button.focusable") || []);
    if (!buttons.length) {
      return false;
    }
    const index = Math.max(0, Math.min(buttons.length - 1, Number(this.episodeHoldMenu?.optionIndex || 0)));
    buttons.forEach((node, buttonIndex) => node.classList.toggle("focused", buttonIndex === index));
    const target = buttons[index] || buttons[0] || null;
    if (!target) {
      return false;
    }
    target.classList.add("focused");
    target.focus();
    return true;
  },

  moveEpisodeHoldMenuFocus(delta) {
    if (!this.episodeHoldMenu) {
      return false;
    }
    const options = this.getEpisodeHoldMenuOptions();
    if (!options.length) {
      return false;
    }
    this.episodeHoldMenu = {
      ...this.episodeHoldMenu,
      optionIndex: Math.max(0, Math.min(options.length - 1, Number(this.episodeHoldMenu.optionIndex || 0) + delta))
    };
    return this.applyEpisodeHoldMenuFocus();
  },

  isEpisodeHoldTarget(node) {
    return Boolean(node?.matches?.(".series-episode-card.focusable"));
  },

  cancelPendingEpisodeHold() {
    if (this.pendingEpisodeHoldTimer) {
      clearTimeout(this.pendingEpisodeHoldTimer);
      this.pendingEpisodeHoldTimer = null;
    }
    this.pendingEpisodeHoldTarget = null;
  },

  hasPendingEpisodeHold(node) {
    const pending = this.pendingEpisodeHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.videoId || "") === String(pending.videoId || "");
  },

  startPendingEpisodeHold(node) {
    const videoId = String(node?.dataset?.videoId || "");
    if (!videoId) {
      return false;
    }
    this.cancelPendingEpisodeHold();
    this.pendingEpisodeHoldTarget = {
      videoId,
      holdTriggered: false
    };
    this.pendingEpisodeHoldTimer = setTimeout(() => {
      this.pendingEpisodeHoldTimer = null;
      const pending = this.pendingEpisodeHoldTarget;
      if (!pending || Router.getCurrent() !== "detail") {
        return;
      }
      const current = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
      if (!this.hasPendingEpisodeHold(current)) {
        return;
      }
      pending.holdTriggered = true;
      this.openEpisodeHoldMenu(current);
    }, EPISODE_HOLD_DELAY_MS);
    return true;
  },

  async completePendingEpisodeHold(node) {
    const pending = this.pendingEpisodeHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    this.cancelPendingEpisodeHold();
    if (holdTriggered) {
      return true;
    }
    if (!this.isEpisodeHoldTarget(node)) {
      return false;
    }
    const selectedEpisode = this.episodes.find((entry) => entry.id === node.dataset.videoId);
    if (!selectedEpisode) {
      return false;
    }
    await this.openEpisodeStreamChooser(selectedEpisode.id);
    return true;
  },

  openEpisodeHoldMenu(node) {
    const episode = this.getEpisodeByVideoId(node?.dataset?.videoId || "");
    if (!episode) {
      return false;
    }
    this.pendingFocusRestore = this.getEpisodeFocusDescriptor(episode.id);
    this.episodeHoldMenu = {
      videoId: String(episode.id || ""),
      optionIndex: 0,
      episode: { ...episode }
    };
    this.render(this.meta, this.pendingFocusRestore);
    return true;
  },

  closeEpisodeHoldMenu() {
    if (!this.episodeHoldMenu) {
      return false;
    }
    const focusRestore = this.getEpisodeFocusDescriptor(this.episodeHoldMenu.videoId);
    this.episodeHoldMenu = null;
    this.render(this.meta, focusRestore);
    return true;
  },

  startEpisodeFromHoldMenu(episode, options = {}) {
    if (!episode?.id) {
      return false;
    }
    const progress = this.getEpisodeMenuProgress(episode);
    this.episodeHoldMenu = null;
    this.navigateToStreamScreenForEpisode(episode, {
      resumePositionMs: options.startOver ? 0 : (Number(progress?.positionMs || 0) || 0)
    });
    return true;
  },

  async refreshEpisodePlaybackState() {
    const [progress, allProgressItems, allWatchedItems, watchedItem] = await Promise.all([
      watchProgressRepository.getProgressByContentId(this.params?.itemId),
      watchProgressRepository.getAll(),
      watchedItemsRepository.getAll(),
      watchedItemsRepository.isWatched(this.params?.itemId)
    ]);
    this.isMarkedWatched = Boolean(
      watchedItem
      || (progress && Number(progress.durationMs || 0) > 0 && Number(progress.positionMs || 0) >= Number(progress.durationMs || 0))
    );
    this.buildEpisodeState(allProgressItems, allWatchedItems);
    this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
  },

  async setEpisodeWatchedState(episode, watched) {
    if (!episode?.id) {
      return false;
    }
    if (watched) {
      await watchedItemsRepository.mark({
        contentId: this.params?.itemId,
        contentType: "series",
        title: this.meta?.name || this.params?.fallbackTitle || episode.title || "Untitled",
        season: episode.season,
        episode: episode.episode,
        watchedAt: Date.now()
      });
      await watchProgressRepository.saveProgress({
        contentId: this.params?.itemId,
        contentType: "series",
        videoId: episode.id,
        season: episode.season,
        episode: episode.episode,
        positionMs: 100,
        durationMs: 100,
        updatedAt: Date.now()
      });
    } else {
      await watchedItemsRepository.unmark(this.params?.itemId, {
        season: episode.season,
        episode: episode.episode
      });
      await watchProgressRepository.removeProgress(this.params?.itemId, episode.id);
    }
    await this.refreshEpisodePlaybackState();
    this.episodeHoldMenu = null;
    this.render(this.meta, this.getEpisodeFocusDescriptor(episode.id));
    return true;
  },

  async activateEpisodeHoldMenuOption() {
    const episode = this.getEpisodeHoldMenuEpisode();
    const options = this.getEpisodeHoldMenuOptions();
    const option = options[Math.max(0, Math.min(options.length - 1, Number(this.episodeHoldMenu?.optionIndex || 0)))];
    if (!episode || !option) {
      return false;
    }
    if (option.action === "resume" || option.action === "play") {
      return this.startEpisodeFromHoldMenu(episode);
    }
    if (option.action === "startOver") {
      return this.startEpisodeFromHoldMenu(episode, { startOver: true });
    }
    if (option.action === "toggleWatched") {
      return this.setEpisodeWatchedState(episode, !this.isEpisodeMarkedWatched(episode));
    }
    return false;
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
      const year = extractPreviewYear(item.releaseInfo);
      const primaryImage = item.landscapePoster || item.poster || "";
      const fallbackImage = item.poster && item.poster !== primaryImage ? item.poster : "";
      return `
      <article class="detail-morelike-card focusable"
           data-action="openMoreLikeDetail"
           data-item-id="${item.id}"
           data-item-type="${item.type || this.params?.itemType || "movie"}"
           data-item-title="${escapeHtml(item.name || "Untitled")}">
        <div class="detail-morelike-poster-wrap">
          ${primaryImage
            ? `<img class="detail-morelike-poster-image" src="${escapeHtml(primaryImage)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async"${fallbackImage ? ` data-fallback-src="${escapeHtml(fallbackImage)}"` : ""} onerror="const next=this.dataset.fallbackSrc||''; if(next && this.src !== next){ this.src = next; this.dataset.fallbackSrc=''; return; } this.hidden = true; const placeholder = this.nextElementSibling; if(placeholder){ placeholder.hidden = false; }" />`
            : ""}
          <div class="detail-morelike-poster placeholder"${primaryImage ? " hidden" : ""}></div>
        </div>
        <div class="detail-morelike-name">${escapeHtml(item.name || "Untitled")}</div>
        ${year ? `<div class="detail-morelike-type">${escapeHtml(year)}</div>` : ""}
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
        ${company.logo ? `<img src="${company.logo}" alt="${escapeHtml(company.name || "Company")}" loading="lazy" decoding="async" />` : `<span>${escapeHtml(company.name || "")}</span>`}
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
        if (isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.seriesInsightTab) {
          this.seriesInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
          this.updateRenderedDetailSections(this.meta);
          return;
        }
        if (!isSeriesDetailMeta(this.meta, this.episodes) && tab !== this.movieInsightTab) {
          this.movieInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
          this.updateRenderedDetailSections(this.meta);
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
    if (this.detailClickHandler) {
      this.container.removeEventListener("click", this.detailClickHandler, true);
    }
    this.detailClickHandler = (event) => {
      const target = event?.target?.closest?.("[data-trailer-control]");
      if (!target || !this.isTrailerPlaying) {
        return;
      }
      event?.preventDefault?.();
      this.restartTrailerControlsTimer();
      const control = String(target.dataset.trailerControl || "");
      if (control === "playPause") {
        this.toggleActiveTrailerPlayback();
        return;
      }
      if (control === "mute") {
        this.setTrailerMutedState(!this.trailerMuted);
      }
    };
    this.container.addEventListener("click", this.detailClickHandler, true);
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

  syncDetailActionButtons() {
    if (!this.container) {
      return;
    }
    Array.from(this.container.querySelectorAll('[data-action="toggleLibrary"]')).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (node.classList.contains("series-circle-btn")) {
        node.innerHTML = renderLibraryGlyph(this.isSavedInLibrary);
        node.setAttribute(
          "aria-label",
          this.isSavedInLibrary
            ? t("detail.removeFromLibrary", {}, "Remove from Library")
            : t("detail.addToLibrary", {}, "Add to Library")
        );
      } else {
        node.textContent = this.isSavedInLibrary
          ? t("detail.removeFromLibrary", {}, "Remove from Library")
          : t("detail.addToLibrary", {}, "Add to Library");
      }
    });
    Array.from(this.container.querySelectorAll('[data-action="toggleWatched"]')).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (node.classList.contains("series-circle-btn")) {
        node.classList.toggle("is-selected", this.isMarkedWatched);
        node.innerHTML = renderWatchedGlyph(this.isMarkedWatched);
        node.setAttribute(
          "aria-label",
          this.isMarkedWatched
            ? t("common.markUnwatched", {}, "Mark Unwatched")
            : t("common.markWatched", {}, "Mark Watched")
        );
      } else {
        node.textContent = this.isMarkedWatched
          ? t("common.markUnwatched", {}, "Mark Unwatched")
          : t("common.markWatched", {}, "Mark Watched");
      }
    });
    Router.captureCurrentRouteState();
  },

  captureDetailFocus() {
    if (!this.container) {
      return null;
    }
    const current = this.container.querySelector(".focusable.focused");
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = current || (active && this.container.contains(active) ? active : null);
    if (target?.matches?.(".hold-menu-button.focusable")) {
      return this.getEpisodeFocusDescriptor(this.episodeHoldMenu?.videoId);
    }
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
    return this.focusInList([target], 0, { animated: false });
  },

  isPerformanceConstrained() {
    return Boolean(globalThis.document?.body?.classList?.contains("performance-constrained"));
  },

  isLegacyTvRuntime() {
    if (Environment.isTizen()) {
      return true;
    }
    if (!Environment.isWebOS()) {
      return false;
    }
    const webOsMajor = Number(Platform.getWebOsMajorVersion?.() || 0);
    return webOsMajor > 0 && webOsMajor <= 5;
  },

  shouldSuppressTrailerAutoplay() {
    return false;
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
    const effectiveDuration = this.isLegacyTvRuntime()
      ? 0
      : (this.isPerformanceConstrained() ? Math.min(Number(duration || 150), 90) : Number(duration || 150));
    if (prefersReducedMotion || effectiveDuration <= 0) {
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
      const progress = Math.min(1, (now - startTime) / effectiveDuration);
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
      || this.shouldSuppressTrailerAutoplay()
      || !PlayerSettingsStore.get().trailerAutoplay
    ) {
      return;
    }
    this.trailerAutoplayTimer = setTimeout(() => {
      this.playTrailer({ muted: true, restart: true, initiatedByUser: false });
    }, 7000);
  },

  detachTrailerMediaListeners() {
    (this.trailerMediaListeners || []).forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.trailerMediaListeners = [];
  },

  stopTrailerProgressTimer() {
    if (this.trailerProgressTimer) {
      clearInterval(this.trailerProgressTimer);
      this.trailerProgressTimer = null;
    }
  },

  stopTrailerControlsTimer() {
    if (this.trailerControlsTimer) {
      clearTimeout(this.trailerControlsTimer);
      this.trailerControlsTimer = null;
    }
  },

  stopTrailerProxyLoadingTimer() {
    if (this.trailerProxyLoadingTimer) {
      clearTimeout(this.trailerProxyLoadingTimer);
      this.trailerProxyLoadingTimer = null;
    }
  },

  startTrailerProxyLoadingTimer(ytId = "") {
    this.stopTrailerProxyLoadingTimer();
    const expectedId = String(ytId || "").trim();
    if (!expectedId) {
      return;
    }
    this.trailerProxyLoadingTimer = setTimeout(() => {
      const activeId = String(this.trailerSource?.ytId || "").trim();
      if (!this.isTrailerPlaying || this.trailerSource?.kind !== "youtube" || activeId !== expectedId) {
        return;
      }
      if (this.trailerProxyState && !this.trailerProxyState.loading) {
        return;
      }
      this.trailerProxyState = {
        currentTime: Number(this.trailerProxyState?.currentTime || 0),
        duration: Number(this.trailerProxyState?.duration || 0),
        paused: false,
        muted: Boolean(this.trailerMuted),
        loading: false,
        controllable: false
      };
      this.trailerYoutubeFallbackActive = true;
      this.updateTrailerOverlay();
      this.restartTrailerControlsTimer();
    }, 4500);
  },

  setTrailerControlsVisible(visible) {
    this.trailerControlsVisible = Boolean(visible);
    const overlay = this.trailerUiRefs?.overlay;
    if (overlay) {
      overlay.classList.toggle("hidden", !this.trailerControlsVisible);
    }
  },

  restartTrailerControlsTimer() {
    this.stopTrailerControlsTimer();
    if (!this.isTrailerPlaying || !this.trailerSource) {
      this.setTrailerControlsVisible(false);
      return;
    }
    this.setTrailerControlsVisible(true);
    const playback = this.getTrailerPlaybackSnapshot();
    if (playback.loading || playback.paused) {
      return;
    }
    this.trailerControlsTimer = setTimeout(() => {
      this.setTrailerControlsVisible(false);
    }, 3200);
  },

  startTrailerProgressTimer() {
    this.stopTrailerProgressTimer();
    this.updateTrailerOverlay();
    this.trailerProgressTimer = setInterval(() => {
      if (this.isTrailerPlaying && this.trailerSource?.kind === "youtube" && !this.trailerYoutubeFallbackActive) {
        this.postTrailerProxyCommand("getState");
      }
      this.updateTrailerOverlay();
    }, 250);
  },

  cacheTrailerRefs() {
    const layer = this.container?.querySelector(".detail-trailer-layer");
    this.trailerUiRefs = layer
      ? {
        layer,
        overlay: layer.querySelector(".detail-trailer-controls-overlay"),
        media: layer.querySelector("[data-trailer-media]"),
        frame: layer.querySelector(".detail-trailer-frame"),
        video: layer.querySelector(".detail-trailer-video"),
        status: layer.querySelector("[data-trailer-status]"),
        progressFill: layer.querySelector("[data-trailer-progress-fill]"),
        timeLabel: layer.querySelector("[data-trailer-time-label]"),
        playPauseButton: layer.querySelector('[data-trailer-control="playPause"]'),
        playPauseIcon: layer.querySelector("[data-trailer-play-icon]"),
        playPauseText: layer.querySelector("[data-trailer-play-label]"),
        muteButton: layer.querySelector('[data-trailer-control="mute"]'),
        muteIcon: layer.querySelector("[data-trailer-mute-icon]"),
        muteText: layer.querySelector("[data-trailer-mute-label]")
      }
      : null;
  },

  getTrailerPlaybackSnapshot() {
    const snapshot = {
      currentTime: 0,
      duration: 0,
      paused: true,
      muted: Boolean(this.trailerMuted),
      loading: false,
      controllable: true
    };
    if (!this.isTrailerPlaying || !this.trailerSource) {
      return snapshot;
    }
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return {
          ...snapshot,
          loading: true
        };
      }
      const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      return {
        currentTime: Number.isFinite(video.currentTime) ? Number(video.currentTime) : 0,
        duration,
        paused: Boolean(video.paused),
        muted: Boolean(video.muted),
        loading: Boolean(!video.readyState || video.readyState < 2),
        controllable: true
      };
    }

    if (!this.trailerProxyState) {
      return {
        ...snapshot,
        loading: true
      };
    }
    return {
      currentTime: Number(this.trailerProxyState.currentTime || 0),
      duration: Number(this.trailerProxyState.duration || 0),
      paused: Boolean(this.trailerProxyState.paused),
      muted: Boolean(this.trailerProxyState.muted),
      loading: Boolean(this.trailerProxyState.loading),
      controllable: this.trailerProxyState.controllable !== false
    };
  },

  updateTrailerOverlay() {
    const refs = this.trailerUiRefs;
    if (!refs) {
      return;
    }
    const playback = this.getTrailerPlaybackSnapshot();
    this.trailerMuted = Boolean(playback.muted);
    const progress = playback.duration > 0
      ? Math.max(0, Math.min(100, (playback.currentTime / playback.duration) * 100))
      : 0;
    if (refs.progressFill) {
      refs.progressFill.style.width = `${progress.toFixed(3)}%`;
    }
    if (refs.timeLabel) {
      refs.timeLabel.textContent = `${formatPlaybackTime(playback.currentTime)} / ${formatPlaybackTime(playback.duration)}`;
    }
    if (refs.status) {
      refs.status.textContent = playback.loading
        ? t("detail.trailerLoading", {}, "Loading trailer...")
        : playback.controllable
          ? t("detail.trailerControlsHint", {}, "OK Play/Pause  LEFT/RIGHT Seek  UP/DOWN Audio  BACK Close")
          : t("detail.trailerFallbackHint", {}, "Use back to close the trailer");
    }
    if (refs.playPauseIcon) {
      refs.playPauseIcon.src = playback.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg";
      refs.playPauseIcon.alt = "";
    }
    if (refs.playPauseText) {
      refs.playPauseText.textContent = playback.paused
        ? t("detail.trailerResume", {}, "Resume")
        : t("detail.trailerPause", {}, "Pause");
    }
    if (refs.playPauseButton) {
      refs.playPauseButton.setAttribute("aria-label", playback.paused
        ? t("detail.trailerResume", {}, "Resume")
        : t("detail.trailerPause", {}, "Pause"));
    }
    if (refs.muteIcon) {
      refs.muteIcon.src = playback.muted
        ? "assets/icons/ic_player_audio_outline.svg"
        : "assets/icons/ic_player_audio_filled.svg";
      refs.muteIcon.alt = "";
    }
    if (refs.muteText) {
      refs.muteText.textContent = playback.muted
        ? t("detail.trailerUnmute", {}, "Unmute")
        : t("detail.trailerMute", {}, "Mute");
    }
    if (refs.muteButton) {
      refs.muteButton.setAttribute("aria-label", playback.muted
        ? t("detail.trailerUnmute", {}, "Unmute")
        : t("detail.trailerMute", {}, "Mute"));
      refs.muteButton.disabled = !playback.controllable;
    }
    if (playback.loading || playback.paused) {
      this.stopTrailerControlsTimer();
      this.setTrailerControlsVisible(true);
      return;
    }
    if (this.trailerControlsVisible && !this.trailerControlsTimer) {
      this.restartTrailerControlsTimer();
    }
  },

  bindTrailerVideoEvents(video) {
    if (!video) {
      return;
    }
    this.detachTrailerMediaListeners();
    const sync = () => this.updateTrailerOverlay();
    const eventNames = ["play", "pause", "timeupdate", "volumechange", "loadedmetadata", "durationchange", "waiting", "playing", "canplay"];
    this.trailerMediaListeners = eventNames.map((eventName) => {
      video.addEventListener(eventName, sync);
      return { target: video, eventName, handler: sync };
    });
  },

  destroyYoutubeTrailerPlayer() {
    this.stopTrailerProxyLoadingTimer();
    this.trailerProxyState = null;
    this.trailerYoutubeFallbackActive = false;
  },

  async initYoutubeTrailerPlayer() {
    const ytId = String(this.trailerSource?.ytId || "").trim();
    if (!ytId || !this.trailerUiRefs?.frame || !this.isTrailerPlaying || this.trailerSource?.kind !== "youtube") {
      return;
    }
    this.destroyYoutubeTrailerPlayer();
    this.trailerProxyState = {
      currentTime: 0,
      duration: 0,
      paused: false,
      muted: Boolean(this.trailerMuted),
      loading: true,
      controllable: true
    };
    this.trailerYoutubeFallbackActive = false;
    this.startTrailerProxyLoadingTimer(ytId);
    this.updateTrailerOverlay();
    setTimeout(() => {
      if (!this.isTrailerPlaying || this.trailerSource?.kind !== "youtube" || String(this.trailerSource?.ytId || "").trim() !== ytId) {
        return;
      }
      this.postTrailerProxyCommand("setMuted", { muted: Boolean(this.trailerMuted) });
      this.postTrailerProxyCommand("play");
      this.postTrailerProxyCommand("getState");
    }, 180);
  },

  toggleActiveTrailerPlayback() {
    if (!this.isTrailerPlaying || !this.trailerSource) {
      return;
    }
    this.restartTrailerControlsTimer();
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return;
      }
      if (video.paused) {
        const playAttempt = video.play?.();
        if (playAttempt?.catch) {
          playAttempt.catch(() => {});
        }
      } else {
        video.pause?.();
      }
      this.updateTrailerOverlay();
      return;
    }
    if (!this.trailerProxyState || this.trailerYoutubeFallbackActive) {
      return;
    }
    if (this.trailerProxyState.paused) {
      this.postTrailerProxyCommand("play");
    } else {
      this.postTrailerProxyCommand("pause");
    }
    this.updateTrailerOverlay();
  },

  setTrailerMutedState(nextMuted) {
    this.trailerMuted = Boolean(nextMuted);
    if (!this.isTrailerPlaying || !this.trailerSource) {
      return;
    }
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (video) {
        video.muted = this.trailerMuted;
      }
      this.updateTrailerOverlay();
      return;
    }
    if (!this.trailerProxyState || this.trailerYoutubeFallbackActive) {
      this.updateTrailerOverlay();
      return;
    }
    this.postTrailerProxyCommand("setMuted", { muted: this.trailerMuted });
    this.updateTrailerOverlay();
  },

  seekTrailerBy(deltaSeconds) {
    const delta = Number(deltaSeconds || 0);
    if (!delta || !this.isTrailerPlaying || !this.trailerSource) {
      return;
    }
    if (this.trailerSource.kind === "video") {
      const video = this.trailerUiRefs?.video;
      if (!video) {
        return;
      }
      const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
      if (duration <= 0) {
        return;
      }
      video.currentTime = Math.max(0, Math.min(duration, Number(video.currentTime || 0) + delta));
      this.updateTrailerOverlay();
      return;
    }
    if (!this.trailerProxyState || this.trailerYoutubeFallbackActive) {
      return;
    }
    const duration = Number(this.trailerProxyState.duration || 0);
    if (duration <= 0) {
      return;
    }
    const currentTime = Number(this.trailerProxyState.currentTime || 0);
    const target = Math.max(0, Math.min(duration, currentTime + delta));
    this.postTrailerProxyCommand("seekTo", { seconds: target });
    this.updateTrailerOverlay();
  },

  syncTrailerDom() {
    const shell = this.container?.querySelector(".series-detail-shell");
    const layer = this.container?.querySelector(".detail-trailer-layer");
    if (!shell || !layer) {
      return;
    }
    shell.classList.toggle("detail-trailer-active", Boolean(this.isTrailerPlaying));
    if (!this.isTrailerPlaying || !this.trailerSource) {
      this.stopTrailerProgressTimer();
      this.detachTrailerMediaListeners();
      this.destroyYoutubeTrailerPlayer();
      this.trailerUiRefs = null;
      layer.innerHTML = "";
      return;
    }
    const title = escapeHtml(this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Trailer");
    const subtitle = escapeHtml(t("detail.trailerLabel", {}, "Trailer"));
    const controlsMarkup = `
      <div class="detail-trailer-controls-overlay" tabindex="-1">
        <div class="detail-trailer-controls-gradient detail-trailer-controls-gradient-top"></div>
        <div class="detail-trailer-controls-gradient detail-trailer-controls-gradient-bottom"></div>
        <div class="detail-trailer-controls-top">
          <div class="detail-trailer-badge">${subtitle}</div>
          <div class="detail-trailer-status" data-trailer-status aria-live="polite"></div>
        </div>
        <div class="detail-trailer-controls-bottom">
          <div class="detail-trailer-meta">
            <div class="detail-trailer-title">${title}</div>
            <div class="detail-trailer-subtitle">${subtitle}</div>
          </div>
          <div class="detail-trailer-progress">
            <div class="detail-trailer-progress-track">
              <div class="detail-trailer-progress-fill" data-trailer-progress-fill></div>
            </div>
          </div>
          <div class="detail-trailer-controls-row">
            <div class="detail-trailer-buttons">
              <button class="player-control-btn detail-trailer-control-btn is-primary" type="button" data-trailer-control="playPause" aria-label="${escapeAttribute(t("detail.trailerPause", {}, "Pause"))}">
                <img class="player-control-icon" data-trailer-play-icon src="assets/icons/ic_player_pause.svg" alt="" />
                <span class="detail-trailer-control-text" data-trailer-play-label>${escapeHtml(t("detail.trailerPause", {}, "Pause"))}</span>
              </button>
              <button class="player-control-btn detail-trailer-control-btn" type="button" data-trailer-control="mute" aria-label="${escapeAttribute(t("detail.trailerMute", {}, "Mute"))}">
                <img class="player-control-icon" data-trailer-mute-icon src="assets/icons/ic_player_audio_outline.svg" alt="" />
                <span class="detail-trailer-control-text" data-trailer-mute-label>${escapeHtml(t("detail.trailerMute", {}, "Mute"))}</span>
              </button>
            </div>
            <div class="detail-trailer-time" data-trailer-time-label>0:00 / 0:00</div>
          </div>
        </div>
      </div>
    `;
    if (this.trailerSource.kind === "youtube") {
      const youtubeFrameUrl = buildInlineYoutubePlayerUrl(this.trailerSource.ytId, { muted: this.trailerMuted }) || this.trailerSource.embedUrl || "";
      layer.innerHTML = `
        <div class="detail-trailer-media detail-trailer-youtube" data-trailer-media>
          <iframe
            class="detail-trailer-frame"
            src="${youtubeFrameUrl}"
            title="Trailer"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="origin-when-cross-origin"
            allowfullscreen
            scrolling="no"
            tabindex="-1"
            aria-hidden="true"
          ></iframe>
        </div>
        ${controlsMarkup}
      `;
      this.cacheTrailerRefs();
      this.trailerUiRefs?.overlay?.focus?.({ preventScroll: true });
      this.startTrailerProgressTimer();
      this.initYoutubeTrailerPlayer();
      return;
    }
    layer.innerHTML = `
      <div class="detail-trailer-media" data-trailer-media>
        <video class="detail-trailer-video" autoplay loop playsinline${this.trailerMuted ? " muted" : ""}>
          <source src="${this.trailerSource.url}" />
        </video>
      </div>
      ${controlsMarkup}
    `;
    this.cacheTrailerRefs();
    this.trailerUiRefs?.overlay?.focus?.({ preventScroll: true });
    this.bindTrailerVideoEvents(this.trailerUiRefs?.video || null);
    const playAttempt = this.trailerUiRefs?.video?.play?.();
    if (playAttempt?.catch) {
      playAttempt.catch(() => {});
    }
    this.startTrailerProgressTimer();
  },

  async playTrailer({ muted = null, restart = false, initiatedByUser = true } = {}) {
    if (!this.trailerSource || this.trailerSource.kind === "youtube") {
      const preferredSource = await this.resolvePreferredTrailerSource(this.meta);
      if (preferredSource) {
        this.trailerSource = preferredSource;
      }
    }
    if (!this.trailerSource) {
      return;
    }
    if (muted != null) {
      this.trailerMuted = Boolean(muted);
    } else if (!this.isTrailerPlaying && initiatedByUser) {
      this.trailerMuted = false;
    }
    if (this.isTrailerPlaying && !restart) {
      this.toggleActiveTrailerPlayback();
      return;
    }
    this.stopTrailerPlayback({ keepDom: false, restartAutoplay: false });
    this.isTrailerPlaying = true;
    this.syncTrailerDom();
    this.restartTrailerControlsTimer();
  },

  openTrailerInPlayer() {
    this.playTrailer({ restart: true, initiatedByUser: true });
  },

  stopTrailerPlayback({ keepDom = false, restartAutoplay = true } = {}) {
    if (this.trailerAutoplayTimer) {
      clearTimeout(this.trailerAutoplayTimer);
      this.trailerAutoplayTimer = null;
    }
    this.stopTrailerProgressTimer();
    this.stopTrailerControlsTimer();
    this.stopTrailerProxyLoadingTimer();
    this.detachTrailerMediaListeners();
    this.destroyYoutubeTrailerPlayer();
    this.isTrailerPlaying = false;
    if (!keepDom) {
      const layer = this.container?.querySelector(".detail-trailer-layer");
      if (layer) {
        const activeFrame = layer.querySelector("iframe");
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
        layer.innerHTML = "";
      }
    }
    this.trailerUiRefs = null;
    this.trailerControlsVisible = true;
    const shell = this.container?.querySelector(".series-detail-shell");
    if (shell) {
      shell.classList.remove("detail-trailer-active");
    }
    if (restartAutoplay) {
      this.restartTrailerAutoplayTimer();
    }
  },

  async openEpisodeStreamChooser(videoId) {
    if (!videoId || !this.meta) {
      return;
    }
    this.stopTrailerPlayback({ keepDom: false, restartAutoplay: false });
    const episode = this.episodes.find((entry) => entry.id === videoId) || null;
    if (!episode) {
      return;
    }
    this.navigateToStreamScreenForEpisode(episode);
  },

  async openMovieStreamChooser() {
    this.stopTrailerPlayback({ keepDom: false, restartAutoplay: false });
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
    if (this.episodeHoldMenu) {
      this.closeEpisodeHoldMenu();
      return true;
    }
    if (this.isTrailerPlaying) {
      this.stopTrailerPlayback();
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
    if (this.navigateBackFromDetail()) {
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
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType: this.params?.itemType || "series",
      imdbId,
      videoId: pending.videoId,
      season: pending.episode?.season ?? null,
      episode: pending.episode?.episode ?? null,
      episodeLabel: pending.episode ? `S${pending.episode.season}E${pending.episode.episode}` : null,
      playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerSubtitle: pending.episode
        ? `S${pending.episode.season}E${pending.episode.episode} - ${pending.episode.title || ""}`.replace(/\s+-\s*$/, "")
        : "",
      playerEpisodeTitle: pending.episode?.title || "",
      playerBackdropUrl: this.meta?.background || this.meta?.poster || null,
      playerLogoUrl: this.meta?.logo || null,
      parentalWarnings: this.meta?.parentalWarnings || null,
      parentalGuide: this.meta?.parentalGuide || null,
      episodes: this.episodes || [],
      streamCandidates: pending.streams || [],
      nextEpisodeVideoId: nextEpisode?.id || null,
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.title || "",
      nextEpisodeReleased: nextEpisode?.released || ""
    });
  },

  navigateToStreamScreenForEpisode(episode, extraParams = {}) {
    if (!episode?.id) {
      return;
    }
    const currentIndex = this.episodes.findIndex((entry) => entry.id === episode.id);
    const nextEpisode = currentIndex >= 0 ? (this.episodes[currentIndex + 1] || null) : null;
    const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType: "series",
      imdbId,
      returnToDetail: true,
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
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.title || "",
      nextEpisodeReleased: nextEpisode?.released || "",
      ...extraParams
    });
  },

  navigateToStreamScreenForMovie(extraParams = {}) {
    const releaseYear = String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
    const streamBackdrop = this.meta?.background || this.meta?.landscapePoster || this.meta?.poster || null;
    const itemType = resolvePlayableDetailType(this.params?.itemType || this.meta?.type, this.meta);
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType,
      imdbId,
      returnToDetail: true,
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
      episodes: [],
      ...extraParams
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
    const imdbId = resolveMetaImdbId(this.meta, this.params);
    Router.navigate("player", {
      streamUrl: selectedStream.url,
      itemId: this.params?.itemId,
      itemType: this.params?.itemType || "movie",
      imdbId,
      season: null,
      episode: null,
      playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      playerSubtitle: "",
      playerReleaseYear: String(this.meta?.releaseInfo || "").match(/\b(19|20)\d{2}\b/)?.[0] || "",
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

  getDetailContentScroller() {
    return this.container?.querySelector(".series-detail-content") || null;
  },

  getDetailFocusGroup(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    return node.closest(".series-detail-actions, .series-season-row, .series-episode-track, .series-insight-tabs, .movie-cast-track, .series-cast-track, .series-rating-seasons, .series-episode-ratings-grid, .detail-morelike-track, .detail-company-track") || node;
  },

  getHorizontalTrackScrollLeft(horizontalTrack, target) {
    if (!(horizontalTrack instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      return 0;
    }
    const maxScrollLeft = Math.max(0, horizontalTrack.scrollWidth - horizontalTrack.clientWidth);
    if (horizontalTrack.classList.contains("series-episode-track")) {
      const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(horizontalTrack) : null;
      const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
      return Math.max(0, Math.min(maxScrollLeft, target.offsetLeft - leftPad));
    }
    if (horizontalTrack.classList.contains("detail-morelike-track")) {
      const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(horizontalTrack) : null;
      const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
      return Math.max(0, Math.min(maxScrollLeft, target.offsetLeft - leftPad));
    }

    const edgePadding = horizontalTrack.classList.contains("home-track") ? 0 : 24;
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const viewLeft = horizontalTrack.scrollLeft;
    const viewRight = viewLeft + horizontalTrack.clientWidth;
    if (targetRight > (viewRight - edgePadding)) {
      return Math.max(0, Math.min(maxScrollLeft, targetRight - horizontalTrack.clientWidth + edgePadding));
    }
    if (targetLeft < (viewLeft + edgePadding)) {
      return Math.max(0, Math.min(maxScrollLeft, targetLeft - edgePadding));
    }
    return viewLeft;
  },

  syncDetailScrollBounds(target) {
    const detailContent = this.getDetailContentScroller();
    if (!detailContent || !(target instanceof HTMLElement) || !detailContent.contains(target)) {
      return;
    }
    const focusables = Array.from(detailContent.querySelectorAll(".focusable")).filter((node) => node instanceof HTMLElement);
    if (!focusables.length) {
      return;
    }
    const targetGroup = this.getDetailFocusGroup(target);
    const firstGroup = this.getDetailFocusGroup(focusables[0]);
    const lastGroup = this.getDetailFocusGroup(focusables[focusables.length - 1]);
    if (targetGroup && firstGroup && targetGroup === firstGroup) {
      detailContent.scrollTop = 0;
      return;
    }
    if (targetGroup && lastGroup && targetGroup === lastGroup) {
      detailContent.scrollTop = Math.max(0, detailContent.scrollHeight - detailContent.clientHeight);
    }
  },

  getRememberedEpisodeIndex(episodes = []) {
    if (!Array.isArray(episodes) || !episodes.length) {
      return 0;
    }
    const seasonKey = String(Number(this.selectedSeason || 0) || 0);
    const remembered = Number(this.episodeFocusIndexBySeason?.[seasonKey]);
    if (Number.isFinite(remembered) && remembered >= 0) {
      return Math.min(episodes.length - 1, remembered);
    }
    return 0;
  },

  getSelectedSeasonIndex(seasons = []) {
    if (!Array.isArray(seasons) || !seasons.length) {
      return 0;
    }
    const selectedIndex = seasons.findIndex((node) => Number(node?.dataset?.season || 0) === Number(this.selectedSeason || 0));
    return selectedIndex >= 0 ? selectedIndex : 0;
  },

  getActiveInsightTabKey() {
    return isSeriesDetailMeta(this.meta, this.episodes)
      ? String(this.seriesInsightTab || "cast")
      : String(this.movieInsightTab || "cast");
  },

  getActiveInsightTabIndex(tabs = [], fallbackIndex = 0) {
    if (!Array.isArray(tabs) || !tabs.length) {
      return 0;
    }
    const activeTabKey = this.getActiveInsightTabKey();
    const activeTabIndex = tabs.findIndex((node) => String(node?.dataset?.tab || "") === activeTabKey);
    if (activeTabIndex >= 0) {
      return activeTabIndex;
    }
    const selectedTabIndex = tabs.findIndex((node) => node?.classList?.contains("selected"));
    if (selectedTabIndex >= 0) {
      return selectedTabIndex;
    }
    return Math.max(0, Math.min(tabs.length - 1, Number(fallbackIndex) || 0));
  },

  rememberEpisodeFocus(target, list = null) {
    if (!(target instanceof HTMLElement) || !target.matches(".series-episode-card")) {
      return;
    }
    const seasonKey = String(Number(this.selectedSeason || 0) || 0);
    const items = Array.isArray(list) && list.length
      ? list
      : Array.from(this.container?.querySelectorAll(".series-episode-track .series-episode-card.focusable") || []);
    const index = items.indexOf(target);
    if (index >= 0) {
      this.episodeFocusIndexBySeason[seasonKey] = index;
    }
  },

  getRememberedRailIndex(railKey, items = []) {
    if (!railKey || !Array.isArray(items) || !items.length) {
      return 0;
    }
    const remembered = Number(this.railFocusIndexByKey?.[railKey]);
    if (Number.isFinite(remembered) && remembered >= 0) {
      return Math.min(items.length - 1, remembered);
    }
    return 0;
  },

  getRememberedCompanyIndex(companyTracks = [], companyCards = [], trackIndex = 0) {
    const cards = Array.isArray(companyCards?.[trackIndex]) ? companyCards[trackIndex] : [];
    if (!cards.length) {
      return 0;
    }
    const railKey = String(companyTracks?.[trackIndex]?.dataset?.scrollKey || "").trim();
    if (!railKey) {
      return 0;
    }
    return this.getRememberedRailIndex(railKey, cards);
  },

  rememberRailFocus(target, list = null) {
    if (!(target instanceof HTMLElement) || !target.matches(".detail-morelike-card, .detail-company-card")) {
      return;
    }
    const track = target.closest("[data-scroll-key]");
    const railKey = String(track?.dataset?.scrollKey || "").trim();
    if (!railKey) {
      return;
    }
    const itemSelector = target.matches(".detail-company-card")
      ? ".detail-company-card.focusable"
      : ".detail-morelike-card.focusable";
    const items = Array.isArray(list) && list.length
      ? list
      : Array.from(track.querySelectorAll(itemSelector));
    const index = items.indexOf(target);
    if (index >= 0) {
      this.railFocusIndexByKey[railKey] = index;
    }
  },

  getMoreLikeRailKey() {
    return isSeriesDetailMeta(this.meta, this.episodes)
      ? "morelike:series"
      : "morelike:movie";
  },

  focusInList(list, targetIndex, options = {}) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const preserveVerticalScroll = Boolean(options?.preserveVerticalScroll);
    const animated = options?.animated !== false;
    const index = Math.max(0, Math.min(list.length - 1, targetIndex));
    const target = list[index];
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    target.focus();
    this.rememberEpisodeFocus(target, list);
    this.rememberRailFocus(target, list);
    const horizontalTrack = target.closest(".series-episode-track, .series-cast-track, .movie-cast-track, .home-track, .series-episode-ratings-grid, .series-rating-seasons, .detail-morelike-track, .detail-company-track, .series-season-row, .series-insight-tabs");
    if (horizontalTrack) {
      const nextScrollLeft = this.getHorizontalTrackScrollLeft(horizontalTrack, target);
      if (animated) {
        this.animateScroll(horizontalTrack, "x", nextScrollLeft, 140);
      } else {
        horizontalTrack.scrollLeft = nextScrollLeft;
      }
      const detailContent = this.getDetailContentScroller();
      if (!preserveVerticalScroll && detailContent && detailContent.contains(horizontalTrack)) {
        const rect = horizontalTrack.getBoundingClientRect();
        const contentRect = detailContent.getBoundingClientRect();
        const topPad = 72;
        const bottomPad = 120;
        if (rect.bottom > contentRect.bottom - bottomPad) {
          const nextScrollTop = detailContent.scrollTop + Math.ceil(rect.bottom - contentRect.bottom + bottomPad);
          if (animated) {
            this.animateScroll(detailContent, "y", nextScrollTop, 150);
          } else {
            detailContent.scrollTop = nextScrollTop;
          }
        } else if (rect.top < contentRect.top + topPad) {
          const nextScrollTop = detailContent.scrollTop - Math.ceil(contentRect.top + topPad - rect.top);
          if (animated) {
            this.animateScroll(detailContent, "y", nextScrollTop, 150);
          } else {
            detailContent.scrollTop = nextScrollTop;
          }
        }
      }
    } else if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (!preserveVerticalScroll) {
      this.syncDetailScrollBounds(target);
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
    if (!this.meta || !isSeriesDetailMeta(this.meta, this.episodes) || this.pendingEpisodeSelection || this.pendingMovieSelection) {
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
    const moreLikeRememberedIndex = this.getRememberedRailIndex(this.getMoreLikeRailKey(), moreLikeCards);
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) => Array.from(track.querySelectorAll(".detail-company-card.focusable")));
    const rememberedCompanyIndex = (trackIndex = 0) => this.getRememberedCompanyIndex(companyTracks, companyCards, trackIndex);

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
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
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
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      return true;
    }

    const episodeIndex = episodes.indexOf(current);
    if (episodeIndex >= 0) {
      if (direction === "left") return this.focusInList(episodes, episodeIndex - 1, { preserveVerticalScroll: true }) || true;
      if (direction === "right") return this.focusInList(episodes, episodeIndex + 1, { preserveVerticalScroll: true }) || true;
      if (direction === "up") {
        if (seasons.length) {
          return this.focusInList(seasons, this.getSelectedSeasonIndex(seasons)) || true;
        }
        if (actions.length) {
          return this.focusInList(actions, Math.min(episodeIndex, actions.length - 1)) || true;
        }
      }
      if (direction === "down" && insightTabs.length) {
        return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
      }
      if (direction === "down") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, 0) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, 0) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
        }
      }
      return true;
    }

    const tabIndex = insightTabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left") return this.focusInList(insightTabs, tabIndex - 1, { preserveVerticalScroll: true }) || true;
      if (direction === "right") return this.focusInList(insightTabs, tabIndex + 1, { preserveVerticalScroll: true }) || true;
      if (direction === "up") {
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
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
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
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
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs), { preserveVerticalScroll: true }) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
      }
      return true;
    }

    const ratingSeasonIndex = ratingSeasons.indexOf(current);
    if (ratingSeasonIndex >= 0) {
      if (direction === "left") return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
      if (direction === "right") return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1), { preserveVerticalScroll: true }) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      if (direction === "down" && ratingChips.length) {
        return this.focusInList(ratingChips, Math.min(ratingSeasonIndex, ratingChips.length - 1)) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
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
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs, 1), { preserveVerticalScroll: true }) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (insightTabs.length) {
          const moreLikeTabIndex = Math.max(0, insightTabs.findIndex((node) => String(node?.dataset?.tab || "") === "morelike"));
          return this.focusInList(insightTabs, moreLikeTabIndex, { preserveVerticalScroll: true }) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
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
          return this.focusInList(companyCards[trackIndex - 1], rememberedCompanyIndex(trackIndex - 1)) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (this.seriesInsightTab === "ratings" && ratingChips.length) {
          return this.focusInList(ratingChips, Math.min(companyIndex, ratingChips.length - 1)) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(companyIndex, castCards.length - 1)) || true;
        }
        if (insightTabs.length) {
          return this.focusInList(insightTabs, this.getActiveInsightTabIndex(insightTabs)) || true;
        }
        if (episodes.length) {
          return this.focusInList(episodes, this.getRememberedEpisodeIndex(episodes)) || true;
        }
      }
      if (direction === "down" && trackIndex < companyCards.length - 1 && companyCards[trackIndex + 1]?.length) {
        return this.focusInList(companyCards[trackIndex + 1], rememberedCompanyIndex(trackIndex + 1)) || true;
      }
      return true;
    }

    return false;
  },

  handleMovieDpad(event) {
    if (!this.meta || isSeriesDetailMeta(this.meta, this.episodes) || this.pendingEpisodeSelection || this.pendingMovieSelection) {
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
    const moreLikeRememberedIndex = this.getRememberedRailIndex(this.getMoreLikeRailKey(), moreLikeCards);
    const companyTracks = Array.from(this.container.querySelectorAll(".detail-company-track"));
    const companyCards = companyTracks.map((track) => Array.from(track.querySelectorAll(".detail-company-card.focusable")));
    const rememberedCompanyIndex = (trackIndex = 0) => this.getRememberedCompanyIndex(companyTracks, companyCards, trackIndex);

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }

    const actionIndex = actions.indexOf(current);
    if (actionIndex >= 0) {
      if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
      if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
      if (direction === "down") {
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs), { preserveVerticalScroll: true }) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, actionIndex) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (companyCards[0]?.length) {
          return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
        }
      }
      return true;
    }

    const tabIndex = tabs.indexOf(current);
    if (tabIndex >= 0) {
      if (direction === "left") return this.focusInList(tabs, tabIndex - 1, { preserveVerticalScroll: true }) || true;
      if (direction === "right") return this.focusInList(tabs, tabIndex + 1, { preserveVerticalScroll: true }) || true;
      if (direction === "up") return this.focusInList(actions, Math.min(tabIndex, actions.length - 1)) || true;
      if (direction === "down") {
        if (cast.length) return this.focusInList(cast, Math.min(tabIndex, cast.length - 1)) || true;
        if (moreLikeCards.length) return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        if (companyCards[0]?.length) return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
      }
      return true;
    }

    const castIndex = cast.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(cast, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(cast, castIndex + 1) || true;
      if (direction === "up") {
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs), { preserveVerticalScroll: true }) || true;
        }
        return this.focusInList(actions, Math.min(castIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (tabs.length) {
          const moreLikeTabIndex = Math.max(0, tabs.findIndex((node) => String(node?.dataset?.tab || "") === "morelike"));
          return this.focusInList(tabs, moreLikeTabIndex, { preserveVerticalScroll: true }) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, Math.min(moreLikeIndex, cast.length - 1)) || true;
        }
        return this.focusInList(actions, Math.min(moreLikeIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && companyCards[0]?.length) {
        return this.focusInList(companyCards[0], rememberedCompanyIndex(0)) || true;
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
          return this.focusInList(companyCards[trackIndex - 1], rememberedCompanyIndex(trackIndex - 1)) || true;
        }
        if (moreLikeCards.length) {
          return this.focusInList(moreLikeCards, moreLikeRememberedIndex) || true;
        }
        if (cast.length) {
          return this.focusInList(cast, Math.min(companyIndex, cast.length - 1)) || true;
        }
        if (tabs.length) {
          return this.focusInList(tabs, this.getActiveInsightTabIndex(tabs), { preserveVerticalScroll: true }) || true;
        }
        return this.focusInList(actions, Math.min(companyIndex, actions.length - 1)) || true;
      }
      if (direction === "down" && trackIndex < companyCards.length - 1 && companyCards[trackIndex + 1]?.length) {
        return this.focusInList(companyCards[trackIndex + 1], rememberedCompanyIndex(trackIndex + 1)) || true;
      }
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }

    const code = Number(event?.keyCode || 0);
    const originalKeyCode = Number(event?.originalKeyCode || code || 0);
    const currentFocusedNode = this.container.querySelector(".focusable.focused") || null;

    const isTizenHoldTarget = Environment.isTizen() && this.isEpisodeHoldTarget(currentFocusedNode);
    if (!isTizenHoldTarget || code !== 13) {
      this.cancelPendingEpisodeHold();
    }

    if (this.episodeHoldMenu) {
      if (isBackEvent(event)) {
        event?.preventDefault?.();
        this.closeEpisodeHoldMenu();
        return;
      }
      if (code === 38 || code === 40) {
        event?.preventDefault?.();
        this.moveEpisodeHoldMenuFocus(code === 38 ? -1 : 1);
        return;
      }
      if (code === 13) {
        event?.preventDefault?.();
        await this.activateEpisodeHoldMenuOption();
        return;
      }
      return;
    }

    if (isBackEvent(event)) {
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (this.consumeBackRequest()) {
        return;
      }
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        this.closeEpisodeStreamChooser();
        return;
      }
      Router.back();
      return;
    }

    if (this.isTrailerPlaying) {
      this.restartTrailerControlsTimer();
      const direction = getDpadDirection(event);
      if (event.keyCode === 13) {
        event?.preventDefault?.();
        this.toggleActiveTrailerPlayback();
        return;
      }
      if (direction === "left") {
        event?.preventDefault?.();
        this.seekTrailerBy(-10);
        return;
      }
      if (direction === "right") {
        event?.preventDefault?.();
        this.seekTrailerBy(10);
        return;
      }
      if (direction === "up" || direction === "down") {
        event?.preventDefault?.();
        this.setTrailerMutedState(!this.trailerMuted);
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

    const isEpisodeHoldTarget = this.isEpisodeHoldTarget(currentFocusedNode);
    const wantsEpisodeHoldMenu = isEpisodeHoldTarget
      && ((code === 13 && event?.repeat) || originalKeyCode === 82 || code === 93);
    if (wantsEpisodeHoldMenu) {
      event?.preventDefault?.();
      this.cancelPendingEpisodeHold();
      this.openEpisodeHoldMenu(currentFocusedNode);
      return;
    }
    if (Environment.isTizen() && code === 13 && isEpisodeHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingEpisodeHold(currentFocusedNode)) {
        this.startPendingEpisodeHold(currentFocusedNode);
      }
      return;
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

    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const action = current.dataset.action;
    if (action === "goBack") {
      if (this.navigateBackFromDetail()) {
        return;
      }
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
      if (isSeriesDetailMeta(this.meta, this.episodes)) {
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
      this.playTrailer({ muted: false, restart: true, initiatedByUser: true });
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
        this.updateRenderedDetailSections(this.meta);
      }
      return;
    }

    if (action === "setMovieInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.movieInsightTab) {
        this.movieInsightTab = ["cast", "ratings", "morelike", "collection"].includes(tab) ? tab : "cast";
        this.updateRenderedDetailSections(this.meta);
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
      this.isSavedInLibrary = !this.isSavedInLibrary;
      this.syncDetailActionButtons();
      return;
    }

    if (action === "toggleWatched") {
      const focusRestore = this.captureDetailFocus();
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
      await this.refreshEpisodePlaybackState();
      this.render(this.meta, focusRestore);
      return;
    }

    if (action === "playStream" && current.dataset.streamUrl) {
      const imdbId = resolveMetaImdbId(this.meta, this.params);
      Router.navigate("player", {
        streamUrl: current.dataset.streamUrl,
        itemId: this.params?.itemId,
        itemType: this.params?.itemType,
        imdbId,
        season: this.nextEpisodeToWatch?.season ?? null,
        episode: this.nextEpisodeToWatch?.episode ?? null,
        playerTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
        playerSubtitle: this.params?.itemType === "series" ? (this.nextEpisodeToWatch?.title || "") : "",
        playerEpisodeTitle: this.nextEpisodeToWatch?.title || "",
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

  async onKeyUp(event) {
    if (!Environment.isTizen()) {
      return;
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
    if (await this.completePendingEpisodeHold(current)) {
      event?.preventDefault?.();
    }
  },

  cleanup() {
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.cancelPendingEpisodeHold();
    this.episodeHoldMenu = null;
    this.stopTrailerPlayback({ keepDom: false, restartAutoplay: false });
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
    if (this.detailClickHandler && this.container) {
      this.container.removeEventListener("click", this.detailClickHandler, true);
      this.detailClickHandler = null;
    }
    if (this.backHandler) {
      document.removeEventListener("keydown", this.backHandler, true);
      this.backHandler = null;
    }
    if (this.trailerProxyMessageHandler) {
      window.removeEventListener("message", this.trailerProxyMessageHandler);
      this.trailerProxyMessageHandler = null;
    }
    ScreenUtils.hide(this.container);
  }

};
