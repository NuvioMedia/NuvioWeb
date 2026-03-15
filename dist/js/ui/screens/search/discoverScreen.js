import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { Platform } from "../../../platform/index.js";
import { renderFilterPicker } from "../../components/filterPicker.js";
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

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatAddonTypeLabel(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!type) return "Movie";
  if (type === "tv") return "Tv";
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
    container.scrollTo({
      top: resolvedTop,
      behavior: "smooth"
    });
  } else {
    setContainerScrollTop(container, resolvedTop, "auto");
  }
  return resolvedTop;
}

export const DiscoverScreen = {

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
    this.sidebarProfile = await getSidebarProfileState();
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.focusZone = this.focusZone || "content";
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

    this.render();
    await this.loadCatalogsAndContent();
  },

  async loadCatalogsAndContent() {
    const token = this.loadToken;
    const addons = await addonRepository.getInstalledAddons();
    if (token !== this.loadToken) return;

    this.catalogs = [];
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        const isSearchOnly = (catalog.extra || []).some((extra) => extra?.name === "search");
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

  async reloadItems() {
    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    this.captureViewState();
    this.items = [];
    this.nextSkip = 0;
    this.hasMore = true;
    this.loading = true;
    this.lastFocusedKey = null;
    this.lastFocusedDiscoverItemId = "";
    this.pendingRestoreFocus = false;
    this.savedScrollTop = 0;
    this.render();
    if (!selectedCatalog) {
      this.loading = false;
      this.hasMore = false;
      this.render();
      return;
    }

    this.loading = false;
    await this.loadNextPage({ restoreFocusToGrid: false });
  },

  async loadNextPage({ restoreFocusToGrid = true, preserveViewport = false } = {}) {
    if (this.loading || !this.hasMore) {
      return;
    }

    const token = this.loadToken;
    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    if (!selectedCatalog) {
      this.hasMore = false;
      this.render();
      return;
    }

    this.loading = true;
    this.captureViewState();
    this.pendingRestoreFocus = Boolean(restoreFocusToGrid);
    this.preserveViewportOnNextRender = Boolean(preserveViewport);
    if (!preserveViewport) {
      this.render();
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
      this.render();
      return;
    }

    const incoming = Array.isArray(result?.data?.items) ? result.data.items : [];
    let addedCount = 0;
    if (!this.items.length) {
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
    this.render();
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
      this.reloadItems();
      return;
    }
    if (kind === "catalog") {
      if (!value || value === this.selectedCatalogKey) return;
      this.selectedCatalogKey = value;
      this.updateGenreOptions();
      this.reloadItems();
      return;
    }
    if (kind === "genre") {
      const safeValue = value || "Default";
      if (safeValue === this.selectedGenre) return;
      this.selectedGenre = safeValue;
      this.reloadItems();
    }
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
    this.render();
  },

  closePickerMenu() {
    if (!this.openPicker) return;
    this.openPicker = null;
    this.render();
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
    const options = Array.from(this.container?.querySelectorAll(".discover-picker-menu .discover-picker-option") || []);
    if (!options.length) {
      this.render();
      return;
    }
    const selectedValue = this.getCurrentPickerValue(this.openPicker);
    const pickerOptions = this.getPickerOptions(this.openPicker);
    options.forEach((node, index) => {
      const option = pickerOptions[index] || null;
      const isFocused = index === this.pickerOptionIndex;
      const isSelected = option?.value === selectedValue;
      node.classList.toggle("focused-option", isFocused);
      node.classList.toggle("selected", isSelected);
      node.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    this.syncOpenPickerScroll();
  },

  selectCurrentPickerOption() {
    if (!this.openPicker) return;
    const kind = this.openPicker;
    const options = this.getPickerOptions(kind);
    const option = options[this.pickerOptionIndex] || null;
    this.openPicker = null;
    this.render();
    if (option) {
      this.setPickerValue(kind, option.value);
    }
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
    const menu = this.container?.querySelector(".discover-picker-menu");
    const option = menu?.querySelector(".discover-picker-option.focused-option");
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

  focusSidebarNode() {
    const target = getRootSidebarSelectedNode(this.container, this.layoutPrefs)
      || getRootSidebarNodes(this.container, this.layoutPrefs)[0]
      || null;
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    this.focusZone = "sidebar";
    focusWithoutAutoScroll(target);
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, true);
    }
    return true;
  },

  async openSidebar() {
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    return this.focusSidebarNode();
  },

  restoreContentFocus({ scrollMode = "center" } = {}) {
    const selector = this.lastFocusedAction && this.lastFocusedAction !== "openDetail"
      ? `.focusable[data-action="${this.lastFocusedAction}"]`
      : "";
    const target = (this.lastFocusedKey
      ? this.container?.querySelector(`.seeall-card.focusable[data-focus-key="${String(this.lastFocusedKey).replace(/["\\]/g, "\\$&")}"]`)
      : null)
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
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
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
    const options = isOpen ? this.getPickerOptions(kind) : [];
    const currentValue = this.getCurrentPickerValue(kind);
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
    const anchorAction = kind === "type"
      ? "discoverFilterType"
      : (kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre");
    return renderFilterPicker({
      picker: kind,
      title,
      value,
      options,
      open: isOpen,
      focusIndex: this.pickerOptionIndex,
      selectedIndex,
      widthClass: "library-picker-flex",
      classPrefix: "library-picker",
      wrapperExtraClass: "discover-filter-shell",
      anchorExtraClass: "library-primary discover-filter",
      menuExtraClass: "discover-picker-menu",
      optionExtraClass: "discover-picker-option",
      focusedOptionClass: "focused-option",
      selectedOptionClass: "selected",
      optionFocusable: true,
      anchorAction
    });
  },

  render() {
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    const currentFocused = this.container?.querySelector(".focusable.focused");
    if (currentFocused?.dataset?.action) {
      this.lastFocusedAction = String(currentFocused.dataset.action);
    }

    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    const contextLabel = selectedCatalog
      ? `${selectedCatalog.addonName || "Addon"} • ${formatAddonTypeLabel(selectedCatalog.type)}`
      : "Choose a catalog to start browsing";
    const cards = this.items.length
      ? this.items.map((item, index) => `
              <article class="discover-card seeall-card focusable"
                        data-action="openDetail"
                        data-item-id="${item.id || ""}"
                        data-item-type="${item.type || selectedCatalog?.type || "movie"}"
                        data-item-title="${item.name || "Untitled"}"
                        data-focus-key="item:${item.id || index}"
                        data-item-index="${index}">
                 <div class="seeall-card-poster-wrap">
                   ${item.poster
                     ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" />`
                     : `<div class="seeall-card-poster placeholder"></div>`}
                 </div>
                 ${this.layoutPrefs?.posterLabelsEnabled !== false ? `
                   <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
                   <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
                 ` : ""}
               </article>
             `).join("")
      : `<div class="seeall-empty">No items available.</div>`;

    this.container.innerHTML = `
      <div class="home-shell search-screen-shell discover-shell">
        ${renderRootSidebar({
          selectedRoute: "search",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main discover-main">
          <div class="seeall-shell discover-seeall-shell">
            <header class="seeall-header discover-header">
              <h2 class="seeall-title">Discover</h2>
              <div class="seeall-subtitle">${escapeHtml(contextLabel)}</div>
            </header>
            <section class="library-picker-row discover-picker-row">
              ${this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType))}
              ${this.renderFilterPicker("catalog", "Catalog", selectedCatalog?.catalogName || "Select")}
              ${this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default")}
            </section>
            <section class="seeall-grid discover-grid">
              ${cards}
            </section>
            ${this.loading ? `<div class="seeall-loading">Loading...</div>` : ""}
          </div>
        </main>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindCardEvents();
    this.bindShellEvents();
    bindRootSidebarEvents(this.container, {
      currentRoute: "search",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
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
    if (this.focusZone === "sidebar") {
      this.focusSidebarNode();
    } else {
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.preserveViewportOnNextRender = false;
      this.restoreContentFocus({ scrollMode });
    }
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
      const optionNode = event.target?.closest?.(".discover-picker-option");
      if (optionNode && this.openPicker) {
        const optionIndex = Number(optionNode.dataset.optionIndex || -1);
        if (optionIndex >= 0) {
          this.pickerOptionIndex = optionIndex;
          this.selectCurrentPickerOption();
          return;
        }
      }

      const filterNode = event.target?.closest?.(".discover-filter");
      if (filterNode) {
        const action = String(filterNode.dataset.action || "");
        this.focusFilter(action);
        if (action === "discoverFilterType") this.openPickerMenu("type");
        if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
        if (action === "discoverFilterGenre") this.openPickerMenu("genre");
        return;
      }

      const cardNode = event.target?.closest?.(".discover-card");
      if (cardNode) {
        this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
        this.lastFocusedKey = String(cardNode.dataset.focusKey || this.lastFocusedKey || "");
        this.lastFocusedDiscoverItemId = String(cardNode.dataset.itemId || "");
        Router.navigate("detail", {
          itemId: cardNode.dataset.itemId,
          itemType: cardNode.dataset.itemType || "movie",
          fallbackTitle: cardNode.dataset.itemTitle || "Untitled"
        });
      }
    });
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.openPicker) {
        this.closePickerMenu();
        return;
      }
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
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
    if (this.focusZone === "sidebar") {
      if (isUpKey(event) || isDownKey(event) || isRightKey(event)) {
        event?.preventDefault?.();
      }
      if (isUpKey(event) || isDownKey(event)) {
        const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
        const focusedIndex = Math.max(0, nodes.indexOf(current));
        const nextIndex = Math.max(0, Math.min(nodes.length - 1, focusedIndex + (isUpKey(event) ? -1 : 1)));
        const nextNode = nodes[nextIndex] || null;
        if (nextNode) {
          this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
          nextNode.classList.add("focused");
          focusWithoutAutoScroll(nextNode);
        }
        return;
      }
      if (isRightKey(event)) {
        await this.closeSidebarToContent();
        return;
      }
      if (isEnterKey(event) && current && isRootSidebarNode(current)) {
        event?.preventDefault?.();
        activateLegacySidebarAction(String(current.dataset.action || ""), "search");
        if (isSelectedSidebarAction(String(current.dataset.action || ""), "search")) {
          await this.closeSidebarToContent();
        }
        return;
      }
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
        this.render();
        this.lastFocusedAction = action;
        this.moveFilterFocus(movingRight ? 1 : -1);
        return;
      }
      return;
    }

    const currentAction = String(current?.dataset?.action || "");
    if (currentAction === "openDetail" && current?.dataset?.itemId) {
      this.lastFocusedKey = String(current.dataset.focusKey || this.lastFocusedKey || "");
      this.lastFocusedDiscoverItemId = String(current.dataset.itemId || "");
    }
    const focusedFilterKind = this.getKindFromFilterAction(currentAction);

    if (focusedFilterKind) {
      if (isLeftKey(event)) {
        if (currentAction === "discoverFilterType") {
          await this.openSidebar();
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
        await this.openSidebar();
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

    if (isRootSidebarNode(current)) {
      activateLegacySidebarAction(action, "search");
      if (isSelectedSidebarAction(action, "search")) {
        await this.closeSidebarToContent();
      }
      return;
    }
    if (action === "discoverFilterType") this.openPickerMenu("type");
    if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
    if (action === "discoverFilterGenre") this.openPickerMenu("genre");
    if (action === "openDetail") {
      this.savedScrollTop = this.container?.querySelector(".discover-main")?.scrollTop || 0;
      this.lastFocusedKey = String(current.dataset.focusKey || this.lastFocusedKey || "");
      Router.navigate("detail", {
        itemId: current.dataset.itemId,
        itemType: current.dataset.itemType || "movie",
        fallbackTitle: current.dataset.itemTitle || "Untitled"
      });
    }
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    ScreenUtils.hide(this.container);
  }
};
