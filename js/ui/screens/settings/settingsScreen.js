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
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { SavedLibrarySyncService } from "../../../core/profile/savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "../../../core/profile/watchedItemsSyncService.js";
import { WatchProgressSyncService } from "../../../core/profile/watchProgressSyncService.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
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
  setModernSidebarExpanded,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";
const STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";
const SETTINGS_UI_STATE_KEY = "settingsScreenUiState";
const SETTINGS_VERSION_LABEL = typeof __NUVIO_APP_VERSION__ !== "undefined"
  ? __NUVIO_APP_VERSION__
  : "0.0.0";
const PRIVACY_URL = "https://tapframe.github.io/NuvioStreaming/#privacy-policy";
const SUPPORTERS_URL = "https://github.com/Tapframe/NuvioStreaming";

const THEME_OPTIONS = [
  { id: "WHITE", labelKey: "settings.appearance.themes.white", color: "#f5f5f5" },
  { id: "CRIMSON", labelKey: "settings.appearance.themes.crimson", color: "#e53935" },
  { id: "OCEAN", labelKey: "settings.appearance.themes.ocean", color: "#1e88e5" },
  { id: "VIOLET", labelKey: "settings.appearance.themes.violet", color: "#8e24aa" },
  { id: "EMERALD", labelKey: "settings.appearance.themes.emerald", color: "#43a047" },
  { id: "AMBER", labelKey: "settings.appearance.themes.amber", color: "#fb8c00" },
  { id: "ROSE", labelKey: "settings.appearance.themes.rose", color: "#d81b60" }
];

const FONT_OPTIONS = [
  { id: "INTER", label: "Inter" },
  { id: "DM_SANS", label: "DM Sans" },
  { id: "OPEN_SANS", label: "Open Sans" }
];

const APP_LANGUAGE_NATIVE_LABELS = {
  en: "English",
  es: "Espanol",
  fr: "Francais",
  hi: "Hindi",
  hu: "Magyar",
  it: "Italiano",
  ja: "Japanese",
  nl: "Nederlands",
  pl: "Polski",
  ro: "Romana",
  se: "Svenska",
  sk: "Slovencina",
  sl: "Slovenscina",
  tr: "Turkce",
  vi: "Tieng Viet"
};

function appLanguageOptionLabel(localeId) {
  const normalized = String(localeId || "").trim().toLowerCase();
  if (!normalized) {
    return "System Default";
  }
  return APP_LANGUAGE_NATIVE_LABELS[normalized] || normalized.toUpperCase();
}

const LANGUAGE_OPTIONS = [
  { id: null, labelKey: "common.systemDefault" },
  ...I18n.getSupportedLocales()
    .map((localeId) => ({
      id: localeId,
      label: appLanguageOptionLabel(localeId)
    }))
    .sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")))
];

const TMDB_LANGUAGE_OPTIONS = [
  { id: "en-US", labelKey: "common.english" },
  { id: "it-IT", labelKey: "common.italian" },
  { id: "es-ES", labelKey: "common.spanish" }
];

const PREFERRED_PLAYBACK_LANGUAGE_OPTIONS = [
  { id: "system", labelKey: "common.system" },
  { id: "en", labelKey: "common.english" },
  { id: "it", labelKey: "common.italian" }
];

const AVAILABLE_SUBTITLE_LANGUAGES = [
  { id: "af", label: "Afrikaans" },
  { id: "sq", label: "Albanian" },
  { id: "am", label: "Amharic" },
  { id: "ar", label: "Arabic" },
  { id: "hy", label: "Armenian" },
  { id: "az", label: "Azerbaijani" },
  { id: "eu", label: "Basque" },
  { id: "be", label: "Belarusian" },
  { id: "bn", label: "Bengali" },
  { id: "bs", label: "Bosnian" },
  { id: "bg", label: "Bulgarian" },
  { id: "my", label: "Burmese" },
  { id: "ca", label: "Catalan" },
  { id: "zh", label: "Chinese" },
  { id: "zh-cn", label: "Chinese (Simplified)" },
  { id: "zh-tw", label: "Chinese (Traditional)" },
  { id: "hr", label: "Croatian" },
  { id: "cs", label: "Czech" },
  { id: "da", label: "Danish" },
  { id: "nl", label: "Dutch" },
  { id: "en", label: "English" },
  { id: "et", label: "Estonian" },
  { id: "tl", label: "Filipino" },
  { id: "fi", label: "Finnish" },
  { id: "fr", label: "French" },
  { id: "gl", label: "Galician" },
  { id: "ka", label: "Georgian" },
  { id: "de", label: "German" },
  { id: "el", label: "Greek" },
  { id: "gu", label: "Gujarati" },
  { id: "he", label: "Hebrew" },
  { id: "hi", label: "Hindi" },
  { id: "hu", label: "Hungarian" },
  { id: "is", label: "Icelandic" },
  { id: "id", label: "Indonesian" },
  { id: "ga", label: "Irish" },
  { id: "it", label: "Italian" },
  { id: "ja", label: "Japanese" },
  { id: "kn", label: "Kannada" },
  { id: "kk", label: "Kazakh" },
  { id: "km", label: "Khmer" },
  { id: "ko", label: "Korean" },
  { id: "lo", label: "Lao" },
  { id: "lv", label: "Latvian" },
  { id: "lt", label: "Lithuanian" },
  { id: "mk", label: "Macedonian" },
  { id: "ms", label: "Malay" },
  { id: "ml", label: "Malayalam" },
  { id: "mt", label: "Maltese" },
  { id: "mr", label: "Marathi" },
  { id: "mn", label: "Mongolian" },
  { id: "ne", label: "Nepali" },
  { id: "no", label: "Norwegian" },
  { id: "pa", label: "Punjabi" },
  { id: "fa", label: "Persian" },
  { id: "pl", label: "Polish" },
  { id: "pt", label: "Portuguese (Portugal)" },
  { id: "pt-br", label: "Portuguese (Brazil)" },
  { id: "ro", label: "Romanian" },
  { id: "ru", label: "Russian" },
  { id: "sr", label: "Serbian" },
  { id: "si", label: "Sinhala" },
  { id: "sk", label: "Slovak" },
  { id: "sl", label: "Slovenian" },
  { id: "es", label: "Spanish" },
  { id: "es-419", label: "Spanish (Latin America)" },
  { id: "sw", label: "Swahili" },
  { id: "sv", label: "Swedish" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "th", label: "Thai" },
  { id: "tr", label: "Turkish" },
  { id: "uk", label: "Ukrainian" },
  { id: "ur", label: "Urdu" },
  { id: "uz", label: "Uzbek" },
  { id: "vi", label: "Vietnamese" },
  { id: "cy", label: "Welsh" },
  { id: "zu", label: "Zulu" }
].sort((left, right) => left.label.localeCompare(right.label));

const PREFERRED_SUBTITLE_LANGUAGE_OPTIONS = [
  { id: "off", labelKey: "subtitle_none_forced_only", label: "None (forced only)" },
  ...AVAILABLE_SUBTITLE_LANGUAGES
];

