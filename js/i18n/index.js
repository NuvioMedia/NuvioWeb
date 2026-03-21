import { ThemeStore } from "../data/local/themeStore.js";

const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = [
  "en",
  "es",
  "fr",
  "hi",
  "hu",
  "it",
  "ja",
  "nl",
  "pl",
  "ro",
  "se",
  "sk",
  "sl",
  "tr",
  "vi"
];

const KEY_ALIASES = {
  "common.add": "plugin_add_btn",
  "common.notSet": "mdblist_not_set",
  "common.systemDefault": "appearance_language_system",
  "sidebar.addons": "nav_addons",
  "sidebar.expandSidebar": "cd_expand_sidebar",
  "sidebar.home": "nav_home",
  "sidebar.library": "nav_library",
  "sidebar.search": "nav_search",
  "sidebar.settings": "nav_settings",
  "settings.account.signInWithQr": "account_signin_qr_title",
  "settings.account.signInWithQrSubtitle": "account_signin_qr_subtitle",
  "settings.account.signOut": "account_sign_out",
  "settings.account.syncNote": "account_sync_description",
  "settings.appearance.appFont": "appearance_font",
  "settings.appearance.appFontSubtitle": "appearance_font_subtitle",
  "settings.appearance.appLanguage": "appearance_language",
  "settings.appearance.appLanguageSubtitle": "appearance_language_subtitle",
  "settings.about.madeWithLove": "about_made_with_love",
  "settings.about.privacyPolicy.subtitle": "about_privacy_policy_subtitle",
  "settings.about.privacyPolicy.title": "about_privacy_policy",
  "settings.about.supporters.subtitle": "about_supporters_contributors_subtitle",
  "settings.about.supporters.title": "about_supporters_contributors",
  "settings.about.version": "about_version",
  "settings.dialogs.backdropExpandDelay": "layout_expand_delay",
  "settings.dialogs.modernTrailerPlaybackLocation": "layout_trailer_location",
  "settings.dialogs.preferredAudioLanguage": "audio_preferred_lang",
  "settings.dialogs.selectFont": "appearance_font_dialog_title",
  "settings.dialogs.selectLanguage": "appearance_language_dialog_title",
  "settings.dialogs.selectTmdbLanguage": "tmdb_language_dialog_title",
  "settings.integration.animeskip.enable.subtitle": "animeskip_enable_subtitle",
  "settings.integration.animeskip.enable.title": "animeskip_enable_title",
  "settings.integration.animeskip.label": "animeskip_title",
  "settings.integration.animeskip.subtitle": "settings_animeskip_subtitle",
  "settings.integration.animeskip.clientId.prompt": "animeskip_client_id_title",
  "settings.integration.animeskip.clientId.subtitle": "animeskip_client_id_subtitle",
  "settings.integration.animeskip.clientId.title": "animeskip_client_id_title",
  "settings.integration.mdblist.apiKey.prompt": "mdblist_api_key_title",
  "settings.integration.mdblist.apiKey.subtitle": "mdblist_api_key_subtitle",
  "settings.integration.mdblist.apiKey.title": "mdblist_api_key_title",
  "settings.integration.mdblist.enable.subtitle": "mdblist_enable_subtitle",
  "settings.integration.mdblist.enable.title": "mdblist_enable_title",
  "settings.integration.mdblist.label": "mdblist_title",
  "settings.integration.mdblist.subtitle": "settings_mdblist_subtitle",
  "settings.integration.tmdb.artwork.subtitle": "tmdb_artwork_subtitle",
  "settings.integration.tmdb.artwork.title": "tmdb_artwork_title",
  "settings.integration.tmdb.basicInfo.subtitle": "tmdb_basic_info_subtitle",
  "settings.integration.tmdb.basicInfo.title": "tmdb_basic_info_title",
  "settings.integration.tmdb.details.subtitle": "tmdb_details_subtitle",
  "settings.integration.tmdb.details.title": "tmdb_details_title",
  "settings.integration.tmdb.enable.subtitle": "tmdb_enable_subtitle",
  "settings.integration.tmdb.enable.title": "tmdb_enable_title",
  "settings.integration.tmdb.label": "mdblist_tmdb_title",
  "settings.integration.tmdb.language.subtitle": "tmdb_language_subtitle",
  "settings.integration.tmdb.language.title": "tmdb_language_title",
  "settings.integration.tmdb.subtitle": "settings_tmdb_subtitle",
  "settings.layout.addonName.subtitle": "layout_addon_name_sub",
  "settings.layout.addonName.title": "layout_addon_name",
  "settings.layout.autoplayTrailer.subtitle": "layout_autoplay_trailer_sub",
  "settings.layout.autoplayTrailer.title": "layout_autoplay_trailer",
  "settings.layout.autoplayTrailerExpandedCard.subtitle": "layout_autoplay_trailer_expanded_sub",
  "settings.layout.autoplayTrailerExpandedCard.title": "layout_autoplay_trailer_expanded",
  "settings.layout.blurUnwatched.subtitle": "layout_blur_unwatched_sub",
  "settings.layout.blurUnwatched.title": "layout_blur_unwatched",
  "settings.layout.catalogType.subtitle": "layout_catalog_type_sub",
  "settings.layout.catalogType.title": "layout_catalog_type",
  "settings.layout.collapseSidebar.subtitle": "layout_collapse_sidebar_sub",
  "settings.layout.collapseSidebar.title": "layout_collapse_sidebar",
  "settings.layout.focusedPosterExpand.subtitle": "layout_expand_poster_sub",
  "settings.layout.focusedPosterExpand.title": "layout_expand_poster",
  "settings.layout.focusedPosterExpandDelay.subtitle": "layout_expand_delay_sub",
  "settings.layout.focusedPosterExpandDelay.title": "layout_expand_delay",
  "settings.layout.groups.detailPage.subtitle": "layout_section_detail_desc",
  "settings.layout.groups.detailPage.title": "layout_section_detail",
  "settings.layout.groups.focusedPoster.subtitle": "layout_section_focused_desc",
  "settings.layout.groups.focusedPoster.title": "layout_section_focused",
  "settings.layout.groups.homeContent.subtitle": "layout_section_content_desc",
  "settings.layout.groups.homeContent.title": "layout_section_content",
  "settings.layout.groups.homeLayout.subtitle": "layout_section_home_desc",
  "settings.layout.groups.homeLayout.title": "layout_section_home",
  "settings.layout.heroSection.subtitle": "layout_show_hero_sub",
  "settings.layout.heroSection.title": "layout_show_hero",
  "settings.layout.hideUnreleased.subtitle": "layout_hide_unreleased_sub",
  "settings.layout.hideUnreleased.title": "layout_hide_unreleased",
  "settings.layout.homeLayouts.classic.caption": "layout_classic_desc",
  "settings.layout.homeLayouts.classic.label": "layout_classic",
  "settings.layout.homeLayouts.grid.caption": "layout_grid_desc",
  "settings.layout.homeLayouts.grid.label": "layout_grid",
  "settings.layout.homeLayouts.modern.caption": "layout_modern_desc",
  "settings.layout.homeLayouts.modern.label": "layout_modern",
  "settings.layout.landscapePosters.subtitle": "layout_landscape_posters_sub",
  "settings.layout.landscapePosters.title": "layout_landscape_posters",
  "settings.layout.modernSidebar.subtitle": "layout_modern_sidebar_sub",
  "settings.layout.modernSidebar.title": "layout_modern_sidebar",
  "settings.layout.modernSidebarBlur.subtitle": "layout_modern_sidebar_blur_sub",
  "settings.layout.modernSidebarBlur.title": "layout_modern_sidebar_blur",
  "settings.layout.posterLabels.subtitle": "layout_poster_labels_sub",
  "settings.layout.posterLabels.title": "layout_poster_labels",
  "settings.layout.preferExternalMeta.subtitle": "layout_prefer_external_meta_sub",
  "settings.layout.preferExternalMeta.title": "layout_prefer_external_meta",
  "settings.layout.searchDiscover.subtitle": "layout_show_discover_sub",
  "settings.layout.searchDiscover.title": "layout_show_discover",
  "settings.layout.showTrailerButton.subtitle": "layout_trailer_button_sub",
  "settings.layout.showTrailerButton.title": "layout_trailer_button",
  "settings.layout.trailerMuted.subtitle": "layout_trailer_muted_sub_preview",
  "settings.layout.trailerMuted.title": "layout_trailer_muted",
  "settings.layout.trailerMutedExpandedCard.subtitle": "layout_trailer_muted_sub_expanded",
  "settings.layout.trailerMutedExpandedCard.title": "layout_trailer_muted",
  "settings.layout.trailerTarget.subtitle": "layout_trailer_location_sub",
  "settings.layout.trailerTarget.title": "layout_trailer_location",
  "settings.layout.trailerTargets.expandedCard": "layout_trailer_expanded_card",
  "settings.layout.trailerTargets.heroMedia": "layout_trailer_hero_media",
  "settings.playback.autoplayNextEpisode.subtitle": "autoplay_next_episode_sub",
  "settings.playback.autoplayNextEpisode.title": "autoplay_next_episode",
  "settings.playback.autoplayTrailer.subtitle": "audio_autoplay_trailers_sub",
  "settings.playback.autoplayTrailer.title": "audio_autoplay_trailers",
  "settings.playback.groups.audio.subtitle": "playback_section_audio_desc",
  "settings.playback.groups.audio.title": "playback_section_audio",
  "settings.playback.groups.general.subtitle": "playback_section_general_desc",
  "settings.playback.groups.general.title": "playback_section_general",
  "settings.playback.groups.stream.subtitle": "playback_section_player_desc",
  "settings.playback.groups.stream.title": "playback_section_player",
  "settings.playback.groups.subtitles.subtitle": "playback_section_subtitles_desc",
  "settings.playback.groups.subtitles.title": "playback_section_subtitles",
  "settings.playback.preferredAudio.title": "audio_preferred_lang",
  "settings.playback.subtitleLanguage.title": "sub_preferred_lang",
  "settings.playback.playerEngine.title": "player_engine_title",
  "settings.playback.playerEngine.subtitle": "player_engine_subtitle",
  "settings.playback.engines.auto": "player_engine_auto",
  "settings.playback.engines.native": "player_engine_native",
  "settings.playback.engines.web": "player_engine_web",
  "settings.dialogs.selectPlayerEngine": "dialog_select_player_engine",
  "settings.plugins.addRepository": "plugin_add_repository",
  "settings.plugins.manageFromPhone": "plugin_manage_from_phone_title",
  "settings.plugins.manageFromPhoneSubtitle": "plugin_manage_from_phone_subtitle",
  "settings.plugins.providersHeading": "plugin_providers_section",
  "settings.plugins.repositoriesHeading": "plugin_repositories_section",
  "settings.profiles.manageProfiles": "profile_manage_title",
  "settings.sections.about.label": "about_title",
  "settings.sections.about.subtitle": "about_subtitle",
  "settings.sections.account.label": "settings_account",
  "settings.sections.account.subtitle": "settings_account_subtitle",
  "settings.sections.appearance.label": "appearance_title",
  "settings.sections.appearance.subtitle": "appearance_subtitle",
  "settings.sections.integration.label": "settings_integrations_section",
  "settings.sections.integration.subtitle": "settings_integrations_section_subtitle",
  "settings.sections.layout.label": "settings_layout",
  "settings.sections.layout.subtitle": "settings_layout_subtitle",
  "settings.sections.playback.label": "settings_playback",
  "settings.sections.playback.subtitle": "settings_playback_subtitle",
  "settings.sections.plugins.label": "settings_plugins",
  "settings.sections.plugins.subtitle": "settings_plugins_section_subtitle",
  "settings.sections.profiles.label": "settings_profiles",
  "settings.sections.profiles.subtitle": "settings_profiles_subtitle",
  "settings.sections.trakt.label": "trakt_watch_progress_source_trakt",
  "settings.sections.trakt.subtitle": "settings_trakt_subtitle",
  "settings.status.signedIn": "account_signed_in_label",
  "settings.trakt.openSettings": "trakt_watch_progress_source_trakt",
  "settings.trakt.openSettingsSubtitle": "settings_trakt_subtitle",
  "auth.account.loadingAccount": "account_loading",
  "auth.account.signIn": "account_signin_qr_title",
  "auth.account.signInCopy": "account_sign_in_description",
  "auth.account.signInSubtitle": "account_signin_qr_subtitle",
  "auth.account.signedInAs": "account_signed_in_label",
  "auth.account.signOut": "account_sign_out",
  "auth.account.title": "account_title",
  "auth.qr.approved": "auth_qr_finishing",
  "auth.qr.back": "auth_qr_back",
  "auth.qr.cardAriaLabel": "auth_qr_account_login",
  "auth.qr.cardSubtitleSignedIn": "auth_qr_synced_data",
  "auth.qr.cardSubtitleSignedOut": "auth_qr_scan_instruction",
  "auth.qr.cardTitle": "auth_qr_account_login",
  "auth.qr.codeLabel": "auth_qr_code_label",
  "auth.qr.continue": "auth_qr_continue",
  "auth.qr.continueWithoutAccount": "auth_qr_continue_without_account",
  "auth.qr.expired": "auth_qr_unavailable",
  "auth.qr.leftDescriptionSignedIn": "auth_qr_connected",
  "auth.qr.leftDescriptionSignedOut": "auth_qr_phone_hint",
  "auth.qr.preparing": "auth_qr_generating",
  "auth.qr.refresh": "auth_qr_refresh",
  "auth.qr.scanAndSignIn": "auth_qr_scan_instruction",
  "auth.qr.title": "auth_qr_title",
  "auth.qr.unavailable": "auth_qr_unavailable",
  "auth.signIn.back": "auth_qr_back",
  "auth.signIn.description": "auth_signin_tv_disabled",
  "auth.signIn.emailPrompt": "debug_email_placeholder",
  "auth.signIn.openQrLogin": "auth_signin_qr_btn",
  "auth.signIn.passwordPrompt": "debug_password_placeholder",
  "auth.signIn.title": "auth_signin_title",
  "auth.syncCode.back": "auth_qr_back",
  "auth.syncCode.title": "account_sync_code_title"
};

