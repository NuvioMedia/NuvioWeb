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

function isSearchOnlyCatalog(catalog) {
  return (catalog.extra || []).some((extra) => extra.name === "search" && extra.isRequired);
}

function catalogKey(catalog) {
  return `${catalog.addonId}|${catalog.type}|${catalog.catalogId}|${catalog.catalogName}`;
}

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatCatalogRowTitle(catalogName, addonName, type) {
  const typeLabel = toTitleCase(type || "movie") || "Movie";
  let base = String(catalogName || "").trim();
  if (!base) {
    return typeLabel;
  }
  const addon = String(addonName || "").trim();
  const cleanedAddon = addon.replace(/\baddon\b/i, "").trim();
  const cleanupTerms = [
    addon,
    cleanedAddon,
    "The Movie Database Addon",
    "TMDB Addon",
    "Addon"
  ].filter(Boolean);
  cleanupTerms.forEach((term) => {
    const regex = new RegExp(`\\s*-?\\s*${escapeRegExp(term)}\\s*`, "ig");
    base = base.replace(regex, " ");
  });
  base = base.replace(/\s{2,}/g, " ").trim();
  if (!base) {
    return typeLabel;
  }
  const endsWithType = new RegExp(`\\b${escapeRegExp(typeLabel)}$`, "i").test(base);
  if (endsWithType) {
    return base;
  }
  return `${base} - ${typeLabel}`;
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

function profileInitial(name) {
  const raw = String(name || "").trim();
  const first = raw.charAt(0);
  return first ? first.toUpperCase() : "P";
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

function navIconSvg(action) {
  const iconByAction = {
    gotoHome: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
    gotoSearch: "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8L20 22l2-2-6.5-6.5zM6.5 11A4.5 4.5 0 1 1 11 15.5 4.5 4.5 0 0 1 6.5 11z",
    gotoLibrary: "M5 4h14a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V6a2 2 0 0 1 2-2z",
    gotoPlugin: "M19 11h-1V9a2 2 0 0 0-2-2h-2V5a2 2 0 0 0-4 0v2H8a2 2 0 0 0-2 2v2H5a2 2 0 0 0 0 4h1v2a2 2 0 0 0 2 2h2v1a2 2 0 0 0 4 0v-1h2a2 2 0 0 0 2-2v-2h1a2 2 0 0 0 0-4z",
    gotoSettings: "M19.1 12.9c.1-.3.1-.6.1-.9s0-.6-.1-.9l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7 7 0 0 0-1.6-.9l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7 7 0 0 0-1.6.9l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6l2.1 1.6c-.1.3-.1.6-.1.9s0 .6.1.9L2.3 14.5a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1c.5.4 1 .7 1.6.9l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6c.6-.2 1.1-.5 1.6-.9l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6l-2.1-1.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z",
    gotoAccount: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2-8 4.5V21h16v-2.5C20 16 16.4 14 12 14z",
    toggleLayout: "M3 5h8v6H3zm10 0h8v6h-8zM3 13h8v6H3zm10 0h8v6h-8z"
  };
  const path = iconByAction[action] || iconByAction.gotoHome;
  return `
    <svg viewBox="0 0 24 24" class="home-nav-icon" aria-hidden="true" focusable="false">
      <path d="${path}" fill="currentColor"></path>
    </svg>
  `;
}

export const HomeScreen = {
  stopHeroRotation() {
    if (this.heroRotateTimer) {
      clearInterval(this.heroRotateTimer);
      this.heroRotateTimer = null;
    }
  },

  startHeroRotation() {
    this.stopHeroRotation();
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    this.heroRotateTimer = setInterval(() => {
      this.rotateHero();
    }, 9000);
  },

  rotateHero() {
    if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
      return;
    }
    this.heroIndex = (Number(this.heroIndex) + 1) % this.heroCandidates.length;
    this.heroItem = this.heroCandidates[this.heroIndex];
    this.applyHeroToDom();
  },

  applyHeroToDom() {
    const heroNode = this.container?.querySelector(".home-hero-card");
    if (!heroNode) {
      return;
    }
    const hero = this.heroItem || this.heroCandidates?.[0] || null;
    heroNode.dataset.itemId = hero?.id || "";
    heroNode.dataset.itemType = hero?.type || "movie";
    heroNode.dataset.itemTitle = hero?.name || "Untitled";

    const title = heroNode.querySelector(".home-hero-title");
    if (title) {
      title.textContent = hero?.name || "No featured item";
    }
    const description = heroNode.querySelector(".home-hero-description");
    if (description) {
      description.textContent = hero?.description || "";
    }

    const desiredImage = hero?.background || hero?.poster || "";
    let backdrop = heroNode.querySelector(".featured-backdrop");
    if (desiredImage) {
      if (!backdrop) {
        backdrop = document.createElement("img");
        backdrop.className = "featured-backdrop";
        backdrop.alt = hero?.name || "featured";
        heroNode.insertBefore(backdrop, heroNode.firstChild);
      }
      backdrop.src = desiredImage;
      backdrop.alt = hero?.name || "featured";
    } else {
      backdrop?.remove();
    }
  },

  setSidebarExpanded(expanded) {
    const sidebar = this.container?.querySelector(".home-sidebar");
    if (!sidebar) {
      return;
    }
    sidebar.classList.toggle("expanded", Boolean(expanded));
  },

  isSidebarNode(node) {
    return String(node?.dataset?.navZone || "") === "sidebar";
  },

  isMainNode(node) {
    return String(node?.dataset?.navZone || "") === "main";
  },

  focusWithoutAutoScroll(target) {
    if (!target || typeof target.focus !== "function") {
      return;
    }
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
  },

  ensureMainVerticalVisibility(target) {
    const main = this.container?.querySelector(".home-main");
    if (!main || !target || !main.contains(target)) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const pad = 14;
    if (rect.bottom > mainRect.bottom - pad) {
      main.scrollTop += Math.ceil(rect.bottom - mainRect.bottom + pad);
    } else if (rect.top < mainRect.top + pad) {
      main.scrollTop -= Math.ceil(mainRect.top + pad - rect.top);
    }
  },

  ensureTrackHorizontalVisibility(target, direction = null) {
    const track = target?.closest?.(".home-track");
    if (!track) {
      return;
    }
    const targetLeft = target.offsetLeft;
    const targetRight = targetLeft + target.offsetWidth;
    const viewLeft = track.scrollLeft;
    const viewRight = viewLeft + track.clientWidth;
    const step = target.offsetWidth + 18;

    if (targetRight > viewRight) {
      const overshoot = targetRight - viewRight;
      const delta = direction === "right"
        ? Math.max(step, overshoot)
        : overshoot;
      track.scrollLeft = Math.min(track.scrollWidth - track.clientWidth, viewLeft + delta);
      return;
    }

    if (targetLeft < viewLeft) {
      const overshoot = viewLeft - targetLeft;
      const delta = direction === "left"
        ? Math.max(step, overshoot)
        : overshoot;
      track.scrollLeft = Math.max(0, viewLeft - delta);
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
      this.ensureTrackHorizontalVisibility(target, direction);
      this.ensureMainVerticalVisibility(target);
    }
    return true;
  },

  buildNavigationModel() {
    const sidebar = Array.from(this.container?.querySelectorAll(".home-sidebar .focusable") || []);
    const rows = [];

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

    sidebar.forEach((node, index) => {
      node.dataset.navZone = "sidebar";
      node.dataset.navIndex = String(index);
    });

    rows.forEach((rowNodes, rowIndex) => {
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navZone = "main";
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
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
        const target = (this.lastMainFocus && this.isMainNode(this.lastMainFocus))
          ? this.lastMainFocus
          : (nav.rows[0]?.[0] || null);
        return this.focusNode(current, target, direction) || true;
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
      const sidebarFallback = nav.sidebar[Math.min(row, nav.sidebar.length - 1)] || nav.sidebar[0] || null;
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
      const target = targetRowNodes[Math.min(col, targetRowNodes.length - 1)] || targetRowNodes[0];
      return this.focusNode(current, target, direction) || true;
    }

    return false;
  },

  async mount() {
    this.container = document.getElementById("home");
    ScreenUtils.show(this.container);
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

  async loadData(options = {}) {
    const background = Boolean(options?.background);
    const token = this.homeLoadToken;
    const prefs = LayoutPreferences.get();
    this.layoutMode = prefs.homeLayout || "classic";

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
      title: prettyId(item.contentId),
      poster: null
    }));
    this.heroCandidates = this.collectHeroCandidates(this.rows);
    this.heroIndex = 0;
    this.heroItem = this.heroCandidates[0] || this.pickHeroItem(this.rows);
    this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === this.loadedProfileId)
      || profiles[0]
      || null;
    this.activeProfileName = String(activeProfile?.name || "Profile").trim() || "Profile";
    this.activeProfileInitial = profileInitial(this.activeProfileName);
    this.hasLoadedOnce = true;
    this.render();

    // Load secondary rows in background and append when ready.
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
        this.heroCandidates = this.collectHeroCandidates(this.rows);
        this.render();
      }).catch((error) => {
        console.warn("Deferred home rows load failed", error);
      });
    }

    // Hero enrichment in background (no blocking).
    this.enrichHero(this.heroCandidates[0] || null).then(() => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.applyHeroToDom();
    }).catch((error) => {
      console.warn("Hero async enrichment failed", error);
    });

    this.enrichContinueWatching(this.continueWatching).then((enriched) => {
      if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
        return;
      }
      this.continueWatchingDisplay = enriched;
      this.render();
    }).catch((error) => {
      console.warn("Continue watching async enrichment failed", error);
    });
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
        homeCatalogKey: catalogKey(row)
      }));
  },

  sortAndFilterRows(rows = []) {
    const allKeys = rows.map((row) => row.homeCatalogKey);
    const orderedKeys = HomeCatalogStore.ensureOrderKeys(allKeys);
    const enabledRows = rows.filter((row) => !HomeCatalogStore.isDisabled(row.homeCatalogKey));
    const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
    enabledRows.sort((left, right) => {
      const l = orderIndex.has(left.homeCatalogKey) ? orderIndex.get(left.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
      const r = orderIndex.has(right.homeCatalogKey) ? orderIndex.get(right.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
      return l - r;
    });
    return enabledRows;
  },

  render() {
    const heroItem = this.heroItem || this.heroCandidates?.[this.heroIndex] || this.pickHeroItem(this.rows);
    const progressHtml = this.renderContinueWatching(this.continueWatchingDisplay || []);

    this.container.innerHTML = `
      <div class="home-shell home-enter">
        <aside class="home-sidebar">
          <div class="home-brand-wrap">
            <img src="assets/brand/app_logo_wordmark.png" class="home-brand-logo-main" alt="Nuvio" />
          </div>
          <div class="home-nav-list">
            <button class="home-nav-item focusable" data-action="gotoHome" aria-label="Home"><span class="home-nav-icon-wrap">${navIconSvg("gotoHome")}</span><span class="home-nav-label">Home</span></button>
            <button class="home-nav-item focusable" data-action="gotoSearch" aria-label="Search"><span class="home-nav-icon-wrap">${navIconSvg("gotoSearch")}</span><span class="home-nav-label">Search</span></button>
            <button class="home-nav-item focusable" data-action="gotoLibrary" aria-label="Library"><span class="home-nav-icon-wrap">${navIconSvg("gotoLibrary")}</span><span class="home-nav-label">Library</span></button>
            <button class="home-nav-item focusable" data-action="gotoPlugin" aria-label="Addons"><span class="home-nav-icon-wrap">${navIconSvg("gotoPlugin")}</span><span class="home-nav-label">Addons</span></button>
            <button class="home-nav-item focusable" data-action="gotoSettings" aria-label="Settings"><span class="home-nav-icon-wrap">${navIconSvg("gotoSettings")}</span><span class="home-nav-label">Settings</span></button>
          </div>
          <button class="home-profile-pill focusable" data-action="gotoAccount" aria-label="Account">
            <span class="home-profile-avatar">${this.activeProfileInitial || "P"}</span>
            <span class="home-profile-name">${this.activeProfileName || "Profile"}</span>
          </button>
        </aside>

        <main class="home-main">
          <section class="home-hero">
            <div class="home-hero-card focusable"
                data-action="openDetail"
                data-item-id="${heroItem?.id || ""}"
                data-item-type="${heroItem?.type || "movie"}"
                data-item-title="${heroItem?.name || "Untitled"}">
              ${heroItem?.background ? `<img class="featured-backdrop" src="${heroItem.background}" alt="${heroItem?.name || "featured"}" />` : ""}
              <div class="home-hero-title">${heroItem?.name || "No featured item"}</div>
              <div class="home-hero-description">${heroItem?.description || ""}</div>
            </div>
          </section>

          ${progressHtml}

          <section class="home-catalogs" id="homeCatalogRows"></section>
        </main>
      </div>
    `;

    const rowsContainer = this.container.querySelector("#homeCatalogRows");
    if (rowsContainer) {
      this.catalogSeeAllMap = new Map();
      this.rows.forEach((rowData) => {
        const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
        this.catalogSeeAllMap.set(seeAllId, {
          addonBaseUrl: rowData.addonBaseUrl || "",
          addonId: rowData.addonId || "",
          addonName: rowData.addonName || "",
          catalogId: rowData.catalogId || "",
          catalogName: rowData.catalogName || "",
          type: rowData.type || "movie",
          initialItems: Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : []
        });
        const section = document.createElement("section");
        section.className = "home-row home-row-enter";
        section.style.animationDelay = `${Math.min(460, (rowsContainer.children.length + 1) * 42)}ms`;
        section.innerHTML = `
          <div class="home-row-head">
            <h3 class="home-row-title">${formatCatalogRowTitle(rowData.catalogName, rowData.addonName, rowData.type)}</h3>
          </div>
        `;

        const track = document.createElement("div");
        track.className = "home-track";

        rowData.result.data.items.slice(0, this.layoutMode === "grid" ? 12 : 16).forEach((item) => {
          const card = document.createElement("article");
          card.className = "home-content-card focusable";
          card.dataset.action = "openDetail";
          card.dataset.itemId = item.id;
          card.dataset.itemType = rowData.type;
          card.dataset.itemTitle = item.name;
          card.innerHTML = `
            ${item.poster ? `<img class="content-poster" src="${item.poster}" alt="${item.name || "content"}" />` : `<div class="content-poster placeholder"></div>`}
          `;
          card.addEventListener("click", () => {
            this.openDetailFromNode(card);
          });
          track.appendChild(card);
        });

        const seeAllCard = document.createElement("article");
        seeAllCard.className = "home-content-card home-seeall-card focusable";
        seeAllCard.dataset.action = "openCatalogSeeAll";
        seeAllCard.dataset.seeAllId = seeAllId;
        seeAllCard.dataset.addonBaseUrl = rowData.addonBaseUrl || "";
        seeAllCard.dataset.addonId = rowData.addonId || "";
        seeAllCard.dataset.addonName = rowData.addonName || "";
        seeAllCard.dataset.catalogId = rowData.catalogId || "";
        seeAllCard.dataset.catalogName = rowData.catalogName || "";
        seeAllCard.dataset.catalogType = rowData.type || "";
        seeAllCard.innerHTML = `
          <div class="home-seeall-card-inner">
            <div class="home-seeall-arrow" aria-hidden="true">&#8594;</div>
            <div class="home-seeall-label">See All</div>
          </div>
        `;
        seeAllCard.addEventListener("click", () => {
          this.openCatalogSeeAllFromNode(seeAllCard);
        });
        track.appendChild(seeAllCard);

        section.appendChild(track);
        rowsContainer.appendChild(section);
      });
    }

    this.container.querySelectorAll(".home-sidebar .focusable").forEach((item) => {
      item.addEventListener("focus", () => {
        this.setSidebarExpanded(true);
      });
      item.addEventListener("click", () => {
        const action = item.dataset.action;
        if (action === "gotoHome") return;
        if (action === "gotoLibrary") Router.navigate("library");
        if (action === "gotoSearch") Router.navigate("search");
        if (action === "gotoPlugin") Router.navigate("plugin");
        if (action === "gotoSettings") Router.navigate("settings");
        if (action === "gotoAccount") Router.navigate("profileSelection");
      });
    });

    ScreenUtils.indexFocusables(this.container);
    this.buildNavigationModel();
    ScreenUtils.setInitialFocus(this.container, ".home-main .focusable");
    const current = this.container.querySelector(".home-main .focusable.focused");
    if (current && this.isMainNode(current)) {
      this.lastMainFocus = current;
    }
    this.setSidebarExpanded(false);
    this.startHeroRotation();
  },

  renderContinueWatching(items) {
    if (!items.length) {
      return `
        <section class="home-row">
          <h3 class="home-row-title">Continue Watching</h3>
          <p class="home-empty">No saved progress yet.</p>
        </section>
      `;
    }

    const cards = items.map((item) => {
      const positionMs = Number(item.positionMs || 0);
      const durationMs = Number(item.durationMs || 0);
      const positionMin = Math.floor(positionMs / 60000);
      const durationMin = Math.floor(durationMs / 60000);
      const remaining = Math.max(0, durationMin - positionMin);
      const hasDuration = durationMs > 0;
      const progress = hasDuration ? Math.max(0, Math.min(1, positionMs / durationMs)) : 0;
      const leftText = hasDuration ? `${remaining}m left` : "Continue";
      const progressText = hasDuration ? `${positionMin}m / ${durationMin || "?"}m` : `${positionMin}m watched`;
      return `
        <article class="home-content-card home-progress-card focusable" data-action="resumeProgress"
             data-item-id="${item.contentId}"
             data-item-type="${item.contentType || "movie"}"
             data-item-title="${item.title || prettyId(item.contentId)}">
          <div class="home-progress-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}>
            <span class="home-progress-left">${leftText}</span>
          </div>
          <div class="home-progress-meta">
            <div class="home-content-title">${item.title || prettyId(item.contentId)}</div>
            <div class="home-content-type">${progressText}</div>
            <div class="home-progress-track">
              <div class="home-progress-fill" style="width:${Math.round(progress * 100)}%"></div>
            </div>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="home-row">
        <h3 class="home-row-title">Continue Watching</h3>
        <div class="home-track">${cards}</div>
      </section>
    `;
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
            poster: result.data.poster || result.data.background || null
          };
        }
      } catch (error) {
        console.warn("Continue watching enrichment failed", error);
      }
      return {
        ...item,
        title: prettyId(item.contentId),
        poster: null
      };
    }));
    return enriched;
  },

  pickHeroItem(rows) {
    for (const row of rows) {
      const first = row.result?.data?.items?.[0];
      if (first) {
        return first;
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
    const hero = baseHero || this.pickHeroItem(this.rows);
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

      this.heroItem = {
        ...hero,
        name: settings.useBasicInfo ? (enriched.localizedTitle || hero.name) : hero.name,
        description: settings.useBasicInfo ? (enriched.description || hero.description) : hero.description,
        background: settings.useArtwork ? (enriched.backdrop || hero.background) : hero.background,
        poster: settings.useArtwork ? (enriched.poster || hero.poster) : hero.poster,
        logo: settings.useArtwork ? (enriched.logo || hero.logo) : hero.logo
      };
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
    if (this.handleHomeDpad(event)) {
      return;
    }
    if (event.keyCode === 76) {
      this.layoutMode = this.layoutMode === "grid" ? "classic" : "grid";
      LayoutPreferences.set({ homeLayout: this.layoutMode });
      this.render();
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
    if (action === "gotoHome") return;
    if (action === "gotoLibrary") Router.navigate("library");
    if (action === "gotoSearch") Router.navigate("search");
    if (action === "gotoPlugin") Router.navigate("plugin");
    if (action === "gotoSettings") Router.navigate("settings");
    if (action === "gotoAccount") Router.navigate("profileSelection");
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
    this.homeLoadToken = (this.homeLoadToken || 0) + 1;
    this.stopHeroRotation();
    ScreenUtils.hide(this.container);
  }

};
