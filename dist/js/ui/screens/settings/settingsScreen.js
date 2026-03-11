import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { SessionStore } from "../../../core/storage/sessionStore.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { HomeCatalogStore } from "../../../data/local/homeCatalogStore.js";
import { ThemeStore } from "../../../data/local/themeStore.js";
import { ThemeManager } from "../../theme/themeManager.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { MdbListSettingsStore } from "../../../data/local/mdbListSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../../data/local/animeSkipSettingsStore.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../../core/profile/profileSyncService.js";
import { PluginSyncService } from "../../../core/profile/pluginSyncService.js";
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { SavedLibrarySyncService } from "../../../core/profile/savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "../../../core/profile/watchedItemsSyncService.js";
import { WatchProgressSyncService } from "../../../core/profile/watchProgressSyncService.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { Platform } from "../../../platform/index.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";
const STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";
const SETTINGS_UI_STATE_KEY = "settingsScreenUiState";
const SETTINGS_VERSION_LABEL = "0.1.0-web";
const PRIVACY_URL = "https://tapframe.github.io/NuvioStreaming/#privacy-policy";
const SUPPORTERS_URL = "https://github.com/Tapframe/NuvioStreaming";

const THEME_OPTIONS = [
  { id: "WHITE", label: "White", color: "#f5f5f5" },
  { id: "CRIMSON", label: "Crimson", color: "#e53935" },
  { id: "OCEAN", label: "Ocean", color: "#1e88e5" },
  { id: "VIOLET", label: "Violet", color: "#8e24aa" },
  { id: "EMERALD", label: "Emerald", color: "#43a047" },
  { id: "AMBER", label: "Amber", color: "#fb8c00" },
  { id: "ROSE", label: "Rose", color: "#d81b60" }
];

const FONT_OPTIONS = [
  { id: "INTER", label: "Inter" },
  { id: "DM_SANS", label: "DM Sans" },
  { id: "OPEN_SANS", label: "Open Sans" }
];

const LANGUAGE_OPTIONS = [
  { id: null, label: "System default" },
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
  { id: "es", label: "Espanol" }
];

const HOME_LAYOUT_OPTIONS = [
  { id: "modern", label: "Modern", caption: "Floating rows" },
  { id: "grid", label: "Grid", caption: "Dense browse" },
  { id: "classic", label: "Classic", caption: "Hero first" }
];

const SECTION_META = [
  { id: "account", label: "Account", subtitle: "Manage login, sync, and device link status." },
  { id: "profiles", label: "Profiles", subtitle: "Manage user profiles for this account." },
  { id: "appearance", label: "Appearance", subtitle: "Choose your color theme, font and language" },
  { id: "layout", label: "Layout", subtitle: "Adjust home layout, content visibility, and poster behavior" },
  { id: "plugins", label: "Plugins", subtitle: "Manage repositories, providers, and plugin states." },
  { id: "integration", label: "Integration", subtitle: "Choose TMDB or MDBList" },
  { id: "playback", label: "Playback", subtitle: "Configure video playback and subtitle options" },
  { id: "trakt", label: "Trakt", subtitle: "Manage Trakt authentication and sync preferences." },
  { id: "about", label: "About", subtitle: "App information, credits, and legal links" }
];

const SECTION_ICONS = {
  account: "person",
  profiles: "people",
  appearance: "palette",
  layout: "grid_view",
  plugins: "build",
  integration: "link",
  playback: "settings",
  trakt: "trakt",
  about: "info"
};

