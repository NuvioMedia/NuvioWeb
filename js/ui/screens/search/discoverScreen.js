import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import { renderContentFilterPicker } from "../../components/filterPicker.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../components/posterOptionsMenu.js";
import {
  focusWithoutAutoScroll,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

const POSTER_HOLD_DELAY_MS = 650;
const PICKER_MENU_EXIT_MS = 160;

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatAddonTypeLabel(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!type) return "Movie";
  if (type === "tv") return "TV";
  if (type === "series") return "Series";
  if (type === "movie") return "Movie";
  return toTitleCase(type);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
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

function extractReleaseYear(item = {}) {
  const candidates = [
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.releaseInfo,
    item?.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function actionForPickerKind(kind) {
  if (kind === "type") return "discoverFilterType";
  if (kind === "catalog") return "discoverFilterCatalog";
  if (kind === "genre") return "discoverFilterGenre";
  return "discoverFilterType";
}

function isKey(event, code, aliases = []) {
  const keyCode = Number(event?.keyCode || 0);
  if (keyCode === code) return true;
  const key = String(event?.key || "");
  return aliases.includes(key);
}

function isUpKey(event) {
  return isKey(event, 38, ["ArrowUp", "Up"]);
}

function isDownKey(event) {
  return isKey(event, 40, ["ArrowDown", "Down"]);
}

function isLeftKey(event) {
  return isKey(event, 37, ["ArrowLeft", "Left"]);
}

function isRightKey(event) {
  return isKey(event, 39, ["ArrowRight", "Right"]);
}

function isEnterKey(event) {
  return isKey(event, 13, ["Enter"]);
}

function setContainerScrollTop(container, top, behavior = "auto") {
  if (!(container instanceof HTMLElement)) {
    return 0;
  }
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const resolvedTop = Math.max(0, Math.min(maxScrollTop, Number(top || 0)));
  if (behavior === "smooth") {
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: resolvedTop, behavior: "smooth" });
    } else {
      container.scrollTop = resolvedTop;
    }
    return resolvedTop;
  }

  const previousBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  container.scrollTop = resolvedTop;
  void container.offsetHeight;
  container.style.scrollBehavior = previousBehavior;
  return resolvedTop;
}

function scrollNodeIntoContainerView(node, container, { center = false, padding = 18, behavior = "smooth" } = {}) {
  if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return null;
  }
  const itemTop = node.offsetTop;
  const itemBottom = itemTop + node.offsetHeight;
  const currentTop = container.scrollTop;
  const viewTop = currentTop + padding;
  const viewBottom = currentTop + container.clientHeight - padding;
  let nextScrollTop = currentTop;

  if (center) {
    nextScrollTop = itemTop - ((container.clientHeight - node.offsetHeight) / 2);
  } else if (itemTop < viewTop) {
    nextScrollTop = itemTop - padding;
  } else if (itemBottom > viewBottom) {
    nextScrollTop = itemBottom - container.clientHeight + padding;
  }

  const resolvedTop = Math.max(0, nextScrollTop);
  if (Math.abs(resolvedTop - currentTop) <= 1) {
    return resolvedTop;
  }
  if (behavior === "smooth") {
    setContainerScrollTop(container, resolvedTop, "smooth");
  } else {
    setContainerScrollTop(container, resolvedTop, "auto");
  }
  return resolvedTop;
}

