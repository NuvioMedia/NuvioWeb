import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { ThemeSettings } from "./themeSettings.js";
import { PlaybackSettings } from "./playbackSettings.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../../core/profile/profileSyncService.js";
import { PluginSyncService } from "../../../core/profile/pluginSyncService.js";
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { SavedLibrarySyncService } from "../../../core/profile/savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "../../../core/profile/watchedItemsSyncService.js";
import { WatchProgressSyncService } from "../../../core/profile/watchProgressSyncService.js";
import { AuthManager } from "../../../core/auth/authManager.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";
const STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";

const SECTION_META = [
  { id: "account", label: "Account", subtitle: "Account and sync status." },
  { id: "profiles", label: "Profiles", subtitle: "Manage user profiles for this account." },
  { id: "appearance", label: "Appearance", subtitle: "Choose theme and visual preferences." },
  { id: "layout", label: "Layout", subtitle: "Home layout and navigation behavior." },
  { id: "plugins", label: "Plugins", subtitle: "Manage repositories and plugin runtime." },
  { id: "integration", label: "Integration", subtitle: "Cloud sync and metadata integration." },
  { id: "playback", label: "Playback", subtitle: "Video, audio, and subtitle defaults." },
  { id: "trakt", label: "Trakt", subtitle: "Trakt integration status." },
  { id: "about", label: "About", subtitle: "App information and links." }
];

