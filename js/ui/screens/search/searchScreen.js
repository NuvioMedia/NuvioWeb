import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  focusWithoutAutoScroll,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatTypeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Movie";
  if (normalized === "tv") return "TV";
  return toTitleCase(normalized) || "Movie";
}

function trimLeadingWhitespace(value) {
  const text = String(value || "");
  if (typeof text.trimStart === "function") {
    return text.trimStart();
  }
  return text.replace(/^\s+/, "");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeSelectorValue(value = "") {
  const raw = String(value ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function formatCatalogRowTitle(catalogName, addonName, type) {
  const typeLabel = formatTypeLabel(type);
  let base = String(catalogName || "").trim();
  if (!base) return typeLabel;
  const addon = String(addonName || "").trim();
  const cleanedAddon = addon.replace(/\baddon\b/i, "").trim();
  [addon, cleanedAddon, "The Movie Database Addon", "TMDB Addon", "Addon"]
    .filter(Boolean)
    .forEach((term) => {
      const regex = new RegExp(`\\s*-?\\s*${escapeRegExp(term)}\\s*`, "ig");
      base = base.replace(regex, " ");
    });
  base = base.replace(/\s{2,}/g, " ").trim();
  if (!base) return typeLabel;
  const endsWithType = new RegExp(`\\b${escapeRegExp(typeLabel)}$`, "i").test(base);
  return endsWithType ? base : `${base} - ${typeLabel}`;
}

function formatDateLabel(item = {}) {
  const candidates = [
    item.released,
    item.releaseDate,
    item.release_date,
    item.releaseInfo,
    item.year
  ].filter(Boolean);

  for (const value of candidates) {
    const raw = String(value).trim();
    if (!raw) continue;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      return raw;
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
    const yearOnly = raw.match(/\b(19|20)\d{2}\b/);
    if (yearOnly) {
      return `01/01/${yearOnly[0]}`;
    }
  }
  return "";
}

function formatReleaseYear(item = {}) {
  const rawDate = formatDateLabel(item);
  const matchFromFormatted = rawDate.match(/\b(19|20)\d{2}\b/);
  if (matchFromFormatted) {
    return matchFromFormatted[0];
  }

  const candidates = [
    item.released,
    item.releaseDate,
    item.release_date,
    item.releaseInfo,
    item.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
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
    if (timer) clearTimeout(timer);
  }
}

function buildRowStateKey(row = {}, rowIndex = 0) {
  const parts = [
    row.addonBaseUrl,
    row.addonId,
    row.catalogId,
    row.catalogName,
    row.type,
    row.title,
    rowIndex
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.join("|") || `row:${rowIndex}`;
}

export const SearchScreen = {

  getRouteStateKey() {
    return "route:search";
  },

  clearRouteStateOnMount(params = {}) {
    const incomingQuery = String(params.query || "").trim();
    if (!incomingQuery) {
      return false;
    }
    const previousQuery = String(this.query || "").trim();
    return Boolean(previousQuery && previousQuery !== incomingQuery);
  },

  captureRouteState() {
    this.captureLiveViewState();
    const content = this.container?.querySelector(".search-content");
    const rowScrollLeftByKey = {};
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "").trim();
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        rowScrollLeftByKey[rowKey] = Number(track.scrollLeft || 0);
      }
    });
    const focused = this.container?.querySelector(".focusable.focused");
    return {
      query: String(this.query || ""),
      mode: String(this.mode || "idle"),
      rows: Array.isArray(this.rows) ? this.rows.map((row, index) => ({
        ...row,
        stateKey: row.stateKey || buildRowStateKey(row, index)
      })) : [],
      focusZone: String(this.focusZone || "content"),
      lastContentFocus: this.lastContentFocus ? { ...this.lastContentFocus } : null,
      sidebarExpanded: Boolean(this.sidebarExpanded),
      sidebarFocusIndex: Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0,
      pillIconOnly: Boolean(this.pillIconOnly),
      contentScrollTop: Number(content?.scrollTop || 0),
      rowScrollLeftByKey,
      rowFocusedIndexByKey: this.rowFocusedIndexByKey ? { ...this.rowFocusedIndexByKey } : {},
      pendingAutoFocusResults: false,
      voiceSearchSupported: Boolean(this.voiceSearchSupported),
      focusedAction: String(focused?.dataset?.action || ""),
      focusedRowKey: String(focused?.dataset?.rowKey || ""),
      focusedItemId: String(focused?.dataset?.itemId || ""),
      focusedNavZone: String(focused?.dataset?.navZone || ""),
      focusedNavRow: Number(focused?.dataset?.navRow || 0),
      focusedNavCol: Number(focused?.dataset?.navCol || 0)
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const incomingQuery = String(params.query || "").trim();
    const hasExplicitQuery = Boolean(incomingQuery);
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    this.query = hasExplicitQuery ? incomingQuery : String(snapshot?.query || "").trim();
    this.mode = hasExplicitQuery
      ? (incomingQuery.length >= 2 ? "search" : "idle")
      : String(snapshot?.mode || (this.query.length >= 2 ? "search" : "idle"));
    this.rows = Array.isArray(snapshot?.rows)
      ? snapshot.rows.map((row, index) => ({
        ...row,
        stateKey: row.stateKey || buildRowStateKey(row, index)
      }))
      : [];
    this.focusZone = String(snapshot?.focusZone || this.focusZone || "content");
    this.lastContentFocus = snapshot?.lastContentFocus ? { ...snapshot.lastContentFocus } : this.lastContentFocus || null;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && snapshot?.sidebarExpanded);
    this.sidebarFocusIndex = Number.isFinite(snapshot?.sidebarFocusIndex) ? snapshot.sidebarFocusIndex : 0;
    this.pillIconOnly = Boolean(snapshot?.pillIconOnly);
    this.contentScrollTop = Number(snapshot?.contentScrollTop || 0);
    this.rowScrollLeftByKey = snapshot?.rowScrollLeftByKey && typeof snapshot.rowScrollLeftByKey === "object"
      ? { ...snapshot.rowScrollLeftByKey }
      : {};
    this.rowFocusedIndexByKey = snapshot?.rowFocusedIndexByKey && typeof snapshot.rowFocusedIndexByKey === "object"
      ? { ...snapshot.rowFocusedIndexByKey }
      : {};
    this.pendingAutoFocusResults = false;
    this.restoredFocusedDescriptor = snapshot ? {
      action: String(snapshot.focusedAction || ""),
      rowKey: String(snapshot.focusedRowKey || ""),
      itemId: String(snapshot.focusedItemId || ""),
      navZone: String(snapshot.focusedNavZone || ""),
      navRow: Number(snapshot.focusedNavRow || 0),
      navCol: Number(snapshot.focusedNavCol || 0)
    } : null;
  },

  cancelScheduledRender() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  requestRender() {
    if (!this.container || Router.getCurrent() !== "search") {
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "search") {
        return;
      }
      this.render();
    });
  },

  captureLiveViewState() {
    const content = this.container?.querySelector(".search-content");
    if (content) {
      this.contentScrollTop = Number(content.scrollTop || 0);
    }
    const nextRowScroll = {};
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "");
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        nextRowScroll[rowKey] = Number(track.scrollLeft || 0);
      }
    });
    if (Object.keys(nextRowScroll).length) {
      this.rowScrollLeftByKey = {
        ...(this.rowScrollLeftByKey || {}),
        ...nextRowScroll
      };
    }
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("search");
    ScreenUtils.show(this.container);
    this.searchRouteEnterPending = true;
    this.activationGuardUntil = Date.now() + 220;
    this.layoutPrefs = LayoutPreferences.get();
    try {
      this.sidebarProfile = await getSidebarProfileState();
    } catch (err) {
      console.warn("debug: fail on load", err);
      this.sidebarProfile = null;
    }
    this.sidebarExpanded = false;
    this.focusZone = "content";
    this.sidebarFocusIndex = 0;
    this.rows = [];
    this.lastContentFocus = null;
    this.contentScrollTop = 0;
    this.rowScrollLeftByKey = {};
    this.rowFocusedIndexByKey = {};
    this.restoredFocusedDescriptor = null;
    this.voiceSearchSupported = typeof window !== "undefined"
      && (typeof window.SpeechRecognition === "function" || typeof window.webkitSpeechRecognition === "function");
    this.voiceSearchActive = false;
    this.voiceRecognition = this.voiceRecognition || null;
    this.searchToastTimer = null;
    this.hydrateFromRouteState(navigationContext?.restoredState || null, params);
    if (!navigationContext?.isBackNavigation) {
      this.focusZone = "content";
      this.sidebarExpanded = false;
      this.sidebarFocusIndex = 0;
      this.pillIconOnly = false;
    }
    this.loadToken = (this.loadToken || 0) + 1;
    const hasExplicitQuery = Boolean(String(params.query || "").trim());
    const restoredQuery = String(navigationContext?.restoredState?.query || "").trim();
    const shouldUseRestoredState = Boolean(
      navigationContext?.restoredState
      && (!hasExplicitQuery || restoredQuery === String(params.query || "").trim())
    );
    if (shouldUseRestoredState) {
      this.render();
      return;
    }
    this.renderLoading();
    try {
      await this.reloadRows();
    } catch (err) {
      console.error("searchScreen: Failed to load rows", err);
      this.rows = [];
      this.render(); 
    }
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="home-shell search-screen-shell${this.searchRouteEnterPending ? " search-route-enter" : ""}">
        ${renderRootSidebar({
          selectedRoute: "search",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main search-content search-loading-shell">
          <div class="search-loading">${escapeHtml(t("discover_loading", {}, "Loading..."))}</div>
        </main>
      </div>
    `;
    this.searchRouteEnterPending = false;
  },

  async reloadRows() {
    const token = this.loadToken;
    if (this.mode === "search" && this.query.length >= 2) {
      this.rows = await this.searchRows(this.query);
    } else if (this.mode === "discover") {
      this.rows = await this.loadDiscoverRows();
    } else {
      this.rows = [];
    }
    if (token !== this.loadToken) return;
    this.requestRender();
  },

  async loadDiscoverRows() {
    const addons = await addonRepository.getInstalledAddons();
    const sections = [];
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
        if (requiresSearch) return;
        if (catalog.apiType !== "movie" && catalog.apiType !== "series" && catalog.apiType !== "tv") return;
        sections.push({
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName,
          catalogId: catalog.id,
          catalogName: catalog.name,
          type: catalog.apiType
        });
      });
    });

    const picked = sections.slice(0, 8);
    const resolved = await Promise.all(
      picked.map(async (section) => {
        try {
          const result = await withTimeout(
            catalogRepository.getCatalog({
              addonBaseUrl: section.addonBaseUrl,
              addonId: section.addonId,
              addonName: section.addonName,
              catalogId: section.catalogId,
              catalogName: section.catalogName,
              type: section.type,
              skip: 0,
              supportsSkip: true,
            }),
            3500,
            { status: "error", message: "timeout" },
          );
          return { ...section, result };
        } catch (err) {
          console.warn(
            `fail on load catalog ${section.catalogName}:`,
            err,
          );
          return {
            ...section,
            result: { status: "error", message: "fetch_failed" },
          };
        }
      }),
    );

    return resolved
      .filter((entry) => entry.result?.status === "success" && entry.result?.data?.items?.length)
      .map((entry) => ({
        title: formatCatalogRowTitle(entry.catalogName, entry.addonName, entry.type),
        subtitle: `from ${entry.addonName || "Addon"}`,
        type: entry.type,
        addonBaseUrl: entry.addonBaseUrl,
        addonId: entry.addonId,
        addonName: entry.addonName,
        catalogId: entry.catalogId,
        catalogName: entry.catalogName,
        items: (entry.result?.data?.items || []).slice(0, 14)
      }));
  },

  async searchRows(query) {
    const addons = await addonRepository.getInstalledAddons();
    const searchableCatalogs = [];
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
        if (!requiresSearch) return;
        if (catalog.apiType !== "movie" && catalog.apiType !== "series" && catalog.apiType !== "tv") return;
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

    const responses = await Promise.all(
      searchableCatalogs.slice(0, 14).map(async (catalog) => {
        try {
          const result = await withTimeout(
            catalogRepository.getCatalog({
              addonBaseUrl: catalog.addonBaseUrl,
              addonId: catalog.addonId,
              addonName: catalog.addonName,
              catalogId: catalog.catalogId,
              catalogName: catalog.catalogName,
              type: catalog.type,
              skip: 0,
              extraArgs: { search: query },
              supportsSkip: true,
            }),
            3500,
            { status: "error", message: "timeout" },
          );
          return { catalog, result };
        } catch (err) {
          console.warn(
            `fail on search catalog ${catalog.catalogName}:`,
            err,
          );
          return {
            catalog,
            result: { status: "error", message: "fetch_failed" },
          };
        }
      }),
    );

    return responses
      .filter(({ result }) => result?.status === "success" && result?.data?.items?.length)
      .map(({ catalog, result }) => ({
        title: formatCatalogRowTitle(catalog.catalogName, catalog.addonName, catalog.type),
        subtitle: `from ${catalog.addonName || "Addon"}`,
        type: catalog.type,
        addonBaseUrl: catalog.addonBaseUrl,
        addonId: catalog.addonId,
        addonName: catalog.addonName,
        catalogId: catalog.catalogId,
        catalogName: catalog.catalogName,
        items: (result?.data?.items || []).slice(0, 18)
      }));
  },

  renderRows() {
    if (!Array.isArray(this.rows) || !this.rows.length) {
      if (this.mode === "search") {
        return `
          <div class="search-empty-state search-empty-state-results">
            <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
            <h2>${escapeHtml(t("search_no_results_title", {}, "No Results"))}</h2>
            <p>${escapeHtml(t("search_no_results_subtitle", {}, "Try searching with different keywords"))}</p>
          </div>
        `;
      }
        return `
        <div class="search-empty-state">
          <span class="search-empty-icon material-icons" aria-hidden="true">search</span>
          <h2>${escapeHtml(t("search_start_title", {}, "Start Searching"))}</h2>
          <p>${escapeHtml(this.layoutPrefs?.searchDiscoverEnabled
            ? t("search_start_subtitle", {}, "Enter at least 2 characters")
            : t("search_start_subtitle_no_discover", {}, "Discover is disabled. Enter at least 2 characters"))}</p>
        </div>
      `;
    }

    return this.rows.map((row, rowIndex) => {
      const rowKey = row.stateKey || buildRowStateKey(row, rowIndex);
      return `
      <section class="search-results-row" data-row-key="${escapeHtml(rowKey)}">
        <h3 class="search-results-title">${row.title}</h3>
        <div class="search-results-subtitle">${row.subtitle}</div>
        <div class="search-results-track">
          ${(row.items || []).map((item) => `
            <article class="search-result-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.id || ""}"
                     data-item-type="${item.type || row.type || "movie"}"
                     data-item-title="${item.name || "Untitled"}"
                     data-row-key="${escapeHtml(rowKey)}">
              <div class="search-result-poster-wrap">
                ${item.poster ? `<img class="search-result-poster" src="${item.poster}" alt="${item.name || "content"}" loading="lazy" decoding="async" />` : `<div class="search-result-poster placeholder"></div>`}
              </div>
              <div class="search-result-name">${item.name || "Untitled"}</div>
              <div class="search-result-date">${formatReleaseYear(item)}</div>
            </article>
          `).join("")}
          ${(row.items || []).length >= 15 ? `
            <article class="search-result-card search-seeall-card focusable"
                     data-action="openCatalogSeeAll"
                     data-addon-base-url="${row.addonBaseUrl || ""}"
                     data-addon-id="${row.addonId || ""}"
                     data-addon-name="${row.addonName || ""}"
                     data-catalog-id="${row.catalogId || ""}"
                     data-catalog-name="${row.catalogName || ""}"
                     data-catalog-type="${row.type || "movie"}"
                     data-row-index="${rowIndex}"
                     data-row-key="${escapeHtml(rowKey)}">
              <div class="search-seeall-inner">
                <div class="search-seeall-arrow" aria-hidden="true">&#8594;</div>
                <div class="search-seeall-label">See All</div>
              </div>
            </article>
          ` : ""}
        </div>
      </section>
    `;
    }).join("");
  },

  render() {
    this.cancelScheduledRender();
    const queryText = this.query || "";
    this.container.innerHTML = `
      <div class="home-shell search-screen-shell${this.searchRouteEnterPending ? " search-route-enter" : ""}">
        ${renderRootSidebar({
          selectedRoute: "search",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main search-content">
          <section class="search-header${this.layoutPrefs?.searchDiscoverEnabled ? "" : " no-discover"}">
            ${this.layoutPrefs?.searchDiscoverEnabled ? `
              <button class="search-discover-btn focusable" data-action="openDiscover">
                <span class="search-action-icon material-icons" aria-hidden="true">explore</span>
              </button>
            ` : ""}
            <button
              class="search-voice-btn focusable${this.voiceSearchActive ? " listening" : ""}"
              data-action="openVoice"
              aria-label="Voice search"
            >
              <span class="search-action-icon material-icons" aria-hidden="true">mic</span>
            </button>
            <input
              id="searchInput"
              class="search-input-field focusable"
              type="text"
              data-action="searchInput"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="${escapeHtml(t("search_placeholder", {}, "Search movies & series"))}"
              value="${escapeHtml(queryText)}"
            />
          </section>
          ${this.renderRows()}
        </main>
      </div>
    `;
    this.searchRouteEnterPending = false;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    bindRootSidebarEvents(this.container, {
      currentRoute: "search",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
    this.bindSearchInputEvents();
    this.bindActionEvents();
    const input = this.container.querySelector("#searchInput");
    input?.blur?.();
    this.restoreScrollState();
    const shouldFocusResults = Boolean(this.pendingAutoFocusResults && this.navModel?.rows?.[0]?.[0]);
    if (this.focusZone === "sidebar") {
      this.focusSidebarNode();
    } else {
      this.restoreContentFocus(shouldFocusResults);
    }
    this.pendingAutoFocusResults = false;
  },

  buildNavigationModel() {
    const header = [
      this.container?.querySelector(".search-discover-btn.focusable"),
      this.container?.querySelector(".search-voice-btn.focusable"),
      this.container?.querySelector("#searchInput.focusable")
    ].filter(Boolean);
    const rows = Array.from(this.container?.querySelectorAll(".search-results-row .search-results-track") || [])
      .map((track) => Array.from(track.querySelectorAll(".search-result-card.focusable")))
      .filter((row) => row.length > 0);

    header.forEach((node, index) => {
      node.dataset.navZone = "header";
      node.dataset.navCol = String(index);
    });

    rows.forEach((rowNodes, rowIndex) => {
      const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navZone = "results";
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
        if (rowKey) {
          node.dataset.rowKey = rowKey;
        }
      });
    });

    this.navModel = { header, rows };
    if (!this.lastContentFocus) {
      const fallback = this.getDefaultHeaderFocusTarget() || rows[0]?.[0] || null;
      if (fallback) {
        this.rememberContentFocus(fallback);
      }
    }
  },

  getDefaultHeaderFocusTarget() {
    return this.container?.querySelector(".search-discover-btn.focusable")
      || this.container?.querySelector("#searchInput.focusable")
      || this.container?.querySelector(".search-voice-btn.focusable")
      || null;
  },

  restoreScrollState() {
    const content = this.container?.querySelector(".search-content");
    if (content) {
      content.scrollTop = Number(this.contentScrollTop || 0);
    }
    Array.from(this.container?.querySelectorAll(".search-results-row") || []).forEach((rowNode) => {
      const rowKey = String(rowNode.dataset.rowKey || "");
      const track = rowNode.querySelector(".search-results-track");
      if (rowKey && track) {
        track.scrollLeft = Number(this.rowScrollLeftByKey?.[rowKey] || 0);
      }
    });
  },

  rememberContentFocus(node) {
    if (!node) {
      return;
    }
    const rowKey = String(node.dataset.rowKey || "");
    if (String(node.dataset.navZone || "") === "results" && rowKey) {
      this.rowFocusedIndexByKey = {
        ...(this.rowFocusedIndexByKey || {}),
        [rowKey]: Math.max(0, Number(node.dataset.navCol || 0))
      };
    }
    this.lastContentFocus = {
      zone: String(node.dataset.navZone || ""),
      row: Number(node.dataset.navRow || 0),
      col: Number(node.dataset.navCol || 0),
      action: String(node.dataset.action || ""),
      rowKey
    };
  },

  resolvePreferredResultsNode(rowNodes = [], fallbackCol = 0) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowKey = String(rowNodes[0]?.dataset?.rowKey || "");
    const storedIndex = rowKey ? Number(this.rowFocusedIndexByKey?.[rowKey]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusSidebarNode(preferredNode = null) {
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const target = preferredNode
      || getRootSidebarSelectedNode(this.container, this.layoutPrefs)
      || nodes[0]
      || null;
    if (!target) {
      return false;
    }
    this.sidebarFocusIndex = Math.max(0, nodes.indexOf(target));
    this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
    return true;
  },

  async openSidebar() {
    this.captureLiveViewState();
    const selected = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    return this.focusSidebarNode(selected || nodes[0] || null);
  },

  async closeSidebarToContent() {
    this.captureLiveViewState();
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
    return this.restoreContentFocus(false) || true;
  },

  restoreContentFocus(preferResults = false) {
    let target = null;
    if (preferResults) {
      target = this.container?.querySelector(".search-results-row .search-result-card.focusable") || null;
    }
    if (!target && !preferResults && this.mode !== "search") {
      target = this.getDefaultHeaderFocusTarget();
    }
    if (!target && this.restoredFocusedDescriptor?.rowKey && this.restoredFocusedDescriptor?.itemId) {
      target = this.container?.querySelector(
        `.search-result-card.focusable[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"][data-item-id="${escapeSelectorValue(this.restoredFocusedDescriptor.itemId)}"]`
      ) || null;
    }
    if (!target && this.restoredFocusedDescriptor?.rowKey && this.restoredFocusedDescriptor?.action === "openCatalogSeeAll") {
      target = this.container?.querySelector(
        `.search-result-card.focusable.search-seeall-card[data-row-key="${escapeSelectorValue(this.restoredFocusedDescriptor.rowKey)}"]`
      ) || null;
    }
    if (!target && this.lastContentFocus) {
      if (this.lastContentFocus.zone === "results") {
        if (this.lastContentFocus.rowKey) {
          const rowNodes = Array.from(this.container?.querySelectorAll(
            `.search-result-card.focusable[data-row-key="${escapeSelectorValue(this.lastContentFocus.rowKey)}"]`
          ) || []);
          target = this.resolvePreferredResultsNode(rowNodes, this.lastContentFocus.col);
        }
        if (!target) {
          target = this.container?.querySelector(
            `.search-result-card.focusable[data-nav-row="${this.lastContentFocus.row}"][data-nav-col="${this.lastContentFocus.col}"]`
          ) || null;
        }
      } else if (this.lastContentFocus.zone === "header") {
        target = this.container?.querySelector(
          `.focusable[data-nav-zone="header"][data-nav-col="${this.lastContentFocus.col}"]`
        ) || null;
      }
    }
    if (!target) {
      target = this.getDefaultHeaderFocusTarget()
        || this.container?.querySelector(".search-result-card.focusable")
        || null;
    }
    if (!target) {
      return false;
    }
    this.focusNode(this.container?.querySelector(".focusable.focused") || null, target);
    this.restoredFocusedDescriptor = null;
    return true;
  },

  focusNode(current, target) {
    if (!target) return false;
    if (current && current !== target) {
      current.classList.remove("focused");
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    const zone = String(target.dataset.navZone || "");
    const currentZone = String(current?.dataset?.navZone || "");
    const sidebarFocused = isRootSidebarNode(target);
    this.focusZone = sidebarFocused ? "sidebar" : "content";
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, sidebarFocused);
    }
    if (!sidebarFocused) {
      this.rememberContentFocus(target);
    }
    if (zone === "header" && currentZone === "results") {
      this.ensureHeaderVisible();
    }
    if (zone === "results") {
      this.ensureResultsRowVisible(target);
      this.ensureResultCardVisible(current, target);
    }
    this.captureLiveViewState();
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

  ensureResultsRowVisible(target) {
    const content = this.container?.querySelector(".search-content");
    const row = target?.closest?.(".search-results-row");
    if (!content || !row) {
      return;
    }

    const contentRect = content.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const topInset = 18;
    const bottomInset = 28;
    const rowTop = rowRect.top - contentRect.top + content.scrollTop;
    const rowBottom = rowRect.bottom - contentRect.top + content.scrollTop;
    const visibleTop = contentRect.top + topInset;
    const visibleBottom = contentRect.bottom - bottomInset;

    if (rowRect.top < visibleTop) {
      this.animateScroll(content, "y", rowTop - topInset, 150);
      return;
    }

    if (rowRect.bottom > visibleBottom) {
      this.animateScroll(content, "y", rowBottom - content.clientHeight + bottomInset, 150);
    }
  },

  ensureResultCardVisible(current, target) {
    const track = target?.closest?.(".search-results-track");
    if (!track || !target) {
      return;
    }

    const styles = globalThis.getComputedStyle ? globalThis.getComputedStyle(track) : null;
    const leftPad = Math.max(0, Number.parseFloat(styles?.paddingLeft || "0") || 0);
    const trackRect = track.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetLeft = (targetRect.left - trackRect.left) + Number(track.scrollLeft || 0);
    const maxScrollLeft = Math.max(0, Number(track.scrollWidth || 0) - Number(track.clientWidth || 0));
    this.animateScroll(track, "x", Math.max(0, Math.min(maxScrollLeft, targetLeft - leftPad)), 140);
  },

  ensureHeaderVisible() {
    const content = this.container?.querySelector(".search-content");
    const header = this.container?.querySelector(".search-header");
    if (!content || !header) return;

    const contentRect = content.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const topInset = 22;
    const visibleTop = contentRect.top + topInset;

    if (headerRect.top < visibleTop) {
      this.animateScroll(content, "y", content.scrollTop + (headerRect.top - visibleTop), 150);
    }
  },

  handleSearchDpad(event) {
    const keyCode = Number(event?.keyCode || 0);
    const direction = keyCode === 38 ? "up"
      : keyCode === 40 ? "down"
        : keyCode === 37 ? "left"
          : keyCode === 39 ? "right"
            : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel || {};
    const current = this.container?.querySelector(".focusable.focused") || null;
    if (!current) {
      return false;
    }
    const zone = String(current.dataset.navZone || "");

    event?.preventDefault?.();

    if (zone === "header") {
      const col = Number(current.dataset.navCol || 0);
      if (direction === "left") {
        if (col > 0) return this.focusNode(current, nav.header?.[col - 1] || current) || true;
        return "sidebar";
      }
      if (direction === "right") {
        if (col < (nav.header?.length || 0) - 1) {
          return this.focusNode(current, nav.header?.[col + 1] || current) || true;
        }
        return true;
      }
      if (direction === "down") {
        const firstRow = nav.rows?.[0] || [];
        const target = this.resolvePreferredResultsNode(firstRow, col);
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        return true;
      }
      return true;
    }

    if (zone === "results") {
      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows?.[row] || [];

      if (direction === "left") {
        if (col > 0) {
          return this.focusNode(current, rowNodes[col - 1] || current) || true;
        }
        return "sidebar";
      }
      if (direction === "right") {
        const target = rowNodes[col + 1] || null;
        return this.focusNode(current, target || current) || true;
      }
      if (direction === "down") {
        const nextRowNodes = nav.rows?.[row + 1] || null;
        if (!nextRowNodes) {
          return true;
        }
        const target = this.resolvePreferredResultsNode(nextRowNodes, col);
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        const prevRowNodes = nav.rows?.[row - 1] || null;
        if (prevRowNodes) {
          const target = this.resolvePreferredResultsNode(prevRowNodes, col);
          return this.focusNode(current, target) || true;
        }
        const target = nav.header?.[Math.min(col, (nav.header?.length || 1) - 1)] || nav.header?.[0] || null;
        return this.focusNode(current, target) || true;
      }
      return true;
    }

    return false;
  },

  bindSearchInputEvents() {
    const input = this.container?.querySelector("#searchInput");
    if (!input || input.__boundSearchListeners) return;
    input.__boundSearchListeners = true;

    input.addEventListener("input", (event) => {
      this.query = trimLeadingWhitespace(event.target?.value || "");
      if (this.query.length === 0 && this.mode !== "idle") {
        this.mode = "idle";
        this.loadToken = (this.loadToken || 0) + 1;
        this.captureLiveViewState();
        this.renderLoading();
        this.reloadRows();
      }
    });

    input.addEventListener("keydown", async (event) => {
      if (event.keyCode !== 13) return;
      event.preventDefault();
      this.query = String(input.value || "").trim();
      this.mode = this.query.length >= 2 ? "search" : "idle";
      this.pendingAutoFocusResults = this.mode === "search";
      this.loadToken = (this.loadToken || 0) + 1;
      this.captureLiveViewState();
      this.renderLoading();
      await this.reloadRows();
    });
  },

  isSearchInputEditingActive() {
    const input = this.container?.querySelector("#searchInput");
    return !!input && document.activeElement === input;
  },

  bindActionEvents() {
    this.container?.querySelectorAll("[data-action]").forEach((node) => {
      if (node.__boundActionListeners) return;
      node.__boundActionListeners = true;
      if (node.dataset.action === "searchInput") return;
      node.addEventListener("click", () => {
        this.activateActionNode(node);
      });
    });
  },

  activateActionNode(node) {
    if (!node) return;
    if (Date.now() < Number(this.activationGuardUntil || 0)) return;
    const action = String(node.dataset.action || "");
    if (!action) return;

    if (action === "openDetail") this.openDetailFromNode(node);
    if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(node);
    if (action === "openDiscover" && this.layoutPrefs?.searchDiscoverEnabled) Router.navigate("discover");
    if (action === "openVoice") this.handleVoiceSearch();
  },

  ensureVoiceRecognition() {
    if (this.voiceRecognition || !this.voiceSearchSupported) {
      return this.voiceRecognition;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognition !== "function") {
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = async (event) => {
      const recognized = String(event.results?.[0]?.[0]?.transcript || "").trim();
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      if (!recognized) {
        this.showSearchToast("No speech detected. Try again.");
        return;
      }
      this.query = recognized;
      this.mode = this.query.length >= 2 ? "search" : "idle";
      this.pendingAutoFocusResults = this.mode === "search";
      this.loadToken = (this.loadToken || 0) + 1;
      this.renderLoading();
      await this.reloadRows();
    };

    recognition.onerror = (event) => {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      const errorCode = String(event?.error || "");
      if (errorCode === "aborted") return;
      if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
        this.showSearchToast("Microphone permission is required for voice search.");
        return;
      }
      if (errorCode === "no-speech") {
        this.showSearchToast("No speech detected. Try again.");
        return;
      }
      this.showSearchToast("Voice recognition failed. Try again.");
    };

    recognition.onend = () => {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
    };

    this.voiceRecognition = recognition;
    return recognition;
  },

  handleVoiceSearch() {
    const recognition = this.ensureVoiceRecognition();
    if (!recognition) {
      this.showSearchToast("Voice search is unavailable on this device.");
      return;
    }

    try {
      if (this.voiceSearchActive) {
        recognition.stop();
        return;
      }
      this.voiceSearchActive = true;
      this.syncVoiceButtonState();
      recognition.start();
    } catch (_) {
      this.voiceSearchActive = false;
      this.syncVoiceButtonState();
      this.showSearchToast("Voice search is unavailable on this device.");
    }
  },

  syncVoiceButtonState() {
    const button = this.container?.querySelector(".search-voice-btn");
    if (!button) return;
    button.classList.toggle("listening", Boolean(this.voiceSearchActive));
  },

  showSearchToast(message) {
    if (!this.container) return;
    const shell = this.container.querySelector(".search-screen-shell");
    if (!shell) return;
    let toast = shell.querySelector(".search-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "search-toast";
      shell.appendChild(toast);
    }
    toast.textContent = String(message || "").trim();
    toast.classList.add("visible");

    if (this.searchToastTimer) {
      clearTimeout(this.searchToastTimer);
    }
    this.searchToastTimer = setTimeout(() => {
      toast?.classList.remove("visible");
    }, 2600);
  },

  openDetailFromNode(node) {
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  openCatalogSeeAllFromNode(node) {
    const rowIndex = Math.max(0, Number(node?.dataset?.rowIndex || 0));
    const sourceRow = this.rows?.[rowIndex] || null;
    Router.navigate("catalogSeeAll", {
      addonBaseUrl: node.dataset.addonBaseUrl || "",
      addonId: node.dataset.addonId || "",
      addonName: node.dataset.addonName || "",
      catalogId: node.dataset.catalogId || "",
      catalogName: node.dataset.catalogName || "",
      type: node.dataset.catalogType || "movie",
      initialItems: Array.isArray(sourceRow?.items) ? sourceRow.items : []
    });
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event.preventDefault?.();
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (this.isSearchInputEditingActive()) {
      const navigationKeys = [35, 36, 37, 39];
      if (navigationKeys.indexOf(code) !== -1) {
        event.stopPropagation?.();
        return;
      }
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

    if (this.focusZone === "sidebar") {
      const current = this.container?.querySelector(".focusable.focused") || null;
      const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      if (code === 38 || code === 40 || code === 39) {
        event.preventDefault?.();
      }
      if (code === 38 || code === 40) {
        const focusedIndex = Math.max(0, nodes.indexOf(current));
        const nextIndex = clamp(focusedIndex + (code === 38 ? -1 : 1), 0, Math.max(0, nodes.length - 1));
        const nextNode = nodes[nextIndex] || current;
        if (nextNode) {
          this.sidebarFocusIndex = nextIndex;
          this.focusNode(current, nextNode);
        }
        return;
      }
      if (code === 39) {
        await this.closeSidebarToContent();
        return;
      }
      if (code === 13 && current && isRootSidebarNode(current)) {
        event.preventDefault?.();
        activateLegacySidebarAction(String(current.dataset.action || ""), "search");
        if (isSelectedSidebarAction(String(current.dataset.action || ""), "search")) {
          await this.closeSidebarToContent();
        }
        return;
      }
    }

    const dpadResult = this.handleSearchDpad(event);
    if (dpadResult === "sidebar") {
      await this.openSidebar();
      return;
    }
    if (dpadResult) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (code !== 13) return;
    const current = this.container.querySelector(".focusable.focused");
    if (!current) return;

    const action = String(current.dataset.action || "");
    if (action === "openDiscover" || action === "openVoice" || action === "openDetail" || action === "openCatalogSeeAll") {
      this.activateActionNode(current);
    }
    if (action === "searchInput") {
      const input = this.container?.querySelector("#searchInput");
      if (input) {
        input.focus();
      }
    }
  },

  cleanup() {
    this.cancelScheduledRender();
    if (this.searchToastTimer) {
      clearTimeout(this.searchToastTimer);
      this.searchToastTimer = null;
    }
    if (this.voiceRecognition) {
      try {
        this.voiceRecognition.onresult = null;
        this.voiceRecognition.onerror = null;
        this.voiceRecognition.onend = null;
        this.voiceRecognition.stop();
      } catch (_) {
        // Ignore stop failures from inactive recognizers.
      }
      this.voiceRecognition = null;
    }
    this.voiceSearchActive = false;
    ScreenUtils.hide(this.container);
  }
};