export const DiscoverScreen = {

  clearClosingPicker() {
    if (this.closingPickerTimer) {
      clearTimeout(this.closingPickerTimer);
      this.closingPickerTimer = null;
    }
    this.closingPicker = null;
  },

  startClosingPicker(picker) {
    const pickerKey = String(picker || "");
    if (!pickerKey) {
      this.clearClosingPicker();
      return;
    }
    if (this.closingPicker === pickerKey && this.closingPickerTimer) {
      clearTimeout(this.closingPickerTimer);
    }
    this.closingPicker = pickerKey;
    this.closingPickerTimer = setTimeout(() => {
      this.closingPickerTimer = null;
      if (this.closingPicker === pickerKey) {
        this.closingPicker = null;
        this.requestRender();
      }
    }, PICKER_MENU_EXIT_MS);
  },

  cancelScheduledRender() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  requestRender() {
    if (!this.container || Router.getCurrent() !== "discover") {
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "discover") {
        return;
      }
      this.render();
    });
  },

  getRouteStateKey() {
    return "discover";
  },

  captureRouteState() {
    this.captureViewState();
    return {
      selectedType: String(this.selectedType || "movie"),
      catalogs: Array.isArray(this.catalogs) ? [...this.catalogs] : [],
      selectedCatalogKey: String(this.selectedCatalogKey || ""),
      selectedGenre: String(this.selectedGenre || "Default"),
      items: Array.isArray(this.items) ? [...this.items] : [],
      nextSkip: Number(this.nextSkip || 0),
      hasMore: Boolean(this.hasMore),
      lastFocusedAction: String(this.lastFocusedAction || "discoverFilterType"),
      lastFocusedKey: this.lastFocusedKey ? String(this.lastFocusedKey) : null,
      lastFocusedDiscoverItemId: this.lastFocusedDiscoverItemId ? String(this.lastFocusedDiscoverItemId) : "",
      savedScrollTop: Number(this.savedScrollTop || 0),
      rowFocusedIndexByRow: this.rowFocusedIndexByRow && typeof this.rowFocusedIndexByRow === "object"
        ? { ...this.rowFocusedIndexByRow }
        : {},
      focusZone: String(this.focusZone || "content")
    };
  },

  hydrateFromRouteState(restoredState = null) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    if (!snapshot) {
      return false;
    }
    this.selectedType = String(snapshot.selectedType || "movie");
    this.catalogs = Array.isArray(snapshot.catalogs) ? [...snapshot.catalogs] : [];
    this.selectedCatalogKey = String(snapshot.selectedCatalogKey || "");
    this.selectedGenre = String(snapshot.selectedGenre || "Default");
    this.items = Array.isArray(snapshot.items) ? [...snapshot.items] : [];
    this.nextSkip = Number(snapshot.nextSkip || 0);
    this.hasMore = Boolean(snapshot.hasMore);
    this.lastFocusedAction = String(snapshot.lastFocusedAction || "discoverFilterType");
    this.lastFocusedKey = snapshot.lastFocusedKey ? String(snapshot.lastFocusedKey) : null;
    this.lastFocusedDiscoverItemId = String(snapshot.lastFocusedDiscoverItemId || "");
    this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
    this.rowFocusedIndexByRow = snapshot.rowFocusedIndexByRow && typeof snapshot.rowFocusedIndexByRow === "object"
      ? { ...snapshot.rowFocusedIndexByRow }
      : {};
    this.focusZone = String(snapshot.focusZone || "content");
    this.loading = false;
    this.updateCatalogOptions();
    this.pendingRestoreFocus = true;
    this.preserveViewportOnNextRender = false;
    return true;
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("discover");
    ScreenUtils.show(this.container);
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = false;
    this.focusZone = "content";
    this.discoverRouteEnterPending = true;
    this.suppressInitialLoadingRenders = true;
    this.loadToken = (this.loadToken || 0) + 1;

    this.typeOptions = [];
    this.selectedType = "movie";
    this.catalogs = [];
    this.catalogOptions = [];
    this.selectedCatalogKey = "";
    this.genreOptions = ["Default"];
    this.selectedGenre = "Default";
    this.items = [];
    this.loading = true;

    this.openPicker = null;
    this.closingPicker = null;
    this.closingPickerTimer = null;
    this.lastRenderedOpenPicker = null;
    this.posterOptionsMenu = null;
    this.posterOptionsController = null;
    this.pendingPosterOptionsFocusKey = "";
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;
    this.pickerOptionIndex = 0;
    this.lastFocusedAction = "discoverFilterType";
    this.lastFocusedKey = null;
    this.savedScrollTop = 0;
    this.rowFocusedIndexByRow = {};
    this.pendingRestoreFocus = false;
    this.preserveViewportOnNextRender = false;
    this.nextSkip = 0;
    this.hasMore = true;

    if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null)) {
      this.render();
      return;
    }

    try {
      await this.loadCatalogsAndContent();
    } catch (err) {
      console.error("discoverScreen: Failed to load content", err);
      this.loading = false;
      this.items = [];
      this.suppressInitialLoadingRenders = false;
      this.requestRender();
    } finally {
      this.suppressInitialLoadingRenders = false;
    }
  },

  async loadCatalogsAndContent() {
    const token = this.loadToken;
    const addons = await addonRepository.getInstalledAddons();
    if (token !== this.loadToken) return;

    this.catalogs = [];
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        // Only skip catalogs that REQUIRE a search query (truly search-only).
        // Catalogs that merely support optional search are still browsable and
        // belong in Discover (e.g. some addons declare an optional search extra).
        const isSearchOnly = (catalog.extra || []).some((extra) => extra?.name === "search" && Boolean(extra?.isRequired));
        if (isSearchOnly) return;
        const type = String(catalog.apiType || "").trim();
        if (!type) return;
        this.catalogs.push({
          key: `${addon.baseUrl}::${type}::${catalog.id}`,
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName || addon.name,
          catalogId: catalog.id,
          catalogName: catalog.name || catalog.id,
          type,
          extra: Array.isArray(catalog.extra) ? catalog.extra : []
        });
      });
    });

    this.updateCatalogOptions();
    await this.reloadItems();
  },

  updateCatalogOptions() {
    const dynamicTypes = [...new Set(this.catalogs.map((entry) => entry.type).filter(Boolean))];
    this.typeOptions = dynamicTypes.length ? dynamicTypes : ["movie", "series"];

    if (!this.typeOptions.includes(this.selectedType)) {
      this.selectedType = this.typeOptions[0] || "movie";
    }

    const forType = this.catalogs.filter((entry) => entry.type === this.selectedType);
    this.catalogOptions = forType;
    if (!forType.some((entry) => entry.key === this.selectedCatalogKey)) {
      this.selectedCatalogKey = forType[0]?.key || "";
    }
    this.updateGenreOptions();
  },

  updateGenreOptions() {
    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    const genreExtra = (selectedCatalog?.extra || []).find((extra) => extra?.name === "genre");
    const genres = Array.isArray(genreExtra?.options) ? genreExtra.options.filter(Boolean) : [];
    this.genreOptions = ["Default", ...genres];
    if (!this.genreOptions.includes(this.selectedGenre)) {
      this.selectedGenre = "Default";
    }
  },

  getSelectedCatalog() {
    return this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
  },

  getDiscoverContextLabel(selectedCatalog = null) {
    return selectedCatalog
      ? `${selectedCatalog.addonName || "Addon"} • ${formatAddonTypeLabel(selectedCatalog.type)}`
      : "Choose a catalog to start browsing";
  },

  renderDiscoverCards(selectedCatalog = null) {
    return this.items.length
      ? this.items.map((item, index) => `
              <article class="discover-card seeall-card focusable"
                        data-action="openDetail"
                        data-item-id="${item.id || ""}"
                        data-item-type="${item.type || selectedCatalog?.type || "movie"}"
                        data-item-title="${item.name || "Untitled"}"
                        data-poster-src="${escapeHtml(item.poster || "")}"
                        data-backdrop-src="${escapeHtml(item.background || item.backdrop || "")}"
                        data-focus-key="item:${item.id || index}"
                        data-item-index="${index}">
                 <div class="seeall-card-poster-wrap">
                   ${item.poster
      ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" loading="lazy" decoding="async" />`
      : `<div class="seeall-card-poster placeholder"></div>`}
                 </div>
                 ${this.layoutPrefs?.posterLabelsEnabled !== false ? `
                   <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                   <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
                 ` : ""}
               </article>
             `).join("")
      : `<div class="seeall-empty">${escapeHtml(t("catalog_see_all_empty_title", {}, "No items available"))}</div>`;
  },

  renderDiscoverLoadingMarkup() {
    return this.loading ? `<div class="seeall-loading">${escapeHtml(t("discover_loading", {}, "Loading..."))}</div>` : "";
  },

  async reloadItems({ suppressLoadingRender = false, preserveExistingItems = false, partialRender = false } = {}) {
    const selectedCatalog = this.getSelectedCatalog();
    this.captureViewState();
    this.nextSkip = 0;
    this.hasMore = true;
    this.loading = true;
    this.lastFocusedKey = null;
    this.lastFocusedDiscoverItemId = "";
    this.pendingRestoreFocus = false;
    this.savedScrollTop = 0;
    if (!preserveExistingItems) {
      this.items = [];
    }
    if (!suppressLoadingRender && !this.suppressInitialLoadingRenders) {
      this.requestRender();
    }
    if (!selectedCatalog) {
      this.loading = false;
      this.hasMore = false;
      this.suppressInitialLoadingRenders = false;
      if (partialRender) {
        this.updateRenderedDiscoverResults();
      } else {
        this.requestRender();
      }
      return;
    }

    this.loading = false;
    await this.loadNextPage({ restoreFocusToGrid: false, suppressLoadingRender, replaceExistingItems: preserveExistingItems, partialRender });
  },

  async loadNextPage({ restoreFocusToGrid = true, preserveViewport = false, suppressLoadingRender = false, replaceExistingItems = false, partialRender = false } = {}) {
    if (this.loading || !this.hasMore) {
      return;
    }

    const token = this.loadToken;
    const selectedCatalog = this.getSelectedCatalog();
    if (!selectedCatalog) {
      this.hasMore = false;
      if (partialRender) {
        this.updateRenderedDiscoverResults();
      } else {
        this.requestRender();
      }
      return;
    }

    this.loading = true;
    this.captureViewState();
    this.pendingRestoreFocus = Boolean(restoreFocusToGrid);
    this.preserveViewportOnNextRender = Boolean(preserveViewport);
    if (!suppressLoadingRender && !preserveViewport && !this.suppressInitialLoadingRenders) {
      this.requestRender();
    }

    const extraArgs = {};
    if (this.selectedGenre && this.selectedGenre !== "Default") {
      extraArgs.genre = this.selectedGenre;
    }

    const result = await catalogRepository.getCatalog({
      addonBaseUrl: selectedCatalog.addonBaseUrl,
      addonId: selectedCatalog.addonId,
      addonName: selectedCatalog.addonName,
      catalogId: selectedCatalog.catalogId,
      catalogName: selectedCatalog.catalogName,
      type: selectedCatalog.type,
      skip: Math.max(0, Number(this.nextSkip || 0)),
      extraArgs,
      supportsSkip: true
    });

    if (token !== this.loadToken) return;
    if (result.status !== "success") {
      this.loading = false;
      this.hasMore = false;
      this.preserveViewportOnNextRender = false;
      this.suppressInitialLoadingRenders = false;
      if (partialRender) {
        this.updateRenderedDiscoverResults();
      } else {
        this.requestRender();
      }
      return;
    }

    const incoming = Array.isArray(result?.data?.items) ? result.data.items : [];
    let addedCount = 0;
    if (replaceExistingItems) {
      this.items = [];
    } else if (!this.items.length) {
      this.items = [];
    }
    if (incoming.length) {
      const seen = new Set(this.items.map((item) => item.id));
      incoming.forEach((item) => {
        if (!item?.id || seen.has(item.id)) {
          return;
        }
        seen.add(item.id);
        this.items.push(item);
        addedCount += 1;
      });
      this.nextSkip = Math.max(0, Number(this.nextSkip || 0)) + 100;
    }
    this.hasMore = incoming.length > 0;
    this.loading = false;
    if (!this.lastFocusedKey && this.items[0]?.id) {
      this.lastFocusedKey = `item:${this.items[0].id}`;
      this.lastFocusedDiscoverItemId = String(this.items[0].id);
    }
    this.pendingRestoreFocus = Boolean(restoreFocusToGrid);
    this.preserveViewportOnNextRender = Boolean(preserveViewport && addedCount > 0);
    this.suppressInitialLoadingRenders = false;
    if (partialRender) {
      this.updateRenderedDiscoverResults();
    } else {
      this.requestRender();
    }
  },

  shouldAutoLoadMore(index) {
    if (this.loading || !this.hasMore) {
      return false;
    }
    const remaining = (this.items.length - 1) - Number(index || 0);
    return remaining <= 10;
  },

  shouldAutoLoadMoreFromScroll(scroller) {
    if (!(scroller instanceof HTMLElement) || this.loading || !this.hasMore) {
      return false;
    }
    const remaining = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
    return remaining <= 640;
  },

  getPickerOptions(kind) {
    if (kind === "type") {
      return this.typeOptions.map((value) => ({
        value,
        label: formatAddonTypeLabel(value)
      }));
    }
    if (kind === "catalog") {
      return this.catalogOptions.map((entry) => ({
        value: entry.key,
        label: entry.catalogName || "Select"
      }));
    }
    if (kind === "genre") {
      return this.genreOptions.map((value) => ({
        value,
        label: value
      }));
    }
    return [];
  },

  getCurrentPickerValue(kind) {
    if (kind === "type") return this.selectedType;
    if (kind === "catalog") return this.selectedCatalogKey;
    if (kind === "genre") return this.selectedGenre || "Default";
    return "";
  },

  setPickerValue(kind, value) {
    if (kind === "type") {
      if (!value || value === this.selectedType) return;
      this.selectedType = value;
      this.updateCatalogOptions();
      this.reloadItems({ suppressLoadingRender: true, preserveExistingItems: true, partialRender: true });
      return;
    }
    if (kind === "catalog") {
      if (!value || value === this.selectedCatalogKey) return;
      this.selectedCatalogKey = value;
      this.updateGenreOptions();
      this.reloadItems({ suppressLoadingRender: true, preserveExistingItems: true, partialRender: true });
      return;
    }
    if (kind === "genre") {
      const safeValue = value || "Default";
      if (safeValue === this.selectedGenre) return;
      this.selectedGenre = safeValue;
      this.reloadItems({ suppressLoadingRender: true, preserveExistingItems: true, partialRender: true });
    }
  },

  syncRenderedFilterValues() {
    const valueByKind = {
      type: formatAddonTypeLabel(this.selectedType),
      catalog: this.getSelectedCatalog()?.catalogName || "Select",
      genre: this.selectedGenre || "Default"
    };
    Object.entries(valueByKind).forEach(([kind, value]) => {
      const node = this.container?.querySelector(`.library-picker-anchor[data-picker="${kind}"] .library-picker-value`);
      if (node instanceof HTMLElement) {
        node.textContent = value;
      }
    });
  },

  closePickerMenuInDom(focusAction = "") {
    if (!this.container) {
      return;
    }
    this.lastRenderedOpenPicker = null;
    this.clearClosingPicker();
    Array.from(this.container.querySelectorAll(".discover-picker-row .library-picker")).forEach((node) => {
      node.classList.remove("open", "closing");
      const menu = node.querySelector(".library-picker-menu");
      if (menu) {
        menu.remove();
      }
    });
    Array.from(this.container.querySelectorAll(".discover-picker-row .library-picker-anchor")).forEach((node) => {
      node.setAttribute("aria-expanded", "false");
    });
    this.syncRenderedFilterValues();
    const target = focusAction
      ? this.container.querySelector(`.discover-filter[data-action="${focusAction}"]`)
      : null;
    if (target instanceof HTMLElement) {
      this.container.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) {
          node.classList.remove("focused");
        }
      });
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
    }
  },

  updateRenderedDiscoverResults() {
    if (!this.container || !this.container.querySelector(".discover-shell")) {
      this.requestRender();
      return;
    }
    const selectedCatalog = this.getSelectedCatalog();
    const subtitleNode = this.container.querySelector("#discoverContextLabel");
    if (subtitleNode instanceof HTMLElement) {
      subtitleNode.textContent = this.getDiscoverContextLabel(selectedCatalog);
    }
    const gridNode = this.container.querySelector("#discoverGridMount");
    if (gridNode instanceof HTMLElement) {
      gridNode.innerHTML = this.renderDiscoverCards(selectedCatalog);
    }
    const loadingNode = this.container.querySelector("#discoverLoadingMount");
    if (loadingNode instanceof HTMLElement) {
      loadingNode.innerHTML = this.renderDiscoverLoadingMarkup();
    }

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindCardEvents();

    const focusedFilter = this.container.querySelector(".discover-filter.focused");
    if (focusedFilter instanceof HTMLElement) {
      focusWithoutAutoScroll(focusedFilter);
      this.scrollContentToTop();
      return;
    }

    if (this.pendingRestoreFocus) {
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.restoreFocusedCard({ scrollMode });
      this.syncOpenPickerScroll();
      return;
    }
    this.restoreScrollState();
    const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
    this.preserveViewportOnNextRender = false;
    this.restoreContentFocus({ scrollMode });
    this.syncOpenPickerScroll();
  },

  openPickerMenu(kind) {
    const options = this.getPickerOptions(kind);
    if (!options.length) return;
    this.openPicker = kind;
    const currentValue = this.getCurrentPickerValue(kind);
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
    this.pickerOptionIndex = currentIndex;
    this.lastFocusedAction = kind === "type"
      ? "discoverFilterType"
      : (kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre");
    this.requestRender();
  },

  closePickerMenu() {
    if (!this.openPicker) return;
    this.openPicker = null;
    if (!this.suppressInitialLoadingRenders) {
      this.requestRender();
    }
  },

  isPosterHoldTarget(node) {
    return Boolean(node?.matches?.(".discover-card.seeall-card.focusable[data-action='openDetail']"));
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    const pending = this.pendingPosterHoldTarget;
    if (!pending || !node) {
      return false;
    }
    return String(node.dataset.focusKey || "") === String(pending.focusKey || "");
  },

  startPendingPosterHold(node) {
    if (!this.isPosterHoldTarget(node)) {
      return false;
    }
    this.cancelPendingPosterHold();
    this.pendingPosterHoldTarget = {
      focusKey: String(node.dataset.focusKey || "")
    };
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const current = this.container?.querySelector(".discover-card.seeall-card.focusable.focused[data-action='openDetail']") || null;
      if (!this.hasPendingPosterHold(current)) {
        return;
      }
      this.pendingPosterHoldTarget.holdTriggered = true;
      void this.openPosterOptionsMenu(current);
    }, POSTER_HOLD_DELAY_MS);
    return true;
  },

  completePendingPosterHold(node, event = null) {
    const pending = this.pendingPosterHoldTarget;
    if (!pending) {
      return false;
    }
    const holdTriggered = Boolean(pending.holdTriggered);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingPosterHold(node);
    this.cancelPendingPosterHold();
    if (holdTriggered || shouldOpenHoldMenu) {
      if (shouldOpenHoldMenu) {
        void this.openPosterOptionsMenu(node);
      }
      return true;
    }
    if (!this.isPosterHoldTarget(node)) {
      return false;
    }
    this.openDetailFromNode(node);
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node, this.selectedType || "movie");
    if (!item?.id) {
      return false;
    }
    this.captureViewState();
    this.lastFocusedKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
    this.lastFocusedDiscoverItemId = String(node.dataset.itemId || "");
    this.pendingPosterOptionsFocusKey = String(node.dataset.focusKey || "");
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled"
          });
        },
        onDismiss: () => {
          this.lastFocusedKey = this.pendingPosterOptionsFocusKey || this.lastFocusedKey;
          this.pendingPosterOptionsFocusKey = "";
          this.pendingRestoreFocus = true;
          this.preserveViewportOnNextRender = true;
          this.requestRender();
        },
        onChanged: () => {
          this.requestRender();
        }
      });
    }
    this.suppressHoldMenuEnterUntilKeyUp = true;
    return this.posterOptionsController.open(item, {
      focusKey: node.dataset.focusKey || "",
      itemIndex: Number(node.dataset.itemIndex || -1)
    });
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    return true;
  },

  openDetailFromNode(node) {
    if (!node) {
      return false;
    }
    this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
    this.lastFocusedKey = String(node.dataset.focusKey || this.lastFocusedKey || "");
    this.lastFocusedDiscoverItemId = String(node.dataset.itemId || "");
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
    return true;
  },

  movePickerIndex(delta) {
    const options = this.getPickerOptions(this.openPicker);
    if (!options.length) return;
    const next = this.pickerOptionIndex + delta;
    this.pickerOptionIndex = Math.min(options.length - 1, Math.max(0, next));
    this.refreshOpenPickerMenuState();
  },

  refreshOpenPickerMenuState() {
    if (!this.openPicker) {
      return;
    }
    const options = Array.from(this.container?.querySelectorAll(".library-picker.open .library-picker-option") || []);
    if (!options.length) {
      this.requestRender();
      return;
    }
    const selectedValue = this.getCurrentPickerValue(this.openPicker);
    const pickerOptions = this.getPickerOptions(this.openPicker);
    options.forEach((node, index) => {
      const option = pickerOptions[index] || null;
      const isFocused = index === this.pickerOptionIndex;
      const isSelected = option?.value === selectedValue;
      node.classList.toggle("focused", isFocused);
      node.classList.toggle("selected", isSelected);
      node.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    this.syncOpenPickerScroll();
  },

  applyOpenPickerOptionFocus() {
    if (!this.openPicker) {
      return false;
    }
    const options = Array.from(this.container?.querySelectorAll(`.library-picker.open .library-picker-option.focusable[data-picker="${this.openPicker}"]`) || []);
    if (!options.length) {
      return false;
    }
    const focusIndex = Math.max(0, Math.min(options.length - 1, Number(this.pickerOptionIndex || 0)));
    options.forEach((node, index) => node.classList.toggle("focused", index === focusIndex));
    const target = options[focusIndex] || options[0] || null;
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.syncOpenPickerScroll();
    return true;
  },

  isFilterAction(action) {
    return Boolean(this.getKindFromFilterAction(action));
  },

  selectCurrentPickerOption() {
    if (!this.openPicker) return;
    const kind = this.openPicker;
    const options = this.getPickerOptions(kind);
    const option = options[this.pickerOptionIndex] || null;
    const currentValue = this.getCurrentPickerValue(kind);
    const hasChanged = Boolean(option) && option.value !== currentValue;
    this.lastFocusedAction = actionForPickerKind(kind);
    this.lastFocusedKey = null;
    this.lastFocusedDiscoverItemId = "";
    this.openPicker = null;
    if (!hasChanged) {
      this.requestRender();
      return;
    }
    if (option) {
      this.setPickerValue(kind, option.value);
    }
    this.closePickerMenuInDom(this.lastFocusedAction);
  },

  focusFilter(action) {
    const target = this.container?.querySelector(`.discover-filter[data-action="${action}"]`) || null;
    if (!target) return;
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusZone = "content";
    focusWithoutAutoScroll(target);
    this.scrollContentToTop();
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    this.lastFocusedAction = action;
  },

  moveFilterFocus(delta) {
    const filters = ["discoverFilterType", "discoverFilterCatalog", "discoverFilterGenre"];
    const currentAction = this.lastFocusedAction || "discoverFilterType";
    const currentIndex = Math.max(0, filters.indexOf(currentAction));
    const nextIndex = Math.min(filters.length - 1, Math.max(0, currentIndex + delta));
    this.focusFilter(filters[nextIndex]);
  },

  focusNearestFilterFromCard(cardNode) {
    const filters = Array.from(this.container?.querySelectorAll(".discover-filter.focusable") || []);
    if (!filters.length || !cardNode) return false;
    const cardRect = cardNode.getBoundingClientRect();
    const cardCenterX = cardRect.left + (cardRect.width / 2);
    let target = null;
    let minDx = Number.POSITIVE_INFINITY;
    filters.forEach((filter) => {
      const rect = filter.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const dx = Math.abs(centerX - cardCenterX);
      if (dx < minDx) {
        minDx = dx;
        target = filter;
      }
    });
    if (!target) return false;
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusZone = "content";
    focusWithoutAutoScroll(target);
    this.scrollContentToTop();
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    this.lastFocusedAction = String(target.dataset.action || "discoverFilterType");
    return true;
  },

  captureViewState() {
    const main = this.container?.querySelector(".discover-main");
    if (main) {
      this.savedScrollTop = main.scrollTop;
    }
    const focused = this.container?.querySelector(".seeall-card.focused") || this.container?.querySelector(".discover-card.focused");
    if (focused?.dataset?.focusKey) {
      this.lastFocusedKey = String(focused.dataset.focusKey || "");
    }
    if (focused?.dataset?.itemId) {
      this.lastFocusedDiscoverItemId = String(focused.dataset.itemId || "");
    }
  },

  restoreScrollState() {
    const main = this.container?.querySelector(".discover-main");
    if (main) {
      this.savedScrollTop = setContainerScrollTop(main, this.savedScrollTop, "auto");
    }
  },

  restoreFocusedCard({ scrollMode = "center" } = {}) {
    this.restoreScrollState();
    const target = (this.lastFocusedKey
      ? this.container?.querySelector(`.seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`)
      : null)
      || (this.lastFocusedDiscoverItemId
        ? this.container?.querySelector(`.seeall-card.focusable[data-item-id="${String(this.lastFocusedDiscoverItemId).replace(/["\\]/g, "\\$&")}"]`)
        : null)
      || this.container?.querySelector(".seeall-card.focusable")
      || (this.lastFocusedAction
        ? this.container?.querySelector(`.discover-filter.focusable[data-action="${String(this.lastFocusedAction).replace(/["\\]/g, "\\$&")}"]`)
        : null)
      || this.container?.querySelector(".discover-filter.focusable")
      || null;
    if (!target) {
      return;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    if (target.classList.contains("discover-filter")) {
      focusWithoutAutoScroll(target);
      this.scrollContentToTop();
      return;
    }
    focusWithoutAutoScroll(target);
    this.rememberRowFocus(target);
    if (scrollMode !== "none") {
      scrollNodeIntoContainerView(target, this.getContentScroller(), { center: scrollMode === "center", padding: 20 });
    }
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
  },

  syncOpenPickerScroll() {
    const menu = this.container?.querySelector(".library-picker.open .library-picker-menu");
    const option = menu?.querySelector(".library-picker-option.focused");
    if (menu && option) {
      option.scrollIntoView({ block: "nearest" });
    }
  },

  buildNavigationModel() {
    const cards = Array.from(this.container?.querySelectorAll(".discover-grid .seeall-card.focusable") || []);
    const rows = groupNodesByOffsetTop(cards);
    rows.forEach((rowNodes, rowIndex) => {
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
      });
    });
    this.navModel = { rows };
  },

  rememberRowFocus(node) {
    if (!node?.dataset) return;
    const row = Number(node.dataset.navRow || -1);
    const col = Number(node.dataset.navCol || 0);
    if (row < 0) return;
    this.rowFocusedIndexByRow = {
      ...(this.rowFocusedIndexByRow || {}),
      [row]: Math.max(0, col)
    };
  },

  resolvePreferredNodeForRow(rowNodes = []) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowIndex = Number(rowNodes[0]?.dataset?.navRow || -1);
    const storedIndex = rowIndex >= 0 ? Number(this.rowFocusedIndexByRow?.[rowIndex]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusNode(target) {
    if (!target) return false;
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    this.focusZone = "content";
    this.lastFocusedAction = String(target.dataset.action || this.lastFocusedAction || "openDetail");
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
    if (target.dataset.itemId) {
      this.lastFocusedDiscoverItemId = String(target.dataset.itemId || "");
    }
    this.rememberRowFocus(target);
    focusWithoutAutoScroll(target);
    const scroller = this.getContentScroller();
    const isFirstRow = Number(target.dataset.navRow || 0) === 0;
    const shouldLoadMore = this.shouldAutoLoadMore(target.dataset.itemIndex);
    const nextScrollTop = isFirstRow
      ? setContainerScrollTop(scroller, 0, "smooth")
      : scrollNodeIntoContainerView(target, scroller, {
        center: false,
        padding: 20,
        behavior: shouldLoadMore ? "auto" : "smooth"
      });
    if (Number.isFinite(nextScrollTop)) {
      this.savedScrollTop = nextScrollTop;
    }
    if (shouldLoadMore) {
      this.loadNextPage({ preserveViewport: true });
    }
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    return true;
  },

  getContentScroller() {
    return this.container?.querySelector(".discover-main") || null;
  },

  scrollContentToTop() {
    const scroller = this.getContentScroller();
    if (scroller) {
      this.savedScrollTop = setContainerScrollTop(scroller, 0, "auto");
    }
  },

  handleGridDpad(event) {
    const code = Number(event?.keyCode || 0);
    const direction = code === 38 ? "up"
      : code === 40 ? "down"
        : code === 37 ? "left"
          : code === 39 ? "right"
            : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel;
    const current = this.container?.querySelector(".discover-grid .seeall-card.focused") || null;
    if (!nav?.rows?.length || !current) {
      return false;
    }

    event?.preventDefault?.();
    const row = Number(current.dataset.navRow || 0);
    const col = Number(current.dataset.navCol || 0);
    const rowNodes = nav.rows[row] || [];

    if (direction === "left") {
      return this.focusNode(rowNodes[col - 1] || current) || true;
    }
    if (direction === "right") {
      return this.focusNode(rowNodes[col + 1] || current) || true;
    }

    const delta = direction === "up" ? -1 : 1;
    const targetRowNodes = nav.rows[row + delta] || null;
    if (!targetRowNodes?.length) {
      return true;
    }
    return this.focusNode(this.resolvePreferredNodeForRow(targetRowNodes)) || true;
  },

  focusFirstContentCard() {
    const target = (this.lastFocusedKey
      ? this.container?.querySelector(`.discover-grid .seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`)
      : null)
      || this.container?.querySelector(".discover-grid .seeall-card.focusable")
      || null;
    return this.focusNode(target);
  },

  restoreContentFocus({ scrollMode = "center" } = {}) {
    if (this.openPicker && this.applyOpenPickerOptionFocus()) {
      return true;
    }
    const selector = this.lastFocusedAction && this.lastFocusedAction !== "openDetail"
      ? `.focusable[data-action="${this.lastFocusedAction}"]`
      : "";
    const filterTarget = this.isFilterAction(this.lastFocusedAction) && selector
      ? this.container?.querySelector(selector)
      : null;
    const posterTarget = this.lastFocusedKey
      ? this.container?.querySelector(`.seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`)
      : null;
    const target = filterTarget
      || posterTarget
      || (selector ? this.container?.querySelector(selector) : null)
      || (this.lastFocusedDiscoverItemId
        ? this.container?.querySelector(`.seeall-card.focusable[data-item-id="${String(this.lastFocusedDiscoverItemId).replace(/["\\]/g, "\\$&")}"]`)
        : null)
      || this.container?.querySelector(".discover-filter.focusable")
      || this.container?.querySelector(".seeall-card.focusable")
      || null;
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusZone = "content";
    if (target.classList.contains("discover-filter")) {
      focusWithoutAutoScroll(target);
      this.scrollContentToTop();
    } else {
      focusWithoutAutoScroll(target);
      this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
      if (scrollMode !== "none") {
        scrollNodeIntoContainerView(target, this.getContentScroller(), { center: scrollMode === "center", padding: 20 });
      }
    }
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    return true;
  },

  async closeSidebarToContent() {
    this.focusZone = "content";
    return this.restoreContentFocus() || true;
  },

  getKindFromFilterAction(action) {
    if (action === "discoverFilterType") return "type";
    if (action === "discoverFilterCatalog") return "catalog";
    if (action === "discoverFilterGenre") return "genre";
    return null;
  },

  renderFilterPicker(kind, title, value) {
    const isOpen = this.openPicker === kind;
    const isClosing = this.closingPicker === kind;
    const options = isOpen || isClosing ? this.getPickerOptions(kind) : [];
    const currentValue = this.getCurrentPickerValue(kind);
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
    const anchorAction = kind === "type"
      ? "discoverFilterType"
      : (kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre");
    return renderContentFilterPicker({
      variant: "discover",
      picker: kind,
      title,
      value,
      options,
      open: isOpen,
      closing: isClosing,
      focusIndex: this.pickerOptionIndex,
      selectedIndex,
      widthClass: "library-picker-flex",
      anchorAction,
      optionFocusable: isOpen
    });
  },

  render() {
    this.cancelScheduledRender();
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = false;
    const openPicker = this.openPicker || null;
    if (this.lastRenderedOpenPicker && this.lastRenderedOpenPicker !== openPicker) {
      this.startClosingPicker(this.lastRenderedOpenPicker);
    }
    if (openPicker && this.closingPicker === openPicker) {
      this.clearClosingPicker();
    }
    this.lastRenderedOpenPicker = openPicker;
    const currentFocused = this.container?.querySelector(".focusable.focused");
    const currentFocusedAction = String(currentFocused?.dataset?.action || "");
    if (currentFocusedAction === "openDetail" || this.isFilterAction(currentFocusedAction)) {
      this.lastFocusedAction = currentFocusedAction;
    }

    const selectedCatalog = this.getSelectedCatalog();
    const contextLabel = this.getDiscoverContextLabel(selectedCatalog);
    const cards = this.renderDiscoverCards(selectedCatalog);

    const enterClass = this.discoverRouteEnterPending ? " nuvio-route-slide-enter" : "";
    this.discoverRouteEnterPending = false;

    this.container.innerHTML = `
      <div class="home-shell search-screen-shell discover-shell">
        <main class="home-main discover-main${enterClass}">
          <div class="seeall-shell discover-seeall-shell">
            <header class="seeall-header discover-header">
              <h2 class="seeall-title">Discover</h2>
              <div class="seeall-subtitle" id="discoverContextLabel">${escapeHtml(contextLabel)}</div>
            </header>
            <section class="library-picker-row discover-picker-row" id="discoverPickerRow">
              ${this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType))}
              ${this.renderFilterPicker("catalog", "Catalog", selectedCatalog?.catalogName || "Select")}
              ${this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default")}
            </section>
            <section class="seeall-grid discover-grid" id="discoverGridMount">
              ${cards}
            </section>
            <div id="discoverLoadingMount">${this.renderDiscoverLoadingMarkup()}</div>
          </div>
        </main>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindCardEvents();
    this.bindShellEvents();
    this.bindPointerEvents();
    if (this.pendingRestoreFocus) {
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.restoreFocusedCard({ scrollMode });
      this.syncOpenPickerScroll();
      return;
    }
    this.restoreScrollState();
    const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
    this.preserveViewportOnNextRender = false;
    this.restoreContentFocus({ scrollMode });
    this.syncOpenPickerScroll();
  },

  bindCardEvents() {
    this.container?.querySelectorAll(".seeall-card.focusable").forEach((node) => {
      if (node.__boundDiscoverCardHandlers) return;
      node.__boundDiscoverCardHandlers = true;
      node.addEventListener("focus", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        this.lastFocusedDiscoverItemId = String(node.dataset.itemId || this.lastFocusedDiscoverItemId || "");
        this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
      });
      node.addEventListener("mouseenter", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        this.lastFocusedDiscoverItemId = String(node.dataset.itemId || this.lastFocusedDiscoverItemId || "");
      });
    });
  },

  bindShellEvents() {
    const scroller = this.getContentScroller();
    if (!scroller || scroller.__discoverScrollBound) {
      return;
    }
    scroller.__discoverScrollBound = true;
    scroller.addEventListener("scroll", () => {
      this.savedScrollTop = Number(scroller.scrollTop || 0);
      if (this.shouldAutoLoadMoreFromScroll(scroller)) {
        this.loadNextPage({ preserveViewport: true });
      }
    }, { passive: true });
  },

  bindPointerEvents() {
    if (!this.container || this.container.__discoverPointerBound) return;
    this.container.__discoverPointerBound = true;

    this.container.addEventListener("click", (event) => {
      const isKeyboardClick = Number(event?.detail || 0) === 0;
      const optionNode = event.target?.closest?.(".library-picker-option");
      if (optionNode && this.openPicker) {
        if (isKeyboardClick) {
          return;
        }
        const optionIndex = Number(optionNode.dataset.optionIndex || -1);
        if (optionIndex >= 0) {
          this.pickerOptionIndex = optionIndex;
          this.selectCurrentPickerOption();
          return;
        }
      }

      const filterNode = event.target?.closest?.(".discover-filter");
      if (filterNode) {
        if (isKeyboardClick) {
          return;
        }
        const action = String(filterNode.dataset.action || "");
        this.focusFilter(action);
        if (action === "discoverFilterType") this.openPickerMenu("type");
        if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
        if (action === "discoverFilterGenre") this.openPickerMenu("genre");
        return;
      }

      const cardNode = event.target?.closest?.(".discover-card");
      if (cardNode) {
        this.openDetailFromNode(cardNode);
      }
    });
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.closePosterOptionsMenu()) {
        return;
      }
      if (this.openPicker) {
        this.closePickerMenu();
        return;
      }
      await Router.back();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    const code = Number(event?.keyCode || 0);
    if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      return;
    }
    const currentAction = String(current?.dataset?.action || "");
    const focusedFilterKind = this.getKindFromFilterAction(currentAction);
    if (isEnterKey(event) && focusedFilterKind) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.openPickerMenu(focusedFilterKind);
      return;
    }

    if (code === 13 && this.isPosterHoldTarget(current)) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(current)) {
        this.startPendingPosterHold(current);
      }
      return;
    }
    if (isUpKey(event) || isDownKey(event) || isLeftKey(event) || isRightKey(event)) {
      event?.preventDefault?.();
    }

    if (this.openPicker) {
      if (isUpKey(event)) {
        this.movePickerIndex(-1);
        return;
      }
      if (isDownKey(event)) {
        this.movePickerIndex(1);
        return;
      }
      if (isEnterKey(event)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        this.selectCurrentPickerOption();
        return;
      }
      if (isLeftKey(event) || isRightKey(event)) {
        const movingRight = isRightKey(event);
        const action = this.openPicker === "type"
          ? "discoverFilterType"
          : (this.openPicker === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre");
        this.openPicker = null;
        this.lastFocusedAction = action;
        this.moveFilterFocus(movingRight ? 1 : -1);
        this.requestRender();
        return;
      }
      return;
    }

    if (currentAction === "openDetail" && current?.dataset?.itemId) {
      this.lastFocusedKey = String(current.dataset.focusKey || this.lastFocusedKey || "");
      this.lastFocusedDiscoverItemId = String(current.dataset.itemId || "");
    }

    if (focusedFilterKind) {
      if (isLeftKey(event)) {
        if (currentAction === "discoverFilterType") {
          return;
        }
        this.moveFilterFocus(-1);
        return;
      }
      if (isRightKey(event)) {
        this.moveFilterFocus(1);
        return;
      }
      if (isDownKey(event)) {
        this.focusFirstContentCard();
        return;
      }
    }

    if (currentAction === "openDetail") {
      if (isLeftKey(event) && Number(current.dataset.navCol || 0) === 0) {
        event?.preventDefault?.();
        return;
      }
      if (isUpKey(event) && Number(current.dataset.navRow || 0) === 0) {
        event?.preventDefault?.();
        this.focusNearestFilterFromCard(current);
        return;
      }
      if (this.handleGridDpad(event)) {
        return;
      }
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (!isEnterKey(event)) return;
    if (!current) return;
    const action = String(current.dataset.action || "");
    this.lastFocusedAction = action;

    if (action === "discoverFilterType") this.openPickerMenu("type");
    if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
    if (action === "discoverFilterGenre") this.openPickerMenu("genre");
    if (action === "openDetail") {
      this.openDetailFromNode(current);
    }
  },

  onKeyUp(event) {
    if (this.suppressHoldMenuEnterUntilKeyUp) {
      this.suppressHoldMenuEnterUntilKeyUp = false;
      if (Number(event?.keyCode || 0) === 13) {
        event?.preventDefault?.();
        return;
      }
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".discover-card.seeall-card.focusable.focused[data-action='openDetail']") || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  consumeBackRequest() {
    if (this.closePosterOptionsMenu()) {
      return true;
    }
    if (this.openPicker) {
      this.closePickerMenu();
      return true;
    }
    return false;
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    this.cancelScheduledRender();
    this.clearClosingPicker();
    this.lastRenderedOpenPicker = null;
    this.cancelPendingPosterHold();
    this.posterOptionsMenu = null;
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.pendingPosterOptionsFocusKey = "";
    this.suppressHoldMenuEnterUntilKeyUp = false;
    ScreenUtils.hide(this.container);
  }
};
