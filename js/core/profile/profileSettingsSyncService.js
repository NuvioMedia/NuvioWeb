import { LocalStore } from "../storage/localStore.js";
import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ThemeStore } from "../../data/local/themeStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { MdbListSettingsStore } from "../../data/local/mdbListSettingsStore.js";
import { AnimeSkipSettingsStore } from "../../data/local/animeSkipSettingsStore.js";
import { ProfileManager } from "./profileManager.js";

const PULL_RPC = "sync_pull_profile_settings_blob";
const PUSH_RPC = "sync_push_profile_settings_blob";
const SETTINGS_SYNC_PLATFORM = "tv";
const CACHE_KEY = "profileSettingsSyncCache";

function resolveProfileId(profileId = null) {
  const raw = Number(profileId ?? ProfileManager.getActiveProfileId() ?? 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function cloneValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFeaturePayload(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return cloneValue(value) || {};
}

function normalizeBlob(blob = {}) {
  const features = isPlainObject(blob?.features) ? blob.features : {};
  return {
    version: Number(blob?.version || 1) || 1,
    features: Object.entries(features).reduce((accumulator, [featureName, featureValue]) => {
      accumulator[String(featureName || "").trim()] = normalizeFeaturePayload(featureValue);
      return accumulator;
    }, {})
  };
}

function readCache() {
  const cached = LocalStore.get(CACHE_KEY, {}) || {};
  return isPlainObject(cached) ? cached : {};
}

function getCachedBlob(profileId) {
  const cache = readCache();
  const key = String(resolveProfileId(profileId));
  if (!cache || !isPlainObject(cache[key])) {
    return null;
  }
  return normalizeBlob(cache[key]);
}

function setCachedBlob(profileId, blob) {
  const cache = readCache();
  cache[String(resolveProfileId(profileId))] = normalizeBlob(blob);
  LocalStore.set(CACHE_KEY, cache);
}

function shouldTreatAsMissingResource(error) {
  if (!error) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (typeof error.code === "string" && (error.code === "PGRST202" || error.code === "PGRST205")) {
    return true;
  }
  const message = String(error.message || "");
  return message.includes("PGRST202")
    || message.includes("PGRST205")
    || message.includes("Could not find the function")
    || message.includes("Could not find the table");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeSubtitleLanguage(value, fallback = "off") {
  const code = String(value ?? fallback).trim().toLowerCase();
  if (!code) {
    return fallback;
  }
  switch (code) {
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt_pt":
    case "por":
      return "pt";
    case "force":
    case "forc":
      return "forced";
    case "none":
      return "off";
    default:
      return code;
  }
}

function normalizeAudioLanguageForAndroid(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "system") {
    return "DEVICE";
  }
  if (normalized.toUpperCase() === "DEFAULT") {
    return "DEFAULT";
  }
  if (normalized.toUpperCase() === "DEVICE") {
    return "DEVICE";
  }
  return normalized.toLowerCase();
}

function normalizeAudioLanguageForWeb(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toUpperCase() === "DEVICE" || normalized.toUpperCase() === "DEFAULT") {
    return "system";
  }
  return normalized.toLowerCase();
}

function normalizeHomeLayoutForAndroid(value) {
  const normalized = String(value || "modern").trim().toLowerCase();
  switch (normalized) {
    case "classic":
      return "CLASSIC";
    case "grid":
      return "GRID";
    default:
      return "MODERN";
  }
}

function normalizeHomeLayoutForWeb(value) {
  const normalized = String(value || "").trim().toUpperCase();
  switch (normalized) {
    case "CLASSIC":
      return "classic";
    case "GRID":
      return "grid";
    default:
      return "modern";
  }
}

function normalizeTrailerTargetForAndroid(value) {
  return String(value || "").trim().toLowerCase() === "expanded_card"
    ? "EXPANDED_CARD"
    : "HERO_MEDIA";
}

function normalizeTrailerTargetForWeb(value) {
  return String(value || "").trim().toUpperCase() === "EXPANDED_CARD"
    ? "expanded_card"
    : "hero_media";
}

function normalizeTmdbLanguageForAndroid(value) {
  const normalized = String(value || "en-US").trim();
  if (!normalized) {
    return "en";
  }
  return normalized.split(/[-_]/)[0].toLowerCase() || "en";
}

function normalizeTmdbLanguageForWeb(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "it":
    case "it-it":
      return "it-IT";
    case "es":
    case "es-es":
      return "es-ES";
    case "en":
    case "en-us":
    default:
      return "en-US";
  }
}