const RAIL_ITEMS = [
  { id: "home", label: "Home", action: () => Router.navigate("home") },
  { id: "search", label: "Search", action: () => Router.navigate("search") },
  { id: "library", label: "Library", action: () => Router.navigate("library") },
  { id: "plugin", label: "Addons", action: () => Router.navigate("plugin") },
  { id: "settings", label: "Settings", action: () => {} }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function railIconPath(actionId) {
  if (actionId === "home") return "assets/icons/sidebar_home.svg";
  if (actionId === "search") return "assets/icons/sidebar_search.svg";
  if (actionId === "library") return "assets/icons/sidebar_library.svg";
  if (actionId === "plugin") return "assets/icons/sidebar_plugin.svg";
  return "assets/icons/sidebar_settings.svg";
}

export const SettingsScreen = {

  async mount() {
    this.container = document.getElementById("settings");
    ScreenUtils.show(this.container);
    this.activeSection = this.activeSection || "account";
    this.focusZone = this.focusZone || "nav";
    this.railIndex = Number.isFinite(this.railIndex) ? this.railIndex : RAIL_ITEMS.findIndex((item) => item.id === "settings");
    if (this.railIndex < 0) {
      this.railIndex = 0;
    }
    this.navIndex = Number.isFinite(this.navIndex) ? this.navIndex : SECTION_META.findIndex((s) => s.id === this.activeSection);
    if (this.navIndex < 0) {
      this.navIndex = 0;
      this.activeSection = SECTION_META[0].id;
    }
    this.panelIndex = Number.isFinite(this.panelIndex) ? this.panelIndex : 0;
    await this.render();
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons();
    const profiles = await ProfileManager.getProfiles();
    const tmdbSettings = TmdbSettingsStore.get();
    const rotatedDpad = Boolean(LocalStore.get(ROTATED_DPAD_KEY, true));
    const strictDpadGrid = Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true));
    const themeItems = ThemeSettings.getItems();
    const playbackItems = PlaybackSettings.getItems();

    return {
      addons,
      profiles,
      tmdbSettings,
      rotatedDpad,
      strictDpadGrid,
      themeItems,
      playbackItems,
      authState: AuthManager.getAuthState()
    };
  },

  buildSectionItems(sectionId, model) {
    const items = [];

    const addItem = (label, description, action) => {
      const id = `action_${Math.random().toString(36).slice(2, 9)}`;
      this.actionMap.set(id, action);
      items.push({ id, label, description });
    };

    if (sectionId === "account") {
      const signedIn = model.authState === "authenticated";
      addItem(
        signedIn ? "Signed in" : "Not signed in",
        signedIn ? "Account linked on this TV." : "Open QR login to connect account.",
        () => Router.navigate(signedIn ? "account" : "authQrSignIn")
      );
      addItem("Open account screen", "View sync overview and linked status", () => Router.navigate("account"));
      if (signedIn) {
        addItem("Sign out", "Disconnect account from this TV", async () => {
          await AuthManager.signOut();
          Router.navigate("authQrSignIn");
        });
      }
      return items;
    }

    if (sectionId === "profiles") {
      model.profiles.forEach((profile) => {
        addItem(
          `${profile.name}${String(profile.id) === String(ProfileManager.getActiveProfileId()) ? " (Active)" : ""}`,
          profile.isPrimary ? "Primary profile" : "Secondary profile",
          async () => {
            await ProfileManager.setActiveProfile(profile.id);
            await ProfileSyncService.pull();
          }
        );
      });
      addItem("Open profile selection", "Go back to profile chooser", () => Router.navigate("profileSelection"));
      return items;
    }

    if (sectionId === "appearance") {
      model.themeItems.forEach((item) => addItem(item.label, item.description, item.action));
      return items;
    }

    if (sectionId === "layout") {
      addItem("Reset home catalog prefs", "Restore catalog order and visibility", () => {
        HomeCatalogStore.reset();
      });
      addItem(
        `Remote D-Pad mapping: ${model.rotatedDpad ? "Rotated" : "Standard"}`,
        "Switch if arrows feel swapped on your TV",
        () => {
          LocalStore.set(ROTATED_DPAD_KEY, !Boolean(LocalStore.get(ROTATED_DPAD_KEY, true)));
        }
      );
      addItem(
        `Remote grid navigation: ${model.strictDpadGrid ? "Strict" : "Flexible"}`,
        "Strict matches Android-style row/column navigation",
        () => {
          LocalStore.set(STRICT_DPAD_GRID_KEY, !Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true)));
        }
      );
      return items;
    }

    if (sectionId === "plugins") {
      addItem("Open plugins manager", "Manage plugin runtime and repositories", () => Router.navigate("plugin"));
      addItem("Sync pull plugins", "Download plugin repositories from cloud", () => PluginSyncService.pull());
      addItem("Sync push plugins", "Upload local plugin repositories to cloud", () => PluginSyncService.push());
      return items;
    }

    if (sectionId === "integration") {
      addItem(
        `TMDB enrichment: ${model.tmdbSettings.enabled ? "ON" : "OFF"}`,
        "Enable TMDB metadata enrichment",
        () => TmdbSettingsStore.set({ enabled: !TmdbSettingsStore.get().enabled })
      );
      addItem(
        `TMDB artwork: ${model.tmdbSettings.useArtwork ? "ON" : "OFF"}`,
        "Use poster/logo/backdrop from TMDB",
        () => TmdbSettingsStore.set({ useArtwork: !TmdbSettingsStore.get().useArtwork })
      );
      addItem("Set TMDB API key", model.tmdbSettings.apiKey ? "TMDB key configured" : "No TMDB key configured", () => {
        const value = window.prompt("Insert TMDB API key", TmdbSettingsStore.get().apiKey || "");
        if (value !== null) {
          TmdbSettingsStore.set({ apiKey: String(value).trim() });
        }
      });
      addItem("Sync pull all", "Download profiles/plugins/addons/library/progress", async () => {
        await ProfileSyncService.pull();
        await PluginSyncService.pull();
        await LibrarySyncService.pull();
        await SavedLibrarySyncService.pull();
        await WatchedItemsSyncService.pull();
        await WatchProgressSyncService.pull();
      });
      addItem("Sync push all", "Upload profiles/plugins/addons/library/progress", async () => {
        await ProfileSyncService.push();
        await PluginSyncService.push();
        await LibrarySyncService.push();
        await SavedLibrarySyncService.push();
        await WatchedItemsSyncService.push();
        await WatchProgressSyncService.push();
      });
      return items;
    }

    if (sectionId === "playback") {
      model.playbackItems.forEach((item) => addItem(item.label, item.description, item.action));
      return items;
    }

    if (sectionId === "trakt") {
      addItem("Open account", "Manage Trakt from account section", () => Router.navigate("account"));
      return items;
    }

    if (sectionId === "about") {
      addItem("Nuvio webOS build", "Full webOS mode (Android parity migration)", () => {});
      addItem("Privacy policy", "Open privacy page", () => {
        window.open?.("https://nuvioapp.space/privacy", "_blank");
      });
      return items;
    }

    return items;
  },

  async render() {
    this.model = await this.collectModel();
    this.actionMap = new Map();

    const section = SECTION_META.find((item) => item.id === this.activeSection) || SECTION_META[0];
    const panelItems = this.buildSectionItems(section.id, this.model);
    this.panelIndex = clamp(this.panelIndex, 0, Math.max(panelItems.length - 1, 0));
    this.navIndex = clamp(this.navIndex, 0, SECTION_META.length - 1);

    const navHtml = SECTION_META.map((item, index) => `
      <button class="settings-nav-item focusable${this.activeSection === item.id ? " selected" : ""}"
              data-zone="nav"
              data-nav-index="${index}"
              data-section="${item.id}">
        <span class="settings-nav-label">${item.label}</span>
        <span class="settings-nav-chevron">›</span>
      </button>
    `).join("");

    const panelHtml = panelItems.length
      ? panelItems.map((item, index) => `
          <button class="settings-panel-item focusable"
                  data-zone="panel"
                  data-panel-index="${index}"
                  data-action-id="${item.id}">
            <span class="settings-panel-title">${item.label}</span>
            <span class="settings-panel-subtitle">${item.description || ""}</span>
            <span class="settings-panel-chevron">›</span>
          </button>
        `).join("")
      : `<div class="settings-panel-empty">No options in this section.</div>`;

    const railHtml = RAIL_ITEMS.map((item, index) => `
      <button class="settings-rail-item focusable${item.id === "settings" ? " selected" : ""}"
              data-zone="rail"
              data-rail-index="${index}"
              data-rail-action="${item.id}">
        <img class="settings-rail-icon" src="${railIconPath(item.id)}" alt="" aria-hidden="true" />
      </button>
    `).join("");

    this.container.innerHTML = `
      <div class="settings-shell">
        <aside class="settings-rail">
          ${railHtml}
        </aside>
        <aside class="settings-sidebar">
          ${navHtml}
        </aside>
        <section class="settings-content">
          <h2 class="settings-title">${section.label}</h2>
          <p class="settings-subtitle">${section.subtitle}</p>
          <div class="settings-panel">
            ${panelHtml}
          </div>
        </section>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyFocus();
  },

  applyFocus() {
    const current = this.container.querySelector(".focusable.focused");
    current?.classList.remove("focused");

    if (this.focusZone === "panel") {
      const panel = Array.from(this.container.querySelectorAll('.settings-panel-item.focusable'));
      const target = panel[this.panelIndex] || panel[0];
      if (target) {
        target.classList.add("focused");
        target.focus();
        return;
      }
      this.focusZone = "nav";
    }

    if (this.focusZone === "rail") {
      const rail = Array.from(this.container.querySelectorAll('.settings-rail-item.focusable'));
      const target = rail[this.railIndex] || rail[0];
      if (target) {
        target.classList.add("focused");
        target.focus();
        return;
      }
      this.focusZone = "nav";
    }

    const nav = Array.from(this.container.querySelectorAll('.settings-nav-item.focusable'));
    const target = nav[this.navIndex] || nav[0];
    if (target) {
      target.classList.add("focused");
      target.focus();
    }
  },

  async moveNav(delta) {
    const next = clamp(this.navIndex + delta, 0, SECTION_META.length - 1);
    if (next === this.navIndex) {
      return;
    }
    this.navIndex = next;
    this.activeSection = SECTION_META[next].id;
    this.panelIndex = 0;
    await this.render();
  },

  movePanel(delta) {
    const panel = Array.from(this.container.querySelectorAll('.settings-panel-item.focusable'));
    if (!panel.length) {
      return;
    }
    this.panelIndex = clamp(this.panelIndex + delta, 0, panel.length - 1);
    this.applyFocus();
  },

  moveRail(delta) {
    this.railIndex = clamp(this.railIndex + delta, 0, RAIL_ITEMS.length - 1);
    this.applyFocus();
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }

      if (this.focusZone === "rail") {
        if (code === 38) {
          this.moveRail(-1);
          return;
        }
        if (code === 40) {
          this.moveRail(1);
          return;
        }
        if (code === 39) {
          this.focusZone = "nav";
          this.applyFocus();
          return;
        }
      } else if (this.focusZone === "nav") {
        if (code === 38) {
          await this.moveNav(-1);
          return;
        }
        if (code === 40) {
          await this.moveNav(1);
          return;
        }
        if (code === 39) {
          const panel = this.container.querySelectorAll('.settings-panel-item.focusable');
          if (panel.length) {
            this.focusZone = "panel";
            this.panelIndex = clamp(this.panelIndex, 0, panel.length - 1);
            this.applyFocus();
          }
          return;
        }
        if (code === 37) {
          this.focusZone = "rail";
          this.applyFocus();
          return;
        }
      } else {
        if (code === 38) {
          this.movePanel(-1);
          return;
        }
        if (code === 40) {
          this.movePanel(1);
          return;
        }
        if (code === 37) {
          this.focusZone = "nav";
          this.applyFocus();
          return;
        }
      }
      return;
    }

    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector('.focusable.focused');
    if (!current) {
      return;
    }

    const zone = String(current.dataset.zone || "");

    if (zone === "rail") {
      const actionId = String(current.dataset.railAction || "");
      const action = RAIL_ITEMS.find((item) => item.id === actionId)?.action;
      if (action) {
        await action();
      }
      return;
    }

    if (zone === "nav") {
      const section = current.dataset.section;
      const index = Number(current.dataset.navIndex || 0);
      if (section && this.activeSection !== section) {
        this.activeSection = section;
        this.navIndex = clamp(index, 0, SECTION_META.length - 1);
        this.panelIndex = 0;
        await this.render();
      }
      return;
    }

    const actionId = current.dataset.actionId;
    const action = this.actionMap.get(actionId);
    if (!action) {
      return;
    }

    await action();
    if (Router.getCurrent() === "settings") {
      await this.render();
      this.focusZone = "panel";
      this.applyFocus();
    }
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }

};