const warnedKeys = new Set();
let activeMessages = Object.create(null);
let currentLocale = DEFAULT_LOCALE;
let initialized = false;
let initPromise = null;
let baseMessagesPromise = null;
const localeMessagesCache = new Map();

function normalizeLocale(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  const [language] = raw.split(/[-_]/);
  return language || raw;
}

function detectSystemLocale() {
  const candidates = Array.isArray(globalThis.navigator?.languages)
    ? globalThis.navigator.languages
    : [globalThis.navigator?.language];
  return candidates.find(Boolean) || DEFAULT_LOCALE;
}

function resolvePreferredLocale(preferred = null) {
  const requested = preferred === null
    ? ThemeStore.get().language || detectSystemLocale()
    : preferred;
  const normalized = normalizeLocale(requested);
  if (!normalized || normalized === "system") {
    return normalizeLocale(detectSystemLocale()) || DEFAULT_LOCALE;
  }
  if (SUPPORTED_LOCALES.includes(normalized)) {
    return normalized;
  }
  return DEFAULT_LOCALE;
}

function interpolate(template, params = {}) {
  const values = Array.isArray(params) ? params : Object.values(params || {});
  let sequentialIndex = 0;
  return String(template || "")
    .replace(/\{\{(\w+)\}\}/g, (_, key) => String(params?.[key] ?? ""))
    .replace(/%(\d+)\$[a-z]/gi, (_, index) => String(values[Number(index) - 1] ?? ""))
    .replace(/%[a-z]/gi, () => String(values[sequentialIndex++] ?? ""))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, "\"");
}