function hexToAndroidColorInt(value, fallback = "#ffffff") {
  const match = String(value || fallback).trim().match(/^#([0-9a-f]{6})$/i);
  const hex = match ? match[1] : String(fallback || "#ffffff").replace(/^#/, "");
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return ((0xff << 24) | (red << 16) | (green << 8) | blue);
}

function androidColorIntToHex(value, fallback = "#ffffff") {
  const parsed = numberOrNull(value);
  if (parsed == null) {
    return fallback;
  }
  const unsigned = parsed >>> 0;
  return `#${unsigned.toString(16).slice(-6).padStart(6, "0")}`;
}

const FEATURE_ADAPTERS = {
  theme_settings: {
    export(profileId) {
      const theme = ThemeStore.getForProfile(profileId);
      return {
        selected_theme: String(theme.themeName || "WHITE").toUpperCase(),
        selected_font: String(theme.fontFamily || "INTER").toUpperCase()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.selected_theme)) {
        projected.selected_theme = String(raw.selected_theme).toUpperCase();
      }
      if (stringOrNull(raw.selected_font)) {
        projected.selected_font = String(raw.selected_font).toUpperCase();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (stringOrNull(raw.selected_theme)) {
        partial.themeName = String(raw.selected_theme).toUpperCase();
      }
      if (stringOrNull(raw.selected_font)) {
        partial.fontFamily = String(raw.selected_font).toUpperCase();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      ThemeStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  layout_settings: {
    export(profileId) {
      const layout = LayoutPreferences.getForProfile(profileId);
      return {
        selected_layout: normalizeHomeLayoutForAndroid(layout.homeLayout),
        has_chosen_layout: true,
        sidebar_collapsed_by_default: Boolean(layout.collapseSidebar),
        modern_sidebar_enabled: Boolean(layout.modernSidebar),
        modern_sidebar_blur_enabled: Boolean(layout.modernSidebarBlur),
        modern_landscape_posters_enabled: Boolean(layout.modernLandscapePostersEnabled),
        hero_section_enabled: Boolean(layout.heroSectionEnabled),
        search_discover_enabled: Boolean(layout.searchDiscoverEnabled),
        poster_labels_enabled: Boolean(layout.posterLabelsEnabled),
        catalog_addon_name_enabled: Boolean(layout.catalogAddonNameEnabled),
        catalog_type_suffix_enabled: Boolean(layout.catalogTypeSuffixEnabled),
        focused_poster_backdrop_expand_enabled: Boolean(layout.focusedPosterBackdropExpandEnabled),
        focused_poster_backdrop_expand_delay_seconds: Math.max(0, Number(layout.focusedPosterBackdropExpandDelaySeconds ?? 3) || 0),
        focused_poster_backdrop_trailer_enabled: Boolean(layout.focusedPosterBackdropTrailerEnabled),
        focused_poster_backdrop_trailer_muted: layout.focusedPosterBackdropTrailerMuted !== false,
        focused_poster_backdrop_trailer_playback_target: normalizeTrailerTargetForAndroid(layout.focusedPosterBackdropTrailerPlaybackTarget),
        poster_card_width_dp: Math.max(72, Number(layout.posterCardWidthDp ?? 126) || 126),
        poster_card_corner_radius_dp: Math.max(0, Number(layout.posterCardCornerRadiusDp ?? 12) || 12),
        detail_page_trailer_button_enabled: Boolean(layout.detailPageTrailerButtonEnabled),
        hide_unreleased_content: Boolean(layout.hideUnreleasedContent)
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.selected_layout)) {
        projected.selected_layout = normalizeHomeLayoutForAndroid(raw.selected_layout);
      }
      if (booleanOrNull(raw.has_chosen_layout) != null) {
        projected.has_chosen_layout = Boolean(raw.has_chosen_layout);
      }
      [
        "sidebar_collapsed_by_default",
        "modern_sidebar_enabled",
        "modern_sidebar_blur_enabled",
        "modern_landscape_posters_enabled",
        "hero_section_enabled",
        "search_discover_enabled",
        "poster_labels_enabled",
        "catalog_addon_name_enabled",
        "catalog_type_suffix_enabled",
        "focused_poster_backdrop_expand_enabled",
        "focused_poster_backdrop_trailer_enabled",
        "focused_poster_backdrop_trailer_muted",
        "detail_page_trailer_button_enabled",
        "hide_unreleased_content"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      if (numberOrNull(raw.focused_poster_backdrop_expand_delay_seconds) != null) {
        projected.focused_poster_backdrop_expand_delay_seconds = Math.max(0, Math.trunc(Number(raw.focused_poster_backdrop_expand_delay_seconds)));
      }
      if (stringOrNull(raw.focused_poster_backdrop_trailer_playback_target)) {
        projected.focused_poster_backdrop_trailer_playback_target = normalizeTrailerTargetForAndroid(raw.focused_poster_backdrop_trailer_playback_target);
      }
      if (numberOrNull(raw.poster_card_width_dp) != null) {
        projected.poster_card_width_dp = Math.max(72, Math.trunc(Number(raw.poster_card_width_dp)));
      }
      if (numberOrNull(raw.poster_card_corner_radius_dp) != null) {
        projected.poster_card_corner_radius_dp = Math.max(0, Math.trunc(Number(raw.poster_card_corner_radius_dp)));
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (stringOrNull(raw.selected_layout)) {
        partial.homeLayout = normalizeHomeLayoutForWeb(raw.selected_layout);
      }
      if (booleanOrNull(raw.sidebar_collapsed_by_default) != null) {
        partial.collapseSidebar = Boolean(raw.sidebar_collapsed_by_default);
      }
      if (booleanOrNull(raw.modern_sidebar_enabled) != null) {
        partial.modernSidebar = Boolean(raw.modern_sidebar_enabled);
      }
      if (booleanOrNull(raw.modern_sidebar_blur_enabled) != null) {
        partial.modernSidebarBlur = Boolean(raw.modern_sidebar_blur_enabled);
      }
      if (booleanOrNull(raw.modern_landscape_posters_enabled) != null) {
        partial.modernLandscapePostersEnabled = Boolean(raw.modern_landscape_posters_enabled);
      }
      if (booleanOrNull(raw.hero_section_enabled) != null) {
        partial.heroSectionEnabled = Boolean(raw.hero_section_enabled);
      }
      if (booleanOrNull(raw.search_discover_enabled) != null) {
        partial.searchDiscoverEnabled = Boolean(raw.search_discover_enabled);
      }
      if (booleanOrNull(raw.poster_labels_enabled) != null) {
        partial.posterLabelsEnabled = Boolean(raw.poster_labels_enabled);
      }
      if (booleanOrNull(raw.catalog_addon_name_enabled) != null) {
        partial.catalogAddonNameEnabled = Boolean(raw.catalog_addon_name_enabled);
      }
      if (booleanOrNull(raw.catalog_type_suffix_enabled) != null) {
        partial.catalogTypeSuffixEnabled = Boolean(raw.catalog_type_suffix_enabled);
      }
      if (booleanOrNull(raw.focused_poster_backdrop_expand_enabled) != null) {
        partial.focusedPosterBackdropExpandEnabled = Boolean(raw.focused_poster_backdrop_expand_enabled);
      }
      if (numberOrNull(raw.focused_poster_backdrop_expand_delay_seconds) != null) {
        partial.focusedPosterBackdropExpandDelaySeconds = Math.max(0, Math.trunc(Number(raw.focused_poster_backdrop_expand_delay_seconds)));
      }
      if (booleanOrNull(raw.focused_poster_backdrop_trailer_enabled) != null) {
        partial.focusedPosterBackdropTrailerEnabled = Boolean(raw.focused_poster_backdrop_trailer_enabled);
      }
      if (booleanOrNull(raw.focused_poster_backdrop_trailer_muted) != null) {
        partial.focusedPosterBackdropTrailerMuted = Boolean(raw.focused_poster_backdrop_trailer_muted);
      }
      if (stringOrNull(raw.focused_poster_backdrop_trailer_playback_target)) {
        partial.focusedPosterBackdropTrailerPlaybackTarget = normalizeTrailerTargetForWeb(raw.focused_poster_backdrop_trailer_playback_target);
      }
      if (numberOrNull(raw.poster_card_width_dp) != null) {
        partial.posterCardWidthDp = Math.max(72, Math.trunc(Number(raw.poster_card_width_dp)));
      }
      if (numberOrNull(raw.poster_card_corner_radius_dp) != null) {
        partial.posterCardCornerRadiusDp = Math.max(0, Math.trunc(Number(raw.poster_card_corner_radius_dp)));
      }
      if (booleanOrNull(raw.detail_page_trailer_button_enabled) != null) {
        partial.detailPageTrailerButtonEnabled = Boolean(raw.detail_page_trailer_button_enabled);
      }
      if (booleanOrNull(raw.hide_unreleased_content) != null) {
        partial.hideUnreleasedContent = Boolean(raw.hide_unreleased_content);
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      LayoutPreferences.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  player_settings: {
    export(profileId) {
      const settings = PlayerSettingsStore.getForProfile(profileId);
      return {
        preferred_audio_language: normalizeAudioLanguageForAndroid(settings.preferredAudioLanguage),
        subtitle_preferred_language: normalizeSubtitleLanguage(settings.subtitleStyle?.preferredLanguage ?? settings.subtitleLanguage, "off"),
        subtitle_secondary_language: normalizeSubtitleLanguage(settings.subtitleStyle?.secondaryPreferredLanguage ?? settings.secondarySubtitleLanguage, "off"),
        subtitle_size: Math.max(50, Math.trunc(Number(settings.subtitleStyle?.fontSize ?? 100) || 100)),
        subtitle_vertical_offset: Math.trunc(Number(settings.subtitleStyle?.verticalOffset ?? 0) || 0),
        subtitle_bold: Boolean(settings.subtitleStyle?.bold),
        subtitle_text_color: hexToAndroidColorInt(settings.subtitleStyle?.textColor, "#ffffff"),
        subtitle_outline_enabled: settings.subtitleStyle?.outlineEnabled !== false,
        subtitle_outline_color: hexToAndroidColorInt(settings.subtitleStyle?.outlineColor, "#000000"),
        audio_amplification_db: Math.max(0, Math.trunc(Number(settings.audioAmplificationDb ?? 0) || 0)),
        persist_audio_amplification: Boolean(settings.persistAudioAmplification),
        skip_intro_enabled: Boolean(settings.skipIntroEnabled),
        stream_auto_play_next_episode_enabled: Boolean(settings.autoplayNextEpisode)
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (stringOrNull(raw.preferred_audio_language)) {
        projected.preferred_audio_language = normalizeAudioLanguageForAndroid(raw.preferred_audio_language);
      }
      if (stringOrNull(raw.subtitle_preferred_language)) {
        projected.subtitle_preferred_language = normalizeSubtitleLanguage(raw.subtitle_preferred_language, "off");
      }
      if (stringOrNull(raw.subtitle_secondary_language)) {
        projected.subtitle_secondary_language = normalizeSubtitleLanguage(raw.subtitle_secondary_language, "off");
      }
      [
        "subtitle_bold",
        "subtitle_outline_enabled",
        "persist_audio_amplification",
        "skip_intro_enabled",
        "stream_auto_play_next_episode_enabled"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      [
        "subtitle_size",
        "subtitle_vertical_offset",
        "subtitle_text_color",
        "subtitle_outline_color",
        "audio_amplification_db"
      ].forEach((key) => {
        if (numberOrNull(raw[key]) != null) {
          projected[key] = Math.trunc(Number(raw[key]));
        }
      });
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      const subtitleStyle = {};
      const preferredAudioLanguage = normalizeAudioLanguageForWeb(raw.preferred_audio_language);
      const subtitleLanguage = stringOrNull(raw.subtitle_preferred_language)
        ? normalizeSubtitleLanguage(raw.subtitle_preferred_language, "off")
        : null;
      const secondarySubtitleLanguage = stringOrNull(raw.subtitle_secondary_language)
        ? normalizeSubtitleLanguage(raw.subtitle_secondary_language, "off")
        : null;

      if (preferredAudioLanguage) {
        partial.preferredAudioLanguage = preferredAudioLanguage;
      }
      if (subtitleLanguage) {
        partial.subtitleLanguage = subtitleLanguage;
        partial.subtitlesEnabled = subtitleLanguage !== "off";
        subtitleStyle.preferredLanguage = subtitleLanguage;
      }
      if (secondarySubtitleLanguage) {
        partial.secondarySubtitleLanguage = secondarySubtitleLanguage;
        subtitleStyle.secondaryPreferredLanguage = secondarySubtitleLanguage;
      }
      if (numberOrNull(raw.subtitle_size) != null) {
        subtitleStyle.fontSize = Math.max(50, Math.trunc(Number(raw.subtitle_size)));
      }
      if (numberOrNull(raw.subtitle_vertical_offset) != null) {
        subtitleStyle.verticalOffset = Math.trunc(Number(raw.subtitle_vertical_offset));
      }
      if (booleanOrNull(raw.subtitle_bold) != null) {
        subtitleStyle.bold = Boolean(raw.subtitle_bold);
      }
      if (numberOrNull(raw.subtitle_text_color) != null) {
        subtitleStyle.textColor = androidColorIntToHex(raw.subtitle_text_color, "#ffffff");
      }
      if (booleanOrNull(raw.subtitle_outline_enabled) != null) {
        subtitleStyle.outlineEnabled = Boolean(raw.subtitle_outline_enabled);
      }
      if (numberOrNull(raw.subtitle_outline_color) != null) {
        subtitleStyle.outlineColor = androidColorIntToHex(raw.subtitle_outline_color, "#000000");
      }
      if (numberOrNull(raw.audio_amplification_db) != null) {
        partial.audioAmplificationDb = Math.max(0, Math.trunc(Number(raw.audio_amplification_db)));
      }
      if (booleanOrNull(raw.persist_audio_amplification) != null) {
        partial.persistAudioAmplification = Boolean(raw.persist_audio_amplification);
      }
      if (booleanOrNull(raw.skip_intro_enabled) != null) {
        partial.skipIntroEnabled = Boolean(raw.skip_intro_enabled);
      }
      if (booleanOrNull(raw.stream_auto_play_next_episode_enabled) != null) {
        partial.autoplayNextEpisode = Boolean(raw.stream_auto_play_next_episode_enabled);
      }
      if (Object.keys(subtitleStyle).length) {
        partial.subtitleStyle = subtitleStyle;
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      PlayerSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  tmdb_settings: {
    export(profileId) {
      const settings = TmdbSettingsStore.getForProfile(profileId);
      return {
        tmdb_enabled: Boolean(settings.enabled),
        tmdb_language: normalizeTmdbLanguageForAndroid(settings.language),
        tmdb_use_artwork: settings.useArtwork !== false,
        tmdb_use_basic_info: settings.useBasicInfo !== false,
        tmdb_use_details: settings.useDetails !== false
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      [
        "tmdb_enabled",
        "tmdb_use_artwork",
        "tmdb_use_basic_info",
        "tmdb_use_details"
      ].forEach((key) => {
        if (booleanOrNull(raw[key]) != null) {
          projected[key] = Boolean(raw[key]);
        }
      });
      if (stringOrNull(raw.tmdb_language)) {
        projected.tmdb_language = normalizeTmdbLanguageForAndroid(raw.tmdb_language);
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.tmdb_enabled) != null) {
        partial.enabled = Boolean(raw.tmdb_enabled);
      }
      if (stringOrNull(raw.tmdb_language)) {
        partial.language = normalizeTmdbLanguageForWeb(raw.tmdb_language);
      }
      if (booleanOrNull(raw.tmdb_use_artwork) != null) {
        partial.useArtwork = Boolean(raw.tmdb_use_artwork);
      }
      if (booleanOrNull(raw.tmdb_use_basic_info) != null) {
        partial.useBasicInfo = Boolean(raw.tmdb_use_basic_info);
      }
      if (booleanOrNull(raw.tmdb_use_details) != null) {
        partial.useDetails = Boolean(raw.tmdb_use_details);
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      TmdbSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  mdblist_settings: {
    export(profileId) {
      const settings = MdbListSettingsStore.getForProfile(profileId);
      return {
        mdblist_enabled: Boolean(settings.enabled),
        mdblist_api_key: String(settings.apiKey || "").trim()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (booleanOrNull(raw.mdblist_enabled) != null) {
        projected.mdblist_enabled = Boolean(raw.mdblist_enabled);
      }
      if (raw.mdblist_api_key != null) {
        projected.mdblist_api_key = String(raw.mdblist_api_key || "").trim();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.mdblist_enabled) != null) {
        partial.enabled = Boolean(raw.mdblist_enabled);
      }
      if (raw.mdblist_api_key != null) {
        partial.apiKey = String(raw.mdblist_api_key || "").trim();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      MdbListSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  },
  animeskip_settings: {
    export(profileId) {
      const settings = AnimeSkipSettingsStore.getForProfile(profileId);
      return {
        animeskip_enabled: Boolean(settings.enabled),
        animeskip_client_id: String(settings.clientId || "").trim()
      };
    },
    project(rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const projected = {};
      if (booleanOrNull(raw.animeskip_enabled) != null) {
        projected.animeskip_enabled = Boolean(raw.animeskip_enabled);
      }
      if (raw.animeskip_client_id != null) {
        projected.animeskip_client_id = String(raw.animeskip_client_id || "").trim();
      }
      return projected;
    },
    import(profileId, rawFeature = {}) {
      const raw = normalizeFeaturePayload(rawFeature);
      const partial = {};
      if (booleanOrNull(raw.animeskip_enabled) != null) {
        partial.enabled = Boolean(raw.animeskip_enabled);
      }
      if (raw.animeskip_client_id != null) {
        partial.clientId = String(raw.animeskip_client_id || "").trim();
      }
      if (!Object.keys(partial).length) {
        return false;
      }
      AnimeSkipSettingsStore.setForProfile(profileId, partial, { silentSync: true });
      return true;
    }
  }
};

const SUPPORTED_FEATURE_NAMES = Object.keys(FEATURE_ADAPTERS);

function buildComparableFeaturesFromBlob(blob = {}) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(blob?.features?.[featureName] || {});
    return accumulator;
  }, {});
}

function buildComparableFeaturesFromLocal(profileId) {
  return SUPPORTED_FEATURE_NAMES.reduce((accumulator, featureName) => {
    const exported = FEATURE_ADAPTERS[featureName].export(profileId);
    accumulator[featureName] = FEATURE_ADAPTERS[featureName].project(exported);
    return accumulator;
  }, {});
}

function buildComparableSignatureFromBlob(blob = {}) {
  return stableStringify(buildComparableFeaturesFromBlob(blob));
}

function buildComparableSignatureFromLocal(profileId) {
  return stableStringify(buildComparableFeaturesFromLocal(profileId));
}

function buildOutgoingBlob(profileId, baseBlob = null) {
  const normalizedBase = normalizeBlob(baseBlob || {});
  const nextFeatures = {
    ...normalizedBase.features
  };

  SUPPORTED_FEATURE_NAMES.forEach((featureName) => {
    nextFeatures[featureName] = {
      ...normalizeFeaturePayload(nextFeatures[featureName]),
      ...FEATURE_ADAPTERS[featureName].export(profileId)
    };
  });

  return {
    version: 1,
    features: nextFeatures
  };
}

function extractBlobFromResponse(response) {
  const payload = Array.isArray(response)
    ? (response[0] || null)
    : response;
  const blob = payload?.settings_json ?? payload?.settingsJson ?? null;
  if (!isPlainObject(blob)) {
    return null;
  }
  return normalizeBlob(blob);
}

function applyRemoteBlob(profileId, blob) {
  let applied = false;
  SUPPORTED_FEATURE_NAMES.forEach((featureName) => {
    const didApply = FEATURE_ADAPTERS[featureName].import(profileId, blob?.features?.[featureName] || {});
    if (didApply) {
      applied = true;
    }
  });
  return applied;
}

export const ProfileSettingsSyncService = {

  async pull(profileId = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const response = await SupabaseApi.rpc(PULL_RPC, {
        p_profile_id: resolvedProfileId,
        p_platform: SETTINGS_SYNC_PLATFORM
      }, true);
      const blob = extractBlobFromResponse(response);
      if (!blob) {
        return false;
      }

      setCachedBlob(resolvedProfileId, blob);

      const remoteSignature = buildComparableSignatureFromBlob(blob);
      const localSignature = buildComparableSignatureFromLocal(resolvedProfileId);
      if (remoteSignature === localSignature) {
        return false;
      }

      return applyRemoteBlob(String(resolvedProfileId), blob);
    } catch (error) {
      if (shouldTreatAsMissingResource(error)) {
        return false;
      }
      console.warn("Profile settings sync pull failed", error);
      return false;
    }
  },

  async push(profileId = null) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const resolvedProfileId = resolveProfileId(profileId);
      const blob = buildOutgoingBlob(String(resolvedProfileId), getCachedBlob(resolvedProfileId));
      await SupabaseApi.rpc(PUSH_RPC, {
        p_profile_id: resolvedProfileId,
        p_settings_json: blob,
        p_platform: SETTINGS_SYNC_PLATFORM
      }, true);
      setCachedBlob(resolvedProfileId, blob);
      return true;
    } catch (error) {
      if (shouldTreatAsMissingResource(error)) {
        return false;
      }
      console.warn("Profile settings sync push failed", error);
      return false;
    }
  }

};
