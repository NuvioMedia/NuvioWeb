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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatCatalogRowTitle(catalogName, addonName, type) {
  const typeLabel = toTitleCase(type || "movie") || "Movie";
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

export const SearchScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("search");
    ScreenUtils.show(this.container);
    this.query = String(params.query || "").trim();
    this.mode = this.query.length >= 2 ? "search" : "idle";
    this.rows = [];
    this.loadToken = (this.loadToken || 0) + 1;
    this.renderLoading();
    await this.reloadRows();
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="search-screen-shell">
        <div class="search-loading">Loading...</div>
      </div>
    `;
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
    this.render();
  },

  async loadDiscoverRows() {
    const addons = await addonRepository.getInstalledAddons();
    const sections = [];
    addons.forEach((addon) => {
      addon.catalogs.forEach((catalog) => {
        const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
        if (requiresSearch) return;
        if (catalog.apiType !== "movie" && catalog.apiType !== "series") return;
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
    const resolved = await Promise.all(picked.map(async (section) => {
      const result = await withTimeout(catalogRepository.getCatalog({
        addonBaseUrl: section.addonBaseUrl,
        addonId: section.addonId,
        addonName: section.addonName,
        catalogId: section.catalogId,
        catalogName: section.catalogName,
        type: section.type,
        skip: 0,
        supportsSkip: true
      }), 3500, { status: "error", message: "timeout" });
      return { ...section, result };
    }));

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
        if (catalog.apiType !== "movie" && catalog.apiType !== "series") return;
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

    const responses = await Promise.all(searchableCatalogs.slice(0, 14).map(async (catalog) => {
      const result = await withTimeout(catalogRepository.getCatalog({
        addonBaseUrl: catalog.addonBaseUrl,
        addonId: catalog.addonId,
        addonName: catalog.addonName,
        catalogId: catalog.catalogId,
        catalogName: catalog.catalogName,
        type: catalog.type,
        skip: 0,
        extraArgs: { search: query },
        supportsSkip: true
      }), 3500, { status: "error", message: "timeout" });
      return { catalog, result };
    }));

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
          <div class="search-empty-state small">
            <img src="assets/icons/sidebar_search.svg" class="search-empty-icon" alt="" aria-hidden="true" />
            <h2>No Results</h2>
            <p>Try another keyword.</p>
          </div>
        `;
      }
      return `
        <div class="search-empty-state">
          <img src="assets/icons/sidebar_search.svg" class="search-empty-icon" alt="" aria-hidden="true" />
          <h2>Start Searching</h2>
          <p>Enter at least 2 characters</p>
        </div>
      `;
    }

    return this.rows.map((row, rowIndex) => `
      <section class="search-results-row">
        <h3 class="search-results-title">${row.title}</h3>
        <div class="search-results-subtitle">${row.subtitle}</div>
        <div class="search-results-track">
          ${(row.items || []).map((item) => `
            <article class="search-result-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.id || ""}"
                     data-item-type="${item.type || row.type || "movie"}"
                     data-item-title="${item.name || "Untitled"}">
              <div class="search-result-poster-wrap">
                ${item.poster ? `<img class="search-result-poster" src="${item.poster}" alt="${item.name || "content"}" />` : `<div class="search-result-poster placeholder"></div>`}
              </div>
              <div class="search-result-name">${item.name || "Untitled"}</div>
              <div class="search-result-date">${formatDateLabel(item)}</div>
            </article>
          `).join("")}
          <article class="search-result-card search-seeall-card focusable"
                   data-action="openCatalogSeeAll"
                   data-addon-base-url="${row.addonBaseUrl || ""}"
                   data-addon-id="${row.addonId || ""}"
                   data-addon-name="${row.addonName || ""}"
                   data-catalog-id="${row.catalogId || ""}"
                   data-catalog-name="${row.catalogName || ""}"
                   data-catalog-type="${row.type || "movie"}"
                   data-row-index="${rowIndex}">
            <div class="search-seeall-inner">
              <div class="search-seeall-arrow" aria-hidden="true">&#8594;</div>
              <div class="search-seeall-label">See All</div>
            </div>
          </article>
        </div>
      </section>
    `).join("");
  },

  render() {
    const queryText = this.query || "";
    this.container.innerHTML = `
      <div class="search-screen-shell">
        <aside class="search-sidebar">
          <button class="search-nav-item focusable" data-action="gotoHome"><img src="${navIcon("gotoHome")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable active" data-action="gotoSearch"><img src="${navIcon("gotoSearch")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoLibrary"><img src="${navIcon("gotoLibrary")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoPlugin"><img src="${navIcon("gotoPlugin")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoSettings"><img src="${navIcon("gotoSettings")}" alt="" aria-hidden="true" /></button>
        </aside>

        <main class="search-content">
          <section class="search-header">
            <button class="search-discover-btn focusable" data-action="openDiscover">
              <img src="assets/icons/discover_compass.svg" alt="" aria-hidden="true" />
            </button>
            <input
              id="searchInput"
              class="search-input-field focusable"
              type="text"
              data-action="searchInput"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Search movies & series"
              value="${queryText.replace(/"/g, "&quot;")}"
            />
          </section>
          ${this.renderRows()}
        </main>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    this.bindSearchInputEvents();
    const input = this.container.querySelector("#searchInput");
    input?.blur?.();
    ScreenUtils.setInitialFocus(this.container, ".search-discover-btn");
  },

  buildNavigationModel() {
    const sidebar = Array.from(this.container?.querySelectorAll(".search-sidebar .focusable") || []);
    const header = [
      this.container?.querySelector(".search-discover-btn.focusable"),
      this.container?.querySelector("#searchInput.focusable")
    ].filter(Boolean);
    const rows = Array.from(this.container?.querySelectorAll(".search-results-row .search-results-track") || [])
      .map((track) => Array.from(track.querySelectorAll(".search-result-card.focusable")))
      .filter((row) => row.length > 0);

    sidebar.forEach((node, index) => {
      node.dataset.navZone = "sidebar";
      node.dataset.navIndex = String(index);
    });

    header.forEach((node, index) => {
      node.dataset.navZone = "header";
      node.dataset.navCol = String(index);
    });

    rows.forEach((rowNodes, rowIndex) => {
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navZone = "results";
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
      });
    });

    this.navModel = { sidebar, header, rows };
    this.lastMainFocus = header[1] || header[0] || rows[0]?.[0] || null;
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
    target.focus();
    const zone = String(target.dataset.navZone || "");
    if (zone === "header" || zone === "results") {
      this.lastMainFocus = target;
    }
    if (zone === "results") {
      target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    }
    return true;
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

    if (zone === "sidebar") {
      const sidebarIndex = Number(current.dataset.navIndex || 0);
      if (direction === "up") {
        return this.focusNode(current, nav.sidebar?.[Math.max(0, sidebarIndex - 1)] || current) || true;
      }
      if (direction === "down") {
        return this.focusNode(current, nav.sidebar?.[Math.min((nav.sidebar?.length || 1) - 1, sidebarIndex + 1)] || current) || true;
      }
      if (direction === "right") {
        const target = this.lastMainFocus || nav.header?.[1] || nav.header?.[0] || nav.rows?.[0]?.[0] || null;
        return this.focusNode(current, target) || true;
      }
      return true;
    }

    if (zone === "header") {
      const col = Number(current.dataset.navCol || 0);
      if (direction === "left") {
        if (col > 0) return this.focusNode(current, nav.header?.[col - 1] || current) || true;
        return this.focusNode(current, nav.sidebar?.[1] || nav.sidebar?.[0] || current) || true;
      }
      if (direction === "right") {
        if (col < (nav.header?.length || 0) - 1) {
          return this.focusNode(current, nav.header?.[col + 1] || current) || true;
        }
        return true;
      }
      if (direction === "down") {
        const firstRow = nav.rows?.[0] || [];
        const target = firstRow[Math.min(col, Math.max(0, firstRow.length - 1))] || firstRow[0] || null;
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        return this.focusNode(current, nav.sidebar?.[1] || nav.sidebar?.[0] || current) || true;
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
        return this.focusNode(current, nav.sidebar?.[1] || nav.sidebar?.[0] || current) || true;
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
        const target = nextRowNodes[Math.min(col, nextRowNodes.length - 1)] || nextRowNodes[0] || null;
        return this.focusNode(current, target) || true;
      }
      if (direction === "up") {
        const prevRowNodes = nav.rows?.[row - 1] || null;
        if (prevRowNodes) {
          const target = prevRowNodes[Math.min(col, prevRowNodes.length - 1)] || prevRowNodes[0] || null;
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
      this.query = String(event.target?.value || "").trimStart();
      if (this.query.length === 0 && this.mode !== "idle") {
        this.mode = "idle";
        this.loadToken = (this.loadToken || 0) + 1;
        this.renderLoading();
        this.reloadRows();
      }
    });

    input.addEventListener("keydown", async (event) => {
      if (event.keyCode !== 13) return;
      event.preventDefault();
      this.query = String(input.value || "").trim();
      this.mode = this.query.length >= 2 ? "search" : "idle";
      this.loadToken = (this.loadToken || 0) + 1;
      this.renderLoading();
      await this.reloadRows();
    });
  },

  openDetailFromNode(node) {
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  openCatalogSeeAllFromNode(node) {
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

  async onKeyDown(event) {
    if (Environment.isBackEvent(event)) {
      event?.preventDefault?.();
      Router.navigate("home");
      return;
    }

    if (this.handleSearchDpad(event)) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    if (event.keyCode !== 13) return;
    const current = this.container.querySelector(".focusable.focused");
    if (!current) return;

    const action = String(current.dataset.action || "");
    if (action === "gotoHome") Router.navigate("home");
    if (action === "gotoSearch") return;
    if (action === "gotoLibrary") Router.navigate("library");
    if (action === "gotoPlugin") Router.navigate("plugin");
    if (action === "gotoSettings") Router.navigate("settings");
    if (action === "openDetail") this.openDetailFromNode(current);
    if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
    if (action === "openDiscover") {
      Router.navigate("discover");
    }
    if (action === "searchInput") {
      const input = this.container?.querySelector("#searchInput");
      if (input) {
        input.focus();
      }
    }
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }
};