const HOME_LAYOUT_OPTIONS = [
  { id: "modern", labelKey: "settings.layout.homeLayouts.modern.label", captionKey: "settings.layout.homeLayouts.modern.caption" },
  { id: "grid", labelKey: "settings.layout.homeLayouts.grid.label", captionKey: "settings.layout.homeLayouts.grid.caption" },
  { id: "classic", labelKey: "settings.layout.homeLayouts.classic.label", captionKey: "settings.layout.homeLayouts.classic.caption" }
];

const SECTION_META = [
  { id: "account", labelKey: "settings.sections.account.label", subtitleKey: "settings.sections.account.subtitle" },
  { id: "profiles", labelKey: "settings.sections.profiles.label", subtitleKey: "settings.sections.profiles.subtitle" },
  { id: "appearance", labelKey: "settings.sections.appearance.label", subtitleKey: "settings.sections.appearance.subtitle" },
  { id: "layout", labelKey: "settings.sections.layout.label", subtitleKey: "settings.sections.layout.subtitle" },
  { id: "plugins", labelKey: "settings.sections.plugins.label", subtitleKey: "settings.sections.plugins.subtitle" },
  { id: "integration", labelKey: "settings.sections.integration.label", subtitleKey: "settings.sections.integration.subtitle" },
  { id: "playback", labelKey: "settings.sections.playback.label", subtitleKey: "settings.sections.playback.subtitle" },
  { id: "trakt", labelKey: "settings.sections.trakt.label", subtitleKey: "settings.sections.trakt.subtitle" },
  { id: "about", labelKey: "settings.sections.about.label", subtitleKey: "settings.sections.about.subtitle" }
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
  trash: '<path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 12h10l1-12"></path><path d="M9 7V4h6v3"></path>',
  plugins: '<path d="m11 17-5-5.28 1.4-1.42 3.6 3.8L17.6 7.5 19 8.92 11 17zM12 22q-2.075 0-3.9-.788t-3.175-2.137Q3.6 17.725 2.8 15.9T2 12q0-2.075.788-3.9t2.137-3.175Q6.275 3.6 8.1 2.8T12 2q2.075 0 3.9.788t3.175 2.137Q20.4 6.275 21.2 8.1T22 12q0 2.075-.788 3.9t-2.137 3.175Q17.725 20.4 15.9 21.2T12 22z"></path>'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLayoutPreviewMarkup(layoutId) {
  const normalized = String(layoutId || "classic").toLowerCase();
  if (normalized === "modern") {
    return `
      <span class="settings-layout-preview-modern-stage">
        <span class="settings-layout-preview-modern-hero"></span>
        <span class="settings-layout-preview-modern-row">
          ${Array.from({ length: 9 }, (_, index) => `<span class="settings-layout-preview-modern-card${index % 3 === 1 ? " is-strong" : ""}"></span>`).join("")}
        </span>
      </span>
    `;
  }

  if (normalized === "grid") {
    return `
      <span class="settings-layout-preview-grid-canvas">
        ${Array.from({ length: 35 }, (_, index) => `
          <span class="settings-layout-preview-grid-cell${Math.floor(index / 5) % 3 === 2 ? " is-dim" : ""}"></span>
        `).join("")}
      </span>
    `;
  }

  return `
    <span class="settings-layout-preview-classic-stage">
      <span class="settings-layout-preview-classic-row is-top">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card"></span>').join("")}
      </span>
      <span class="settings-layout-preview-classic-row is-featured">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card is-strong"></span>').join("")}
      </span>
      <span class="settings-layout-preview-classic-row is-bottom">
        ${Array.from({ length: 7 }, () => '<span class="settings-layout-preview-classic-card"></span>').join("")}
      </span>
    </span>
  `;
}

function iconSvg(path, className = "settings-inline-icon", viewBox = "0 0 24 24") {
  return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${path}</svg>`;
}

function translateOptionLabel(option, fallback = "") {
  if (!option) {
    return fallback;
  }
  if (option.labelKey) {
    return t(option.labelKey, option.labelParams || {}, option.label || fallback);
  }
  return String(option.label || fallback);
}

function translateOptionCaption(option, fallback = "") {
  if (!option) {
    return fallback;
  }
  if (option.captionKey) {
    return t(option.captionKey, option.captionParams || {}, option.caption || fallback);
  }
  return String(option.caption || fallback);
}

function translateSectionCopy(section) {
  if (!section) {
    return { label: "", subtitle: "" };
  }
  return {
    label: section.labelKey ? t(section.labelKey, section.labelParams || {}, section.label || "") : String(section.label || ""),
    subtitle: section.subtitleKey ? t(section.subtitleKey, section.subtitleParams || {}, section.subtitle || "") : String(section.subtitle || "")
  };
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
  return translateOptionLabel(
    THEME_OPTIONS.find((item) => item.id === String(themeName || "").toUpperCase()),
    t("settings.appearance.themes.white")
  );
}

function labelForFont(fontFamily) {
  return FONT_OPTIONS.find((item) => item.id === String(fontFamily || "").toUpperCase())?.label || "Inter";
}

function labelForLanguage(language) {
  return translateOptionLabel(
    LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language)),
    t("common.systemDefault")
  );
}

function labelForLayout(layout) {
  return translateOptionLabel(
    HOME_LAYOUT_OPTIONS.find((item) => item.id === String(layout || "").toLowerCase()),
    t("settings.layout.homeLayouts.classic.label")
  );
}

function labelForTmdbLanguage(language) {
  return translateOptionLabel(
    TMDB_LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language)),
    String(language || "en-US")
  );
}

function labelForPlaybackLanguage(language) {
  return translateOptionLabel(
    PREFERRED_PLAYBACK_LANGUAGE_OPTIONS.find((item) => String(item.id) === String(language)),
    t("common.system")
  );
}

function extractLanguageCode(value, fallback = "off") {
  if (value && typeof value === "object") {
    return extractLanguageCode(value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode, fallback);
  }
  const code = String(value ?? "").trim();
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function normalizeSelectableSubtitleLanguageCode(language, fallback = "off") {
  const code = extractLanguageCode(language, fallback).trim().toLowerCase();
  if (!code) {
    return fallback;
  }
  switch (code) {
    case "pt-br":
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt-pt":
    case "pt_pt":
    case "por":
      return "pt";
    case "forced":
    case "force":
    case "forc":
      return "forced";
    case "none":
    case "off":
      return "off";
    default:
      return code;
  }
}

function labelForSubtitlePlaybackLanguage(language) {
  const normalized = normalizeSelectableSubtitleLanguageCode(language);
  return translateOptionLabel(
    PREFERRED_SUBTITLE_LANGUAGE_OPTIONS.find((item) => String(item.id) === normalized),
    normalized === "off"
      ? t("subtitle_none_forced_only", {}, "None (forced only)")
      : normalized === "system"
          ? t("common.system")
          : String(language || "system")
  );
}

function subtitleLanguageOptionCode(option) {
  const normalized = normalizeSelectableSubtitleLanguageCode(option?.id);
  if (!normalized || normalized === "off") {
    return "";
  }
  return normalized.toUpperCase();
}

function renderModeLabel(value) {
  return String(value || "native").toLowerCase() === "html" ? t("common.htmlOverlay") : t("common.native");
}

function escapeSelector(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function plannedSubtitle(subtitle) {
  return subtitle ? t("common.comingSoonWithContext", { subject: subtitle }) : t("common.comingSoon");
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

  const railRect = rail.getBoundingClientRect();
  const itemRect = node.getBoundingClientRect();
  const itemTop = (itemRect.top - railRect.top) + rail.scrollTop;
  const itemBottom = (itemRect.bottom - railRect.top) + rail.scrollTop;
  const itemHeight = itemRect.height || node.offsetHeight || 0;
  const padding = Math.max(12, Math.round(clientHeight * 0.12));
  const viewTop = rail.scrollTop + padding;
  const viewBottom = rail.scrollTop + clientHeight - padding;
  let nextScrollTop = rail.scrollTop;

  if (itemTop < viewTop) {
    nextScrollTop = Math.max(0, itemTop - padding);
  } else if (itemBottom > viewBottom) {
    nextScrollTop = Math.min(maxScroll, itemBottom - clientHeight + padding);
  } else {
    return;
  }

  if (Math.abs(rail.scrollTop - nextScrollTop) < 1) {
    return;
  }
  if (typeof rail.scrollTo === "function") {
    rail.scrollTo({
      top: nextScrollTop,
      behavior: "auto"
    });
    return;
  }
  rail.scrollTop = nextScrollTop;
}

function isScrollContainerAtBoundary(node, direction) {
  if (!node) {
    return true;
  }

  const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  if (maxScrollTop <= 0) {
    return true;
  }

  const scrollTop = Number(node.scrollTop || 0);
  if (direction === "up") {
    return scrollTop <= 1;
  }
  if (direction === "down") {
    return scrollTop >= maxScrollTop - 1;
  }
  return false;
}

function captureSettingsScrollState(contentNode) {
  if (!contentNode) {
    return null;
  }

  const themeGrid = contentNode.querySelector(".settings-theme-grid");
  return {
    contentScrollTop: Number(contentNode.scrollTop || 0),
    themeGridScrollTop: Number(themeGrid?.scrollTop || 0)
  };
}

function restoreSettingsScrollState(contentNode, scrollState) {
  if (!contentNode || !scrollState) {
    return;
  }

  contentNode.scrollTop = Number(scrollState.contentScrollTop || 0);
  const themeGrid = contentNode.querySelector(".settings-theme-grid");
  if (themeGrid) {
    themeGrid.scrollTop = Number(scrollState.themeGridScrollTop || 0);
  }
}

function addonKindsLabel(addon) {
  const kinds = Array.isArray(addon?.types) ? addon.types.filter(Boolean) : [];
  if (!kinds.length) {
    return t("common.repository");
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
    appearanceThemeFocusKey: typeof state?.appearanceThemeFocusKey === "string" ? state.appearanceThemeFocusKey : null,
    integrationView: typeof state?.integrationView === "string" ? state.integrationView : "hub",
    expandedSections: normalizeExpandedSections(state?.expandedSections)
  };
}

function isAppearanceThemeFocusKey(focusKey) {
  return String(focusKey || "").startsWith("appearance:theme:");
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
    if (!this.handleWheelBound) {
      this.handleWheelBound = this.handleWheelEvent.bind(this);
      this.container.addEventListener("wheel", this.handleWheelBound, { passive: false });
    }
    this.settingsRouteEnterPending = true;
    const persistedUiState = readSettingsUiState();
    this.activeSection = persistedUiState.activeSection || this.activeSection || null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
    this.navIndex = Number.isFinite(persistedUiState.navIndex)
      ? persistedUiState.navIndex
      : (Number.isFinite(this.navIndex) ? this.navIndex : SECTION_META.findIndex((section) => section.id === this.activeSection));
    this.contentFocusKey = persistedUiState.contentFocusKey || this.contentFocusKey || null;
    this.appearanceThemeFocusKey = persistedUiState.appearanceThemeFocusKey || this.appearanceThemeFocusKey || null;
    this.pluginDraft = this.pluginDraft || "";
    this.integrationView = persistedUiState.integrationView || this.integrationView || "hub";
    this.expandedSections = normalizeExpandedSections(persistedUiState.expandedSections || this.expandedSections);
    this.optionDialog = this.optionDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    const [sidebarProfile, initialModel] = await Promise.all([
      getSidebarProfileState(),
      this.collectModel()
    ]);
    this.sidebarProfile = sidebarProfile;
    this.model = initialModel;
    await this.render({ refreshModel: false });
  },

  ensureExpandedState(sectionId) {
    this.expandedSections[sectionId] = normalizeExpandedState(sectionId, this.expandedSections[sectionId]);
  },

  persistUiState() {
    LocalStore.set(SETTINGS_UI_STATE_KEY, {
      activeSection: this.activeSection || null,
      navIndex: Number.isFinite(this.navIndex) ? this.navIndex : null,
      contentFocusKey: this.contentFocusKey || null,
      appearanceThemeFocusKey: this.appearanceThemeFocusKey || null,
      integrationView: this.integrationView || "hub",
      expandedSections: normalizeExpandedSections(this.expandedSections)
    });
  },

  rememberAppearanceThemeFocusKey(focusKey = this.contentFocusKey) {
    if (!isAppearanceThemeFocusKey(focusKey)) {
      return;
    }
    if (this.appearanceThemeFocusKey === focusKey) {
      return;
    }
    this.appearanceThemeFocusKey = focusKey;
    this.persistUiState();
  },

  getAppearanceThemeFocusKey() {
    return this.appearanceThemeFocusKey || `appearance:theme:${THEME_OPTIONS[0]?.id || "WHITE"}`;
  },

  collapseExpandedSection(sectionId) {
    if (!sectionId) {
      return;
    }
    this.expandedSections[sectionId] = createDefaultExpandedState(sectionId);
  },

  setActiveSection(sectionId) {
    const nextSectionId = sectionId || null;
    if (this.activeSection && this.activeSection !== nextSectionId) {
      this.rememberAppearanceThemeFocusKey();
      this.collapseExpandedSection(this.activeSection);
    }
    this.activeSection = sectionId || null;
    this.contentFocusKey = this.activeSection === "appearance"
      ? this.getAppearanceThemeFocusKey()
      : null;
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
    const [addons, profiles] = await Promise.all([
      addonRepository.getInstalledAddons(),
      ProfileManager.getProfiles()
    ]);
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
          <span class="settings-nav-label-wrap">
            <span class="settings-nav-label">${escapeHtml(translateSectionCopy(item).label)}</span>
            ${item.id === "plugins" ? `<span class="settings-nav-badge">${escapeHtml(t("common.soon", {}, "Soon"))}</span>` : ""}
          </span>
        </span>
        ${iconSvg(ROW_ICONS.chevron, "settings-nav-chevron")}
      </button>
    `).join("");
  },

  renderSectionHeader(section) {
    const copy = translateSectionCopy(section);
    return `
      <header class="settings-content-header">
        <h1 class="settings-title">${escapeHtml(copy.label)}</h1>
        <p class="settings-subtitle">${escapeHtml(copy.subtitle)}</p>
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
      planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : "",
      value ? `<span class="settings-row-value">${escapeHtml(value)}</span>` : "",
      trailing ? iconSvg(ROW_ICONS[trailing], `settings-row-icon${external ? " is-external" : ""}`) : ""
    ].filter(Boolean).join("");
    return `
      <button class="settings-action-row settings-content-focusable focusable${classes ? ` ${classes}` : ""}${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, inert ? () => { } : this.actionMap.get(focusKey))}
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
              ${this.registerAction(focusKey, inert ? () => { } : this.actionMap.get(focusKey))}
              data-role="toggle">
        <span class="settings-row-copy">
          <span class="settings-row-title">${escapeHtml(title)}</span>
          ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
        </span>
        <span class="settings-row-tail">
          ${planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : ""}
          <span class="settings-toggle-pill${checked ? " is-checked" : ""}">
            <span class="settings-toggle-thumb"></span>
          </span>
        </span>
      </button>
    `;
  },

  renderThemeCard(theme, selected, focusKey) {
    const selectedClass = selected ? " is-selected" : "";
    const swatchClass = theme.id === "WHITE" ? " settings-theme-swatch-light" : "";
    return `
      <button class="settings-theme-card settings-content-focusable focusable${selectedClass}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-theme-swatch-wrap">
          <span class="settings-theme-swatch${swatchClass}" style="background:${escapeHtml(theme.color)};">
            ${selected ? iconSvg(ROW_ICONS.check, "settings-theme-check") : ""}
          </span>
        </span>
        <span class="settings-theme-name">${escapeHtml(translateOptionLabel(theme))}</span>
        <span class="settings-theme-underline" style="background:${escapeHtml(theme.color)};"></span>
      </button>
    `;
  },

  renderLayoutCard(option, selected, focusKey) {
    return `
      <button class="settings-layout-card settings-content-focusable focusable${selected ? " is-selected" : ""}"
              data-zone="content"
              ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
        <span class="settings-layout-badge">${escapeHtml(t("common.beta", {}, "Beta"))}</span>
        <span class="settings-layout-preview settings-layout-preview-${escapeHtml(option.id)}">${renderLayoutPreviewMarkup(option.id)}</span>
        <span class="settings-layout-name">${escapeHtml(translateOptionLabel(option))}</span>
        <span class="settings-layout-caption">${escapeHtml(translateOptionCaption(option))}</span>
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
              ${this.registerAction(focusKey, inert ? () => { } : this.actionMap.get(focusKey))}>
        ${planned ? `<span class="settings-plugin-icon-badge">${escapeHtml(t("common.soon"))}</span>` : iconSvg(ROW_ICONS[icon], "settings-plugin-icon-symbol")}
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
          <div class="settings-plugin-repo-title">${escapeHtml(addon.displayName || addon.name || t("common.repository"))}</div>
          <div class="settings-plugin-repo-meta">
            ${escapeHtml(t(
      streamResourceCount === 1 ? "settings.plugins.repoMetaSingular" : "settings.plugins.repoMetaPlural",
      { count: streamResourceCount, version: addon.version || "0.0.0" }
    ))}
          </div>
          <div class="settings-plugin-repo-url">${escapeHtml(addon.baseUrl || addon.description || addonKindsLabel(addon))}</div>
        </div>
        <div class="settings-plugin-repo-actions">
          ${this.renderPluginIconButton({
      focusKey: `plugins:refresh:${index}`,
      icon: "refresh",
      label: t("settings.plugins.refreshRepository")
    })}
          ${this.renderPluginIconButton({
      focusKey: `plugins:remove:${index}`,
      icon: "trash",
      label: t("settings.plugins.removeRepository"),
      destructive: true
    })}
        </div>
      </article>
    `;
  },

  openOptionDialog({ title, options, selectedId, onSelect, returnFocusKey, dialogClassName = "", optionRenderer = "default" }) {
    this.optionDialog = {
      title,
      options: Array.isArray(options) ? options : [],
      selectedId: selectedId ?? null,
      onSelect,
      returnFocusKey,
      dialogClassName,
      optionRenderer
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

    const dialogClassName = this.optionDialog.dialogClassName ? ` ${escapeHtml(this.optionDialog.dialogClassName)}` : "";
    const useLanguageRenderer = this.optionDialog.optionRenderer === "subtitle-language";

    return `
      <div class="settings-dialog-backdrop">
        <div class="settings-dialog${dialogClassName}">
          <div class="settings-dialog-title">${escapeHtml(this.optionDialog.title || t("common.selectOption"))}</div>
          <div class="settings-dialog-list${useLanguageRenderer ? " settings-language-dialog-list" : ""}">
            ${this.optionDialog.options.map((option, index) => `
              <button class="settings-dialog-option settings-content-focusable focusable${useLanguageRenderer ? " settings-language-option" : ""}${String(option.id) === String(this.optionDialog.selectedId) ? " is-selected" : ""}"
                      data-zone="dialog"
                      data-dialog-index="${index}"
                      data-dialog-option-id="${escapeHtml(option.id)}">
                ${useLanguageRenderer
        ? `<span class="settings-language-option-copy">
                      <span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>
                    </span>
                    <span class="settings-language-option-meta">
                      ${subtitleLanguageOptionCode(option)
          ? `<span class="settings-language-option-code">${escapeHtml(subtitleLanguageOptionCode(option))}</span>`
          : ""}
                      ${String(option.id) === String(this.optionDialog.selectedId)
          ? `<span class="settings-language-option-check" aria-hidden="true">&#10003;</span>`
          : ""}
                    </span>`
        : `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>`}
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
        <button class="settings-action-row settings-collapsible-trigger settings-content-focusable focusable${expanded ? " is-open" : ""}"
                data-zone="content"
                ${this.registerAction(focusKey, this.actionMap.get(focusKey))}
                data-role="section-toggle">
          <span class="settings-row-copy">
            <span class="settings-row-title">${escapeHtml(title)}</span>
            ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
          </span>
          <span class="settings-row-tail">
            <span class="settings-row-value">${expanded ? t("common.open") : t("common.closed")}</span>
            ${iconSvg(expanded ? ROW_ICONS.expand : ROW_ICONS.chevron, "settings-row-icon")}
          </span>
        </button>
        ${expanded ? `
          <div class="settings-collapsible-body">
            <div class="settings-group-card settings-subsection-card">
              ${bodyHtml}
            </div>
          </div>
        ` : ""}
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
                <span class="settings-account-status-label">${t("settings.status.signedIn")}</span>
                <strong class="settings-account-status-value">${escapeHtml(model.accountEmail || t("settings.status.linkedFallback"))}</strong>
              </div>`
        : `<p class="settings-account-note">${t("settings.account.syncNote")}</p>
              ${this.renderActionRow({
          focusKey: "account:signin",
          title: t("settings.account.signInWithQr"),
          subtitle: t("settings.account.signInWithQrSubtitle")
        })}`}
          ${signedIn ? this.renderActionRow({
          focusKey: "account:signout",
          title: t("settings.account.signOut"),
          subtitle: t("settings.account.signOutSubtitle")
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
      title: t("settings.profiles.manageProfiles"),
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
        ThemeStore.set({ themeName: theme.id, accentColor: theme.color });
        ThemeManager.apply();
      });
    });

    this.actionMap.set("appearance:font", () => {
      this.openOptionDialog({
        title: t("settings.dialogs.selectFont"),
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
        title: t("settings.dialogs.selectLanguage"),
        options: LANGUAGE_OPTIONS,
        selectedId: model.theme.language,
        returnFocusKey: "appearance:language",
        onSelect: async (option) => {
          ThemeStore.set({ language: option.id });
          await I18n.init();
          ThemeManager.apply();
          I18n.apply();
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
      title: t("settings.appearance.appFont"),
      subtitle: t("settings.appearance.appFontSubtitle"),
      value: labelForFont(model.theme.fontFamily)
    })}
        </div>
      </div>
      <div class="settings-group-card">
        <div class="settings-stack">
          ${this.renderActionRow({
      focusKey: "appearance:language",
      title: t("settings.appearance.appLanguage"),
      subtitle: t("settings.appearance.appLanguageSubtitle"),
      value: labelForLanguage(model.theme.language)
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
    this.actionMap.set("layout:showUnairedNextUp", () => {
      LayoutPreferences.set({ showUnairedNextUp: !LayoutPreferences.get().showUnairedNextUp });
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
        title: t("settings.dialogs.backdropExpandDelay"),
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
        { id: "hero_media", labelKey: "settings.layout.trailerTargets.heroMedia" },
        { id: "expanded_card", labelKey: "settings.layout.trailerTargets.expandedCard" }
      ];
      this.openOptionDialog({
        title: t("settings.dialogs.modernTrailerPlaybackLocation"),
        options,
        selectedId: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media"),
        returnFocusKey: "layout:focusedPosterTrailerTarget",
        onSelect: (option) => {
          LayoutPreferences.set({ focusedPosterBackdropTrailerPlaybackTarget: String(option.id || "hero_media") });
        }
      });
    });
    this.actionMap.set("layout:detail:trailerButton", () => {
      LayoutPreferences.set({ detailPageTrailerButtonEnabled: !LayoutPreferences.get().detailPageTrailerButtonEnabled });
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
      title: t("settings.layout.landscapePosters.title"),
      subtitle: t("settings.layout.landscapePosters.subtitle"),
      checked: Boolean(model.layout.modernLandscapePostersEnabled)
    }) : ""}
      </div>
    `;

    const homeContentBody = `
      <div class="settings-stack">
        ${!model.layout.modernSidebar ? this.renderToggleRow({
      focusKey: "layout:collapseSidebar",
      title: t("settings.layout.collapseSidebar.title"),
      subtitle: t("settings.layout.collapseSidebar.subtitle"),
      checked: Boolean(model.layout.collapseSidebar)
    }) : ""}
        ${this.renderToggleRow({
      focusKey: "layout:modernSidebar",
      title: t("settings.layout.modernSidebar.title"),
      subtitle: t("settings.layout.modernSidebar.subtitle"),
      checked: Boolean(model.layout.modernSidebar)
    })}
        ${model.layout.modernSidebar ? this.renderToggleRow({
      focusKey: "layout:modernSidebarBlur",
      title: t("settings.layout.modernSidebarBlur.title"),
      subtitle: t("settings.layout.modernSidebarBlur.subtitle"),
      checked: Boolean(model.layout.modernSidebarBlur)
    }) : ""}
        ${this.renderToggleRow({
      focusKey: "layout:heroSection",
      title: t("settings.layout.heroSection.title"),
      subtitle: t("settings.layout.heroSection.subtitle"),
      checked: Boolean(model.layout.heroSectionEnabled)
    })}
        ${this.renderToggleRow({
      focusKey: "layout:searchDiscover",
      title: t("settings.layout.searchDiscover.title"),
      subtitle: t("settings.layout.searchDiscover.subtitle"),
      checked: Boolean(model.layout.searchDiscoverEnabled)
    })}
        ${!isModernLayout ? this.renderToggleRow({
      focusKey: "layout:posterLabels",
      title: t("settings.layout.posterLabels.title"),
      subtitle: t("settings.layout.posterLabels.subtitle"),
      checked: Boolean(model.layout.posterLabelsEnabled)
    }) : ""}
        ${!isModernLayout ? this.renderToggleRow({
      focusKey: "layout:addonName",
      title: t("settings.layout.addonName.title"),
      subtitle: t("settings.layout.addonName.subtitle"),
      checked: Boolean(model.layout.catalogAddonNameEnabled)
    }) : ""}
        ${this.renderToggleRow({
      focusKey: "layout:catalogType",
      title: t("settings.layout.catalogType.title"),
      subtitle: t("settings.layout.catalogType.subtitle"),
      checked: Boolean(model.layout.catalogTypeSuffixEnabled)
    })}
        ${this.renderToggleRow({
      focusKey: "layout:hideUnreleased",
      title: t("settings.layout.hideUnreleased.title"),
      subtitle: t("settings.layout.hideUnreleased.subtitle"),
      checked: Boolean(model.layout.hideUnreleasedContent)
    })}
        ${this.renderToggleRow({
      focusKey: "layout:showUnairedNextUp",
      title: t("settings.layout.showUnairedNextUp.title", {}, "Unaired Next Up Episodes"),
      subtitle: t("settings.layout.showUnairedNextUp.subtitle", {}, "Show upcoming episodes in Continue Watching before their release date."),
      checked: model.layout.showUnairedNextUp !== false
    })}
      </div>
    `;

    const detailPageBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
      focusKey: "layout:detail:blurUnwatched",
      title: t("settings.layout.blurUnwatched.title"),
      subtitle: t("settings.layout.blurUnwatched.subtitle"),
      checked: false,
      disabled: true
    })}
        ${this.renderToggleRow({
      focusKey: "layout:detail:trailerButton",
      title: t("settings.layout.showTrailerButton.title"),
      subtitle: t("settings.layout.showTrailerButton.subtitle"),
      checked: Boolean(model.layout.detailPageTrailerButtonEnabled)
    })}
        ${this.renderToggleRow({
      focusKey: "layout:detail:preferExternalMeta",
      title: t("settings.layout.preferExternalMeta.title"),
      subtitle: t("settings.layout.preferExternalMeta.subtitle"),
      checked: false,
      disabled: true
    })}
      </div>
    `;

    const focusedPosterBody = `
      <div class="settings-stack">
        ${!isModernLandscape ? this.renderToggleRow({
      focusKey: "layout:focusedPosterExpand",
      title: t("settings.layout.focusedPosterExpand.title"),
      subtitle: t("settings.layout.focusedPosterExpand.subtitle"),
      checked: Boolean(model.layout.focusedPosterBackdropExpandEnabled)
    }) : ""}
        ${!isModernLandscape && Boolean(model.layout.focusedPosterBackdropExpandEnabled) ? this.renderActionRow({
      focusKey: "layout:focusedPosterExpandDelay",
      title: t("settings.layout.focusedPosterExpandDelay.title"),
      subtitle: t("settings.layout.focusedPosterExpandDelay.subtitle"),
      value: `${Number(model.layout.focusedPosterBackdropExpandDelaySeconds ?? 3)}s`
    }) : ""}
        ${showAutoplayRow ? this.renderToggleRow({
      focusKey: "layout:focusedPosterTrailer",
      title: isModernLayout ? t("settings.layout.autoplayTrailer.title") : t("settings.layout.autoplayTrailerExpandedCard.title"),
      subtitle: isModernLayout
        ? t("settings.layout.autoplayTrailer.subtitle")
        : t("settings.layout.autoplayTrailerExpandedCard.subtitle"),
      checked: Boolean(model.layout.focusedPosterBackdropTrailerEnabled)
    }) : ""}
        ${showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled) ? this.renderToggleRow({
      focusKey: "layout:focusedPosterTrailerMuted",
      title: isModernLayout ? t("settings.layout.trailerMuted.title") : t("settings.layout.trailerMutedExpandedCard.title"),
      subtitle: isModernLayout
        ? t("settings.layout.trailerMuted.subtitle")
        : t("settings.layout.trailerMutedExpandedCard.subtitle"),
      checked: Boolean(model.layout.focusedPosterBackdropTrailerMuted)
    }) : ""}
        ${isModernLayout && showAutoplayRow && Boolean(model.layout.focusedPosterBackdropTrailerEnabled) ? this.renderActionRow({
      focusKey: "layout:focusedPosterTrailerTarget",
      title: t("settings.layout.trailerTarget.title"),
      subtitle: t("settings.layout.trailerTarget.subtitle"),
      value: String(model.layout.focusedPosterBackdropTrailerPlaybackTarget || "hero_media") === "expanded_card"
        ? t("settings.layout.trailerTargets.expandedCard")
        : t("settings.layout.trailerTargets.heroMedia")
    }) : ""}
      </div>
    `;

    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "layout"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderCollapsibleRow({
      focusKey: "layout:toggle:homeLayout",
      title: t("settings.layout.groups.homeLayout.title"),
      subtitle: t("settings.layout.groups.homeLayout.subtitle"),
      expanded: Boolean(expanded.homeLayout),
      bodyHtml: homeLayoutBody
    })}
          ${this.renderCollapsibleRow({
      focusKey: "layout:toggle:homeContent",
      title: t("settings.layout.groups.homeContent.title"),
      subtitle: t("settings.layout.groups.homeContent.subtitle"),
      expanded: Boolean(expanded.homeContent),
      bodyHtml: homeContentBody
    })}
          ${this.renderCollapsibleRow({
      focusKey: "layout:toggle:detailPage",
      title: t("settings.layout.groups.detailPage.title"),
      subtitle: t("settings.layout.groups.detailPage.subtitle"),
      expanded: Boolean(expanded.detailPage),
      bodyHtml: detailPageBody
    })}
          ${this.renderCollapsibleRow({
      focusKey: "layout:toggle:focusedPoster",
      title: t("settings.layout.groups.focusedPoster.title"),
      subtitle: t("settings.layout.groups.focusedPoster.subtitle"),
      expanded: Boolean(expanded.focusedPoster),
      bodyHtml: focusedPosterBody
    })}
        </div>
      </div>
    `;
  },

  renderPluginsSection(model) {
    return `
      ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "plugins"))}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-empty-state settings-empty-state-plugins">
          <p class="settings-plugin-soon-text">Plugin support is coming soon.</p>
        </div>
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
      title: t("settings.integration.tmdb.label"),
      subtitle: t("settings.integration.tmdb.subtitle")
    })}
            ${this.renderActionRow({
      focusKey: "integration:hub:mdblist",
      title: t("settings.integration.mdblist.label"),
      subtitle: t("settings.integration.mdblist.subtitle")
    })}
            ${this.renderActionRow({
      focusKey: "integration:hub:animeskip",
      title: t("settings.integration.animeskip.label"),
      subtitle: t("settings.integration.animeskip.subtitle")
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
        this.openOptionDialog({
          title: t("settings.dialogs.selectTmdbLanguage"),
          options: TMDB_LANGUAGE_OPTIONS,
          selectedId: TmdbSettingsStore.get().language,
          returnFocusKey: "integration:tmdb:language",
          onSelect: (option) => {
            TmdbSettingsStore.set({ language: option.id });
          }
        });
      });
      this.actionMap.set("integration:tmdb:api", () => {
        const value = window.prompt(t("settings.integration.tmdb.apiKey.prompt"), TmdbSettingsStore.get().apiKey || "");
        if (value !== null) {
          TmdbSettingsStore.set({ apiKey: String(value).trim() });
        }
      });

      return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.tmdb.label", subtitleKey: "settings.integration.tmdb.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
        focusKey: "integration:back",
        title: t("settings.integration.backToIntegrations.title"),
        subtitle: t("settings.integration.backToIntegrations.subtitle"),
        icon: "back"
      })}
            ${this.renderToggleRow({
        focusKey: "integration:tmdb:enabled",
        title: t("settings.integration.tmdb.enable.title"),
        subtitle: t("settings.integration.tmdb.enable.subtitle"),
        checked: Boolean(model.tmdb.enabled)
      })}
            ${this.renderToggleRow({
        focusKey: "integration:tmdb:artwork",
        title: t("settings.integration.tmdb.artwork.title"),
        subtitle: t("settings.integration.tmdb.artwork.subtitle"),
        checked: Boolean(model.tmdb.useArtwork),
        disabled: !model.tmdb.enabled
      })}
            ${this.renderToggleRow({
        focusKey: "integration:tmdb:basic",
        title: t("settings.integration.tmdb.basicInfo.title"),
        subtitle: t("settings.integration.tmdb.basicInfo.subtitle"),
        checked: Boolean(model.tmdb.useBasicInfo),
        disabled: !model.tmdb.enabled
      })}
            ${this.renderToggleRow({
        focusKey: "integration:tmdb:details",
        title: t("settings.integration.tmdb.details.title"),
        subtitle: t("settings.integration.tmdb.details.subtitle"),
        checked: Boolean(model.tmdb.useDetails),
        disabled: !model.tmdb.enabled
      })}
            ${this.renderActionRow({
        focusKey: "integration:tmdb:language",
        title: t("settings.integration.tmdb.language.title"),
        subtitle: t("settings.integration.tmdb.language.subtitle"),
        value: labelForTmdbLanguage(model.tmdb.language)
      })}
            ${this.renderActionRow({
        focusKey: "integration:tmdb:api",
        title: t("settings.integration.tmdb.apiKey.title"),
        subtitle: t("settings.integration.tmdb.apiKey.subtitle"),
        value: maskValue(model.tmdb.apiKey, t("common.notSet"))
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
        const value = window.prompt(t("settings.integration.mdblist.apiKey.prompt"), MdbListSettingsStore.get().apiKey || "");
        if (value !== null) {
          MdbListSettingsStore.set({ apiKey: String(value).trim() });
        }
      });

      return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.mdblist.label", subtitleKey: "settings.integration.mdblist.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
        focusKey: "integration:back",
        title: t("settings.integration.backToIntegrations.title"),
        subtitle: t("settings.integration.backToIntegrations.subtitle"),
        icon: "back"
      })}
            ${this.renderToggleRow({
        focusKey: "integration:mdblist:enabled",
        title: t("settings.integration.mdblist.enable.title"),
        subtitle: plannedSubtitle(t("settings.integration.mdblist.enable.subtitle")),
        checked: Boolean(model.mdbList.enabled),
        planned: true
      })}
            ${this.renderActionRow({
        focusKey: "integration:mdblist:key",
        title: t("settings.integration.mdblist.apiKey.title"),
        subtitle: plannedSubtitle(t("settings.integration.mdblist.apiKey.subtitle")),
        value: maskValue(model.mdbList.apiKey, t("common.notSet")),
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
      const value = window.prompt(t("settings.integration.animeskip.clientId.prompt"), AnimeSkipSettingsStore.get().clientId || "");
      if (value !== null) {
        AnimeSkipSettingsStore.set({ clientId: String(value).trim() });
      }
    });

    return `
      ${this.renderSectionHeader({ labelKey: "settings.integration.animeskip.label", subtitleKey: "settings.integration.animeskip.subtitle" })}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
      focusKey: "integration:back",
      title: t("settings.integration.backToIntegrations.title"),
      subtitle: t("settings.integration.backToIntegrations.subtitle"),
      icon: "back"
    })}
          ${this.renderToggleRow({
      focusKey: "integration:animeskip:enabled",
      title: t("settings.integration.animeskip.enable.title"),
      subtitle: plannedSubtitle(t("settings.integration.animeskip.enable.subtitle")),
      checked: Boolean(model.animeSkip.enabled),
      planned: true
    })}
          ${this.renderActionRow({
      focusKey: "integration:animeskip:id",
      title: t("settings.integration.animeskip.clientId.title"),
      subtitle: plannedSubtitle(t("settings.integration.animeskip.clientId.subtitle")),
      value: maskValue(model.animeSkip.clientId, t("common.notSet")),
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
    this.actionMap.set("playback:toggle:audio", () => {
      this.toggleExpandedSection("playback", "audio");
    });
    this.actionMap.set("playback:toggle:subtitles", () => {
      this.toggleExpandedSection("playback", "subtitles");
    });

    this.actionMap.set("playback:autoplay", () => {
      PlayerSettingsStore.set({ autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode });
    });
    this.actionMap.set("playback:trailer", () => {
      PlayerSettingsStore.set({ trailerAutoplay: !PlayerSettingsStore.get().trailerAutoplay });
    });
    this.actionMap.set("playback:skipIntro", () => {
      PlayerSettingsStore.set({ skipIntroEnabled: !PlayerSettingsStore.get().skipIntroEnabled });
    });
    this.actionMap.set("playback:audioLanguage", () => {
      this.openOptionDialog({
        title: t("settings.dialogs.preferredAudioLanguage"),
        options: PREFERRED_PLAYBACK_LANGUAGE_OPTIONS,
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
      const currentSettings = PlayerSettingsStore.get();
      const currentLanguage = normalizeSelectableSubtitleLanguageCode(currentSettings.subtitleStyle?.preferredLanguage || currentSettings.subtitleLanguage);
      this.openOptionDialog({
        title: t("settings.dialogs.preferredSubtitleLanguage"),
        options: PREFERRED_SUBTITLE_LANGUAGE_OPTIONS,
        selectedId: currentLanguage === "system" ? "off" : currentLanguage,
        returnFocusKey: "playback:subtitleLanguage",
        dialogClassName: "settings-language-dialog",
        optionRenderer: "subtitle-language",
        onSelect: (option) => {
          const normalized = normalizeSelectableSubtitleLanguageCode(option.id);
          PlayerSettingsStore.set({
            subtitleLanguage: normalized,
            subtitleStyle: {
              ...currentSettings.subtitleStyle,
              preferredLanguage: normalized
            }
          });
        }
      });
    });
    this.actionMap.set("playback:renderMode", () => {
      this.openOptionDialog({
        title: t("settings.dialogs.subtitleRenderMode"),
        options: [
          { id: "native", labelKey: "common.native" },
          { id: "html", labelKey: "common.htmlOverlay" }
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
      title: t("settings.playback.autoplayNextEpisode.title"),
      subtitle: t("settings.playback.autoplayNextEpisode.subtitle"),
      checked: Boolean(model.player.autoplayNextEpisode)
    })}
        ${this.renderToggleRow({
      focusKey: "playback:skipIntro",
      title: t("settings.playback.skipIntro.title", {}, "Skip Intro"),
      subtitle: t("settings.playback.skipIntro.subtitle", {}, "Use IntroDB to detect intro, recap and outro segments when available."),
      checked: Boolean(model.player.skipIntroEnabled)
    })}
      </div>
    `;

    const audioBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
      focusKey: "playback:trailer",
      title: t("settings.playback.autoplayTrailer.title"),
      subtitle: t("settings.playback.autoplayTrailer.subtitle"),
      checked: Boolean(model.player.trailerAutoplay)
    })}
        ${this.renderActionRow({
      focusKey: "playback:audioLanguage",
      title: t("settings.playback.preferredAudio.title"),
      subtitle: t("settings.playback.preferredAudio.subtitle"),
      value: labelForPlaybackLanguage(model.player.preferredAudioLanguage)
    })}
      </div>
    `;

    const subtitleBody = `
      <div class="settings-stack">
        ${this.renderToggleRow({
      focusKey: "playback:subtitlesEnabled",
      title: t("settings.playback.enableSubtitles.title"),
      subtitle: t("settings.playback.enableSubtitles.subtitle"),
      checked: Boolean(model.player.subtitlesEnabled)
    })}
        ${this.renderActionRow({
      focusKey: "playback:subtitleLanguage",
      title: t("settings.playback.subtitleLanguage.title"),
      subtitle: t("settings.playback.subtitleLanguage.subtitle"),
      value: labelForSubtitlePlaybackLanguage(model.player.subtitleLanguage)
    })}
        ${this.renderActionRow({
      focusKey: "playback:renderMode",
      title: t("settings.playback.renderMode.title"),
      subtitle: t("settings.playback.renderMode.subtitle"),
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
      title: t("settings.playback.groups.general.title"),
      subtitle: t("settings.playback.groups.general.subtitle"),
      expanded: Boolean(expanded.general),
      bodyHtml: generalBody
    })}
          ${this.renderCollapsibleRow({
      focusKey: "playback:toggle:audio",
      title: t("settings.playback.groups.audio.title"),
      subtitle: t("settings.playback.groups.audio.subtitle"),
      expanded: Boolean(expanded.audio),
      bodyHtml: audioBody
    })}
          ${this.renderCollapsibleRow({
      focusKey: "playback:toggle:subtitles",
      title: t("settings.playback.groups.subtitles.title"),
      subtitle: t("settings.playback.groups.subtitles.subtitle"),
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
      title: t("settings.trakt.openSettings"),
      subtitle: plannedSubtitle(t("settings.trakt.openSettingsSubtitle")),
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
          <p class="settings-about-copy">${t("settings.about.madeWithLove")}</p>
          <p class="settings-about-copy">${t("settings.about.version", { version: SETTINGS_VERSION_LABEL })}</p>
          <p class="settings-about-copy">${t("settings.about.portedBy")}</p>
        </div>
        <div class="settings-stack">
          ${this.renderActionRow({
      focusKey: "about:privacy",
      title: t("settings.about.privacyPolicy.title"),
      subtitle: t("settings.about.privacyPolicy.subtitle"),
      external: true
    })}
          ${this.renderActionRow({
      focusKey: "about:supporters",
      title: t("settings.about.supporters.title"),
      subtitle: t("settings.about.supporters.subtitle")
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

  async render({ refreshModel = true } = {}) {
    if (refreshModel || !this.model) {
      this.model = await this.collectModel();
    }
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
    const previousScrollState = !sectionChanged ? captureSettingsScrollState(contentSlot) : null;
    this.renderedSectionId = section.id;
    if (contentSlot) {
      contentSlot.innerHTML = this.renderSection(section, this.model);
      if (previousScrollState) {
        restoreSettingsScrollState(contentSlot, previousScrollState);
      }
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
        scrollIntoNearestView(dialogNode);
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
      setModernSidebarExpanded(this.container, true);
    }
    this.applyFocus();
  },

  async closeSidebarToNav() {
    this.syncNavFocusToActive();
    this.focusZone = "nav";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
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
    this.contentFocusKey = section.id === "appearance"
      ? this.getAppearanceThemeFocusKey()
      : null;
    await this.render({ refreshModel: false });
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
      this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
    }
  },

  moveContent(direction) {
    const before = this.container.querySelector(".settings-content-focusable.focused");
    const beforeFocusKey = String(before?.dataset?.focusKey || "");

    if (
      this.activeSection === "appearance"
      && direction === "up"
      && beforeFocusKey === "appearance:font"
    ) {
      const rememberedTheme = this.container.querySelector(
        focusKeySelector(".settings-content-focusable", this.getAppearanceThemeFocusKey())
      ) || this.container.querySelector(".settings-theme-card.settings-content-focusable");
      if (rememberedTheme) {
        before?.classList?.remove("focused");
        rememberedTheme.classList.add("focused");
        rememberedTheme.focus();
        this.contentFocusKey = String(rememberedTheme.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
        scrollIntoNearestView(rememberedTheme);
        return before !== rememberedTheme;
      }
    }

    if (
      this.activeSection === "appearance"
      && direction === "down"
      && isAppearanceThemeFocusKey(beforeFocusKey)
    ) {
      const themeCards = Array.from(this.container.querySelectorAll(".settings-theme-card.settings-content-focusable"));
      const beforeRect = before?.getBoundingClientRect?.();
      const beforeCenterY = beforeRect ? beforeRect.top + (beforeRect.height / 2) : 0;
      const beforeCenterX = beforeRect ? beforeRect.left + (beforeRect.width / 2) : 0;
      const themeBelow = themeCards
        .filter((card) => card !== before)
        .map((card) => {
          const rect = card.getBoundingClientRect();
          const centerY = rect.top + (rect.height / 2);
          const centerX = rect.left + (rect.width / 2);
          return {
            card,
            verticalDistance: centerY - beforeCenterY,
            horizontalDistance: Math.abs(centerX - beforeCenterX)
          };
        })
        .filter((entry) => entry.verticalDistance > 2)
        .sort((left, right) => {
          if (left.verticalDistance !== right.verticalDistance) {
            return left.verticalDistance - right.verticalDistance;
          }
          return left.horizontalDistance - right.horizontalDistance;
        });

      const nextTheme = themeBelow[0]?.card || null;
      if (nextTheme) {
        before?.classList?.remove("focused");
        nextTheme.classList.add("focused");
        nextTheme.focus();
        this.contentFocusKey = String(nextTheme.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
        scrollIntoNearestView(nextTheme);
        return before !== nextTheme;
      }
    }

    ScreenUtils.moveFocusDirectional(this.container, direction, ".settings-content-focusable");
    const after = this.container.querySelector(".settings-content-focusable.focused");
    if (after) {
      this.contentFocusKey = String(after.dataset.focusKey || "");
      if (isAppearanceThemeFocusKey(beforeFocusKey)) {
        this.rememberAppearanceThemeFocusKey(beforeFocusKey);
      }
      this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
      scrollIntoNearestView(after);
    }
    return before !== after;
  },

  handleWheelEvent(event) {
    const themeGrid = event?.target?.closest?.(".settings-theme-grid");
    if (!themeGrid) {
      return;
    }

    const deltaY = Number(event.deltaY || 0);
    if (!deltaY) {
      return;
    }

    const direction = deltaY < 0 ? "up" : "down";
    if (!isScrollContainerAtBoundary(themeGrid, direction)) {
      return;
    }

    const content = themeGrid.closest(".settings-content");
    if (!content) {
      return;
    }

    event.preventDefault();
    if (typeof content.scrollBy === "function") {
      content.scrollBy({
        top: deltaY,
        behavior: "auto"
      });
      return;
    }

    content.scrollTop += deltaY;
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
        this.contentFocusKey = this.activeSection === "appearance"
          ? this.getAppearanceThemeFocusKey()
          : String(firstContent.dataset.focusKey || "");
        this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
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
    this.rememberAppearanceThemeFocusKey(this.contentFocusKey);
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
        await this.render({ refreshModel: false });
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

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    await this.activateFocused();
  },

  consumeBackRequest() {
    if (!this.optionDialog) {
      return false;
    }
    this.closeOptionDialog();
    void this.render({ refreshModel: false });
    return true;
  },

  cleanup() {
    LocalStore.remove(SETTINGS_UI_STATE_KEY);
    if (this.container && this.handleWheelBound) {
      this.container.removeEventListener("wheel", this.handleWheelBound);
    }
    this.handleWheelBound = null;
    this.activeSection = null;
    this.focusZone = "nav";
    this.sidebarFocusIndex = 0;
    this.navIndex = -1;
    this.contentFocusKey = null;
    this.appearanceThemeFocusKey = null;
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
