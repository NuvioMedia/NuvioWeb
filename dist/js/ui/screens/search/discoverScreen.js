import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { Environment } from "../../../platform/environment.js";

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

function navIcon(action) {
  const map = {
    gotoHome: "assets/icons/sidebar_home.svg",
    gotoSearch: "assets/icons/sidebar_search.svg",
    gotoLibrary: "assets/icons/sidebar_library.svg",
    gotoPlugin: "assets/icons/sidebar_plugin.svg",
    gotoSettings: "assets/icons/sidebar_settings.svg"
  };
  return map[action] || map.gotoSearch;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
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

export const DiscoverScreen = {

  async mount() {
    this.container = document.getElementById("discover");
    ScreenUtils.show(this.container);
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
    const token = this.loadToken;
    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    this.loading = true;
    this.items = [];
    this.render();
    if (!selectedCatalog) {
      this.loading = false;
      this.render();
      return;
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
      skip: 0,
      extraArgs,
      supportsSkip: true
    });

    if (token !== this.loadToken) return;
    this.items = result.status === "success" ? (result.data?.items || []) : [];
    this.loading = false;
    this.render();
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
    this.render();
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
    target.focus();
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
    target.focus();
    this.lastFocusedAction = String(target.dataset.action || "discoverFilterType");
    return true;
  },

  moveCardFocus(direction) {
    const selector = ".discover-grid .discover-card.focusable";
    const before = this.container?.querySelector(`${selector}.focused`) || null;
    ScreenUtils.moveFocusDirectional(this.container, direction, selector);
    const after = this.container?.querySelector(`${selector}.focused`) || null;
    return Boolean(after && before !== after);
  },

  focusFirstContentCard() {
    const firstCard = this.container?.querySelector(".discover-grid .discover-card.focusable");
    if (!firstCard) {
      return false;
    }
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    firstCard.classList.add("focused");
    firstCard.focus();
    this.lastFocusedAction = String(firstCard.dataset.action || "openDetail");
    return true;
  },

  getKindFromFilterAction(action) {
    if (action === "discoverFilterType") return "type";
    if (action === "discoverFilterCatalog") return "catalog";
    if (action === "discoverFilterGenre") return "genre";
    return null;
  },

  renderFilterPicker(kind, title, value) {
    const action = kind === "type"
      ? "discoverFilterType"
      : (kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre");
    const isOpen = this.openPicker === kind;
    const options = isOpen ? this.getPickerOptions(kind) : [];
    const currentValue = this.getCurrentPickerValue(kind);

    return `
      <div class="discover-filter-shell">
        <button class="discover-filter focusable" data-action="${action}">
          <span class="discover-filter-label">${title}</span>
          <span class="discover-filter-line">
            <span class="discover-filter-value">${value}</span>
            <span class="discover-filter-chevron" aria-hidden="true">${isOpen ? "&#9652;" : "&#9662;"}</span>
          </span>
        </button>
        ${isOpen ? `
          <div class="discover-picker-menu" role="listbox" aria-label="${title}">
            ${options.map((option, index) => `
              <div class="discover-picker-option${option.value === currentValue ? " selected" : ""}${index === this.pickerOptionIndex ? " focused-option" : ""}"
                   data-option-index="${index}"
                   role="option"
                   aria-selected="${option.value === currentValue ? "true" : "false"}">
                ${option.label}
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  },

  render() {
    const currentFocused = this.container?.querySelector(".focusable.focused");
    if (currentFocused?.dataset?.action) {
      this.lastFocusedAction = String(currentFocused.dataset.action);
    }

    const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
    const title = selectedCatalog
      ? `${selectedCatalog.addonName || "Addon"} - ${formatAddonTypeLabel(selectedCatalog.type)}`
      : "No catalog selected";
    const cards = this.loading
      ? `<div class="discover-empty">Loading...</div>`
      : (this.items.length
          ? this.items.map((item) => `
              <article class="discover-card focusable"
                       data-action="openDetail"
                       data-item-id="${item.id || ""}"
                       data-item-type="${item.type || selectedCatalog?.type || "movie"}"
                       data-item-title="${item.name || "Untitled"}">
                <div class="discover-card-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
                <div class="discover-card-title">${item.name || "Untitled"}</div>
              </article>
            `).join("")
          : `<div class="discover-empty">No content found.</div>`);

    this.container.innerHTML = `
      <div class="discover-shell">
        <aside class="search-sidebar">
          <button class="search-nav-item focusable" data-action="gotoHome"><img src="${navIcon("gotoHome")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable active" data-action="gotoSearch"><img src="${navIcon("gotoSearch")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoLibrary"><img src="${navIcon("gotoLibrary")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoPlugin"><img src="${navIcon("gotoPlugin")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoSettings"><img src="${navIcon("gotoSettings")}" alt="" aria-hidden="true" /></button>
        </aside>
        <main class="discover-main">
          <h1 class="discover-title">Discover</h1>
          <section class="discover-filters">
            ${this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType))}
            ${this.renderFilterPicker("catalog", "Catalog", selectedCatalog?.catalogName || "Select")}
            ${this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default")}
          </section>
          <div class="discover-row-title">${title}</div>
          <section class="discover-grid">
            ${cards}
          </section>
        </main>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.bindPointerEvents();
    const selector = this.lastFocusedAction
      ? `.focusable[data-action="${this.lastFocusedAction}"]`
      : ".discover-filter.focusable";
    ScreenUtils.setInitialFocus(this.container, selector);
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
        Router.navigate("detail", {
          itemId: cardNode.dataset.itemId,
          itemType: cardNode.dataset.itemType || "movie",
          fallbackTitle: cardNode.dataset.itemTitle || "Untitled"
        });
      }
    });
  },

  async onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.openPicker) {
        this.closePickerMenu();
        return;
      }
      Router.back();
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
        this.render();
        this.lastFocusedAction = action;
        this.moveFilterFocus(movingRight ? 1 : -1);
        return;
      }
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    const currentAction = String(current?.dataset?.action || "");
    const focusedFilterKind = this.getKindFromFilterAction(currentAction);

    if (focusedFilterKind) {
      if (isLeftKey(event)) {
        if (currentAction === "discoverFilterType") {
          if (ScreenUtils.handleDpadNavigation(event, this.container)) {
            return;
          }
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
      if (isLeftKey(event)) {
        if (!this.moveCardFocus("left")) {
          ScreenUtils.moveFocusDirectional(this.container, "left");
        }
        return;
      }
      if (isRightKey(event)) {
        this.moveCardFocus("right");
        return;
      }
      if (isDownKey(event)) {
        this.moveCardFocus("down");
        return;
      }
      if (isUpKey(event)) {
        if (!this.moveCardFocus("up")) {
          this.focusNearestFilterFromCard(current);
        }
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

    if (action === "gotoHome") Router.navigate("home");
    if (action === "gotoSearch") Router.navigate("search");
    if (action === "gotoLibrary") Router.navigate("library");
    if (action === "gotoPlugin") Router.navigate("plugin");
    if (action === "gotoSettings") Router.navigate("settings");
    if (action === "discoverFilterType") this.openPickerMenu("type");
    if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
    if (action === "discoverFilterGenre") this.openPickerMenu("genre");
    if (action === "openDetail") {
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
