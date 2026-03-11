import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { Environment } from "../../../platform/environment.js";

function profileInitial(name) {
  const raw = String(name || "").trim();
  return raw ? raw.charAt(0).toUpperCase() : "P";
}

function navIconSvg(action) {
  const iconAssetByAction = {
    gotoHome: "assets/icons/sidebar_home.svg",
    gotoSearch: "assets/icons/sidebar_search.svg",
    gotoLibrary: "assets/icons/sidebar_library.svg",
    gotoPlugin: "assets/icons/sidebar_plugin.svg",
    gotoSettings: "assets/icons/sidebar_settings.svg"
  };
  return `<img class="home-nav-icon" src="${iconAssetByAction[action] || iconAssetByAction.gotoLibrary}" alt="" aria-hidden="true" />`;
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

export const LibraryScreen = {

  async mount() {
    this.container = document.getElementById("library");
    ScreenUtils.show(this.container);
    this.selectedType = this.selectedType || "all";

    const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === activeProfileId)
      || profiles[0]
      || null;
    this.activeProfileName = String(activeProfile?.name || "Profile").trim() || "Profile";
    this.activeProfileInitial = profileInitial(this.activeProfileName);

    this.renderLoading();
    await this.loadData();
    this.render();
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="library-shell">
        <div class="library-loading">Loading library...</div>
      </div>
    `;
  },

  async loadData() {
    const [savedItems, progressItems] = await Promise.all([
      savedLibraryRepository.getAll(120),
      watchProgressRepository.getRecent(80)
    ]);

    this.savedItems = savedItems || [];
    this.progressItems = progressItems || [];

    const ids = new Map();
    this.savedItems.forEach((item) => {
      ids.set(`${item.contentType || "movie"}::${item.contentId}`, {
        contentId: item.contentId,
        contentType: item.contentType || "movie"
      });
    });
    this.progressItems.forEach((item) => {
      ids.set(`${item.contentType || "movie"}::${item.contentId}`, {
        contentId: item.contentId,
        contentType: item.contentType || "movie"
      });
    });

    const metaEntries = await Promise.all(Array.from(ids.values()).map(async (entry) => {
      const result = await withTimeout(
        metaRepository.getMetaFromAllAddons(entry.contentType, entry.contentId),
        2200,
        { status: "error", message: "timeout" }
      );
      if (result?.status === "success" && result?.data) {
        return [entry.contentId, {
          title: result.data.name || entry.contentId,
          poster: result.data.poster || result.data.background || "",
          type: result.data.type || entry.contentType
        }];
      }
      return [entry.contentId, { title: entry.contentId, poster: "", type: entry.contentType }];
    }));
    this.metaMap = new Map(metaEntries);
  },

  typeAllowed(type) {
    if (this.selectedType === "all") return true;
    return String(type || "").toLowerCase() === this.selectedType;
  },

  filteredSaved() {
    return (this.savedItems || []).filter((item) => this.typeAllowed(item.contentType || "movie"));
  },

  filteredProgress() {
    return (this.progressItems || []).filter((item) => this.typeAllowed(item.contentType || "movie"));
  },

  renderSavedCards() {
    const items = this.filteredSaved();
    if (!items.length) {
      return `<p class="home-empty">No saved items.</p>`;
    }
    return `
      <div class="home-track">
        ${items.map((item) => {
          const meta = this.metaMap?.get?.(item.contentId) || {};
          return `
            <article class="home-content-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.contentId}"
                     data-item-type="${item.contentType || "movie"}"
                     data-item-title="${meta.title || item.contentId}">
              ${meta.poster ? `<img class="content-poster" src="${meta.poster}" alt="${meta.title || item.contentId}" />` : `<div class="content-poster placeholder"></div>`}
            </article>
          `;
        }).join("")}
      </div>
    `;
  },

  renderProgressCards() {
    const items = this.filteredProgress();
    if (!items.length) {
      return `<p class="home-empty">No continue watching items.</p>`;
    }
    return `
      <div class="home-track">
        ${items.map((item) => {
          const meta = this.metaMap?.get?.(item.contentId) || {};
          const positionMin = Math.floor(Number(item.positionMs || 0) / 60000);
          const durationMin = Math.floor(Number(item.durationMs || 0) / 60000);
          const remaining = Math.max(0, durationMin - positionMin);
          const progress = durationMin > 0 ? Math.max(0, Math.min(1, positionMin / durationMin)) : 0;
          return `
            <article class="home-content-card home-progress-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.contentId}"
                     data-item-type="${item.contentType || "movie"}"
                     data-item-title="${meta.title || item.contentId}">
              <div class="home-progress-poster"${meta.poster ? ` style="background-image:url('${meta.poster}')"` : ""}>
                <span class="home-progress-left">${durationMin > 0 ? `${remaining}m left` : "Continue"}</span>
              </div>
              <div class="home-progress-meta">
                <div class="home-content-title">${meta.title || item.contentId}</div>
                <div class="home-content-type">${positionMin}m / ${durationMin || "?"}m</div>
                <div class="home-progress-track">
                  <div class="home-progress-fill" style="width:${Math.round(progress * 100)}%"></div>
                </div>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  },

  render() {
    this.container.innerHTML = `
      <div class="home-shell library-shell">
        <aside class="home-sidebar expanded">
          <div class="home-brand-wrap">
            <img src="assets/brand/app_logo_wordmark.png" class="home-brand-logo-main" alt="Nuvio" />
          </div>
          <div class="home-nav-list">
            <button class="home-nav-item focusable" data-action="gotoHome"><span class="home-nav-icon-wrap">${navIconSvg("gotoHome")}</span><span class="home-nav-label">Home</span></button>
            <button class="home-nav-item focusable" data-action="gotoSearch"><span class="home-nav-icon-wrap">${navIconSvg("gotoSearch")}</span><span class="home-nav-label">Search</span></button>
            <button class="home-nav-item focusable" data-action="gotoLibrary"><span class="home-nav-icon-wrap">${navIconSvg("gotoLibrary")}</span><span class="home-nav-label">Library</span></button>
            <button class="home-nav-item focusable" data-action="gotoPlugin"><span class="home-nav-icon-wrap">${navIconSvg("gotoPlugin")}</span><span class="home-nav-label">Addons</span></button>
            <button class="home-nav-item focusable" data-action="gotoSettings"><span class="home-nav-icon-wrap">${navIconSvg("gotoSettings")}</span><span class="home-nav-label">Settings</span></button>
          </div>
          <button class="home-profile-pill focusable" data-action="gotoAccount">
            <span class="home-profile-avatar">${this.activeProfileInitial || "P"}</span>
            <span class="home-profile-name">${this.activeProfileName || "Profile"}</span>
          </button>
        </aside>

        <main class="home-main library-main">
          <section class="library-topbar">
            <h2 class="library-title">Library</h2>
            <div class="library-type-tabs">
              <button class="library-type-tab focusable${this.selectedType === "all" ? " selected" : ""}" data-action="setType" data-type="all">All</button>
              <button class="library-type-tab focusable${this.selectedType === "movie" ? " selected" : ""}" data-action="setType" data-type="movie">Movie</button>
              <button class="library-type-tab focusable${this.selectedType === "series" ? " selected" : ""}" data-action="setType" data-type="series">Series</button>
            </div>
          </section>

          <section class="home-row">
            <h3 class="home-row-title">Continue Watching</h3>
            ${this.renderProgressCards()}
          </section>

          <section class="home-row">
            <h3 class="home-row-title">Saved</h3>
            ${this.renderSavedCards()}
          </section>
        </main>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container, ".library-type-tabs .focusable");
  },

  onKeyDown(event) {
    if (Environment.isBackEvent(event)) {
      event?.preventDefault?.();
      Router.navigate("home");
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
    if (action === "gotoSearch") Router.navigate("search");
    if (action === "gotoLibrary") return;
    if (action === "gotoPlugin") Router.navigate("plugin");
    if (action === "gotoSettings") Router.navigate("settings");
    if (action === "gotoAccount") Router.navigate("profileSelection");
    if (action === "openDetail") {
      Router.navigate("detail", {
        itemId: current.dataset.itemId,
        itemType: current.dataset.itemType || "movie",
        fallbackTitle: current.dataset.itemTitle || "Untitled"
      });
    }
    if (action === "setType") {
      const nextType = String(current.dataset.type || "all");
      if (nextType !== this.selectedType) {
        this.selectedType = nextType;
        this.render();
      }
    }
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }
};