function parseStringsXml(source) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(source, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("Invalid strings.xml");
  }

  return Array.from(xml.querySelectorAll("string[name]")).reduce((messages, node) => {
    const name = String(node.getAttribute("name") || "").trim();
    if (!name) {
      return messages;
    }
    messages[name] = String(node.textContent || "");
    return messages;
  }, {});
}

function loadXmlFileXhr(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onload = () => {
      // status 0 is returned for successful file:// loads in webOS
      if (xhr.status === 200 || xhr.status === 0) {
        try {
          resolve(parseStringsXml(xhr.responseText));
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`XHR status ${xhr.status} for ${url}`));
      }
    };
    xhr.onerror = () => reject(new Error(`XHR error for ${url}`));
    xhr.send();
  });
}

async function loadXmlFile(relativePath) {
  const candidates = [
    `res/${relativePath}`,
    `dist/res/${relativePath}`
  ];

  for (const candidate of candidates) {
    try {
      return await loadXmlFileXhr(candidate);
    } catch (_) {
      // try next candidate
    }
  }

  throw new Error(`Unable to load translation file: ${relativePath}`);
}

async function loadBaseMessages() {
  if (!baseMessagesPromise) {
    baseMessagesPromise = loadXmlFile("values/strings.xml");
  }
  return baseMessagesPromise;
}