const ROW_ICONS = {
  external: '<path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14z"></path><path d="M5 5h7v2H7v10h10v-5h2v7H5z"></path>',
  chevron: '<path d="m9 6 6 6-6 6"></path>',
  expand: '<path d="m7 10 5 5 5-5"></path>',
  qr: '<path d="M3 3h7v7H3zm2 2v3h3V5zm6-2h2v2h-2zm3 0h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm8-1h2v2h-2zm2 2h2v2h-2zm-4 0h2v2h-2zm8-3h2v2h-2zm-6 6h2v2h-2zm3-3h5v5h-5zm2 2v1h1v-1z"></path>',
  phone: '<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5zm4 15h2v1h-2z"></path>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"></path>',
  back: '<path d="m15 6-6 6 6 6"></path>',
  check: '<path d="m5 13 4 4L19 7"></path>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"></path><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"></path>',
  trash: '<path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 12h10l1-12"></path><path d="M9 7V4h6v3"></path>'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function iconSvg(path, className = "settings-inline-icon", viewBox = "0 0 24 24") {
  return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${path}</svg>`;
}

function renderSectionNavIcon(sectionId) {
  if (sectionId === "trakt") {
    return '<img class="settings-nav-icon settings-nav-icon-image" src="assets/icons/trakt_tv_glyph.svg" alt="" aria-hidden="true" />';
  }
  const iconName = SECTION_ICONS[sectionId] || "settings";
  return `<span class="settings-nav-icon settings-nav-icon-material material-icons" aria-hidden="true">${iconName}</span>`;
}

function cycleOption(options, currentValue) {
  const index = options.findIndex((option) => String(option.id) === String(currentValue));
  if (index < 0 || index === options.length - 1) {
    return options[0];
  }
  return options[index + 1];
}

function maskValue(value, fallback) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return fallback;
  }
  if (trimmed.length <= 4) {
    return "••••";
  }
  return `••••••${trimmed.slice(-4)}`;
}

function labelForTheme(themeName) {
  return THEME_OPTIONS.find((item) => item.id === String(themeName || "").toUpperCase())?.label || "White";
}

function labelForFont(fontFamily) {
  return FONT_OPTIONS.find((item) => item.id === String(fontFamily || "").toUpperCase())?.label || "Inter";
}

function labelForLanguage(language) {
  return LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language))?.label || "System default";
}

function labelForLayout(layout) {
  return HOME_LAYOUT_OPTIONS.find((item) => item.id === String(layout || "").toLowerCase())?.label || "Classic";
}

function qualityLabel(value) {
  const normalized = String(value || "auto").toLowerCase();
  if (normalized === "2160p") return "2160p";
  if (normalized === "1080p") return "1080p";
  if (normalized === "720p") return "720p";
  return "Auto";
}

function playerLabel(value) {
  const normalized = String(value || "auto").toLowerCase();
  if (normalized === "native") return "Native";
  if (normalized === "hls") return "HLS.js";
  if (normalized === "dash") return "dash.js";
  return "Auto";
}

function renderModeLabel(value) {
  return String(value || "native").toLowerCase() === "html" ? "HTML overlay" : "Native";
}

function escapeSelector(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function plannedSubtitle(subtitle) {
  return subtitle ? `${subtitle} Coming soon.` : "Coming soon.";
}

function focusKeySelector(selector, key) {
  return `${selector}[data-focus-key="${escapeSelector(String(key))}"]`;
}

function scrollIntoNearestView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }
  try {
    node.scrollIntoView({
      block: "nearest",
      inline: "nearest"
    });
  } catch (_) {
    node.scrollIntoView();
  }
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function getSessionEmail() {
  const payload = decodeJwtPayload(SessionStore.accessToken);
  return String(payload?.email || payload?.user_metadata?.email || "").trim() || null;
}

function getVisibleSections(model) {
  const isPrimaryProfileActive = String(model?.activeProfileId || "1") === "1";
  return SECTION_META.filter((section) => {
    if (section.id === "account" || section.id === "profiles" || section.id === "trakt") {
      return isPrimaryProfileActive;
    }
    return true;
  });
}

function scrollSettingsRailItem(node) {
  const rail = node?.closest?.(".settings-sidebar");
  if (!rail || !node) {
    return;
  }

  const clientHeight = rail.clientHeight || 0;
  const maxScroll = Math.max(0, rail.scrollHeight - clientHeight);
  if (!clientHeight || maxScroll <= 0) {
    return;
  }

  const itemTop = node.offsetTop;
  const itemHeight = node.offsetHeight || 0;
  const targetCenter = clientHeight * 0.42;
  const desiredTop = itemTop - (targetCenter - (itemHeight / 2));
  const nextScrollTop = clamp(desiredTop, 0, maxScroll);
  if (Math.abs(rail.scrollTop - nextScrollTop) < 1) {
    return;
  }
  if (typeof rail.scrollTo === "function") {
    rail.scrollTo({
      top: nextScrollTop,
      behavior: "smooth"
    });
    return;
  }
  rail.scrollTop = nextScrollTop;
}

function addonKindsLabel(addon) {
  const kinds = Array.isArray(addon?.types) ? addon.types.filter(Boolean) : [];
  if (!kinds.length) {
    return "Repository";
  }
  return kinds.map((entry) => String(entry)).join(", ");
}

function createDefaultExpandedState(sectionId) {
  if (sectionId === "layout") {
    return {
      homeLayout: false,
      homeContent: false,
      detailPage: false,
      focusedPoster: false
    };
  }

  if (sectionId === "playback") {
    return {
      general: false,
      stream: false,
      audio: false,
      subtitles: false
    };
  }

  return {};
}

function normalizeExpandedState(sectionId, value) {
  const defaults = createDefaultExpandedState(sectionId);
  if (!value || typeof value !== "object") {
    return { ...defaults };
  }

  const normalized = { ...defaults };
  Object.keys(defaults).forEach((key) => {
    normalized[key] = Boolean(value[key]);
  });
  return normalized;
}

function normalizeExpandedSections(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    layout: normalizeExpandedState("layout", source.layout),
    playback: normalizeExpandedState("playback", source.playback)
  };
}

function readSettingsUiState() {
  const state = LocalStore.get(SETTINGS_UI_STATE_KEY, null);
  return {
    activeSection: typeof state?.activeSection === "string" ? state.activeSection : null,
    navIndex: Number.isFinite(state?.navIndex) ? state.navIndex : null,
    contentFocusKey: typeof state?.contentFocusKey === "string" ? state.contentFocusKey : null,
    integrationView: typeof state?.integrationView === "string" ? state.integrationView : "hub",
    expandedSections: normalizeExpandedSections(state?.expandedSections)
  };
}

export const SettingsScreen = {

  ensureShell() {
    if (this.container?.querySelector?.(".settings-shell")) {
      return;
    }
    this.container.innerHTML = `
      <div class="home-shell settings-shell">
        <div class="settings-root-sidebar-slot" data-settings-root-sidebar></div>
        <div class="settings-workspace">
          <aside class="settings-sidebar" data-settings-nav></aside>
          <section class="settings-content" data-settings-content></section>
        </div>
        <div data-settings-dialog></div>
      </div>
    `;
  },

  async mount() {
    this.container = document.getElementById("settings");
    ScreenUtils.show(this.container);
    this.settingsRouteEnterPending = true;
    this.sidebarProfile = await getSidebarProfileState();
    const persistedUiState = readSettingsUiState();
    this.activeSection = persistedUiState.activeSection || this.activeSection || null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
    this.navIndex = Number.isFinite(persistedUiState.navIndex)
      ? persistedUiState.navIndex
      : (Number.isFinite(this.navIndex) ? this.navIndex : SECTION_META.findIndex((section) => section.id === this.activeSection));
    this.contentFocusKey = persistedUiState.contentFocusKey || this.contentFocusKey || null;
    this.pluginDraft = this.pluginDraft || "";
    this.integrationView = persistedUiState.integrationView || this.integrationView || "hub";
    this.expandedSections = normalizeExpandedSections(persistedUiState.expandedSections || this.expandedSections);
    this.optionDialog = this.optionDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    await this.render();
  },

  ensureExpandedState(sectionId) {
    this.expandedSections[sectionId] = normalizeExpandedState(sectionId, this.expandedSections[sectionId]);
  },

  persistUiState() {
    LocalStore.set(SETTINGS_UI_STATE_KEY, {
      activeSection: this.activeSection || null,
      navIndex: Number.isFinite(this.navIndex) ? this.navIndex : null,
      contentFocusKey: this.contentFocusKey || null,
      integrationView: this.integrationView || "hub",
      expandedSections: normalizeExpandedSections(this.expandedSections)
    });
  },

  setActiveSection(sectionId) {
    this.activeSection = sectionId || null;
    this.persistUiState();
  },

  toggleExpandedSection(sectionId, groupId) {
    this.ensureExpandedState(sectionId);
    this.expandedSections[sectionId][groupId] = !Boolean(this.expandedSections[sectionId][groupId]);
    this.persistUiState();
  },

  registerAction(focusKey, action) {
    this.actionMap.set(focusKey, action);
    return `data-focus-key="${escapeHtml(focusKey)}"`;
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons();
    const profiles = await ProfileManager.getProfiles();
    const activeProfileId = ProfileManager.getActiveProfileId();
    const pluginSources = PluginManager.listPluginSources();

    return {
      addons,
      profiles,
      activeProfileId,
      accountEmail: getSessionEmail(),
      pluginSources,
      pluginsEnabled: PluginManager.pluginsEnabled,
      theme: ThemeStore.get(),
      player: PlayerSettingsStore.get(),
      layout: LayoutPreferences.get(),
      tmdb: TmdbSettingsStore.get(),
      mdbList: MdbListSettingsStore.get(),
      animeSkip: AnimeSkipSettingsStore.get(),
      rotatedDpad: Boolean(LocalStore.get(ROTATED_DPAD_KEY, true)),
      strictDpadGrid: Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true)),
      authState: AuthManager.getAuthState()
    };
  },

  renderNav() {
    return this.visibleSections.map((item, index) => `
      <button class="settings-nav-item focusable${this.activeSection === item.id ? " selected" : ""}"
              data-zone="nav"
              data-nav-index="${index}"
              data-focus-key="nav:${item.id}"
              data-section="${item.id}">
        <span class="settings-nav-leading">
          ${renderSectionNavIcon(item.id)}
          <span class="settings-nav-label">${escapeHtml(item.label)}</span>
        </span>
        ${iconSvg(ROW_ICONS.chevron, "settings-nav-chevron")}
      </button>
    `).join("");
  },

  renderSectionHeader(section) {
    return `
      <header class="settings-content-header">
        <h1 class="settings-title">${escapeHtml(section.label)}</h1>
        <p class="settings-subtitle">${escapeHtml(section.subtitle)}</p>
      </header>
    `;
  },

  renderActionRow({
    focusKey,
    title,
    subtitle = "",
    value = "",
    icon = "chevron",
    external = false,
    classes = "",
    disabled = false,
    planned = false
  }) {
    const inert = disabled || planned;
    const trailing = external ? "external" : icon;
    const tailContent = [
      planned ? `<span class="settings-row-badge">Soon</span>` : "",
      value ? `<span class="settings-row-value">${escapeHtml(value)}</span>` : "",
      trailing ? iconSvg(ROW_ICONS[trailing], `settings-row-icon${external ? " is-external" : ""}`) : ""
    ].filter(Boolean).join("");
    return `
      <button class="settings-action-row settings-content-focusable focusable${classes ? ` ${classes}` : ""}${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
              data-role="action">
        <span class="settings-row-copy">
          <span class="settings-row-title">${escapeHtml(title)}</span>
          ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
        </span>
        ${tailContent ? `<span class="settings-row-tail">${tailContent}</span>` : ""}
      </button>
    `;
  },

  renderToggleRow({ focusKey, title, subtitle = "", checked = false, disabled = false, planned = false }) {
    const inert = disabled || planned;
    return `
      <button class="settings-action-row settings-toggle-row settings-content-focusable focusable${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
              data-role="toggle">
        <span class="settings-row-copy">
          <span class="settings-row-title">${escapeHtml(title)}</span>
          ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
        </span>
        <span class="settings-row-tail">
          ${planned ? `<span class="settings-row-badge">Soon</span>` : ""}
          <span class="settings-toggle-pill${checked ? " is-checked" : ""}">
            <span class="settings-toggle-thumb"></span>
          </span>
        </span>
      </button>
    `;
  },

  renderThemeCard(theme, selected, focusKey) {
    const selectedClass = selected ? " is-selected" : "";
    return `
      <button class="settings-theme-card settings-content-focusable focusable${selectedClass}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-theme-swatch-wrap">
          <span class="settings-theme-swatch" style="background:${escapeHtml(theme.color)};">
            ${selected ? iconSvg(ROW_ICONS.check, "settings-theme-check") : ""}
          </span>
        </span>
        <span class="settings-theme-name">${escapeHtml(theme.label)}</span>
        <span class="settings-theme-underline" style="background:${escapeHtml(theme.color)};"></span>
      </button>
    `;
  },

  renderLayoutCard(option, selected, focusKey) {
    return `
      <button class="settings-layout-card settings-content-focusable focusable${selected ? " is-selected" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-layout-preview settings-layout-preview-${escapeHtml(option.id)}"></span>
        <span class="settings-layout-name">${escapeHtml(option.label)}</span>
        <span class="settings-layout-caption">${escapeHtml(option.caption)}</span>
      </button>
    `;
  },

  renderPluginIconButton({ focusKey, icon, label, destructive = false, disabled = false, planned = false }) {
    const inert = disabled || planned;
    return `
      <button class="settings-plugin-icon-button settings-content-focusable focusable${inert ? " is-disabled" : ""}${destructive ? " is-destructive" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              aria-label="${escapeHtml(label)}"
              title="${escapeHtml(label)}"
              ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}>
        ${planned ? '<span class="settings-plugin-icon-badge">Soon</span>' : iconSvg(ROW_ICONS[icon], "settings-plugin-icon-symbol")}
      </button>
    `;
  },

  renderPluginRepositoryCard(addon, index) {
    const streamResourceCount = Array.isArray(addon.resources)
      ? addon.resources.filter((resource) => resource?.name === "stream").length
      : 0;
    return `
      <article class="settings-plugin-repo-card">
        <div class="settings-plugin-repo-copy">
          <div class="settings-plugin-repo-title">${escapeHtml(addon.displayName || addon.name || "Repository")}</div>
          <div class="settings-plugin-repo-meta">
            ${escapeHtml(`${streamResourceCount} stream resource${streamResourceCount === 1 ? "" : "s"} · v${addon.version || "0.0.0"}`)}
          </div>
          <div class="settings-plugin-repo-url">${escapeHtml(addon.baseUrl || addon.description || addonKindsLabel(addon))}</div>
        </div>
        <div class="settings-plugin-repo-actions">
          ${this.renderPluginIconButton({
            focusKey: `plugins:refresh:${index}`,
            icon: "refresh",
            label: "Refresh repository"
          })}
          ${this.renderPluginIconButton({
            focusKey: `plugins:remove:${index}`,
            icon: "trash",
            label: "Remove repository",
            destructive: true
          })}
        </div>
      </article>
    `;
  },

  openOptionDialog({ title, options, selectedId, onSelect, returnFocusKey }) {
    this.optionDialog = {
      title,
      options: Array.isArray(options) ? options : [],
      selectedId: selectedId ?? null,
      onSelect,
      returnFocusKey
    };
    const selectedIndex = this.optionDialog.options.findIndex((option) => String(option.id) === String(selectedId));
    this.dialogFocusIndex = clamp(selectedIndex >= 0 ? selectedIndex : 0, 0, Math.max(0, this.optionDialog.options.length - 1));
    this.focusZone = "dialog";
  },

  closeOptionDialog() {
    if (!this.optionDialog) {
      return;
    }
    this.contentFocusKey = this.optionDialog.returnFocusKey || this.contentFocusKey;
    this.optionDialog = null;
    this.focusZone = "content";
  },

  renderOptionDialog() {
    if (!this.optionDialog) {
      return "";
    }

    return `
      <div class="settings-dialog-backdrop">
        <div class="settings-dialog">
          <div class="settings-dialog-title">${escapeHtml(this.optionDialog.title || "Select option")}</div>
          <div class="settings-dialog-list">
            ${this.optionDialog.options.map((option, index) => `
              <button class="settings-dialog-option settings-content-focusable focusable${String(option.id) === String(this.optionDialog.selectedId) ? " is-selected" : ""}"
                      data-zone="dialog"
                      data-dialog-index="${index}"
                      data-dialog-option-id="${escapeHtml(option.id)}">
                <span class="settings-dialog-option-label">${escapeHtml(option.label)}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  },

  renderCollapsibleRow({
    focusKey,
    title,
    subtitle,
    expanded,
    bodyHtml = "",
    classes = ""
  }) {
    return `
      <div class="settings-collapsible${classes ? ` ${classes}` : ""}${expanded ? " is-open" : ""}">
        <button class="settings-action-row settings-content-focusable focusable${expanded ? " is-open" : ""}"
                data-zone="content"
                ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
                data-role="section-toggle">
          <span class="settings-row-copy">
            <span class="settings-row-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
          </span>
          <span class="settings-row-tail">
            <span class="settings-row-value">${expanded ? "Open" : "Closed"}</span>
            ${iconSvg(expanded ? ROW_ICONS.expand : ROW_ICONS.chevron, "settings-row-icon")}
          </span>
        </button>
        ${expanded ? `<div class="settings-collapsible-body">${bodyHtml}</div>` : ""}
      </div>
    `;
  },

  renderAccountSection(model) {
    const signedIn = model.authState === "authenticated";
    this.actionMap.set("account:signin", () => Router.navigate("authQrSignIn"));
    this.actionMap.set("account:signout", async () => {
      await AuthManager.signOut();
      Router.navigate("authQrSignIn");
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "account"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${signedIn
            ? `<div class="settings-account-status">
                <span class="settings-account-status-label">Signed in</span>
                <strong class="settings-account-status-value">${escapeHtml(model.accountEmail || "Account linked on this TV")}</strong>
              </div>`
            : `<p class="settings-account-note">Sync your library and preferences across devices.</p>
              ${this.renderActionRow({
              focusKey: "account:signin",
              title: "Sign in with QR",
              subtitle: "Open QR sign-in to connect this device."
            })}`}
          ${signedIn ? this.renderActionRow({
            focusKey: "account:signout",
            title: "Sign out",
            subtitle: "Disconnect this TV from your account."
          }) : ""}
        </div>
      </div>
    `;
  },

  renderProfilesSection(model) {
    this.actionMap.set("profiles:manage", () => Router.navigate("profileSelection", {
      mode: "management",
      returnRoute: "settings"
    }));

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "profiles"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "profiles:manage",
            title: "Manage Profiles",
            subtitle: "",
            icon: null,
            classes: "settings-profile-manage-row"
          })}
        </div>
      </div>
    `;
  },

  renderAppearanceSection(model) {
    THEME_OPTIONS.forEach((theme) => {
      this.actionMap.set(`appearance:theme:${theme.id}`, () => {
        ThemeStore.set({ themeName: theme.id });
        ThemeManager.apply();
      });
    });

    this.actionMap.set("appearance:font", () => {
      this.openOptionDialog({
        title: "Select font",
        options: FONT_OPTIONS,
        selectedId: model.theme.fontFamily,
        returnFocusKey: "appearance:font",
        onSelect: (option) => {
          ThemeStore.set({ fontFamily: option.id });
          ThemeManager.apply();
        }
      });
    });

    this.actionMap.set("appearance:language", () => {
      this.openOptionDialog({
        title: "Select language",
        options: LANGUAGE_OPTIONS,
        selectedId: model.theme.language,
        returnFocusKey: "appearance:language",
        onSelect: (option) => {
          ThemeStore.set({ language: option.id });
          ThemeManager.apply();
        }
      });
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "appearance"))}
      <div class="settings-group-card settings-theme-grid-card">
        <div class="settings-theme-grid">
          ${THEME_OPTIONS.map((theme) => this.renderThemeCard(
            theme,
            String(model.theme.themeName).toUpperCase() === theme.id,
            `appearance:theme:${theme.id}`
          )).join("")}
        </div>
      </div>
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "appearance:font",
            title: "App Font",
            subtitle: "Choose your preferred font",
            value: labelForFont(model.theme.fontFamily)
          })}
        </div>
      </div>
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "appearance:language",
            title: "App Language",
            subtitle: plannedSubtitle("Override system language"),
            value: labelForLanguage(model.theme.language),
            planned: true
          })}
        </div>
      </div>
    `;
  },

  renderLayoutSection(model) {
    this.ensureExpandedState("layout");
    const expanded = this.expandedSections.layout;

    this.actionMap.set("layout:toggle:homeLayout", () => {
      this.toggleExpandedSection("layout", "homeLayout");
    });
    this.actionMap.set("layout:toggle:homeContent", () => {
      this.toggleExpandedSection("layout", "homeContent");
    });
    this.actionMap.set("layout:toggle:detailPage", () => {
      this.toggleExpandedSection("layout", "detailPage");
    });
    this.actionMap.set("layout:toggle:focusedPoster", () => {
      this.toggleExpandedSection("layout", "focusedPoster");
    });

    HOME_LAYOUT_OPTIONS.forEach((option) => {
      this.actionMap.set(`layout:layout:${option.id}`, () => {
        LayoutPreferences.set({ homeLayout: option.id });
      });
    });

    this.actionMap.set("layout:collapseSidebar", () => {
      LayoutPreferences.set({ collapseSidebar: !LayoutPreferences.get().collapseSidebar });
    });
    this.actionMap.set("layout:modernSidebar", () => {
      LayoutPreferences.set({ modernSidebar: !LayoutPreferences.get().modernSidebar });
    });
    this.actionMap.set("layout:modernSidebarBlur", () => {
      LayoutPreferences.set({ modernSidebarBlur: !LayoutPreferences.get().modernSidebarBlur });
    });
    this.actionMap.set("layout:heroSection", () => {
      LayoutPreferences.set({ heroSectionEnabled: !LayoutPreferences.get().heroSectionEnabled });
    });
    this.actionMap.set("layout:searchDiscover", () => {
      LayoutPreferences.set({ searchDiscoverEnabled: !LayoutPreferences.get().searchDiscoverEnabled });
    });
    this.actionMap.set("layout:hideUnreleased", () => {
      LayoutPreferences.set({ hideUnreleasedContent: !LayoutPreferences.get().hideUnreleasedContent });
    });
    this.actionMap.set("layout:posterLabels", () => {
      LayoutPreferences.set({ posterLabelsEnabled: !LayoutPreferences.get().posterLabelsEnabled });
    });
    this.actionMap.set("layout:addonName", () => {
      LayoutPreferences.set({ catalogAddonNameEnabled: !LayoutPreferences.get().catalogAddonNameEnabled });
    });
    this.actionMap.set("layout:catalogType", () => {
      LayoutPreferences.set({ catalogTypeSuffixEnabled: !LayoutPreferences.get().catalogTypeSuffixEnabled });
    });
    this.actionMap.set("layout:modernLandscapePosters", () => {
      LayoutPreferences.set({ modernLandscapePostersEnabled: !LayoutPreferences.get().modernLandscapePostersEnabled });
    });
    this.actionMap.set("layout:focusedPosterExpand", () => {
      LayoutPreferences.set({ focusedPosterBackdropExpandEnabled: !LayoutPreferences.get().focusedPosterBackdropExpandEnabled });
    });
    this.actionMap.set("layout:focusedPosterExpandDelay", () => {
      const options = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
        id: String(value),
        label: `${value}s`
      }));
      this.openOptionDialog({
        title: "Backdrop Expand Delay",
        options,
        selectedId: String(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3),
        returnFocusKey: "layout:focusedPosterExpandDelay",
        onSelect: (option) => {
          LayoutPreferences.set({ focusedPosterBackdropExpandDelaySeconds: Number(option.id || 0) || 0 });
        }
      });
    });
    this.actionMap.set("layout:focusedPosterTrailer", () => {
      LayoutPreferences.set({ focusedPosterBackdropTrailerEnabled: !LayoutPreferences.get().focusedPosterBackdropTrailerEnabled });
    });
    this.actionMap.set("layout:focusedPosterTrailerMuted", () => {
      LayoutPreferences.set({ focusedPosterBackdropTrailerMuted: !LayoutPreferences.get().focusedPosterBackdropTrailerMuted });
    });
    this.actionMap.set("layout:focusedPosterTrailerTarget", () => {
      const options = [
        { id: "hero_media", label: "Hero Media" },
        { id: "expanded_card", label: "Expanded Card" }
      ];
      this.openOptionDialog({
        title: "Modern Trailer Playback Location",
        options,
        selectedId: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media"),
        returnFocusKey: "layout:focusedPosterTrailerTarget",
        onSelect: (option) => {
          LayoutPreferences.set({ focusedPosterBackdropTrailerPlaybackTarget: String(option.id || "hero_media") });
        }
      });
    });

    const selectedLayout = String(model.layout.homeLayout || "").toLowerCase();
    const isModernLayout = selectedLayout === "modern";
    const isModernLandscape = isModernLayout && Boolean(model.layout.modernLandscapePostersEnabled);
    const showAutoplayRow = Boolean(model.layout.focusedPosterBackdropExpandEnabled) || isModernLandscape;

    const homeLayoutBody = `
      <div class="settings-stack">
        <div class="settings-layout-grid">
          ${HOME_LAYOUT_OPTIONS.map((option) => this.renderLayoutCard(
            option,
            selectedLayout === option.id,
            `layout:layout:${option.id}`
          )).join("")}
        </div>
        ${isModernLayout ? this.renderToggleRow({
          focusKey: "layout:modernLandscapePosters",
          title: "Landscape Posters",
          subtitle: "Switch between portrait and landscape cards for Modern view.",
          checked: Boolean(model.layout.modernLandscapePostersEnabled)
        }) : ""}
      </div>
    `;

    const homeContentBody = `
      <div class="settings-stack">
        ${!model.layout.modernSidebar ? this.renderToggleRow({
          focusKey: "layout:collapseSidebar",
          title: "Collapse Sidebar",
          subtitle: "Hide sidebar by default; show when focused.",
          checked: Boolean(model.layout.collapseSidebar)
        }) : ""}
        ${this.renderToggleRow({
          focusKey: "layout:modernSidebar",
          title: "Modern Sidebar",
          subtitle: "Enable floating sidebar navigation.",
          checked: Boolean(model.layout.modernSidebar)
        })}
        ${model.layout.modernSidebar ? this.renderToggleRow({
          focusKey: "layout:modernSidebarBlur",
          title: "Modern Sidebar Blur",
          subtitle: "Toggle blur effect for modern sidebar surfaces.",
          checked: Boolean(model.layout.modernSidebarBlur)
        }) : ""}
        ${this.renderToggleRow({
          focusKey: "layout:heroSection",
          title: "Show Hero Section",
          subtitle: "Display hero carousel at top of home.",
          checked: Boolean(model.layout.heroSectionEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:searchDiscover",
          title: "Show Discover in Search",
          subtitle: "Show browse section when search is empty.",
          checked: Boolean(model.layout.searchDiscoverEnabled)
        })}
        ${!isModernLayout ? this.renderToggleRow({
          focusKey: "layout:posterLabels",
          title: "Show Poster Labels",
          subtitle: "Show titles under posters in rows, grid, and see-all.",
          checked: Boolean(model.layout.posterLabelsEnabled)
        }) : ""}
        ${!isModernLayout ? this.renderToggleRow({
          focusKey: "layout:addonName",
          title: "Show Addon Name",
          subtitle: "Show source name under catalog titles.",
          checked: Boolean(model.layout.catalogAddonNameEnabled)
        }) : ""}
        ${this.renderToggleRow({
          focusKey: "layout:catalogType",
          title: "Show Catalog Type",
          subtitle: "Show type suffix next to catalog name (Movie/Series).",
          checked: Boolean(model.layout.catalogTypeSuffixEnabled)
        })}
        ${this.renderToggleRow({
          focusKey: "layout:hideUnreleased",
          title: "Hide Unreleased Content",
          subtitle: "Hide movies and shows that haven't been released yet.",
          checked: Boolean(model.layout.hideUnreleasedContent)
        })}
      </div>
    `;

    const detailPageBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "layout:detail:blurUnwatched",
          title: "Blur Unwatched Episodes",
          subtitle: "Blur episode thumbnails until watched to avoid spoilers.",
          checked: false,
          disabled: true
        })}
        ${this.renderToggleRow({
          focusKey: "layout:detail:trailerButton",
          title: "Show Trailer Button",
          subtitle: "Show trailer button on detail page (only when trailer is available).",
          checked: false,
          disabled: true
        })}
        ${this.renderToggleRow({
          focusKey: "layout:detail:preferExternalMeta",
          title: "Prefer meta from external addon",
          subtitle: "Use metadata from external addon instead of catalog addon.",
          checked: false,
          disabled: true
        })}
      </div>
    `;

    const focusedPosterBody = `
      <div class="settings-stack">
        ${!isModernLandscape ? this.renderToggleRow({
          focusKey: "layout:focusedPosterExpand",
          title: "Expand Focused Poster to Backdrop",
          subtitle: "Expand focused poster after idle delay.",
          checked: Boolean(model.layout.focusedPosterBackdropExpandEnabled)
        }) : ""}
        ${!isModernLandscape && Boolean(model.layout.focusedPosterBackdropExpandEnabled) ? this.renderActionRow({
          focusKey: "layout:focusedPosterExpandDelay",
          title: "Backdrop Expand Delay",
          subtitle: "How long to wait before expanding focused cards.",
          value: `${Number(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3)}s`
        }) : ""}
        ${showAutoplayRow ? this.renderToggleRow({
          focusKey: "layout:focusedPosterTrailer",
          title: isModernLayout ? "Autoplay Trailer" : "Autoplay Trailer in Expanded Card",
          subtitle: isModernLayout
            ? "Play trailer preview for focused content when available."
            : "Play trailer inside expanded backdrop when available.",
          checked: Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
        }) : ""}
        ${showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled) ? this.renderToggleRow({
          focusKey: "layout:focusedPosterTrailerMuted",
          title: "Play Trailer Muted",
          subtitle: isModernLayout
            ? "Mute trailer audio during autoplay preview."
            : "Mute trailer audio in expanded cards.",
          checked: Boolean(model.layout.focusedPosterBackdropTrailerMuted)
        }) : ""}
        ${isModernLayout && showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled) ? this.renderActionRow({
          focusKey: "layout:focusedPosterTrailerTarget",
          title: "Modern Trailer Playback Location",
          subtitle: "Choose where trailer preview plays in Modern Home.",
          value: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media") === "expanded_card"
            ? "Expanded Card"
            : "Hero Media"
        }) : ""}
      </div>
    `;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "layout"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:homeLayout",
            title: "Home Layout",
            subtitle: "Choose structure and hero source.",
            expanded: Boolean(expanded.homeLayout),
            bodyHtml: homeLayoutBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:homeContent",
            title: "Home Content",
            subtitle: "Control what appears on home and search.",
            expanded: Boolean(expanded.homeContent),
            bodyHtml: homeContentBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:detailPage",
            title: "Detail Page",
            subtitle: "Settings for the detail and episode screens.",
            expanded: Boolean(expanded.detailPage),
            bodyHtml: detailPageBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "layout:toggle:focusedPoster",
            title: "Focused Poster",
            subtitle: "Advanced behavior for focused poster cards.",
            expanded: Boolean(expanded.focusedPoster),
            bodyHtml: focusedPosterBody
          })}
        </div>
      </div>
    `;
  },

  renderPluginsSection(model) {
    this.actionMap.set("plugins:editDraft", () => {
      const value = window.prompt("Add repository URL", this.pluginDraft || "https://example.com/manifest.json");
      if (value === null) {
        return;
      }
      this.pluginDraft = String(value).trim();
    });

    this.actionMap.set("plugins:addDraft", async () => {
      if (!String(this.pluginDraft || "").trim()) {
        return;
      }
      await addonRepository.addAddon(this.pluginDraft);
      this.pluginDraft = "";
    });

    this.actionMap.set("plugins:phone", () => {});
    model.addons.forEach((addon, index) => {
      this.actionMap.set(`plugins:refresh:${index}`, async () => {
        await addonRepository.refreshAddon(addon.baseUrl || "");
      });
      this.actionMap.set(`plugins:remove:${index}`, async () => {
        await addonRepository.removeAddon(addon.baseUrl || "");
      });
    });
    model.pluginSources.forEach((source) => {
      this.actionMap.set(`plugins:provider:${source.id}`, () => {
        PluginManager.setPluginSourceEnabled(source.id, !source.enabled);
      });
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "plugins"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-plugin-builder">
          <div class="settings-plugin-builder-title">Add repository</div>
          <div class="settings-plugin-builder-row">
            <button class="settings-plugin-input settings-content-focusable focusable"
                    data-zone="content"
                    ${this.registerAction("plugins:editDraft", this.actionMap.get("plugins:editDraft"))}>
              ${escapeHtml(this.pluginDraft || "https://example.com/manifest.json")}
            </button>
            <button class="settings-plugin-add settings-content-focusable focusable${this.pluginDraft ? "" : " is-disabled"}"
                    data-zone="content"
                    ${this.registerAction("plugins:addDraft", this.actionMap.get("plugins:addDraft"))}>
              ${iconSvg(ROW_ICONS.plus, "settings-plugin-add-icon")}
              <span>Add</span>
            </button>
          </div>
        </div>

        ${this.renderActionRow({
          focusKey: "plugins:phone",
          title: "Manage from phone",
          subtitle: plannedSubtitle("Scan a QR code to add or remove repositories from your phone"),
          classes: "settings-plugins-phone",
          icon: "phone",
          planned: true
        })}

        <div class="settings-repository-heading">Repositories (${model.addons.length})</div>

        ${model.addons.length
          ? `<div class="settings-plugin-repo-list">${model.addons.map((addon, index) => this.renderPluginRepositoryCard(addon, index)).join("")}</div>`
          : `<div class="settings-empty-state">
              <p>No repositories added yet.</p>
              <p>Add a repository to get started.</p>
            </div>`}

        ${model.pluginSources.length ? `
          <div class="settings-repository-heading settings-plugin-provider-heading">Providers (${model.pluginSources.length})</div>
          <div class="settings-stack">
            ${model.pluginSources.map((source) => this.renderToggleRow({
              focusKey: `plugins:provider:${source.id}`,
              title: source.name || "Provider",
              subtitle: source.urlTemplate || "Custom provider template",
              checked: Boolean(source.enabled)
            })).join("")}
            ${this.renderActionRow({
              focusKey: "plugins:provider:test",
              title: "Provider testing",
              subtitle: plannedSubtitle("Run local provider tests and inspect results."),
              planned: true
            })}
          </div>
        ` : ""}
      </div>
    `;
  },

  renderIntegrationHub() {
    this.actionMap.set("integration:hub:tmdb", () => {
      this.integrationView = "tmdb";
      this.contentFocusKey = "integration:back";
    });
    this.actionMap.set("integration:hub:mdblist", () => {
      this.integrationView = "mdblist";
      this.contentFocusKey = "integration:back";
    });
    this.actionMap.set("integration:hub:animeskip", () => {
      this.integrationView = "animeskip";
      this.contentFocusKey = "integration:back";
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "integration"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "integration:hub:tmdb",
            title: "TMDB",
            subtitle: "Metadata enrichment controls"
          })}
          ${this.renderActionRow({
            focusKey: "integration:hub:mdblist",
            title: "MDBList",
            subtitle: "External ratings providers"
          })}
          ${this.renderActionRow({
            focusKey: "integration:hub:animeskip",
            title: "Anime-Skip",
            subtitle: "Anime intro/outro skip timestamps"
          })}
        </div>
      </div>
    `;
  },

  renderIntegrationDetail(model, key) {
    this.actionMap.set("integration:back", () => {
      this.integrationView = "hub";
      this.contentFocusKey = "integration:hub:tmdb";
    });

    if (key === "tmdb") {
      this.actionMap.set("integration:tmdb:enabled", () => {
        TmdbSettingsStore.set({ enabled: !TmdbSettingsStore.get().enabled });
      });
      this.actionMap.set("integration:tmdb:artwork", () => {
        TmdbSettingsStore.set({ useArtwork: !TmdbSettingsStore.get().useArtwork });
      });
      this.actionMap.set("integration:tmdb:basic", () => {
        TmdbSettingsStore.set({ useBasicInfo: !TmdbSettingsStore.get().useBasicInfo });
      });
      this.actionMap.set("integration:tmdb:details", () => {
        TmdbSettingsStore.set({ useDetails: !TmdbSettingsStore.get().useDetails });
      });
      this.actionMap.set("integration:tmdb:language", () => {
        const options = [
          { id: "en-US", label: "English" },
          { id: "it-IT", label: "Italian" },
          { id: "es-ES", label: "Spanish" }
        ];
        this.openOptionDialog({
          title: "Select TMDB language",
          options,
          selectedId: TmdbSettingsStore.get().language,
          returnFocusKey: "integration:tmdb:language",
          onSelect: (option) => {
            TmdbSettingsStore.set({ language: option.id });
          }
        });
      });
      this.actionMap.set("integration:tmdb:api", () => {
        const value = window.prompt("TMDB API key", TmdbSettingsStore.get().apiKey || "");
        if (value !== null) {
          TmdbSettingsStore.set({ apiKey: String(value).trim() });
        }
      });

      return `
        ${this.renderSectionHeader({ label: "TMDB", subtitle: "Metadata enrichment controls" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: "Back to Integrations",
              subtitle: "Return to integration list",
              icon: "back"
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:enabled",
              title: "Enable TMDB",
              subtitle: "Turn metadata enrichment on or off.",
              checked: Boolean(model.tmdb.enabled)
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:artwork",
              title: "Artwork",
              subtitle: "Posters, logos, and backdrops from TMDB.",
              checked: Boolean(model.tmdb.useArtwork),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:basic",
              title: "Basic Info",
              subtitle: "Genres, ratings, and overview from TMDB.",
              checked: Boolean(model.tmdb.useBasicInfo),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:tmdb:details",
              title: "Details",
              subtitle: "Runtime, release date, country, and language from TMDB.",
              checked: Boolean(model.tmdb.useDetails),
              disabled: !model.tmdb.enabled
            })}
            ${this.renderActionRow({
              focusKey: "integration:tmdb:language",
              title: "TMDB Language",
              subtitle: "Preferred metadata language",
              value: model.tmdb.language || "en-US"
            })}
            ${this.renderActionRow({
              focusKey: "integration:tmdb:api",
              title: "API Key",
              subtitle: "Configure TMDB credentials",
              value: maskValue(model.tmdb.apiKey, "Not set")
            })}
          </div>
        </div>
      `;
    }

    if (key === "mdblist") {
      this.actionMap.set("integration:mdblist:enabled", () => {
        MdbListSettingsStore.set({ enabled: !MdbListSettingsStore.get().enabled });
      });
      this.actionMap.set("integration:mdblist:key", () => {
        const value = window.prompt("MDBList API key", MdbListSettingsStore.get().apiKey || "");
        if (value !== null) {
          MdbListSettingsStore.set({ apiKey: String(value).trim() });
        }
      });

      return `
        ${this.renderSectionHeader({ label: "MDBList", subtitle: "External ratings providers" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: "Back to Integrations",
              subtitle: "Return to integration list",
              icon: "back"
            })}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:enabled",
              title: "Enable MDBList",
              subtitle: plannedSubtitle("Use MDBList as an extra ratings provider."),
              checked: Boolean(model.mdbList.enabled),
              planned: true
            })}
            ${this.renderActionRow({
              focusKey: "integration:mdblist:key",
              title: "API Key",
              subtitle: plannedSubtitle("Configure MDBList credentials"),
              value: maskValue(model.mdbList.apiKey, "Not set"),
              disabled: !model.mdbList.enabled,
              planned: true
            })}
          </div>
        </div>
      `;
    }

    this.actionMap.set("integration:animeskip:enabled", () => {
      AnimeSkipSettingsStore.set({ enabled: !AnimeSkipSettingsStore.get().enabled });
    });
    this.actionMap.set("integration:animeskip:id", () => {
      const value = window.prompt("Anime-Skip client ID", AnimeSkipSettingsStore.get().clientId || "");
      if (value !== null) {
        AnimeSkipSettingsStore.set({ clientId: String(value).trim() });
      }
    });

    return `
      ${this.renderSectionHeader({ label: "Anime-Skip", subtitle: "Anime intro and outro skip timestamps" })}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "integration:back",
            title: "Back to Integrations",
            subtitle: "Return to integration list",
            icon: "back"
          })}
          ${this.renderToggleRow({
            focusKey: "integration:animeskip:enabled",
            title: "Enable Anime-Skip",
            subtitle: plannedSubtitle("Use Anime-Skip timestamps during playback."),
            checked: Boolean(model.animeSkip.enabled),
            planned: true
          })}
          ${this.renderActionRow({
            focusKey: "integration:animeskip:id",
            title: "Client ID",
            subtitle: plannedSubtitle("Configure Anime-Skip client credentials"),
            value: maskValue(model.animeSkip.clientId, "Not set"),
            disabled: !model.animeSkip.enabled,
            planned: true
          })}
        </div>
      </div>
    `;
  },

  renderIntegrationSection(model) {
    if (this.integrationView && this.integrationView !== "hub") {
      return this.renderIntegrationDetail(model, this.integrationView);
    }
    return this.renderIntegrationHub();
  },

  renderPlaybackSection(model) {
    this.ensureExpandedState("playback");
    const expanded = this.expandedSections.playback;

    this.actionMap.set("playback:toggle:general", () => {
      this.toggleExpandedSection("playback", "general");
    });
    this.actionMap.set("playback:toggle:stream", () => {
      this.toggleExpandedSection("playback", "stream");
    });
    this.actionMap.set("playback:toggle:audio", () => {
      this.toggleExpandedSection("playback", "audio");
    });
    this.actionMap.set("playback:toggle:subtitles", () => {
      this.toggleExpandedSection("playback", "subtitles");
    });

    this.actionMap.set("playback:autoplay", () => {
      PlayerSettingsStore.set({ autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode });
    });
    this.actionMap.set("playback:quality", () => {
      const options = ["auto", "2160p", "1080p", "720p"];
      this.openOptionDialog({
        title: "Preferred quality",
        options: options.map((option) => ({ id: option, label: qualityLabel(option) })),
        selectedId: String(PlayerSettingsStore.get().preferredQuality || "auto"),
        returnFocusKey: "playback:quality",
        onSelect: (option) => {
          PlayerSettingsStore.set({ preferredQuality: option.id });
        }
      });
    });
    this.actionMap.set("playback:player", () => {
      const options = ["auto", "native", "hls", "dash"];
      this.openOptionDialog({
        title: "Player preference",
        options: options.map((option) => ({ id: option, label: playerLabel(option) })),
        selectedId: String(PlayerSettingsStore.get().preferredPlayer || "auto"),
        returnFocusKey: "playback:player",
        onSelect: (option) => {
          PlayerSettingsStore.set({ preferredPlayer: option.id });
        }
      });
    });
    this.actionMap.set("playback:trailer", () => {
      PlayerSettingsStore.set({ trailerAutoplay: !PlayerSettingsStore.get().trailerAutoplay });
    });
    this.actionMap.set("playback:audioLanguage", () => {
      const options = [
        { id: "system", label: "System" },
        { id: "en", label: "English" },
        { id: "it", label: "Italian" }
      ];
      this.openOptionDialog({
        title: "Preferred audio language",
        options,
        selectedId: PlayerSettingsStore.get().preferredAudioLanguage,
        returnFocusKey: "playback:audioLanguage",
        onSelect: (option) => {
          PlayerSettingsStore.set({ preferredAudioLanguage: option.id });
        }
      });
    });
    this.actionMap.set("playback:subtitlesEnabled", () => {
      PlayerSettingsStore.set({ subtitlesEnabled: !PlayerSettingsStore.get().subtitlesEnabled });
    });
    this.actionMap.set("playback:subtitleLanguage", () => {
      const options = [
        { id: "system", label: "System" },
        { id: "en", label: "English" },
        { id: "it", label: "Italian" }
      ];
      this.openOptionDialog({
        title: "Preferred subtitle language",
        options,
        selectedId: PlayerSettingsStore.get().subtitleLanguage,
        returnFocusKey: "playback:subtitleLanguage",
        onSelect: (option) => {
          PlayerSettingsStore.set({ subtitleLanguage: option.id });
        }
      });
    });
    this.actionMap.set("playback:renderMode", () => {
      this.openOptionDialog({
        title: "Subtitle render mode",
        options: [
          { id: "native", label: "Native" },
          { id: "html", label: "HTML overlay" }
        ],
        selectedId: String(PlayerSettingsStore.get().subtitleRenderMode || "native").toLowerCase(),
        returnFocusKey: "playback:renderMode",
        onSelect: (option) => {
          PlayerSettingsStore.set({ subtitleRenderMode: option.id });
        }
      });
    });

    const generalBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:autoplay",
          title: "Autoplay Next Episode",
          subtitle: "Automatically continue to the next episode.",
          checked: Boolean(model.player.autoplayNextEpisode)
        })}
      </div>
    `;

    const streamBody = `
      <div class="settings-stack">
        ${this.renderActionRow({
          focusKey: "playback:quality",
          title: "Preferred Quality",
          subtitle: "Choose the default quality target.",
          value: qualityLabel(model.player.preferredQuality)
        })}
        ${this.renderActionRow({
          focusKey: "playback:player",
          title: "Preferred Player",
          subtitle: "Select the playback engine priority.",
          value: playerLabel(model.player.preferredPlayer)
        })}
      </div>
    `;

    const audioBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:trailer",
          title: "Autoplay Trailer",
          subtitle: "Play trailers automatically on focused content.",
          checked: Boolean(model.player.trailerAutoplay)
        })}
        ${this.renderActionRow({
          focusKey: "playback:audioLanguage",
          title: "Preferred Audio",
          subtitle: "Choose the default audio language.",
          value: String(model.player.preferredAudioLanguage || "system").toUpperCase()
        })}
      </div>
    `;

    const subtitleBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
          focusKey: "playback:subtitlesEnabled",
          title: "Enable Subtitles",
          subtitle: "Turn subtitles on by default.",
          checked: Boolean(model.player.subtitlesEnabled)
        })}
        ${this.renderActionRow({
          focusKey: "playback:subtitleLanguage",
          title: "Subtitle Language",
          subtitle: "Preferred subtitle language.",
          value: String(model.player.subtitleLanguage || "system").toUpperCase()
        })}
        ${this.renderActionRow({
          focusKey: "playback:renderMode",
          title: "Render Mode",
          subtitle: "Choose how subtitles are drawn.",
          value: renderModeLabel(model.player.subtitleRenderMode)
        })}
      </div>
    `;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "playback"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:general",
            title: "General",
            subtitle: "Core playback behavior.",
            expanded: Boolean(expanded.general),
            bodyHtml: generalBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:stream",
            title: "Player & Stream Selection",
            subtitle: "Player preference, auto-play, and source filtering.",
            expanded: Boolean(expanded.stream),
            bodyHtml: streamBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:audio",
            title: "Audio & Trailer",
            subtitle: "Trailer behavior and audio controls.",
            expanded: Boolean(expanded.audio),
            bodyHtml: audioBody
          })}
          ${this.renderCollapsibleRow({
            focusKey: "playback:toggle:subtitles",
            title: "Subtitles",
            subtitle: "Language, style, and render mode.",
            expanded: Boolean(expanded.subtitles),
            bodyHtml: subtitleBody
          })}
        </div>
      </div>
    `;
  },

  renderTraktSection() {
    this.actionMap.set("trakt:open", () => Router.navigate("account"));

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "trakt"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "trakt:open",
            title: "Open Trakt Settings",
            subtitle: plannedSubtitle("Manage Trakt sign-in and continue watching sync."),
            planned: true
          })}
        </div>
      </div>
    `;
  },

  renderAboutSection() {
    this.actionMap.set("about:privacy", () => {
      window.open?.(PRIVACY_URL, "_blank");
    });
    this.actionMap.set("about:supporters", () => {
      window.open?.(SUPPORTERS_URL, "_blank");
    });

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "about"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-about-brand">
          <img class="settings-about-logo" src="assets/brand/app_logo_wordmark.png" alt="Nuvio" />
          <p class="settings-about-copy">Made with &#10084; by Tapframe and friends</p>
          <p class="settings-about-copy">Version ${escapeHtml(SETTINGS_VERSION_LABEL)}</p>
          <p class="settings-about-copy">Ported by edoedac0 and WhiteGiso.</p>
        </div>
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "about:privacy",
            title: "Privacy Policy",
            subtitle: "View our privacy policy",
            external: true
          })}
          ${this.renderActionRow({
            focusKey: "about:supporters",
            title: "Supporters & Contributors",
            subtitle: "Open recognition and project credits"
          })}
        </div>
      </div>
    `;
  },

  renderSection(section, model) {
    if (section.id === "account") return this.renderAccountSection(model);
    if (section.id === "profiles") return this.renderProfilesSection(model);
    if (section.id === "appearance") return this.renderAppearanceSection(model);
    if (section.id === "layout") return this.renderLayoutSection(model);
    if (section.id === "plugins") return this.renderPluginsSection(model);
    if (section.id === "integration") return this.renderIntegrationSection(model);
    if (section.id === "playback") return this.renderPlaybackSection(model);
    if (section.id === "trakt") return this.renderTraktSection(model);
    return this.renderAboutSection(model);
  },

  async render() {
    this.model = await this.collectModel();
    this.layoutPrefs = this.model.layout;
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    this.visibleSections = getVisibleSections(this.model);
    this.actionMap = new Map();
    if (!this.visibleSections.length) {
      this.visibleSections = [SECTION_META.find((item) => item.id === "appearance") || SECTION_META[0]];
    }
    if (!this.visibleSections.some((item) => item.id === this.activeSection)) {
      this.setActiveSection(this.visibleSections[0]?.id || "appearance");
    }
    this.navIndex = clamp(
      Number.isFinite(this.navIndex) ? this.navIndex : this.visibleSections.findIndex((item) => item.id === this.activeSection),
      0,
      this.visibleSections.length - 1
    );
    const section = this.visibleSections.find((item) => item.id === this.activeSection) || this.visibleSections[0];
    this.ensureExpandedState(section.id);
    this.persistUiState();

    this.ensureShell();

    const shell = this.container.querySelector(".settings-shell");
    if (shell) {
      shell.classList.toggle("settings-route-enter", Boolean(this.settingsRouteEnterPending));
      if (this.settingsRouteEnterPending) {
        void shell.offsetWidth;
      }
    }

    const rootSidebarSlot = this.container.querySelector("[data-settings-root-sidebar]");
    const navSlot = this.container.querySelector("[data-settings-nav]");
    const contentSlot = this.container.querySelector("[data-settings-content]");
    const dialogSlot = this.container.querySelector("[data-settings-dialog]");

    const rootSidebarHtml = renderRootSidebar({
      selectedRoute: "settings",
      profile: this.sidebarProfile,
      layout: this.layoutPrefs,
      expanded: Boolean(this.sidebarExpanded),
      pillIconOnly: Boolean(this.pillIconOnly)
    });
    if (rootSidebarSlot && rootSidebarSlot.innerHTML !== rootSidebarHtml) {
      rootSidebarSlot.innerHTML = rootSidebarHtml;
    }

    const navHtml = this.renderNav();
    if (navSlot && navSlot.innerHTML !== navHtml) {
      navSlot.innerHTML = navHtml;
    }

    const sectionChanged = this.renderedSectionId !== section.id;
    this.renderedSectionId = section.id;
    if (contentSlot) {
      contentSlot.innerHTML = this.renderSection(section, this.model);
      if (sectionChanged) {
        contentSlot.classList.remove("is-section-transitioning");
        void contentSlot.offsetWidth;
        contentSlot.classList.add("is-section-transitioning");
      } else {
        contentSlot.classList.remove("is-section-transitioning");
      }
    }

    const dialogHtml = this.renderOptionDialog();
    if (dialogSlot && dialogSlot.innerHTML !== dialogHtml) {
      dialogSlot.innerHTML = dialogHtml;
    }

    bindRootSidebarEvents(this.container, {
      currentRoute: "settings",
      onSelectedAction: () => this.closeSidebarToNav(),
      onExpandSidebar: () => this.openSidebar()
    });
    ScreenUtils.indexFocusables(this.container);
    this.settingsRouteEnterPending = false;
    this.applyFocus();
  },

  applyFocus() {
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    const selectedNode = this.container.querySelector(".settings-nav-item.selected");
    if (selectedNode) {
      scrollSettingsRailItem(selectedNode);
    }

    if (this.optionDialog) {
      const dialogNode = this.container.querySelector(`.settings-dialog-option[data-dialog-index="${this.dialogFocusIndex}"]`)
        || this.container.querySelector(".settings-dialog-option");
      if (dialogNode) {
        dialogNode.classList.add("focused");
        dialogNode.focus();
      }
      return;
    }

    if (this.focusZone === "sidebar") {
      const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
      const sidebarNode = sidebarNodes[this.sidebarFocusIndex] || getRootSidebarSelectedNode(this.container, this.layoutPrefs);
      if (sidebarNode) {
        sidebarNode.classList.add("focused");
        sidebarNode.focus();
        if (!this.layoutPrefs?.modernSidebar) {
          setLegacySidebarExpanded(this.container, true);
        }
        return;
      }
      this.focusZone = "nav";
    }

    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    if (this.focusZone === "content") {
      const contentNode = this.contentFocusKey
        ? this.container.querySelector(focusKeySelector(".settings-content-focusable", this.contentFocusKey))
        : null;
      const fallbackContent = contentNode || this.container.querySelector(".settings-content-focusable");
      if (fallbackContent) {
        fallbackContent.classList.add("focused");
        fallbackContent.focus();
        scrollIntoNearestView(fallbackContent);
        this.contentFocusKey = String(fallbackContent.dataset.focusKey || "");
        return;
      }
      this.focusZone = "nav";
    }

    const navNode = this.container.querySelector(`.settings-nav-item[data-nav-index="${this.navIndex}"]`)
      || this.container.querySelector(".settings-nav-item");
    if (navNode) {
      navNode.classList.add("focused");
      navNode.focus();
      scrollSettingsRailItem(navNode);
    }
  },

  async openSidebar() {
    this.focusZone = "sidebar";
    const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
    const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
    this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      await this.render();
      return;
    }
    this.applyFocus();
  },

  async closeSidebarToNav() {
    this.syncNavFocusToActive();
    this.focusZone = "nav";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      await this.render();
      return;
    }
    this.applyFocus();
  },

  moveNavFocus(index) {
    this.navIndex = clamp(index, 0, this.visibleSections.length - 1);
    this.applyFocus();
  },

  async activateNavSelection() {
    const section = this.visibleSections[this.navIndex];
    if (!section) {
      return;
    }
    this.setActiveSection(section.id);
    this.integrationView = "hub";
    this.contentFocusKey = null;
    await this.render();
  },

  syncNavFocusToActive() {
    const activeIndex = this.visibleSections.findIndex((item) => item.id === this.activeSection);
    if (activeIndex >= 0) {
      this.navIndex = activeIndex;
    }
  },

  updateFocusedContentKey() {
    const focused = this.container.querySelector(".settings-content-focusable.focused");
    if (focused) {
      this.contentFocusKey = String(focused.dataset.focusKey || "");
    }
  },

  moveContent(direction) {
    const before = this.container.querySelector(".settings-content-focusable.focused");
    ScreenUtils.moveFocusDirectional(this.container, direction, ".settings-content-focusable");
    const after = this.container.querySelector(".settings-content-focusable.focused");
    if (after) {
      this.contentFocusKey = String(after.dataset.focusKey || "");
    }
    return before !== after;
  },

  async activateFocused() {
    if (this.optionDialog) {
      const option = this.optionDialog.options[this.dialogFocusIndex];
      if (!option) {
        return;
      }
      if (typeof this.optionDialog.onSelect === "function") {
        await this.optionDialog.onSelect(option);
      }
      this.closeOptionDialog();
      await this.render();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const zone = String(current.dataset.zone || "");

    if (isRootSidebarNode(current)) {
      activateLegacySidebarAction(String(current.dataset.action || ""), "settings");
      if (isSelectedSidebarAction(String(current.dataset.action || ""), "settings")) {
        await this.closeSidebarToNav();
      }
      return;
    }

    if (zone === "nav") {
      await this.activateNavSelection();
      const firstContent = this.container.querySelector(".settings-content-focusable");
      if (firstContent) {
        this.focusZone = "content";
        this.contentFocusKey = String(firstContent.dataset.focusKey || "");
        this.applyFocus();
      }
      return;
    }

    const focusKey = String(current.dataset.focusKey || "");
    const action = this.actionMap.get(focusKey);
    if (!action) {
      return;
    }

    this.contentFocusKey = focusKey;
    await action();

    if (Router.getCurrent() === "settings") {
      await this.render();
      this.focusZone = "content";
      this.applyFocus();
    }
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.optionDialog) {
        this.closeOptionDialog();
        await this.render();
        return;
      }
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    const code = Number(event?.keyCode || 0);

    if (this.optionDialog) {
      if (code === 38 || code === 40) {
        event?.preventDefault?.();
        const delta = code === 38 ? -1 : 1;
        this.dialogFocusIndex = clamp(
          this.dialogFocusIndex + delta,
          0,
          Math.max(0, this.optionDialog.options.length - 1)
        );
        this.applyFocus();
        return;
      }

      if (code === 37 || code === 39) {
        event?.preventDefault?.();
        return;
      }
    }

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();

      if (this.focusZone === "sidebar") {
        if (code === 38) {
          this.sidebarFocusIndex = clamp(this.sidebarFocusIndex - 1, 0, Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1));
          this.applyFocus();
          return;
        }
        if (code === 40) {
          this.sidebarFocusIndex = clamp(this.sidebarFocusIndex + 1, 0, Math.max(0, getRootSidebarNodes(this.container, this.layoutPrefs).length - 1));
          this.applyFocus();
          return;
        }
        if (code === 39) {
          await this.closeSidebarToNav();
          return;
        }
      }

      if (this.focusZone === "nav") {
        if (code === 38) {
          this.moveNavFocus(this.navIndex - 1);
          return;
        }
        if (code === 40) {
          this.moveNavFocus(this.navIndex + 1);
          return;
        }
        if (code === 37) {
          const sidebarNodes = getRootSidebarNodes(this.container, this.layoutPrefs);
          const selectedSidebarNode = getRootSidebarSelectedNode(this.container, this.layoutPrefs);
          this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selectedSidebarNode));
          await this.openSidebar();
          return;
        }
        if (code === 39) {
          const firstContent = this.container.querySelector(".settings-content-focusable");
          if (firstContent) {
            this.focusZone = "content";
            this.contentFocusKey = String(firstContent.dataset.focusKey || "");
            this.applyFocus();
          }
          return;
        }
      }

      if (this.focusZone === "content") {
        if (code === 37) {
          const moved = this.moveContent("left");
          if (!moved) {
            this.syncNavFocusToActive();
            this.focusZone = "nav";
            this.applyFocus();
          }
          return;
        }
        if (code === 38) {
          this.moveContent("up");
          return;
        }
        if (code === 40) {
          this.moveContent("down");
          return;
        }
        if (code === 39) {
          this.moveContent("right");
          return;
        }
      }
    }

    if (code !== 13) {
      return;
    }

    await this.activateFocused();
  },

  consumeBackRequest() {
    if (!this.optionDialog) {
      return false;
    }
    this.closeOptionDialog();
    this.render();
    return true;
  },

  cleanup() {
    LocalStore.remove(SETTINGS_UI_STATE_KEY);
    this.activeSection = null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = 0;
    this.navIndex = -1;
    this.contentFocusKey = null;
    this.integrationView = "hub";
    this.expandedSections = {};
    this.optionDialog = null;
    this.dialogFocusIndex = 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.renderedSectionId = null;
    ScreenUtils.hide(this.container);
  }

};
