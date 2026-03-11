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
  return `<img class="series-btn-svg" src="assets/icons/trailer_play_button.svg" alt="" aria-hidden="true" />`;
}

function ratingToneClass(value) {
  const num = Number(value || 0);
  if (num >= 8.5) return "excellent";
  if (num >= 8) return "great";
  if (num >= 7) return "good";
  if (num >= 6) return "mixed";
  if (num > 0) return "bad";
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

export const MetaDetailsScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("detail");
    ScreenUtils.show(this.container);
    this.params = params;
    this.pendingEpisodeSelection = null;
    this.pendingMovieSelection = null;
    this.streamChooserFocus = null;
    this.streamChooserLoadToken = 0;
    this.isLoadingDetail = true;
    this.detailLoadToken = (this.detailLoadToken || 0) + 1;
    this.seriesInsightTab = this.seriesInsightTab || "cast";
    this.movieInsightTab = this.movieInsightTab || "cast";
    this.selectedRatingSeason = this.selectedRatingSeason || 1;

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

    const [isSaved, progress, watchedItem] = await Promise.all([
      savedLibraryRepository.isSaved(itemId),
      watchProgressRepository.getProgressByContentId(itemId),
      watchedItemsRepository.isWatched(itemId)
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
    this.selectedSeason = this.selectedSeason || this.episodes[0]?.season || 1;
    this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
    this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
    this.moreLikeThisItems = [];
    this.streamItems = [];
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
      if (!this.castItems.length) {
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
      }
      const results = await Promise.all(tasks);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.moreLikeThisItems = Array.isArray(results[0]) ? results[0] : [];
      if (itemType === "series" || itemType === "tv") {
        this.seriesRatingsBySeason = results[1] || {};
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
        tmdbRating: typeof enrichment.rating === "number" ? Number(enrichment.rating.toFixed(1)) : (meta.tmdbRating || null),
        credits: enrichment.credits || meta.credits || null,
        companies: Array.isArray(enrichment.companies) ? enrichment.companies : (meta.companies || [])
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

  render(meta) {
    const isSeries = meta.type === "series" || meta.type === "tv";
    if (isSeries) {
      this.renderSeriesLayout(meta);
      return;
    }
    this.renderMovieLayout(meta);
  },

  renderSeriesLayout(meta) {
    const backdrop = meta.background || meta.poster || "";
    const logoOrTitle = meta.logo
      ? `<img src="${meta.logo}" class="series-detail-logo" alt="${meta.name || "logo"}" />`
      : `<h1 class="series-detail-title">${meta.name || "Untitled"}</h1>`;
    const nextEpisodeLabel = this.nextEpisodeToWatch
      ? `Next S${this.nextEpisodeToWatch.season}E${this.nextEpisodeToWatch.episode}`
      : "Play";
    const imdbBadge = renderImdbBadge(resolveImdbRating(meta));
    const runtimeText = formatRuntimeMinutes(
      meta.runtime
      || meta.runtimeMinutes
      || resolveEpisodeRuntimeForSeason(this.episodes, this.selectedSeason)
      || 0
    );
    const metaInfo = [
      ...(Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : []),
      runtimeText,
      meta.releaseInfo || ""
    ].filter(Boolean).join(" • ");
    const writerLine = Array.isArray(meta.writers)
      ? meta.writers.slice(0, 2).join(", ")
      : (meta.writer || "");
    const countryLine = Array.isArray(meta.country)
      ? meta.country.slice(0, 2).join(", ")
      : (meta.country || "");
    if (!this.selectedRatingSeason || !this.seriesRatingsBySeason?.[this.selectedRatingSeason]) {
      this.selectedRatingSeason = this.selectedSeason || this.episodes?.[0]?.season || 1;
    }

    this.container.innerHTML = `
      <div class="series-detail-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>

        <div class="series-detail-content">
          ${logoOrTitle}
          <div class="series-detail-actions">
            <button class="series-primary-btn focusable" data-action="playDefault">
              <span class="series-btn-icon">${renderPlayGlyph()}</span>
              <span>${nextEpisodeLabel}</span>
            </button>
            <button class="series-circle-btn focusable" data-action="toggleLibrary">
              ${this.isSavedInLibrary ? "-" : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`}
            </button>
          </div>
          ${writerLine ? `<p class="series-detail-support">Writer: ${writerLine}</p>` : ""}
          <p class="series-detail-description">${meta.description || "No description."}</p>
          <p class="series-detail-meta">${metaInfo}${imdbBadge}</p>
          ${countryLine ? `<p class="series-detail-support">${countryLine}</p>` : ""}

          <div class="series-season-row">${this.renderSeasonButtons()}</div>
          <div class="series-episode-track">${this.renderEpisodeCards()}</div>
          ${this.renderSeriesInsightSection()}
          ${this.renderCompanyLogosSection(meta)}
          ${this.renderMoreLikeThisSection()}
        </div>

        <div id="episodeStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
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
    const logoOrTitle = meta.logo
      ? `<img src="${meta.logo}" class="series-detail-logo" alt="${meta.name || "logo"}" />`
      : `<h1 class="series-detail-title">${meta.name || "Untitled"}</h1>`;
    const directorLine = Array.isArray(meta.director)
      ? meta.director.slice(0, 2).join(", ")
      : (meta.director || "");
    const countryLine = Array.isArray(meta.country)
      ? meta.country.slice(0, 2).join(", ")
      : (meta.country || "");
    const durationText = formatRuntimeMinutes(meta.runtime || meta.runtimeMinutes || 0);
    const imdbBadge = renderImdbBadge(resolveImdbRating(meta));
    const metaInfo = [
      ...(Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : []),
      durationText,
      meta.releaseInfo || ""
    ].filter(Boolean).join(" • ");

    this.container.innerHTML = `
      <div class="series-detail-shell movie-detail-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>

        <div class="series-detail-content movie-detail-content">
          ${logoOrTitle}
          <div class="series-detail-actions">
            <button class="series-primary-btn focusable" data-action="playDefault">
              <span class="series-btn-icon">${renderPlayGlyph()}</span>
              <span>Play</span>
            </button>
            <button class="series-circle-btn focusable" data-action="toggleLibrary">
              ${this.isSavedInLibrary ? "-" : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`}
            </button>
            <button class="series-circle-btn focusable" data-action="toggleWatched">${this.isMarkedWatched ? "&#10003;" : "&#9675;"}</button>
          </div>
          ${directorLine ? `<p class="series-detail-support">Director: ${directorLine}</p>` : ""}
          <p class="series-detail-description">${meta.description || "No description."}</p>
          <p class="series-detail-meta">${metaInfo}${imdbBadge}</p>
          ${countryLine ? `<p class="series-detail-support">${countryLine}</p>` : ""}

          ${this.renderMovieInsightSection(meta)}
          ${this.renderCompanyLogosSection(meta)}
          ${this.renderMoreLikeThisSection()}
        </div>
        <div id="movieStreamChooserMount"></div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container, ".movie-detail-content .focusable");
  },
  renderMovieInsightSection(meta) {
    const tabs = `
      <div class="series-insight-tabs">
        <button class="series-insight-tab focusable${this.movieInsightTab === "cast" ? " selected" : ""}" data-action="setMovieInsightTab" data-tab="cast">Creator and Cast</button>
        <span class="series-insight-divider">|</span>
        <button class="series-insight-tab focusable${this.movieInsightTab === "ratings" ? " selected" : ""}" data-action="setMovieInsightTab" data-tab="ratings">Ratings</button>
      </div>
    `;
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
    return `
      <section class="series-insight-section movie-cast-section">
        ${tabs}
        ${this.renderSeriesCastTrack("movie")}
      </section>
    `;
  },

  renderSeriesInsightSection() {
    const tabs = `
      <div class="series-insight-tabs">
        <button class="series-insight-tab focusable${this.seriesInsightTab === "cast" ? " selected" : ""}" data-action="setSeriesInsightTab" data-tab="cast">Creator and Cast</button>
        <span class="series-insight-divider">|</span>
        <button class="series-insight-tab focusable${this.seriesInsightTab === "ratings" ? " selected" : ""}" data-action="setSeriesInsightTab" data-tab="ratings">Ratings</button>
      </div>
    `;
    return `
      <section class="series-insight-section">
        ${tabs}
        ${this.seriesInsightTab === "ratings" ? this.renderSeriesRatingsPanel() : this.renderSeriesCastTrack("series")}
      </section>
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
               data-cast-name="${person.name || ""}"
               data-cast-role="${person.character || ""}"
               data-cast-photo="${person.photo || ""}">
        <div class="movie-cast-avatar"${person.photo ? ` style="background-image:url('${String(person.photo).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="movie-cast-name">${person.name || ""}</div>
        <div class="movie-cast-role">${person.character || ""}</div>
      </article>
    `).join("");
    return `<div class="${className}">${cards}</div>`;
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
          <div class="series-episode-rating-chip ${ratingToneClass(entry.rating)}">
            <span class="series-episode-rating-ep">E${entry.episode}</span>
            <span class="series-episode-rating-val">${entry.rating != null ? String(entry.rating).replace(".", ",") : "-"}</span>
          </div>
        `).join("")
      : `<div class="series-insight-empty">No episode ratings in this season.</div>`;
    return `
      <div class="series-rating-seasons">${seasonButtons}</div>
      <div class="series-episode-ratings-grid">${chips}</div>
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
    return selectedSeasonEpisodes.map((episode) => `
      <article class="series-episode-card focusable"
           data-action="openEpisodeStreams"
           data-video-id="${episode.id}">
        <div class="series-episode-thumb"${episode.thumbnail ? ` style="background-image:url('${episode.thumbnail}')"` : ""}></div>
        <div class="series-episode-badge">S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}</div>
        <div class="series-episode-title">${episode.title}</div>
        <div class="series-episode-overview">${episode.overview || "Episode"}</div>
      </article>
    `).join("");
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

  renderMoreLikeCards() {
    if (!Array.isArray(this.moreLikeThisItems) || !this.moreLikeThisItems.length) {
      return "";
    }
    return this.moreLikeThisItems.map((item) => `
      <article class="detail-morelike-card focusable"
           data-action="openMoreLikeDetail"
           data-item-id="${item.id}"
           data-item-type="${item.type || this.params?.itemType || "movie"}"
           data-item-title="${item.name || "Untitled"}">
        <div class="detail-morelike-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
        <div class="detail-morelike-name">${item.name || "Untitled"}</div>
        <div class="detail-morelike-type">${item.type || "-"}</div>
      </article>
    `).join("");
  },

  renderMoreLikeThisSection() {
    const cards = this.renderMoreLikeCards();
    if (!cards) {
      return "";
    }
    return `
      <section class="detail-morelike-section">
        <h3 class="detail-morelike-title">More Like This</h3>
        <div class="detail-morelike-track">${cards}</div>
      </section>
    `;
  },

  renderCompanyLogosSection(meta = {}) {
    const rawCompanies = Array.isArray(meta?.companies)
      ? meta.companies
      : (Array.isArray(meta?.productionCompanies)
        ? meta.productionCompanies
        : (Array.isArray(meta?.production_companies) ? meta.production_companies : []));
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
      <article class="detail-company-card">
        ${company.logo ? `<img src="${company.logo}" alt="${company.name || "Company"}" />` : `<span>${company.name || ""}</span>`}
      </article>
    `).join("");
    return `
      <section class="detail-company-section">
        <h3 class="detail-company-title">Studios</h3>
        <div class="detail-company-track">${logos}</div>
      </section>
    `;
  },

  async openEpisodeStreamChooser(videoId) {
    if (!videoId || !this.meta) {
      return;
    }
    const episode = this.episodes.find((entry) => entry.id === videoId) || null;
    const requestKey = (this.streamChooserLoadToken || 0) + 1;
    this.streamChooserLoadToken = requestKey;
    this.pendingEpisodeSelection = {
      videoId,
      episode,
      streams: [],
      addonFilter: "all",
      loading: true,
      requestKey
    };
    this.streamChooserFocus = { zone: "filter", index: 0 };
    this.pendingMovieSelection = null;
    this.renderEpisodeStreamChooser();
    const streamResult = await streamRepository.getStreamsFromAllAddons(
      this.params?.itemType || "series",
      videoId,
      {
        itemId: String(this.params?.itemId || ""),
        season: episode?.season ?? null,
        episode: episode?.episode ?? null,
        onChunk: (chunkResult) => {
          if (!this.pendingEpisodeSelection
            || this.pendingEpisodeSelection.videoId !== videoId
            || this.pendingEpisodeSelection.requestKey !== requestKey) {
            return;
          }
          const chunkItems = this.flattenStreams(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          this.pendingEpisodeSelection.streams = this.mergeStreamItems(
            this.pendingEpisodeSelection.streams,
            chunkItems
          );
          this.renderEpisodeStreamChooser();
        }
      }
    );
    const streamItems = this.flattenStreams(streamResult);
    if (!this.pendingEpisodeSelection
      || this.pendingEpisodeSelection.videoId !== videoId
      || this.pendingEpisodeSelection.requestKey !== requestKey) {
      return;
    }
    this.pendingEpisodeSelection = {
      ...this.pendingEpisodeSelection,
      streams: this.mergeStreamItems(this.pendingEpisodeSelection.streams, streamItems),
      loading: false
    };
    this.renderEpisodeStreamChooser();
  },

  async openMovieStreamChooser() {
    const requestKey = (this.streamChooserLoadToken || 0) + 1;
    this.streamChooserLoadToken = requestKey;
    this.pendingMovieSelection = {
      streams: [],
      addonFilter: "all",
      loading: true,
      requestKey
    };
    this.streamChooserFocus = { zone: "filter", index: 0 };
    this.pendingEpisodeSelection = null;
    this.renderMovieStreamChooser();
    const streamResult = await streamRepository.getStreamsFromAllAddons(
      this.params?.itemType || "movie",
      this.params?.itemId,
      {
        itemId: String(this.params?.itemId || ""),
        onChunk: (chunkResult) => {
          if (!this.pendingMovieSelection || this.pendingMovieSelection.requestKey !== requestKey) {
            return;
          }
          const chunkItems = this.flattenStreams(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          this.pendingMovieSelection.streams = this.mergeStreamItems(
            this.pendingMovieSelection.streams,
            chunkItems
          );
          this.renderMovieStreamChooser();
        }
      }
    );
    const streams = this.flattenStreams(streamResult);
    this.streamItems = streams;
    if (!this.pendingMovieSelection || this.pendingMovieSelection.requestKey !== requestKey) {
      return;
    }
    this.pendingMovieSelection = {
      ...this.pendingMovieSelection,
      streams: this.mergeStreamItems(this.pendingMovieSelection.streams, streams),
      loading: false
    };
    this.renderMovieStreamChooser();
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
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType: "series",
      itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      backdrop: this.meta?.background || this.meta?.poster || null,
      poster: this.meta?.poster || null,
      logo: this.meta?.logo || null,
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
    Router.navigate("stream", {
      itemId: this.params?.itemId || null,
      itemType: "movie",
      itemTitle: this.meta?.name || this.params?.fallbackTitle || this.params?.itemId || "Untitled",
      itemSubtitle: Array.isArray(this.meta?.genres) ? this.meta.genres.slice(0, 3).join(" • ") : "",
      backdrop: this.meta?.background || this.meta?.poster || null,
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
    const horizontalTrack = target.closest(".series-episode-track, .series-cast-track, .movie-cast-track, .home-track, .series-episode-ratings-grid, .series-rating-seasons");
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
      if (detailContent && detailContent.contains(target)) {
        const rect = target.getBoundingClientRect();
        const contentRect = detailContent.getBoundingClientRect();
        const pad = 16;
        if (rect.bottom > contentRect.bottom - pad) {
          detailContent.scrollTop += Math.ceil(rect.bottom - contentRect.bottom + pad);
        } else if (rect.top < contentRect.top + pad) {
          detailContent.scrollTop -= Math.ceil(contentRect.top + pad - rect.top);
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
    const moreLikeCards = Array.from(this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable"));

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
      }
      return true;
    }

    const castIndex = castCards.indexOf(current);
    if (castIndex >= 0) {
      if (direction === "left") return this.focusInList(castCards, castIndex - 1) || true;
      if (direction === "right") return this.focusInList(castCards, castIndex + 1) || true;
      if (direction === "up") return this.focusInList(insightTabs, 0) || true;
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(castIndex, moreLikeCards.length - 1)) || true;
      }
      return true;
    }

    const ratingSeasonIndex = ratingSeasons.indexOf(current);
    if (ratingSeasonIndex >= 0) {
      if (direction === "left") return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
      if (direction === "right") return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
      if (direction === "up") return this.focusInList(insightTabs, 1) || true;
      if (direction === "down" && moreLikeCards.length) {
        return this.focusInList(moreLikeCards, Math.min(ratingSeasonIndex, moreLikeCards.length - 1)) || true;
      }
      return true;
    }

    const moreLikeIndex = moreLikeCards.indexOf(current);
    if (moreLikeIndex >= 0) {
      if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
      if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
      if (direction === "up") {
        if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
          return this.focusInList(ratingSeasons, Math.min(moreLikeIndex, ratingSeasons.length - 1)) || true;
        }
        if (castCards.length) {
          return this.focusInList(castCards, Math.min(moreLikeIndex, castCards.length - 1)) || true;
        }
        return this.focusInList(insightTabs, 0) || true;
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
        this.seriesInsightTab = tab === "ratings" ? "ratings" : "cast";
        this.render(this.meta);
      }
      return;
    }

    if (action === "setMovieInsightTab") {
      const tab = String(current.dataset.tab || "cast");
      if (tab !== this.movieInsightTab) {
        this.movieInsightTab = tab === "ratings" ? "ratings" : "cast";
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
    if (this.backHandler) {
      document.removeEventListener("keydown", this.backHandler, true);
      this.backHandler = null;
    }
    ScreenUtils.hide(this.container);
  }

};