async function loadLocaleMessages(locale) {
  if (localeMessagesCache.has(locale)) {
    return await localeMessagesCache.get(locale);
  }

  const promise = (async () => {
    const base = await loadBaseMessages();
    if (locale === DEFAULT_LOCALE) {
      return { ...base };
    }

    try {
      const localized = await loadXmlFile(`values-${locale}/strings.xml`);
      return {
        ...base,
        ...localized
      };
    } catch (_) {
      return { ...base };
    }
  })();

  localeMessagesCache.set(locale, promise);
  const messages = await promise;
  localeMessagesCache.set(locale, messages);
  return messages;
}

function warnMissingKey(locale, key) {
  const warningKey = `${locale}:${key}`;
  if (warnedKeys.has(warningKey)) {
    return;
  }
  warnedKeys.add(warningKey);
  console.warn(`Missing translation for "${key}" in locale "${locale}"`);
}

export const I18n = {

  async init(preferred = null) {
    const locale = resolvePreferredLocale(preferred);
    if (initialized && locale === currentLocale && Object.keys(activeMessages).length > 0) {
      return currentLocale;
    }
    if (initPromise && locale === currentLocale) {
      return await initPromise;
    }

    currentLocale = locale;
    initPromise = (async () => {
      activeMessages = await loadLocaleMessages(locale);
      initialized = true;
      return currentLocale;
    })();

    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  },

  getLocale() {
    return initialized ? currentLocale : resolvePreferredLocale();
  },

  resolveLocale(preferred = null) {
    return resolvePreferredLocale(preferred);
  },

  getSupportedLocales() {
    return [...SUPPORTED_LOCALES];
  },

  t(key, params = {}, options = {}) {
    const locale = normalizeLocale(options?.locale ?? currentLocale) || resolvePreferredLocale(options?.locale ?? null);

    if (typeof activeMessages[key] === "string") {
      return interpolate(activeMessages[key], params);
    }

    const aliasedKey = KEY_ALIASES[key];
    if (aliasedKey && typeof activeMessages[aliasedKey] === "string") {
      return interpolate(activeMessages[aliasedKey], params);
    }

    warnMissingKey(locale, key);
    return interpolate(options?.fallback ?? key, params);
  },

  apply() {
    const locale = this.getLocale();
    if (typeof document !== "undefined" && document?.documentElement) {
      document.documentElement.lang = locale;
    }
    return locale;
  }

};
