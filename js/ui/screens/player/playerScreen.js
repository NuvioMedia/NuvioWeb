import { PlayerController } from "../../../core/player/playerController.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { I18n } from "../../../i18n/index.js";
import { Environment } from "../../../platform/environment.js";
import { Router } from "../../navigation/router.js";

const CLOCK_FORMATTER_CACHE = new Map();
const LANGUAGE_DISPLAY_NAME_CACHE = new Map();
const AUDIO_TRACK_LANGUAGE_KEY_BY_CODE = {
  ar: "common.arabic",
  de: "common.german",
  en: "common.english",
  es: "common.spanish",
  fr: "common.french",
  hi: "common.hindi",
  hu: "common.hungarian",
  it: "common.italian",
  ja: "common.japanese",
  ko: "common.korean",
  nl: "common.dutch",
  pl: "common.polish",
  pt: "common.portuguese",
  ro: "common.romanian",
  ru: "common.russian",
  sk: "common.slovak",
  sl: "common.slovenian",
  sv: "common.swedish",
  tr: "common.turkish",
  vi: "common.vietnamese",
  zh: "common.chinese"
};
const LANGUAGE_CODE_ALIASES = {
  ara: "ar",
  chi: "zh",
  deu: "de",
  dut: "nl",
  eng: "en",
  fra: "fr",
  fre: "fr",
  ger: "de",
  hin: "hi",
  hun: "hu",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nld: "nl",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rum: "ro",
  rus: "ru",
  slk: "sk",
  slo: "sk",
  slv: "sl",
  spa: "es",
  swe: "sv",
  tur: "tr",
  und: "",
  vie: "vi",
  zho: "zh"
};
const SUBTITLE_LANGUAGE_OFF_KEY = "__off__";
const SUBTITLE_LANGUAGE_UNKNOWN_KEY = "__unknown__";
const SUBTITLE_TEXT_COLORS = ["#FFFFFF", "#D9D9D9", "#FFD700", "#00E5FF", "#FF5C5C", "#00FF88"];
const SUBTITLE_OUTLINE_COLORS = ["#000000", "#FFFFFF", "#00E5FF", "#FF5C5C"];
const SUBTITLE_DELAY_STEP_MS = 250;
const SUBTITLE_FONT_STEP = 10;
const SUBTITLE_VERTICAL_OFFSET_STEP = 2;
const AUDIO_AMPLIFICATION_MIN_DB = 0;
const AUDIO_AMPLIFICATION_MAX_DB = 10;
const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function buildIndexedLabel(baseLabel, index) {
  return `${baseLabel} ${index + 1}`;
}

function subtitleLabel(index) {
  return buildIndexedLabel(t("subtitle_dialog_title", {}, "Subtitle"), index);
}

function audioLabel(index) {
  return buildIndexedLabel(t("audio_dialog_title", {}, "Audio"), index);
}

function cleanDisplayText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableText(value) {
  return cleanDisplayText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function pushUniqueText(target, value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return;
  }
  const normalized = normalizeComparableText(text);
  if (target.some((entry) => normalizeComparableText(entry) === normalized)) {
    return;
  }
  target.push(text);
}

function flattenTrackMetadata(value, into = []) {
  if (value === null || value === undefined) {
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  const text = cleanDisplayText(value);
  if (text) {
    into.push(text);
  }
  return into;
}

function isGenericAudioTrackLabel(value) {
  const normalized = normalizeComparableText(value);
  return normalized === ""
    || /^audio\s*\d*$/.test(normalized)
    || /^track\s*\d*$/.test(normalized);
}

function getTrackMetadataStrings(track = {}) {
  const values = [];
  [
    track?.name,
    track?.label,
    track?.title,
    track?.language,
    track?.lang,
    track?.channels,
    track?.characteristics,
    track?.role,
    track?.accessibility,
    track?.codec,
    track?.codecs,
    track?.audioCodec,
    track?.extraInfo,
    track?.attrs
  ].forEach((value) => flattenTrackMetadata(value, values));
  return values;
}

function normalizeTrackLanguageCode(value) {
  const raw = cleanDisplayText(value).toLowerCase();
  if (!raw || raw === "unknown") {
    return "";
  }
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(raw)) {
    return "";
  }
  const parts = raw.split(/[-_]/);
  const base = LANGUAGE_CODE_ALIASES[parts[0]] ?? parts[0];
  if (!base) {
    return "";
  }
  return [base, ...parts.slice(1)].join("-");
}

function getTrackLanguageValue(track = {}) {
  const candidates = [
    track?.language,
    track?.lang,
    track?.track_lang,
    track?.extraInfo?.track_lang,
    track?.extraInfo?.language
  ];
  return candidates.find((value) => cleanDisplayText(value)) || "";
}

function getTrackLanguageLabel(track = {}) {
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  if (!rawLanguage) {
    return "";
  }

  const normalizedCode = normalizeTrackLanguageCode(rawLanguage);
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : "en";
  if (normalizedCode) {
    const cacheKey = `${locale}::${normalizedCode}`;
    if (!LANGUAGE_DISPLAY_NAME_CACHE.has(cacheKey)) {
      let displayName = "";
      try {
        if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
          const formatter = new Intl.DisplayNames([locale], { type: "language" });
          displayName = cleanDisplayText(formatter.of(normalizedCode));
        }
      } catch (_) {
        displayName = "";
      }
      if (!displayName) {
        const fallbackKey = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[normalizedCode.split("-")[0]];
        displayName = fallbackKey ? t(fallbackKey, {}, rawLanguage.toUpperCase()) : rawLanguage.toUpperCase();
      }
      LANGUAGE_DISPLAY_NAME_CACHE.set(cacheKey, displayName);
    }
    return LANGUAGE_DISPLAY_NAME_CACHE.get(cacheKey) || "";
  }

  return rawLanguage;
}

function getMeaningfulTrackLabel(track = {}) {
  const candidates = [track?.name, track?.label, track?.title];
  for (const candidate of candidates) {
    const text = cleanDisplayText(candidate);
    if (!text || isGenericAudioTrackLabel(text)) {
      continue;
    }
    if (normalizeTrackLanguageCode(text)) {
      continue;
    }
    return text;
  }
  return "";
}

function detectChannelLayout(value) {
  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  const explicitLayout = text.match(/\b(7\.1|5\.1|2\.1|2\.0|1\.0)\b/);
  if (explicitLayout) {
    if (explicitLayout[1] === "2.0") {
      return t("player.track.stereo", {}, "Stereo");
    }
    return explicitLayout[1];
  }
  const numericMatch = text.match(/\b([0-9]{1,2})(?:ch| channels?)\b/) || text.match(/^([0-9]{1,2})(?:\/[a-z0-9.]+)?$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels >= 8) {
    return "7.1";
  }
  if (channels >= 6) {
    return "5.1";
  }
  if (channels === 2) {
    return t("player.track.stereo", {}, "Stereo");
  }
  if (channels === 1) {
    return "1.0";
  }
  return `${channels}ch`;
}

function getTrackDescriptorLabels(track = {}) {
  const descriptors = [];
  const metadataStrings = getTrackMetadataStrings(track);
  const searchText = metadataStrings.join(" ").toLowerCase();

  const channelCandidates = [track?.channels, ...metadataStrings];
  for (const candidate of channelCandidates) {
    const channelLayout = detectChannelLayout(candidate);
    if (channelLayout) {
      pushUniqueText(descriptors, channelLayout);
      break;
    }
  }

  if (!descriptors.length) {
    if (/\bstereo\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.stereo", {}, "Stereo"));
    } else if (/\bsurround\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.surround", {}, "Surround"));
    }
  }

  if (/\b(atmos|joc)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Atmos");
  } else if (/\b(eac3|ec-3|ddp|dolby digital plus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital Plus");
  } else if (/\b(ac3|ac-3|dolby digital)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital");
  } else if (/\b(truehd)\b/.test(searchText)) {
    pushUniqueText(descriptors, "TrueHD");
  } else if (/\b(dts:x|dts-hd|dts)\b/.test(searchText)) {
    pushUniqueText(descriptors, "DTS");
  } else if (/\b(aac|mp4a)\b/.test(searchText)) {
    pushUniqueText(descriptors, "AAC");
  } else if (/\b(opus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Opus");
  } else if (/\b(flac)\b/.test(searchText)) {
    pushUniqueText(descriptors, "FLAC");
  } else if (/\b(mp3|mpeg audio)\b/.test(searchText)) {
    pushUniqueText(descriptors, "MP3");
  }

  if (/\bforced\b/.test(searchText) || Boolean(track?.forced)) {
    pushUniqueText(descriptors, t("sub_forced_lang", {}, "Forced"));
  }
  if (/\b(commentary)\b/.test(searchText)) {
    pushUniqueText(descriptors, t("player.track.commentary", {}, "Commentary"));
  }
  if (/\b(audio description|audio-description|describes-video|describes video|descriptive)\b/.test(searchText)) {
    pushUniqueText(descriptors, t("player.track.audioDescription", {}, "Audio description"));
  }

  return descriptors;
}

function formatAudioTrackDisplay(track = {}, index = 0) {
  const languageLabel = getTrackLanguageLabel(track);
  const descriptors = getTrackDescriptorLabels(track);
  const rawLabel = getMeaningfulTrackLabel(track);
  const labelParts = [];

  if (languageLabel) {
    pushUniqueText(labelParts, languageLabel);
  }
  descriptors.forEach((descriptor) => pushUniqueText(labelParts, descriptor));

  const label = labelParts.length ? labelParts.join(" - ") : (rawLabel || audioLabel(index));
  const secondary = !languageLabel
    && rawLabel
    && normalizeComparableText(rawLabel) !== normalizeComparableText(label)
      ? rawLabel
      : "";

  return { label, secondary };
}

function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(date = new Date()) {
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const localeKey = String(locale || "__default__");
  if (!CLOCK_FORMATTER_CACHE.has(localeKey)) {
    try {
      CLOCK_FORMATTER_CACHE.set(localeKey, new Intl.DateTimeFormat(locale || undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }));
    } catch (_) {
      CLOCK_FORMATTER_CACHE.set(localeKey, null);
    }
  }
  const formatter = CLOCK_FORMATTER_CACHE.get(localeKey);
  try {
    if (formatter?.format) {
      return formatter.format(date);
    }
    return date.toLocaleTimeString(locale || undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch (_) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
}

function formatEndsAt(currentSeconds, durationSeconds) {
  const current = Number(currentSeconds || 0);
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "--:--";
  }
  const remainingMs = Math.max(0, (duration - current) * 1000);
  const endDate = new Date(Date.now() + remainingMs);
  return formatClock(endDate);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trackListToArray(trackList) {
  if (!trackList) {
    return [];
  }

  try {
    const iterableTracks = Array.from(trackList).filter(Boolean);
    if (iterableTracks.length) {
      return iterableTracks;
    }
  } catch (_) {
    // Some WebOS track lists are not iterable.
  }

  const length = Number(trackList.length || 0);
  if (Number.isFinite(length) && length > 0) {
    const indexedTracks = [];
    for (let index = 0; index < length; index += 1) {
      const track = trackList[index] || (typeof trackList.item === "function" ? trackList.item(index) : null);
      if (track) {
        indexedTracks.push(track);
      }
    }
    if (indexedTracks.length) {
      return indexedTracks;
    }
  }

  if (typeof trackList.item === "function") {
    const probedTracks = [];
    for (let index = 0; index < 32; index += 1) {
      const track = trackList.item(index);
      if (!track) {
        if (probedTracks.length) {
          break;
        }
        continue;
      }
      probedTracks.push(track);
    }
    if (probedTracks.length) {
      return probedTracks;
    }
  }

  const objectTracks = Object.keys(trackList)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => trackList[key])
    .filter(Boolean);
  return objectTracks;
}

function normalizeItemType(value) {
  const normalized = String(value || "movie").toLowerCase();
  return normalized === "tv" ? "series" : normalized;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEpisodePanelHint() {
  return `UP/DOWN ${t("discover_select_catalog", {}, "Select")} | OK ${t("episodes_play", {}, "Play")} | BACK ${t("episodes_panel_close", {}, "Close")}`;
}

function qualityLabelFromText(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return "2160p";
  if (text.includes("1080")) return "1080p";
  if (text.includes("720")) return "720p";
  if (text.includes("480")) return "480p";
  return "Auto";
}

function formatSubtitleDelay(delayMs = 0) {
  const seconds = Number(delayMs || 0) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(3)}s`;
}

function normalizeSubtitleLanguageKey(value) {
  const code = normalizeTrackLanguageCode(value);
  if (code) {
    return code;
  }
  const cleaned = cleanDisplayText(value);
  return cleaned ? cleaned.toLowerCase() : SUBTITLE_LANGUAGE_UNKNOWN_KEY;
}

function subtitleLanguageLabel(languageKey) {
  if (languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
    return t("subtitle_none", {}, "Off");
  }
  if (languageKey === SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return t("common.unknown", {}, "Unknown");
  }
  return getTrackLanguageLabel({ language: languageKey }) || String(languageKey || "").toUpperCase();
}

function styleChipLabel(value = "") {
  return String(value || "").replace(/^#/, "").toUpperCase();
}

function dbToGain(db = 0) {
  return Math.pow(10, Number(db || 0) / 20);
}

function flattenStreamGroups(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  return (streamResult.data || []).flatMap((group) => {
    const addonName = group.addonName || "Addon";
    return (group.streams || []).map((stream, index) => ({
      id: `${addonName}-${index}-${stream.url || ""}`,
      label: stream.title || stream.name || `${addonName} stream`,
      description: stream.description || stream.name || "",
      addonName,
      addonLogo: group.addonLogo || stream.addonLogo || null,
      sourceType: stream.type || stream.source || "",
      url: stream.url,
      raw: stream
    })).filter((entry) => Boolean(entry.url));
  });
}

function mergeStreamItems(existing = [], incoming = []) {
  const byKey = new Set();
  const merged = [];
  const push = (item) => {
    if (!item?.url) {
      return;
    }
    const key = [
      String(item.addonName || "Addon"),
      String(item.url || ""),
      String(item.sourceType || ""),
      String(item.label || "")
    ].join("::");
    if (byKey.has(key)) {
      return;
    }
    byKey.add(key);
    merged.push(item);
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return merged;
}

function normalizeParentalWarnings(source) {
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2,
    none: 99
  };

  if (Array.isArray(source)) {
    return source
      .map((entry) => ({
        label: String(entry?.label || "").trim(),
        severity: String(entry?.severity || "").trim()
      }))
      .filter((entry) => entry.label && entry.severity)
      .filter((entry) => entry.severity.toLowerCase() !== "none")
      .sort((left, right) => {
        const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
        const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
        return leftRank - rightRank;
      })
      .slice(0, 5);
  }

  const guide = source && typeof source === "object" ? source : null;
  if (!guide) {
    return [];
  }

  const labels = {
    nudity: "Nudity",
    violence: "Violence",
    profanity: "Profanity",
    alcohol: "Alcohol/Drugs",
    frightening: "Frightening"
  };

  return Object.entries(labels)
    .map(([key, label]) => {
      const severity = String(guide[key] || "").trim();
      if (!severity || severity.toLowerCase() === "none") {
        return null;
      }
      return { label, severity };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
      const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
      return leftRank - rightRank;
    })
    .slice(0, 5);
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if (text.startsWith("\"") && text.endsWith("\"")) {
    return text.slice(1, -1);
  }
  return text;
}

function parseHlsAttributeList(value) {
  const raw = String(value || "");
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const key = String(match[1] || "").toUpperCase();
    const attributeValue = stripQuotes(match[2] || "");
    if (!key) {
      continue;
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  try {
    return new URL(String(maybeRelativeUrl || ""), String(baseUrl || "")).toString();
  } catch (_) {
    return String(maybeRelativeUrl || "");
  }
}

function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const unique = [];
  (values || []).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    unique.push(normalized);
  });
  return unique;
}

export const PlayerScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("player");
    this.container.style.display = "block";
    this.params = params;
    this.externalFrameUrl = String(params.externalFrameUrl || "").trim();

    this.aspectModes = [
      { objectFit: "contain", label: "Fit" },
      { objectFit: "cover", label: "Fill" },
      { objectFit: "fill", label: "Stretch" }
    ];

    this.streamCandidates = this.normalizeStreamCandidates(Array.isArray(params.streamCandidates) ? params.streamCandidates : []);
    const initialStreamUrl = params.streamUrl || this.selectBestStreamUrl(this.streamCandidates) || null;
    if (!this.streamCandidates.length && initialStreamUrl) {
      this.streamCandidates = this.normalizeStreamCandidates([
        {
          url: initialStreamUrl,
          title: "Current source",
          addonName: "Current"
        }
      ]);
    }

    this.currentStreamIndex = this.streamCandidates.findIndex((stream) => stream.url === initialStreamUrl);
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = 0;
    }

    this.subtitles = [];
    this.subtitleDialogVisible = false;
    this.subtitleDialogTab = "builtIn";
    this.subtitleDialogIndex = 0;
    this.subtitleLanguageRailIndex = 0;
    this.subtitleOptionRailIndex = 0;
    this.subtitleStyleRailIndex = 0;
    this.subtitleFocusedRail = "language";
    this.subtitleDialogScrollMode = "nearest";
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.builtInSubtitleCount = 0;
    this.externalTrackNodes = [];

    this.audioDialogVisible = false;
    this.audioDialogIndex = 0;
    this.audioMixFocusIndex = 0;
    this.audioFocusedColumn = "tracks";
    this.selectedAudioTrackIndex = -1;

    this.sourcesPanelVisible = false;
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourceFilter = "all";
    this.sourcesFocus = { zone: "filter", index: 0 };
    this.sourceLoadToken = 0;

    this.aspectModeIndex = 0;
    this.aspectToastTimer = null;
    this.speedDialogVisible = false;
    this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.indexOf(1));

    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.episodePanelVisible = false;
    this.episodePanelIndex = Math.max(0, this.episodes.findIndex((entry) => entry.id === params.videoId));
    this.switchingEpisode = false;

    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekCommitTimer = null;
    this.seekOverlayTimer = null;

    this.parentalWarnings = normalizeParentalWarnings(params.parentalWarnings || params.parentalGuide);
    this.parentalGuideVisible = false;
    this.parentalGuideShown = false;
    this.parentalGuideTimer = null;
    this.subtitleSelectionTimer = null;
    this.subtitleLoadToken = 0;
    this.subtitleLoading = false;
    this.manifestLoadToken = 0;
    this.manifestLoading = false;
    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = "";
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.activePlaybackUrl = initialStreamUrl || null;
    this.pendingPlaybackRestore = Number(params.resumePositionMs || 0) > 0
      ? {
          timeSeconds: Number(params.resumePositionMs || 0) / 1000,
          paused: false
        }
      : null;
    this.trackDiscoveryToken = 0;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryTimer = null;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.lastTrackWarmupAt = 0;
    this.failedStreamUrls = new Set();
    this.silentAudioFallbackAttempts = new Set();
    this.silentAudioFallbackCount = 0;
    this.maxSilentAudioFallbackCount = 1;
    this.lastPlaybackErrorAt = 0;
    this.playbackStallTimer = null;
    this.lastPlaybackProgressAt = Date.now();

    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.moreActionsVisible = false;
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = 0;
    this.controlsHideTimer = null;
    this.tickTimer = null;
    this.videoListeners = [];

    const playerSettings = PlayerSettingsStore.get();
    this.subtitleDelayMs = Number(playerSettings.subtitleDelayMs || 0);
    this.subtitleStyleSettings = {
      ...playerSettings.subtitleStyle,
      preferredLanguage: String(playerSettings.subtitleStyle?.preferredLanguage || playerSettings.subtitleLanguage || "system"),
      secondaryPreferredLanguage: String(playerSettings.subtitleStyle?.secondaryPreferredLanguage || playerSettings.secondarySubtitleLanguage || "off")
    };
    this.audioAmplificationDb = clamp(Number(playerSettings.audioAmplificationDb || 0), AUDIO_AMPLIFICATION_MIN_DB, AUDIO_AMPLIFICATION_MAX_DB);
    this.persistAudioAmplification = Boolean(playerSettings.persistAudioAmplification);
    this.audioAmplificationAvailable = false;
    this.audioContext = null;
    this.audioGainNode = null;
    this.audioMediaSource = null;

    this.renderPlayerUi();
    if (!this.isExternalFrameMode()) {
      this.bindVideoEvents();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
    }
    this.renderEpisodePanel();
    this.applyAspectMode({ showToast: false });
    if (!this.isExternalFrameMode()) {
      this.updateUiTick();
    }

    if (initialStreamUrl && !this.isExternalFrameMode()) {
      const sourceCandidate = this.getStreamCandidateByUrl(initialStreamUrl) || this.getCurrentStreamCandidate();
      this.activePlaybackUrl = initialStreamUrl;
      PlayerController.play(this.activePlaybackUrl, this.buildPlaybackContext(sourceCandidate));
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
      this.startTrackDiscoveryWindow();
    }

    if (!this.isExternalFrameMode()) {
      this.loadSubtitles();
      this.syncTrackState();
      this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
      this.endedHandler = () => {
        this.handlePlaybackEnded();
      };
      PlayerController.video?.addEventListener("ended", this.endedHandler);
      this.setControlsVisible(true, { focus: true });
    } else {
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.setControlsVisible(false);
    }
  },

  isExternalFrameMode() {
    return Boolean(this.externalFrameUrl);
  },

  buildPlaybackContext(streamCandidate = this.getCurrentStreamCandidate()) {
    const requestHeaders = this.getCurrentStreamRequestHeaders(streamCandidate);
    const mediaSourceType = String(
      streamCandidate?.sourceType
      || streamCandidate?.raw?.type
      || streamCandidate?.raw?.mimeType
      || ""
    ).trim();
    return {
      itemId: this.params.itemId || null,
      itemType: normalizeItemType(this.params.itemType || "movie"),
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode),
      title: this.params.playerTitle || this.params.itemTitle || null,
      poster: this.params.poster || null,
      background: this.params.playerBackdropUrl || this.params.backdrop || this.params.poster || null,
      episodeTitle: this.params.episodeTitle || this.params.playerSubtitle || null,
      requestHeaders,
      mediaSourceType
    };
  },

  buildSubtitleLookupContext() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const rawItemId = String(this.params?.itemId || "").trim();
    const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
    const id = baseItemId || rawItemId || "";

    let videoId = null;
    if (type === "series") {
      const season = Number(this.params?.season);
      const episode = Number(this.params?.episode);
      if (id && Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
        videoId = `${id}:${season}:${episode}`;
      } else if (this.params?.videoId) {
        videoId = String(this.params.videoId);
      }
    }

    return { type, id, videoId };
  },

  normalizeStreamCandidates(streams = []) {
    return (streams || []).map((stream, index) => {
      if (!stream?.url) {
        return null;
      }
      return {
        id: stream.id || `stream-${index}-${stream.url}`,
        label: stream.title || stream.name || stream.label || `Source ${index + 1}`,
        description: stream.description || stream.name || "",
        addonName: stream.addonName || stream.sourceName || "Addon",
        addonLogo: stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      };
    }).filter(Boolean);
  },

  getCurrentStreamCandidate() {
    if (!this.streamCandidates.length) {
      return null;
    }
    const current = this.streamCandidates[this.currentStreamIndex] || null;
    if (current?.url) {
      return current;
    }
    return this.streamCandidates.find((entry) => Boolean(entry?.url)) || null;
  },

  getStreamSearchText(streamCandidate) {
    const stream = streamCandidate?.raw || streamCandidate || {};
    return String([
      streamCandidate?.label || "",
      streamCandidate?.description || "",
      streamCandidate?.sourceType || "",
      streamCandidate?.url || "",
      stream?.title || "",
      stream?.name || "",
      stream?.description || "",
      stream?.url || ""
    ].join(" ")).toLowerCase();
  },

  getWebOsAudioCompatibilityScore(streamCandidate) {
    const text = this.getStreamSearchText(streamCandidate);
    let score = 0;

    if (/\b(aac|mp4a)\b/.test(text)) score += 22;
    if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score += 14;
    if (/\b(mp3|mpeg audio)\b/.test(text)) score += 8;
    if (/\b(stereo|2\.0|2ch)\b/.test(text)) score += 8;

    if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score -= 28;
    const devicePenalty = typeof PlayerController.getWebOsUnsupportedAudioPenalty === "function"
      ? Number(PlayerController.getWebOsUnsupportedAudioPenalty(text) || 0)
      : 0;
    if (devicePenalty !== 0) {
      score += devicePenalty;
    } else if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
      score -= 45;
    }
    if (/\b(7\.1|8ch)\b/.test(text)) score -= 12;
    if (/\b(flac|alac)\b/.test(text)) score -= 10;

    return score;
  },

  getStreamCandidateByUrl(streamUrl) {
    const normalized = String(streamUrl || "").trim();
    if (!normalized) {
      return null;
    }
    return this.streamCandidates.find((entry) => String(entry?.url || "").trim() === normalized) || null;
  },

  getTrackProbeUrl() {
    const currentCandidate = this.getCurrentStreamCandidate();
    return String(
      this.activePlaybackUrl
      || currentCandidate?.url
      || PlayerController.video?.currentSrc
      || ""
    ).trim();
  },

  isCurrentSourceAdaptiveManifest() {
    const probeUrl = this.getTrackProbeUrl();
    const probeMimeType = typeof PlayerController.guessMediaMimeType === "function"
      ? PlayerController.guessMediaMimeType(probeUrl)
      : null;
    return (typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType))
      || (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType));
  },

  isCurrentSourceLikelyMkv() {
    const probeUrl = this.getTrackProbeUrl().toLowerCase();
    if (!probeUrl) {
      return false;
    }
    if (probeUrl.includes(".mkv")) {
      return true;
    }
    return false;
  },

  getUnavailableTrackMessage(kind = "audio") {
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (!usingAvPlay && this.isCurrentSourceLikelyMkv()) {
      if (kind === "subtitle") {
        return "MKV internal subtitles are not exposed by the webOS web player.";
      }
      return "MKV internal audio tracks are not exposed by the webOS web player.";
    }
    return kind === "subtitle"
      ? "No subtitle tracks available."
      : "No audio tracks available.";
  },

  getVideoTextTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
  },

  getVideoAudioTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
  },

  collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
    const mapSubtitles = (candidate) => {
      const stream = candidate?.raw || candidate || null;
      const rawSubtitles = Array.isArray(stream?.subtitles) ? stream.subtitles : [];
      return rawSubtitles
      .filter((subtitle) => Boolean(subtitle?.url))
      .map((subtitle, index) => ({
        id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
        url: subtitle.url,
        lang: subtitle.lang || "unknown",
        addonName: candidate?.addonName || "Stream",
        addonLogo: candidate?.addonLogo || null
      }));
    };

    const current = mapSubtitles(streamCandidate);
    if (current.length) {
      return current;
    }

    return this.streamCandidates.flatMap((candidate) => mapSubtitles(candidate));
  },

  mergeSubtitleCandidates(primary = [], secondary = []) {
    const merged = [];
    const seen = new Set();
    [...(primary || []), ...(secondary || [])].forEach((subtitle) => {
      if (!subtitle?.url) {
        return;
      }
      const key = `${String(subtitle.url).trim()}::${String(subtitle.lang || "").trim().toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(subtitle);
    });
    return merged;
  },

  getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
    const stream = streamCandidate?.raw || streamCandidate || null;
    const requestHeaders = stream?.behaviorHints?.proxyHeaders?.request;
    if (!requestHeaders || typeof requestHeaders !== "object") {
      return {};
    }
    return { ...requestHeaders };
  },

  parseHlsManifestTracks(manifestText, manifestUrl) {
    const lines = String(manifestText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const audioTracks = [];
    const subtitleTracks = [];
    const variants = [];
    let pendingVariantAttributes = null;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
        const mediaType = String(attributes.TYPE || "").toUpperCase();
        const groupId = String(attributes["GROUP-ID"] || "").trim();
        const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
        const language = String(attributes.LANGUAGE || "").trim();
        const channels = String(attributes.CHANNELS || "").trim();
        const characteristics = String(attributes.CHARACTERISTICS || "").trim();
        const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
        const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
        const forced = String(attributes.FORCED || "").toUpperCase() === "YES";
        const autoselect = String(attributes.AUTOSELECT || "").toUpperCase() === "YES";
        const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;

        if (mediaType === "AUDIO") {
          audioTracks.push({
            id: trackId,
            groupId,
            name: name || `Audio ${audioTracks.length + 1}`,
            language,
            channels,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }

        if (mediaType === "SUBTITLES") {
          subtitleTracks.push({
            id: trackId,
            groupId,
            name: name || `Subtitle ${subtitleTracks.length + 1}`,
            language,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }
        return;
      }

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
        return;
      }

      if (line.startsWith("#")) {
        return;
      }

      if (!pendingVariantAttributes) {
        return;
      }

      variants.push({
        uri: resolveUrl(manifestUrl, line),
        audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
        subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
        codecs: String(pendingVariantAttributes.CODECS || "").trim(),
        bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
        resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
      });
      pendingVariantAttributes = null;
    });

    const codecsByAudioGroup = new Map();
    variants.forEach((variant) => {
      const groupId = cleanDisplayText(variant?.audioGroupId);
      const codecs = cleanDisplayText(variant?.codecs);
      if (!groupId || !codecs) {
        return;
      }
      const existing = codecsByAudioGroup.get(groupId) || [];
      if (!existing.includes(codecs)) {
        existing.push(codecs);
        codecsByAudioGroup.set(groupId, existing);
      }
    });
    audioTracks.forEach((track) => {
      const codecs = codecsByAudioGroup.get(cleanDisplayText(track?.groupId));
      if (codecs?.length) {
        track.codecs = codecs.join(", ");
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants
    };
  },

  parseDashManifestTracks(manifestText) {
    const parseErrorResult = {
      audioTracks: [],
      subtitleTracks: [],
      variants: []
    };

    const parser = typeof DOMParser === "function" ? new DOMParser() : null;
    if (!parser) {
      return parseErrorResult;
    }

    let xmlDocument = null;
    try {
      xmlDocument = parser.parseFromString(String(manifestText || ""), "application/xml");
    } catch (_) {
      return parseErrorResult;
    }
    if (!xmlDocument) {
      return parseErrorResult;
    }
    if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
      return parseErrorResult;
    }

    const adaptationSets = Array.from(xmlDocument.getElementsByTagName("AdaptationSet"));
    if (!adaptationSets.length) {
      return parseErrorResult;
    }

    const audioTracks = [];
    const subtitleTracks = [];
    adaptationSets.forEach((adaptationSet, setIndex) => {
      const contentType = String(adaptationSet.getAttribute("contentType") || "").toLowerCase();
      const mimeType = String(adaptationSet.getAttribute("mimeType") || "").toLowerCase();
      const representation = adaptationSet.getElementsByTagName("Representation")[0] || null;
      const codecs = String(
        adaptationSet.getAttribute("codecs")
        || representation?.getAttribute("codecs")
        || ""
      ).toLowerCase();
      const roleValues = Array.from(adaptationSet.getElementsByTagName("Role"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const accessibilityValues = Array.from(adaptationSet.getElementsByTagName("Accessibility"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const audioChannelConfiguration = adaptationSet.getElementsByTagName("AudioChannelConfiguration")[0]
        || representation?.getElementsByTagName("AudioChannelConfiguration")?.[0]
        || null;
      const language = String(
        adaptationSet.getAttribute("lang")
        || representation?.getAttribute("lang")
        || ""
      ).trim();
      const label = String(
        adaptationSet.getAttribute("label")
        || representation?.getAttribute("label")
        || roleValues[0]
        || ""
      ).trim();
      const setId = String(adaptationSet.getAttribute("id") || setIndex).trim();
      const channels = String(audioChannelConfiguration?.getAttribute("value") || "").trim();
      const role = roleValues.join(" ");
      const accessibility = accessibilityValues.join(" ");

      const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
      const isSubtitle = contentType === "text"
        || mimeType.startsWith("text/")
        || mimeType.includes("ttml")
        || mimeType.includes("vtt")
        || codecs.includes("stpp")
        || codecs.includes("wvtt");

      if (isAudio) {
        audioTracks.push({
          id: `DASH::AUDIO::${setId}::${language || label || audioTracks.length + 1}`,
          groupId: setId,
          name: label || `Audio ${audioTracks.length + 1}`,
          language,
          channels,
          role,
          accessibility,
          codecs,
          uri: null,
          isDefault: audioTracks.length === 0
        });
      } else if (isSubtitle) {
        subtitleTracks.push({
          id: `DASH::SUBTITLES::${setId}::${language || label || subtitleTracks.length + 1}`,
          groupId: setId,
          name: label || `Subtitle ${subtitleTracks.length + 1}`,
          language,
          role,
          accessibility,
          uri: null,
          isDefault: subtitleTracks.length === 0
        });
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants: []
    };
  },

  parseManifestTracks(manifestText, manifestUrl) {
    const text = String(manifestText || "");
    if (!text) {
      return { audioTracks: [], subtitleTracks: [], variants: [] };
    }
    if (text.includes("#EXTM3U")) {
      return this.parseHlsManifestTracks(text, manifestUrl);
    }
    if (/<\s*MPD[\s>]/i.test(text)) {
      return this.parseDashManifestTracks(text);
    }
    return { audioTracks: [], subtitleTracks: [], variants: [] };
  },

  async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
    const currentCandidate = this.getCurrentStreamCandidate();
    const masterUrl = playbackUrl || currentCandidate?.url || "";
    const runtimeUrl = String(PlayerController.video?.currentSrc || "").trim();
    const loadToken = (this.manifestLoadToken || 0) + 1;
    this.manifestLoadToken = loadToken;
    this.manifestLoading = true;

    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = masterUrl;
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.refreshTrackDialogs();

    const probeUrl = masterUrl || runtimeUrl || playbackUrl || "";
    const probeMimeType = typeof PlayerController.guessMediaMimeType === "function"
      ? PlayerController.guessMediaMimeType(probeUrl)
      : null;
    const isAdaptiveManifest = (typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType))
      || (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType));

    if (!isAdaptiveManifest) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (!masterUrl) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    try {
      const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
      const manifestFetchTimeoutMs = 5000;
      const fetchManifestText = async (url, requestHeaders = {}) => {
        const requestController = typeof AbortController === "function" ? new AbortController() : null;
        let requestTimeoutId = null;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            requestTimeoutId = setTimeout(() => {
              try {
                requestController?.abort?.();
              } catch (_) {
                // Ignore abort failures.
              }
              reject(new Error("Manifest fetch timeout"));
            }, manifestFetchTimeoutMs);
          });
          const response = await Promise.race([
            fetch(url, {
              method: "GET",
              headers: requestHeaders,
              signal: requestController?.signal
            }),
            timeoutPromise
          ]);
          const text = await response.text();
          return {
            text,
            finalUrl: response.url || url
          };
        } finally {
          if (requestTimeoutId) {
            clearTimeout(requestTimeoutId);
          }
        }
      };

      const urlCandidates = uniqueNonEmptyValues([masterUrl, runtimeUrl, playbackUrl, this.activePlaybackUrl]);
      let selectedParsed = null;
      let selectedMasterUrl = masterUrl;

      for (const candidateUrl of urlCandidates) {
        let fetchedManifest = null;
        try {
          fetchedManifest = await fetchManifestText(candidateUrl, headers);
        } catch (_) {
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, {});
          } catch (_) {
            fetchedManifest = null;
          }
        }

        if (loadToken !== this.manifestLoadToken) {
          return;
        }
        if (!fetchedManifest) {
          continue;
        }

        const parsed = this.parseManifestTracks(fetchedManifest.text, fetchedManifest.finalUrl || candidateUrl);
        const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
        if (hasTracks) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          break;
        }

        if (!selectedParsed && (parsed.variants.length > 0)) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
        }

        if (parsed.variants.length > 0) {
          const variant = parsed.variants[0];
          if (!variant?.uri) {
            continue;
          }
          try {
            const variantFetched = await fetchManifestText(variant.uri, headers);
            if (loadToken !== this.manifestLoadToken) {
              return;
            }
            const nestedParsed = this.parseManifestTracks(variantFetched.text, variantFetched.finalUrl || variant.uri);
            if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              break;
            }
            if (!selectedParsed && nestedParsed.variants.length > 0) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
            }
          } catch (_) {
            try {
              const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(variantFetchedNoHeaders.text, variantFetchedNoHeaders.finalUrl || variant.uri);
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
              }
            } catch (_) {
              // Ignore nested manifest failures.
            }
          }
        }
      }

      if (!selectedParsed) {
        return;
      }

      this.manifestMasterUrl = selectedMasterUrl || masterUrl;
      this.manifestAudioTracks = selectedParsed.audioTracks;
      this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
      this.manifestVariants = selectedParsed.variants;
      this.selectedManifestAudioTrackId = selectedParsed.audioTracks.find((track) => track.isDefault)?.id || selectedParsed.audioTracks[0]?.id || null;
      this.selectedManifestSubtitleTrackId = selectedParsed.subtitleTracks.find((track) => track.isDefault)?.id || null;
      this.refreshTrackDialogs();
    } catch (error) {
      // Ignore parsing failures on providers that block manifest fetch.
    } finally {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
    if (!this.manifestVariants.length) {
      return null;
    }

    const byAudio = audioGroupId
      ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId)
      : this.manifestVariants.slice();
    const candidatePool = byAudio.length ? byAudio : this.manifestVariants;

    let scopedCandidates = candidatePool;
    if (subtitleGroupId) {
      const bySubtitle = candidatePool.filter((variant) => variant.subtitleGroupId === subtitleGroupId);
      if (bySubtitle.length) {
        scopedCandidates = bySubtitle;
      }
    } else if (subtitleGroupId === null) {
      const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
      if (withoutSubtitle.length) {
        scopedCandidates = withoutSubtitle;
      }
    }

    const capabilityProbe = typeof PlayerController.getPlaybackCapabilities === "function"
      ? PlayerController.getPlaybackCapabilities()
      : null;
    const supports = (key, fallback = true) => {
      if (!capabilityProbe) {
        return fallback;
      }
      return Boolean(capabilityProbe[key]);
    };

    const scoreVariant = (variant) => {
      if (!variant) {
        return Number.NEGATIVE_INFINITY;
      }
      let score = 0;
      const codecs = String(variant.codecs || "").toLowerCase();
      const resolution = String(variant.resolution || "").toLowerCase();
      const bandwidth = Number(variant.bandwidth || 0);

      const resolutionMatch = resolution.match(/^(\d+)\s*x\s*(\d+)$/i);
      const width = Number(resolutionMatch?.[1] || 0);
      const height = Number(resolutionMatch?.[2] || 0);
      if (width >= 3840 || height >= 2160) score += 60;
      else if (width >= 1920 || height >= 1080) score += 40;
      else if (width >= 1280 || height >= 720) score += 20;
      else if (width > 0 || height > 0) score += 8;

      if (Number.isFinite(bandwidth) && bandwidth > 0) {
        score += Math.min(30, Math.round((bandwidth / 1000000) * 3));
      }

      if (codecs.includes("dvh1") || codecs.includes("dvhe")) {
        score += supports("dolbyVision", true) ? 18 : -100;
      }
      if (codecs.includes("hvc1") || codecs.includes("hev1")) {
        score += (supports("mp4Hevc", true) || supports("mp4HevcMain10", true)) ? 14 : -90;
      }
      if (codecs.includes("av01")) {
        score += supports("mp4Av1", true) ? 10 : -80;
      }
      if (codecs.includes("vp9")) {
        score += supports("webmVp9", true) ? 8 : -60;
      }
      if (codecs.includes("ec-3") || codecs.includes("eac3")) {
        score += supports("audioEac3", true) ? 10 : -50;
      }
      if (codecs.includes("ac-3") || codecs.includes("ac3")) {
        score += supports("audioAc3", true) ? 6 : -35;
      }

      return score;
    };

    return scopedCandidates
      .slice()
      .sort((left, right) => scoreVariant(right) - scoreVariant(left))[0] || null;
  },

  applyManifestTrackSelection({ audioTrackId, subtitleTrackId } = {}) {
    if (audioTrackId !== undefined) {
      this.selectedManifestAudioTrackId = audioTrackId;
    }
    if (subtitleTrackId !== undefined) {
      this.selectedManifestSubtitleTrackId = subtitleTrackId;
    }

    const selectedAudio = this.manifestAudioTracks.find((track) => track.id === this.selectedManifestAudioTrackId) || null;
    const selectedSubtitle = this.manifestSubtitleTracks.find((track) => track.id === this.selectedManifestSubtitleTrackId) || null;
    const variant = this.pickManifestVariant({
      audioGroupId: selectedAudio?.groupId || null,
      subtitleGroupId: selectedSubtitle ? (selectedSubtitle.groupId || null) : null
    });

    if (!variant?.uri) {
      this.refreshTrackDialogs();
      return;
    }

    const targetUrl = variant.uri;
    if (targetUrl === this.activePlaybackUrl) {
      this.refreshTrackDialogs();
      return;
    }

    const video = PlayerController.video;
    const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    const restorePaused = Boolean(this.paused || (!usingAvPlay && video?.paused));
    this.pendingPlaybackRestore = {
      timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
      paused: restorePaused
    };

    this.activePlaybackUrl = targetUrl;
    const currentStreamCandidate = this.getCurrentStreamCandidate();
    PlayerController.play(targetUrl, this.buildPlaybackContext(currentStreamCandidate));
    this.paused = false;
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.setControlsVisible(true, { focus: false });
  },

  renderPlayerUi() {
    this.uiRefs = null;
    this.lastUiTickState = null;
    this.container.querySelector("#playerUiRoot")?.remove();

    const root = document.createElement("div");
    root.id = "playerUiRoot";
    root.className = "player-ui-root";

    if (this.isExternalFrameMode()) {
      root.innerHTML = `
        <div class="player-external-frame-shell">
          <iframe
            class="player-external-frame"
            src="${escapeHtml(this.externalFrameUrl)}"
            title="${escapeHtml(this.params.playerTitle || "Trailer")}"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          ></iframe>
        </div>
      `;
    } else {
      root.innerHTML = `
        <div id="playerLoadingOverlay" class="player-loading-overlay">
          <div class="player-loading-backdrop"${this.params.playerBackdropUrl ? ` style="background-image:url('${this.params.playerBackdropUrl}')"` : ""}></div>
          <div class="player-loading-gradient"></div>
          <div class="player-loading-center">
            ${this.params.playerLogoUrl ? `<img class="player-loading-logo" src="${this.params.playerLogoUrl}" alt="logo" />` : ""}
            <div class="player-loading-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Nuvio")}</div>
            ${this.params.playerSubtitle ? `<div class="player-loading-subtitle">${escapeHtml(this.params.playerSubtitle)}</div>` : ""}
          </div>
        </div>

        <div id="playerParentalGuide" class="player-parental-guide hidden"></div>

        <div id="playerAspectToast" class="player-aspect-toast hidden"></div>

        <div id="playerSeekOverlay" class="player-seek-overlay hidden">
          <div class="player-seek-overlay-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
          <div class="player-seek-overlay-bottom">
            <span id="playerSeekDirection" class="player-seek-direction"></span>
            <span id="playerSeekPreview" class="player-seek-preview">0:00 / 0:00</span>
          </div>
        </div>

        <div id="playerModalBackdrop" class="player-modal-backdrop hidden"></div>
        <div id="playerSubtitleDialog" class="player-modal player-subtitle-modal hidden"></div>
        <div id="playerAudioDialog" class="player-modal player-audio-modal hidden"></div>
        <div id="playerSpeedDialog" class="player-modal player-speed-modal hidden"></div>
        <div id="playerSourcesPanel" class="player-sources-panel hidden"></div>

        <div id="playerControlsOverlay" class="player-controls-overlay">
          <div class="player-controls-gradient player-controls-gradient-top"></div>
          <div class="player-controls-gradient player-controls-gradient-bottom"></div>

          <div class="player-controls-top">
            <div id="playerClock" class="player-clock">--:--</div>
            <div id="playerEndsAt" class="player-ends-at">${escapeHtml(t("player_ends_at", ["--:--"], "Ends at %1$s"))}</div>
          </div>

          <div class="player-controls-bottom">
            <div class="player-meta">
              <div class="player-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Untitled")}</div>
              <div class="player-subtitle">${escapeHtml(this.params.playerSubtitle || this.params.episodeLabel || this.params.itemType || "")}</div>
            </div>

            <div class="player-controls-bar">
              <div id="playerProgressShell" class="player-progress-shell">
                <div class="player-progress-track">
                  <div id="playerProgressFill" class="player-progress-fill"></div>
                </div>
              </div>

              <div class="player-controls-row">
                <div id="playerControlButtons" class="player-control-buttons"></div>
                <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    this.container.appendChild(root);
    this.cachePlayerUiRefs(root);
    if (!this.isExternalFrameMode()) {
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.renderParentalGuideOverlay();
      this.renderSeekOverlay();
    }
  },

  cachePlayerUiRefs(root = null) {
    const uiRoot = root || this.container?.querySelector("#playerUiRoot");
    this.uiRefs = uiRoot ? {
      root: uiRoot,
      loadingOverlay: uiRoot.querySelector("#playerLoadingOverlay"),
      parentalGuide: uiRoot.querySelector("#playerParentalGuide"),
      aspectToast: uiRoot.querySelector("#playerAspectToast"),
      seekOverlay: uiRoot.querySelector("#playerSeekOverlay"),
      seekDirection: uiRoot.querySelector("#playerSeekDirection"),
      seekPreview: uiRoot.querySelector("#playerSeekPreview"),
      seekFill: uiRoot.querySelector("#playerSeekFill"),
      modalBackdrop: uiRoot.querySelector("#playerModalBackdrop"),
      subtitleDialog: uiRoot.querySelector("#playerSubtitleDialog"),
      audioDialog: uiRoot.querySelector("#playerAudioDialog"),
      speedDialog: uiRoot.querySelector("#playerSpeedDialog"),
      sourcesPanel: uiRoot.querySelector("#playerSourcesPanel"),
      controlsOverlay: uiRoot.querySelector("#playerControlsOverlay"),
      progressShell: uiRoot.querySelector("#playerProgressShell"),
      clock: uiRoot.querySelector("#playerClock"),
      endsAt: uiRoot.querySelector("#playerEndsAt"),
      progressFill: uiRoot.querySelector("#playerProgressFill"),
      controlButtons: uiRoot.querySelector("#playerControlButtons"),
      timeLabel: uiRoot.querySelector("#playerTimeLabel")
    } : null;
    this.lastUiTickState = {
      progressWidth: "",
      clockText: "",
      clockMinuteKey: "",
      endsAtText: "",
      endsAtMinuteBucket: null,
      timeLabelText: "",
      seekWidth: "",
      seekPreviewText: "",
      seekDirectionText: "",
      progressFocused: false
    };
  },

  getPlayerUiState() {
    return {
      isPlaying: !this.paused,
      isBuffering: Boolean(this.loadingVisible),
      currentPosition: Math.round(this.getPlaybackCurrentSeconds() * 1000),
      duration: Math.round(this.getPlaybackDurationSeconds() * 1000),
      title: String(this.params?.playerTitle || this.params?.itemId || "Untitled"),
      currentSeason: this.params?.season == null ? null : Number(this.params.season),
      currentEpisode: this.params?.episode == null ? null : Number(this.params.episode),
      currentEpisodeTitle: String(this.params?.playerSubtitle || "").trim() || null,
      currentStreamName: this.getCurrentStreamCandidate()?.label || null,
      currentStreamUrl: this.getCurrentStreamCandidate()?.url || null,
      showControls: Boolean(this.controlsVisible),
      showSeekOverlay: Boolean(this.seekOverlayVisible),
      pendingPreviewSeekPosition: this.seekPreviewSeconds == null ? null : Math.round(Number(this.seekPreviewSeconds || 0) * 1000),
      playbackSpeed: Number(PlayerController.video?.playbackRate || 1),
      showAudioOverlay: Boolean(this.audioDialogVisible),
      showSubtitleOverlay: Boolean(this.subtitleDialogVisible),
      subtitleDelayMs: Number(this.subtitleDelayMs || 0),
      subtitleStyle: { ...this.subtitleStyleSettings },
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      isAudioAmplificationAvailable: Boolean(this.audioAmplificationAvailable),
      persistAudioAmplification: Boolean(this.persistAudioAmplification),
      showEpisodesPanel: Boolean(this.episodePanelVisible),
      episodesAll: Array.isArray(this.episodes) ? this.episodes : [],
      showSourcesPanel: Boolean(this.sourcesPanelVisible),
      isLoadingSourceStreams: Boolean(this.sourcesLoading),
      sourceStreamsError: this.sourcesError || null,
      sourceAllStreams: Array.isArray(this.streamCandidates) ? this.streamCandidates : [],
      sourceSelectedAddonFilter: this.sourceFilter === "all" ? null : this.sourceFilter,
      sourceFilteredStreams: this.getFilteredSources(),
      sourceAvailableAddons: this.getSourceFilters().filter((entry) => entry !== "all")
    };
  },

  persistPlayerPresentationSettings() {
    PlayerSettingsStore.set({
      subtitleDelayMs: Number(this.subtitleDelayMs || 0),
      subtitleStyle: { ...this.subtitleStyleSettings },
      subtitleLanguage: this.subtitleStyleSettings?.preferredLanguage || "system",
      secondarySubtitleLanguage: this.subtitleStyleSettings?.secondaryPreferredLanguage || "off",
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      persistAudioAmplification: Boolean(this.persistAudioAmplification)
    });
  },

  ensureAudioAmplificationGraph() {
    const video = PlayerController.video;
    if (!video || this.audioGainNode) {
      return Boolean(this.audioGainNode);
    }
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
      return false;
    }
    try {
      this.audioContext = this.audioContext || new AudioContextCtor();
      this.audioMediaSource = this.audioMediaSource || this.audioContext.createMediaElementSource(video);
      this.audioGainNode = this.audioGainNode || this.audioContext.createGain();
      this.audioMediaSource.connect(this.audioGainNode);
      this.audioGainNode.connect(this.audioContext.destination);
      this.audioAmplificationAvailable = true;
      return true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
      return false;
    }
  },

  applyAudioAmplification() {
    if (!this.ensureAudioAmplificationGraph()) {
      this.audioAmplificationAvailable = false;
      return;
    }
    try {
      if (this.audioContext?.state === "suspended") {
        void this.audioContext.resume().catch(() => {});
      }
      this.audioGainNode.gain.value = dbToGain(this.audioAmplificationDb);
      this.audioAmplificationAvailable = true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
    }
  },

  applySubtitlePresentationSettings() {
    const uiRoot = this.uiRefs?.root;
    const video = PlayerController.video;
    if (!uiRoot || !video) {
      return;
    }
    const style = this.subtitleStyleSettings || {};
    uiRoot.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    uiRoot.style.setProperty("--player-subtitle-outline-color", String(style.outlineColor || "#000000"));
    uiRoot.style.setProperty("--player-subtitle-font-size", `${clamp(Number(style.fontSize || 100), 70, 180)}%`);
    uiRoot.style.setProperty("--player-subtitle-font-weight", style.bold ? "700" : "500");
    uiRoot.style.setProperty("--player-subtitle-shadow", style.outlineEnabled
      ? `0 0 2px ${style.outlineColor || "#000000"}, 0 0 4px ${style.outlineColor || "#000000"}`
      : "none");
    uiRoot.style.setProperty("--player-subtitle-offset", `${clamp(Number(style.verticalOffset || 0), -12, 12) * -2}vh`);
    video.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    video.style.setProperty("--player-subtitle-outline-color", String(style.outlineColor || "#000000"));
    video.style.setProperty("--player-subtitle-font-size", `${clamp(Number(style.fontSize || 100), 70, 180)}%`);
    video.style.setProperty("--player-subtitle-font-weight", style.bold ? "700" : "500");
    video.style.setProperty("--player-subtitle-shadow", style.outlineEnabled
      ? `0 0 2px ${style.outlineColor || "#000000"}, 0 0 4px ${style.outlineColor || "#000000"}`
      : "none");
  },

  updateModalBackdrop() {
    const modalBackdrop = this.uiRefs?.modalBackdrop;
    if (!modalBackdrop) {
      return;
    }
    const hasModal = this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible || this.speedDialogVisible;
    modalBackdrop.classList.toggle("hidden", !hasModal);
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const onWaiting = () => {
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      if (!this.sourcesPanelVisible) {
        this.setControlsVisible(true, { focus: false });
      }
      this.schedulePlaybackStallGuard();
    };

    const onPlaying = () => {
      this.failedStreamUrls.clear();
      this.lastPlaybackErrorAt = 0;
      this.sourcesError = "";
      this.markPlaybackProgress();
      this.clearPlaybackStallGuard();
      this.loadingVisible = false;
      this.paused = false;
      this.updateLoadingVisibility();
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.updateUiTick();
      this.resetControlsAutoHide();
      if (!this.parentalGuideShown && this.parentalWarnings.length) {
        this.showParentalGuideOverlay();
      }
      setTimeout(() => {
        this.attemptSilentAudioRecovery("playing");
      }, 700);
    };

    const onPause = () => {
      const ended = typeof PlayerController.isPlaybackEnded === "function"
        ? PlayerController.isPlaybackEnded()
        : Boolean(video.ended);
      if (ended) {
        return;
      }
      this.clearPlaybackStallGuard();
      this.paused = true;
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
      this.renderControlButtons();
    };

    const onTimeUpdate = () => {
      this.markPlaybackProgress();
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      if (this.pendingPlaybackRestore) {
        const restore = this.pendingPlaybackRestore;
        this.pendingPlaybackRestore = null;
        if (Number.isFinite(restore.timeSeconds) && restore.timeSeconds > 0) {
          try {
            this.seekPlaybackSeconds(restore.timeSeconds);
          } catch (_) {
            // Ignore seek restore failures.
          }
        }
        if (restore.paused) {
          PlayerController.pause();
          this.paused = true;
        } else {
          this.paused = false;
        }
      }

      this.refreshTrackDialogs();
      this.updateUiTick();
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.markPlaybackProgress();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.ensureTrackDataWarmup();
      this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
      setTimeout(() => {
        this.attemptSilentAudioRecovery("metadata");
      }, 500);
    };

    const onPlayable = () => {
      this.refreshTrackDialogs();
      this.applySubtitlePresentationSettings();
      this.updateUiTick();
    };

    const onTrackListChanged = () => {
      this.refreshTrackDialogs();
      if (this.trackDiscoveryInProgress && this.hasAudioTracksAvailable() && this.hasSubtitleTracksAvailable()) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
      }
    };

    const onError = (event) => {
      const now = Date.now();
      if ((now - Number(this.lastPlaybackErrorAt || 0)) < 120) {
        return;
      }
      this.lastPlaybackErrorAt = now;

      const detailErrorCode = Number(event?.detail?.mediaErrorCode || 0);
      const controllerErrorCode = typeof PlayerController.getLastPlaybackErrorCode === "function"
        ? Number(PlayerController.getLastPlaybackErrorCode() || 0)
        : 0;
      const mediaErrorCode = detailErrorCode || Number(video?.error?.code || 0) || controllerErrorCode;
      if (this.recoverFromPlaybackError(mediaErrorCode)) {
        return;
      }

      this.clearPlaybackStallGuard();
      this.loadingVisible = false;
      this.paused = true;
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
      this.sourcesError = `${this.mediaErrorMessage(mediaErrorCode)}. Try another source.`;
      if (this.streamCandidates.length > 1) {
        this.openSourcesPanel();
      } else {
        this.renderSourcesPanel();
      }

      console.warn("Playback failed", {
        url: this.activePlaybackUrl,
        mediaErrorCode
      });
    };

    const bindings = [
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["error", onError],
      ["pause", onPause],
      ["timeupdate", onTimeUpdate],
      ["loadedmetadata", onLoadedMetadata],
      ["loadeddata", onPlayable],
      ["canplay", onPlayable],
      ["avplaytrackschanged", onTrackListChanged],
      ["dashtrackschanged", onTrackListChanged]
    ];

    bindings.forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.videoListeners.push({ target: video, eventName, handler });
    });

    const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(Boolean);
    trackTargets.forEach((target) => {
      if (typeof target.addEventListener !== "function") {
        return;
      }
      ["addtrack", "removetrack", "change"].forEach((eventName) => {
        target.addEventListener(eventName, onTrackListChanged);
        this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
      });
    });
  },

  unbindVideoEvents() {
    this.videoListeners.forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.videoListeners = [];
  },

  getControlDefinitions() {
    const uiState = this.getPlayerUiState();
    const base = [
      {
        action: "playPause",
        label: this.paused ? ">" : "II",
        icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
        title: "Play/Pause",
        primary: true
      }
    ];

    if (this.hasSubtitleTracksAvailable()) {
      base.push({ action: "subtitleDialog", icon: "assets/icons/ic_player_subtitles.svg", title: t("subtitle_dialog_title", {}, "Subtitles") });
    }

    if (this.hasAudioTracksAvailable()) {
      base.push({
        action: "audioTrack",
        icon: this.selectedAudioTrackIndex >= 0 || this.selectedManifestAudioTrackId
          ? "assets/icons/ic_player_audio_filled.svg"
          : "assets/icons/ic_player_audio_outline.svg",
        title: t("audio_dialog_title", {}, "Audio")
      });
    }

    base.push({ action: "source", icon: "assets/icons/ic_player_source.svg", title: t("sources_title", {}, "Sources") });

    if (Array.isArray(uiState.episodesAll) && uiState.episodesAll.length) {
      base.push({ action: "episodes", icon: "assets/icons/ic_player_episodes.svg", title: t("episodes_panel_title", {}, "Episodes") });
    }

    base.push({ action: "more", label: this.moreActionsVisible ? "<" : ">", title: t("player_more_actions_title", {}, "More Actions") });

    if (!this.moreActionsVisible) {
      return base;
    }

    return [
      ...base.slice(0, Math.max(0, base.length - 1)),
      { action: "speed", label: `${Number(PlayerController.video?.playbackRate || 1).toFixed(Number(PlayerController.video?.playbackRate || 1) % 1 ? 2 : 0)}x`, title: t("player_playback_speed", {}, "Playback speed") },
      { action: "aspect", icon: "assets/icons/ic_player_aspect_ratio.svg", title: t("player_more_aspect_ratio", {}, "Aspect Ratio") },
      { action: "backFromMore", label: "<", title: t("player_go_back", {}, "Back") }
    ];
  },

  renderControlButtons() {
    if (this.isExternalFrameMode()) {
      return;
    }
    const wrap = this.uiRefs?.controlButtons;
    if (!wrap) {
      return;
    }

    const controls = this.getControlDefinitions();
    this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));

    wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable${control.primary ? " is-primary" : ""}"
              data-action="${control.action}"
              title="${escapeHtml(control.title || "")}">
        ${control.icon
          ? `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`
          : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`}
      </button>
    `).join("");

    const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
    buttons.forEach((button, index) => {
      button.classList.toggle("focused", this.controlFocusZone === "buttons" && index === this.controlFocusIndex);
    });
    const progressShell = this.uiRefs?.progressShell;
    if (progressShell) {
      progressShell.classList.toggle("focused", this.controlFocusZone === "progress");
    }
  },

  isDialogOpen() {
    return this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible || this.speedDialogVisible;
  },

  setControlsVisible(visible, { focus = false } = {}) {
    this.controlsVisible = Boolean(visible);
    if (this.isExternalFrameMode()) {
      return;
    }
    const overlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.controlsVisible);
    if (this.controlsVisible) {
      this.renderControlButtons();
      if (focus) {
        this.focusFirstControl();
      }
      this.resetControlsAutoHide();
    } else {
      this.clearControlsAutoHide();
    }
  },

  focusFirstControl() {
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = 0;
    this.renderControlButtons();
    const firstButton = this.container.querySelector('.player-control-btn[data-action]');
    firstButton?.focus?.();
  },

  focusProgressBar() {
    this.controlFocusZone = "progress";
    this.renderControlButtons();
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
      return;
    }
    this.controlsHideTimer = setTimeout(() => {
      this.setControlsVisible(false);
    }, 4200);
  },

  getPlaybackCurrentSeconds() {
    if (typeof PlayerController.getCurrentTimeSeconds === "function") {
      return Number(PlayerController.getCurrentTimeSeconds() || 0);
    }
    return Number(PlayerController.video?.currentTime || 0);
  },

  getPlaybackDurationSeconds() {
    if (typeof PlayerController.getDurationSeconds === "function") {
      return Number(PlayerController.getDurationSeconds() || 0);
    }
    return Number(PlayerController.video?.duration || 0);
  },

  seekPlaybackSeconds(seconds) {
    if (typeof PlayerController.seekToSeconds === "function") {
      return Boolean(PlayerController.seekToSeconds(seconds));
    }
    const video = PlayerController.video;
    if (!video) {
      return false;
    }
    video.currentTime = Number(seconds || 0);
    return true;
  },

  updateLoadingVisibility() {
    const overlay = this.uiRefs?.loadingOverlay;
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.loadingVisible);
  },

  updateUiTick() {
    if (this.isExternalFrameMode()) {
      return;
    }
    const current = this.getPlaybackCurrentSeconds();
    const duration = this.getPlaybackDurationSeconds();
    const effectiveProgressSeconds = this.controlsVisible && this.controlFocusZone === "progress" && this.seekPreviewSeconds != null
      ? Number(this.seekPreviewSeconds)
      : current;
    const progress = duration > 0 ? clamp(effectiveProgressSeconds / duration, 0, 1) : 0;
    const uiRefs = this.uiRefs || {};
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const progressFill = uiRefs.progressFill;
    if (progressFill) {
      const nextWidth = `${Math.round(progress * 10000) / 100}%`;
      if (uiState.progressWidth !== nextWidth) {
        progressFill.style.width = nextWidth;
        uiState.progressWidth = nextWidth;
      }
    }

    const clock = uiRefs.clock;
    if (clock) {
      const now = new Date();
      const nextClockMinuteKey = `${now.getHours()}:${now.getMinutes()}`;
      if (uiState.clockMinuteKey !== nextClockMinuteKey) {
        const nextClockText = formatClock(now);
        clock.textContent = nextClockText;
        uiState.clockText = nextClockText;
        uiState.clockMinuteKey = nextClockMinuteKey;
      }
    }

    const endsAt = uiRefs.endsAt;
    if (endsAt) {
      const remainingMs = Math.max(0, (Number(duration || 0) - Number(current || 0)) * 1000);
      const nextEndsAtMinuteBucket = duration > 0 ? Math.floor((Date.now() + remainingMs) / 60000) : -1;
      if (uiState.endsAtMinuteBucket !== nextEndsAtMinuteBucket) {
        const nextEndsAtText = t("player_ends_at", [formatEndsAt(current, duration)], "Ends at %1$s");
        endsAt.textContent = nextEndsAtText;
        uiState.endsAtText = nextEndsAtText;
        uiState.endsAtMinuteBucket = nextEndsAtMinuteBucket;
      }
    }

    const timeLabel = uiRefs.timeLabel;
    if (timeLabel) {
      const nextTimeLabel = `${formatTime(effectiveProgressSeconds)} / ${formatTime(duration)}`;
      if (uiState.timeLabelText !== nextTimeLabel) {
        timeLabel.textContent = nextTimeLabel;
        uiState.timeLabelText = nextTimeLabel;
      }
    }

    if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
      this.renderSeekOverlay();
    }
  },
  renderSeekOverlay() {
    const overlay = this.uiRefs?.seekOverlay;
    const directionNode = this.uiRefs?.seekDirection;
    const previewNode = this.uiRefs?.seekPreview;
    const fillNode = this.uiRefs?.seekFill;
    if (!overlay || !directionNode || !previewNode || !fillNode) {
      return;
    }

    const duration = this.getPlaybackDurationSeconds();
    const currentPreview = this.seekPreviewSeconds != null
      ? Number(this.seekPreviewSeconds)
      : this.getPlaybackCurrentSeconds();

    const shouldShowOverlay = this.seekOverlayVisible && !this.controlsVisible;
    overlay.classList.toggle("hidden", !shouldShowOverlay);
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const nextPreviewText = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
    const nextDirectionText = this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";
    if (uiState.seekPreviewText !== nextPreviewText) {
      previewNode.textContent = nextPreviewText;
      uiState.seekPreviewText = nextPreviewText;
    }
    if (uiState.seekDirectionText !== nextDirectionText) {
      directionNode.textContent = nextDirectionText;
      uiState.seekDirectionText = nextDirectionText;
    }

    const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
    const nextSeekWidth = `${Math.round(percent * 10000) / 100}%`;
    if (uiState.seekWidth !== nextSeekWidth) {
      fillNode.style.width = nextSeekWidth;
      uiState.seekWidth = nextSeekWidth;
    }
  },

  beginSeekPreview(direction, isRepeat = false) {
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return;
    }

    if (direction !== this.seekPreviewDirection || !isRepeat) {
      this.seekRepeatCount = 0;
    }
    this.seekPreviewDirection = direction;
    this.seekRepeatCount += 1;

    const stepSeconds = this.seekRepeatCount >= 10 ? 30 : this.seekRepeatCount >= 4 ? 20 : 10;
    const duration = this.getPlaybackDurationSeconds();
    const base = this.seekPreviewSeconds == null ? currentTime : Number(this.seekPreviewSeconds);
    let next = base + (direction * stepSeconds);
    if (duration > 0) {
      next = clamp(next, 0, duration);
    } else {
      next = Math.max(0, next);
    }

    this.seekPreviewSeconds = next;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.scheduleSeekPreviewCommit();
  },

  scheduleSeekPreviewCommit() {
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
    }
    this.seekCommitTimer = setTimeout(() => {
      this.commitSeekPreview();
    }, 280);
  },

  commitSeekPreview() {
    if (!PlayerController.video) {
      this.cancelSeekPreview({ commit: false });
      return;
    }

    if (this.seekPreviewSeconds != null) {
      this.seekPlaybackSeconds(Number(this.seekPreviewSeconds));
    }

    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }

    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
    }
    this.seekOverlayTimer = setTimeout(() => {
      this.seekOverlayVisible = false;
      this.seekPreviewDirection = 0;
      this.renderSeekOverlay();
      this.resetControlsAutoHide();
    }, 700);
  },

  cancelSeekPreview({ commit = false } = {}) {
    if (commit) {
      this.commitSeekPreview();
      return;
    }

    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }
    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOverlayVisible = false;
    this.renderSeekOverlay();
  },

  togglePause() {
    const preserveProgressFocus = this.controlFocusZone === "progress";
    if (this.isExternalFrameMode()) {
      return;
    }
    if (this.paused) {
      PlayerController.resume();
      this.paused = false;
      this.setControlsVisible(true, { focus: false });
      if (preserveProgressFocus) {
        this.controlFocusZone = "progress";
      }
      this.renderControlButtons();
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.setControlsVisible(true, { focus: !preserveProgressFocus });
    if (preserveProgressFocus) {
      this.controlFocusZone = "progress";
    }
    this.renderControlButtons();
  },

  async playStreamByUrl(streamUrl, { preservePanel = false, resetSilentAudioState = true, preservePlaybackState = false, forceEngine = null } = {}) {
    if (this.isExternalFrameMode()) {
      return;
    }
    if (!streamUrl) {
      return;
    }

    const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === streamUrl);
    if (selectedIndex >= 0) {
      this.currentStreamIndex = selectedIndex;
    }

    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.cancelSeekPreview({ commit: false });
    if (preservePlaybackState) {
      const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
      const video = PlayerController.video;
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
        ? PlayerController.isUsingAvPlay()
        : false;
      this.pendingPlaybackRestore = {
        timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
        paused: Boolean(this.paused || (!usingAvPlay && video?.paused))
      };
    } else {
      this.pendingPlaybackRestore = null;
    }
    this.markPlaybackProgress();
    this.clearPlaybackStallGuard();
    if (resetSilentAudioState) {
      this.silentAudioFallbackAttempts.clear();
      this.silentAudioFallbackCount = 0;
    }

    if (!preservePanel) {
      this.closeSourcesPanel();
    }

    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = -1;
    this.builtInSubtitleCount = 0;
    this.trackDiscoveryInProgress = true;
    this.clearTrackDiscoveryTimer();
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();

    const sourceCandidate = this.getStreamCandidateByUrl(streamUrl) || this.getCurrentStreamCandidate();
    this.activePlaybackUrl = streamUrl;
    PlayerController.play(this.activePlaybackUrl, {
      ...this.buildPlaybackContext(sourceCandidate),
      forceEngine
    });
    this.paused = false;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
    this.startTrackDiscoveryWindow();
    this.syncTrackState();
    this.updateUiTick();
    this.setControlsVisible(true, { focus: false });
    this.schedulePlaybackStallGuard();
  },

  switchStream(direction) {
    if (!this.streamCandidates.length) {
      return;
    }

    this.currentStreamIndex += direction;
    if (this.currentStreamIndex >= this.streamCandidates.length) {
      this.currentStreamIndex = 0;
    }
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = this.streamCandidates.length - 1;
    }

    const selected = this.streamCandidates[this.currentStreamIndex];
    if (!selected?.url) {
      return;
    }
    this.playStreamByUrl(selected.url, { preservePlaybackState: true });
  },

  mediaErrorMessage(errorCode = 0) {
    const code = Number(errorCode || 0);
    if (code === 1) return "Playback aborted";
    if (code === 2) return "Network error";
    if (code === 3) return "Decode error";
    if (code === 4) return "Source not supported on this TV";
    return "Playback error";
  },

  findNextRecoverableStream({ preferAudioCompatible = false } = {}) {
    if (!this.streamCandidates.length) {
      return null;
    }

    const candidates = [];
    for (let offset = 1; offset < this.streamCandidates.length; offset += 1) {
      const index = (this.currentStreamIndex + offset) % this.streamCandidates.length;
      const candidate = this.streamCandidates[index];
      const candidateUrl = String(candidate?.url || "").trim();
      if (!candidateUrl || this.failedStreamUrls.has(candidateUrl)) {
        continue;
      }
      candidates.push({ index, offset, stream: candidate });
    }

    if (!candidates.length) {
      return null;
    }

    if (!preferAudioCompatible) {
      return candidates[0];
    }

    return candidates
      .slice()
      .sort((left, right) => {
        const scoreDelta = this.getWebOsAudioCompatibilityScore(right.stream) - this.getWebOsAudioCompatibilityScore(left.stream);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return left.offset - right.offset;
      })[0] || candidates[0];
  },

  attemptSilentAudioRecovery(reason = "silent-audio") {
    if (!Environment.isWebOS()) {
      return false;
    }
    if (this.sourcesPanelVisible || this.subtitleDialogVisible || this.audioDialogVisible) {
      return false;
    }
    const usingNativePlayback = typeof PlayerController.isUsingNativePlayback === "function"
      ? PlayerController.isUsingNativePlayback()
      : String(PlayerController.playbackEngine || "").startsWith("native");
    if (!usingNativePlayback) {
      return false;
    }
    if (typeof PlayerController.canUseAvPlay === "function" && PlayerController.canUseAvPlay()) {
      return false;
    }

    const currentUrl = String(this.activePlaybackUrl || "").trim();
    if (!currentUrl || this.silentAudioFallbackAttempts.has(currentUrl)) {
      return false;
    }
    if (Number(this.silentAudioFallbackCount || 0) >= Number(this.maxSilentAudioFallbackCount || 0)) {
      return false;
    }

    const nativeAudioCount = this.getAudioTracks().length;
    const dashAudioCount = typeof PlayerController.getDashAudioTracks === "function"
      ? PlayerController.getDashAudioTracks().length
      : 0;
    const hlsAudioCount = typeof PlayerController.getHlsAudioTracks === "function"
      ? PlayerController.getHlsAudioTracks().length
      : 0;
    const hasAudio = nativeAudioCount > 0 || dashAudioCount > 0 || hlsAudioCount > 0;
    if (hasAudio) {
      return false;
    }

    const currentCandidate = this.getStreamCandidateByUrl(currentUrl) || this.getCurrentStreamCandidate();
    const currentScore = this.getWebOsAudioCompatibilityScore(currentCandidate);
    const currentText = this.getStreamSearchText(currentCandidate);
    const clearlyUnsupportedAudio = /\b(eac3|ec-3|ddp|atmos)\b/.test(currentText)
      || (typeof PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription === "function"
        ? PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription(currentText)
        : /\b(truehd|dts-hd|dts:x|dts)\b/.test(currentText));
    if (!clearlyUnsupportedAudio && currentScore >= 0) {
      return false;
    }

    this.silentAudioFallbackAttempts.add(currentUrl);
    const fallback = this.findNextRecoverableStream({ preferAudioCompatible: true });
    if (!fallback?.stream?.url) {
      this.sourcesError = "Audio codec not supported on this TV for this source.";
      this.renderSourcesPanel();
      return false;
    }
    const fallbackScore = this.getWebOsAudioCompatibilityScore(fallback.stream);
    if (fallbackScore <= currentScore) {
      return false;
    }

    this.silentAudioFallbackCount = Number(this.silentAudioFallbackCount || 0) + 1;
    this.currentStreamIndex = fallback.index;
    this.sourcesError = "Audio unavailable on this source, trying a compatible one...";
    console.warn("Silent audio fallback", {
      reason,
      currentUrl,
      nextUrl: fallback.stream.url
    });
    this.playStreamByUrl(fallback.stream.url, {
      preservePanel: false,
      resetSilentAudioState: false,
      preservePlaybackState: true
    });
    return true;
  },

  recoverFromPlaybackError(errorCode = 0) {
    const currentUrl = String(this.activePlaybackUrl || "").trim();
    const alternativeEngine = currentUrl && typeof PlayerController.getAlternativePlaybackEngine === "function"
      ? PlayerController.getAlternativePlaybackEngine(currentUrl)
      : null;
    if (currentUrl && alternativeEngine) {
      this.sourcesError = `${this.mediaErrorMessage(errorCode)}. Retrying current source...`;
      this.playStreamByUrl(currentUrl, {
        preservePanel: false,
        preservePlaybackState: true,
        resetSilentAudioState: false,
        forceEngine: alternativeEngine
      });
      return true;
    }

    if (currentUrl) {
      this.failedStreamUrls.add(currentUrl);
    }

    const fallback = this.findNextRecoverableStream({
      preferAudioCompatible: Environment.isWebOS()
    });
    if (!fallback?.stream?.url) {
      return false;
    }

    this.currentStreamIndex = fallback.index;
    this.sourcesError = `${this.mediaErrorMessage(errorCode)}. Trying next source...`;
    this.playStreamByUrl(fallback.stream.url, {
      preservePanel: false,
      preservePlaybackState: true
    });
    return true;
  },

  clearPlaybackStallGuard() {
    if (this.playbackStallTimer) {
      clearTimeout(this.playbackStallTimer);
      this.playbackStallTimer = null;
    }
  },

  markPlaybackProgress() {
    this.lastPlaybackProgressAt = Date.now();
  },

  schedulePlaybackStallGuard() {
    this.clearPlaybackStallGuard();
    this.playbackStallTimer = setTimeout(() => {
      const video = PlayerController.video;
      const ended = typeof PlayerController.isPlaybackEnded === "function"
        ? PlayerController.isPlaybackEnded()
        : Boolean(video?.ended);
      if (!video || ended || this.paused || this.sourcesPanelVisible) {
        return;
      }

      const readyState = typeof PlayerController.getPlaybackReadyState === "function"
        ? Number(PlayerController.getPlaybackReadyState() || 0)
        : Number(video.readyState || 0);
      const currentTime = this.getPlaybackCurrentSeconds();
      const elapsedFromProgress = Date.now() - Number(this.lastPlaybackProgressAt || 0);
      const stalledAtStart = currentTime < 0.5 && readyState < 2;
      const stalledWhilePlaying = elapsedFromProgress >= 9000 && readyState < 3;
      if (!stalledAtStart && !stalledWhilePlaying) {
        return;
      }

      if (this.recoverFromPlaybackError(2)) {
        return;
      }

      this.loadingVisible = false;
      this.paused = true;
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
      this.sourcesError = "Stream stalled while buffering. Try another source.";
      if (this.streamCandidates.length > 1) {
        this.openSourcesPanel();
      } else {
        this.renderSourcesPanel();
      }
    }, 9000);
  },

  getSubtitleTabs() {
    return [
      { id: "builtIn", label: t("subtitle_tab_builtin", {}, "Built-in") },
      { id: "addons", label: t("subtitle_tab_addons", {}, "Addons") },
      { id: "style", label: t("subtitle_tab_style", {}, "Style") },
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay") }
    ];
  },

  refreshTrackDialogs() {
    this.syncTrackState();
    this.renderControlButtons();
    if (this.subtitleDialogVisible) {
      this.renderSubtitleDialog();
    }
    if (this.audioDialogVisible) {
      this.renderAudioDialog();
    }
  },

  hasAudioTracksAvailable() {
    let dashCount = 0;
    try {
      dashCount = typeof PlayerController.getDashAudioTracks === "function"
        ? PlayerController.getDashAudioTracks().length
        : 0;
    } catch (_) {
      dashCount = 0;
    }

    let avplayCount = 0;
    try {
      avplayCount = typeof PlayerController.getAvPlayAudioTracks === "function"
        ? PlayerController.getAvPlayAudioTracks().length
        : 0;
    } catch (_) {
      avplayCount = 0;
    }

    let hlsCount = 0;
    try {
      hlsCount = typeof PlayerController.getHlsAudioTracks === "function"
        ? PlayerController.getHlsAudioTracks().length
        : 0;
    } catch (_) {
      hlsCount = 0;
    }

    let nativeCount = 0;
    try {
      nativeCount = this.getAudioTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return dashCount > 0 || avplayCount > 0 || hlsCount > 0 || nativeCount > 0 || this.manifestAudioTracks.length > 0;
  },

  hasSubtitleTracksAvailable() {
    let dashCount = 0;
    try {
      dashCount = typeof PlayerController.getDashTextTracks === "function"
        ? PlayerController.getDashTextTracks().length
        : 0;
    } catch (_) {
      dashCount = 0;
    }

    let avplayCount = 0;
    try {
      avplayCount = typeof PlayerController.getAvPlaySubtitleTracks === "function"
        ? PlayerController.getAvPlaySubtitleTracks().length
        : 0;
    } catch (_) {
      avplayCount = 0;
    }

    let nativeCount = 0;
    try {
      nativeCount = this.getTextTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return dashCount > 0 || avplayCount > 0 || nativeCount > 0 || this.manifestSubtitleTracks.length > 0 || this.subtitles.length > 0;
  },

  clearTrackDiscoveryTimer() {
    if (this.trackDiscoveryTimer) {
      clearTimeout(this.trackDiscoveryTimer);
      this.trackDiscoveryTimer = null;
    }
  },

  startTrackDiscoveryWindow({ durationMs = 7000, intervalMs = 350 } = {}) {
    const token = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryToken = token;
    this.trackDiscoveryInProgress = true;
    this.trackDiscoveryStartedAt = Date.now();
    this.trackDiscoveryDeadline = this.trackDiscoveryStartedAt + Math.max(500, Number(durationMs || 0));
    this.clearTrackDiscoveryTimer();

    const tick = () => {
      if (token !== this.trackDiscoveryToken) {
        return;
      }

      const doneByData = this.hasAudioTracksAvailable() || this.hasSubtitleTracksAvailable();
      const doneByIdle = !this.subtitleLoading
        && !this.manifestLoading
        && (Date.now() - Number(this.trackDiscoveryStartedAt || 0)) >= 1200;
      const doneByTimeout = Date.now() >= this.trackDiscoveryDeadline;
      this.refreshTrackDialogs();

      if (doneByData || doneByIdle || doneByTimeout) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
        return;
      }

      this.trackDiscoveryTimer = setTimeout(tick, Math.max(120, Number(intervalMs || 0)));
    };

    tick();
  },

  ensureTrackDataWarmup(force = false) {
    const now = Date.now();
    if (!force && (now - Number(this.lastTrackWarmupAt || 0)) < 1200) {
      return;
    }
    if (!force && (this.subtitleLoading || this.manifestLoading)) {
      this.startTrackDiscoveryWindow();
      return;
    }
    this.lastTrackWarmupAt = now;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null);
    this.startTrackDiscoveryWindow();
  },

  getTextTracks() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  getAudioTracks() {
    const trackList = this.getVideoAudioTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
    const trackCount = textTracks.length;
    if (!trackCount) {
      return 0;
    }

    if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
      return clamp(this.builtInSubtitleCount, 0, trackCount);
    }

    if (this.externalTrackNodes.length > 0) {
      const inferred = trackCount - this.externalTrackNodes.length;
      if (inferred >= 0) {
        return clamp(inferred, 0, trackCount);
      }
      return trackCount;
    }

    return trackCount;
  },

  syncTrackState() {
    const textTracks = this.getTextTracks();
    const audioTracks = this.getAudioTracks();
    const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function"
      ? PlayerController.getDashAudioTracks()
      : [];
    const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function"
      ? PlayerController.getDashTextTracks()
      : [];
    const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function"
      ? PlayerController.getAvPlayAudioTracks()
      : [];
    const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function"
      ? PlayerController.getAvPlaySubtitleTracks()
      : [];
    const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
      ? PlayerController.getHlsAudioTracks()
      : [];

    if (!this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length;
    } else if ((!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) && textTracks.length > this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
    }

    if (avplaySubtitleTracks.length) {
      const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function"
        ? PlayerController.getSelectedAvPlaySubtitleTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedAvPlaySubtitleTrack)
        ? selectedAvPlaySubtitleTrack
        : -1;
    } else if (dashSubtitleTracks.length) {
      const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function"
        ? PlayerController.getSelectedDashTextTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedDashSubtitleTrack)
        ? selectedDashSubtitleTrack
        : -1;
    } else {
      this.selectedSubtitleTrackIndex = textTracks.findIndex((track) => track?.mode && track.mode !== "disabled");
    }

    if (avplayAudioTracks.length) {
      const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function"
        ? PlayerController.getSelectedAvPlayAudioTrackIndex()
        : -1;
      const fallbackTrackIndex = Number(avplayAudioTracks[0]?.avplayTrackIndex);
      this.selectedAudioTrackIndex = selectedAvPlayAudioTrack >= 0
        ? selectedAvPlayAudioTrack
        : (Number.isFinite(fallbackTrackIndex) ? fallbackTrackIndex : 0);
      return;
    }

    if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      this.selectedAudioTrackIndex = selectedDashAudioTrack >= 0 ? selectedDashAudioTrack : 0;
      return;
    }

    if (hlsAudioTracks.length) {
      const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function"
        ? PlayerController.getSelectedHlsAudioTrackIndex()
        : -1;
      const defaultHlsAudioTrack = hlsAudioTracks.findIndex((track) => Boolean(track?.default));
      this.selectedAudioTrackIndex = selectedHlsAudioTrack >= 0
        ? selectedHlsAudioTrack
        : (defaultHlsAudioTrack >= 0 ? defaultHlsAudioTrack : 0);
      return;
    }

    this.selectedAudioTrackIndex = audioTracks.findIndex((track) => Boolean(track?.enabled || track?.selected));
  },

  getSubtitleEntries(tab = this.subtitleDialogTab) {
    const textTracks = this.getTextTracks();
    const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
    const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function"
      ? PlayerController.getDashTextTracks()
      : [];
    const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function"
      ? PlayerController.getSelectedDashTextTrackIndex()
      : -1;
    const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function"
      ? PlayerController.getAvPlaySubtitleTracks()
      : [];
    const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function"
      ? PlayerController.getSelectedAvPlaySubtitleTrackIndex()
      : -1;

    const builtInTracks = textTracks.filter((_, index) => index < builtInBoundary);
    const addonTracks = textTracks.filter((_, index) => index >= builtInBoundary);
    const trackDiscoveryPending = this.isCurrentSourceAdaptiveManifest()
      && (this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading);

    if (tab === "builtIn") {
      if (avplaySubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: selectedAvPlaySubtitleTrack < 0,
            trackIndex: -1,
            avplaySubtitleTrackIndex: -1
          },
          ...avplaySubtitleTracks.map((track, index) => {
            const avplayTrackIndex = Number(track?.avplayTrackIndex);
            const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
            return {
              id: `subtitle-avplay-${normalizedTrackIndex}`,
              label: track?.label || subtitleLabel(index),
              secondary: String(track?.language || "").toUpperCase(),
              selected: normalizedTrackIndex === selectedAvPlaySubtitleTrack,
              trackIndex: null,
              avplaySubtitleTrackIndex: normalizedTrackIndex
            };
          })
        ];
      }

      if (dashSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: selectedDashSubtitleTrack < 0,
            trackIndex: -1,
            dashSubtitleTrackIndex: -1
          },
          ...dashSubtitleTracks.map((track, index) => ({
            id: `subtitle-dash-${index}-${track?.id ?? ""}`,
            label: track?.label || subtitleLabel(index),
            secondary: String(track?.language || "").toUpperCase(),
            selected: index === selectedDashSubtitleTrack,
            trackIndex: null,
            dashSubtitleTrackIndex: index
          }))
        ];
      }

      if (!builtInTracks.length && this.manifestSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: !this.selectedManifestSubtitleTrackId,
            trackIndex: -1,
            manifestSubtitleTrackId: null
          },
          ...this.manifestSubtitleTracks.map((track) => ({
            id: `subtitle-manifest-${track.id}`,
            label: track.name || t("subtitle_dialog_title", {}, "Subtitle"),
            secondary: String(track.language || "").toUpperCase(),
            selected: this.selectedManifestSubtitleTrackId === track.id,
            trackIndex: null,
            manifestSubtitleTrackId: track.id
          }))
        ];
      }

      const entries = [
        {
          id: "subtitle-off",
          label: t("subtitle_none", {}, "None"),
          secondary: "",
          selected: this.selectedSubtitleTrackIndex < 0 && !this.selectedManifestSubtitleTrackId,
          trackIndex: -1
        },
        ...builtInTracks.map((track, index) => ({
          id: `subtitle-built-${index}`,
          label: track.label || subtitleLabel(index),
          secondary: String(track.language || "").toUpperCase(),
          selected: index === this.selectedSubtitleTrackIndex,
          trackIndex: index
        }))
      ];

      if (builtInTracks.length || !trackDiscoveryPending) {
        return entries;
      }

      return [
        ...entries,
        {
          id: "subtitle-builtin-loading",
          label: "Loading subtitle tracks...",
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "addons") {
      if (!addonTracks.length) {
        if (this.subtitles.length) {
          return this.subtitles.map((subtitle, index) => {
            const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
            return {
              id: `subtitle-addon-fallback-${subtitleId}`,
              label: subtitle.lang || subtitleLabel(index),
              secondary: subtitle.addonName || t("nav_addons", {}, "Addon"),
              selected: this.selectedAddonSubtitleId === subtitleId,
              trackIndex: null,
              subtitleIndex: index,
              fallbackAddonSubtitle: true
            };
          });
        }
        if (this.subtitleLoading || this.trackDiscoveryInProgress) {
          return [
            {
              id: "subtitle-addon-loading",
              label: "Loading addon subtitles...",
              secondary: "",
              selected: false,
              disabled: true,
              trackIndex: null
            }
          ];
        }
        return [
          {
            id: "subtitle-addon-empty",
            label: this.getUnavailableTrackMessage("subtitle"),
            secondary: "",
            selected: false,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      return addonTracks.map((track, relativeIndex) => {
        const absoluteIndex = builtInBoundary + relativeIndex;
        return {
          id: `subtitle-addon-${absoluteIndex}`,
          label: track.label || subtitleLabel(relativeIndex),
          secondary: String(track.language || "").toUpperCase(),
          selected: absoluteIndex === this.selectedSubtitleTrackIndex,
          trackIndex: absoluteIndex
        };
      });
    }

    if (tab === "style") {
      return [
        {
          id: "subtitle-style-default",
          label: t("subtitle_style_defaults", {}, "Default"),
          secondary: "System style",
          selected: true,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    return [
      {
        id: "subtitle-delay-default",
        label: "0.0s",
        secondary: "Delay control not available in web player",
        selected: true,
        disabled: true,
        trackIndex: null
      }
    ];
  },

  collectSubtitleOptionItems() {
    const builtInEntries = this.getSubtitleEntries("builtIn").filter((entry) => !entry?.disabled || entry?.id === "subtitle-off");
    const addonEntries = this.getSubtitleEntries("addons").filter((entry) => !entry?.disabled);
    const options = [];

    builtInEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (entry.id === "subtitle-off") {
        options.push({
          id: entry.id,
          languageKey: SUBTITLE_LANGUAGE_OFF_KEY,
          languageLabel: t("subtitle_none", {}, "Off"),
          title: entry.label,
          secondary: "",
          selected: Boolean(entry.selected),
          entry
        });
        return;
      }
      const languageSource = normalizeTrackLanguageCode(entry.secondary) ? entry.secondary : entry.label;
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: languageLabel,
        secondary: [t("subtitle_tab_builtin", {}, "Built-in"), entry.label && normalizeComparableText(entry.label) !== normalizeComparableText(languageLabel) ? entry.label : ""].filter(Boolean).join(" • "),
        selected: Boolean(entry.selected),
        entry
      });
    });

    addonEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      const languageSource = normalizeTrackLanguageCode(entry.secondary) ? entry.secondary : entry.label;
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: languageLabel,
        secondary: [entry.secondary || t("subtitle_tab_addons", {}, "Addons"), entry.label && normalizeComparableText(entry.label) !== normalizeComparableText(languageLabel) ? entry.label : ""].filter(Boolean).join(" • "),
        selected: Boolean(entry.selected),
        entry
      });
    });

    return options;
  },

  getSelectedSubtitleLanguageKey() {
    const selected = this.collectSubtitleOptionItems().find((entry) => entry.selected);
    return selected?.languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
  },

  getSubtitleLanguageRailItems() {
    const options = this.collectSubtitleOptionItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    const groups = new Map();
    options.forEach((option) => {
      if (!groups.has(option.languageKey)) {
        groups.set(option.languageKey, {
          key: option.languageKey,
          label: option.languageLabel || subtitleLanguageLabel(option.languageKey),
          selected: false,
          count: 0
        });
      }
      const group = groups.get(option.languageKey);
      group.count += 1;
      group.selected = group.selected || Boolean(option.selected);
    });
    if (!groups.has(SUBTITLE_LANGUAGE_OFF_KEY)) {
      groups.set(SUBTITLE_LANGUAGE_OFF_KEY, {
        key: SUBTITLE_LANGUAGE_OFF_KEY,
        label: t("subtitle_none", {}, "Off"),
        selected: selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY,
        count: 1
      });
    }
    const values = Array.from(groups.values());
    const offIndex = values.findIndex((entry) => entry.key === SUBTITLE_LANGUAGE_OFF_KEY);
    if (offIndex > 0) {
      const [offEntry] = values.splice(offIndex, 1);
      values.unshift(offEntry);
    }
    return values;
  },

  syncSubtitleOptionIndexForFocusedLanguage() {
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const selectedIndex = options.findIndex((item) => item.selected);
    this.subtitleOptionRailIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : 0);
  },

  scrollSubtitleDialogIntoView() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) {
      return;
    }
    const block = this.subtitleDialogScrollMode === "start" ? "start" : "nearest";
    const rails = [
      dialog.querySelector(".player-subtitle-language-rail .player-dialog-item.focused"),
      dialog.querySelector(".player-subtitle-options-rail .player-dialog-item.focused"),
      dialog.querySelector(".player-subtitle-style-rail .player-dialog-item.focused")
    ];
    rails.forEach((node) => {
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ block, inline: "nearest" });
      }
    });
    this.subtitleDialogScrollMode = "nearest";
  },

  getSubtitleOptionsForLanguage(languageKey = this.getSelectedSubtitleLanguageKey()) {
    return this.collectSubtitleOptionItems().filter((entry) => entry.languageKey === languageKey && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
  },

  getSubtitleStyleControls() {
    const style = this.subtitleStyleSettings || {};
    return [
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay"), value: formatSubtitleDelay(this.subtitleDelayMs) },
      { id: "fontSize", label: t("subtitle_style_size", {}, "Font Size"), value: `${Number(style.fontSize || 100)}%` },
      { id: "bold", label: t("subtitle_style_bold", {}, "Bold"), value: style.bold ? t("common.on", {}, "On") : t("common.off", {}, "Off") },
      { id: "textColor", label: t("subtitle_style_text_color", {}, "Text Color"), value: styleChipLabel(style.textColor || "#FFFFFF") },
      { id: "outlineEnabled", label: t("subtitle_style_outline", {}, "Outline"), value: style.outlineEnabled ? t("common.on", {}, "On") : t("common.off", {}, "Off") },
      { id: "outlineColor", label: t("subtitle_style_outline_color", {}, "Outline Color"), value: styleChipLabel(style.outlineColor || "#000000") },
      { id: "verticalOffset", label: t("subtitle_style_vertical_offset", {}, "Vertical Offset"), value: `${Number(style.verticalOffset || 0)}` },
      { id: "reset", label: t("subtitle_style_defaults", {}, "Reset Defaults"), value: "" }
    ];
  },

  adjustSubtitleStyleControl(controlId, delta = 0) {
    const style = { ...(this.subtitleStyleSettings || {}) };
    if (controlId === "delay") {
      this.subtitleDelayMs = clamp(Number(this.subtitleDelayMs || 0) + (delta * SUBTITLE_DELAY_STEP_MS), -5000, 5000);
    } else if (controlId === "fontSize") {
      style.fontSize = clamp(Number(style.fontSize || 100) + (delta * SUBTITLE_FONT_STEP), 70, 180);
    } else if (controlId === "bold" && delta !== 0) {
      style.bold = !style.bold;
    } else if (controlId === "textColor" && delta !== 0) {
      const currentIndex = Math.max(0, SUBTITLE_TEXT_COLORS.indexOf(String(style.textColor || "#FFFFFF").toUpperCase()));
      style.textColor = SUBTITLE_TEXT_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_TEXT_COLORS.length - 1)];
    } else if (controlId === "outlineEnabled" && delta !== 0) {
      style.outlineEnabled = !style.outlineEnabled;
    } else if (controlId === "outlineColor" && delta !== 0) {
      const currentIndex = Math.max(0, SUBTITLE_OUTLINE_COLORS.indexOf(String(style.outlineColor || "#000000").toUpperCase()));
      style.outlineColor = SUBTITLE_OUTLINE_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_OUTLINE_COLORS.length - 1)];
    } else if (controlId === "verticalOffset") {
      style.verticalOffset = clamp(Number(style.verticalOffset || 0) + (delta * SUBTITLE_VERTICAL_OFFSET_STEP), -12, 12);
    } else if (controlId === "reset") {
      const defaults = PlayerSettingsStore.get().subtitleStyle;
      this.subtitleDelayMs = 0;
      this.subtitleStyleSettings = { ...defaults };
      this.persistPlayerPresentationSettings();
      this.applySubtitlePresentationSettings();
      this.renderSubtitleDialog();
      return;
    }
    this.subtitleStyleSettings = style;
    this.persistPlayerPresentationSettings();
    this.applySubtitlePresentationSettings();
    this.renderSubtitleDialog();
  },
  openSubtitleDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.subtitleDialogVisible = true;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    const languageRail = this.getSubtitleLanguageRailItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    this.subtitleLanguageRailIndex = Math.max(0, languageRail.findIndex((item) => item.key === selectedLanguageKey));
    this.syncSubtitleOptionIndexForFocusedLanguage();
    this.subtitleStyleRailIndex = 0;
    this.subtitleFocusedRail = selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY ? "language" : "options";
    this.subtitleDialogScrollMode = "start";
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeSubtitleDialog() {
    this.subtitleDialogVisible = false;
    this.subtitleFocusedRail = "language";
    this.renderSubtitleDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  cycleSubtitleTab(delta) {
    const tabs = this.getSubtitleTabs();
    const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
    const nextIndex = clamp(index + delta, 0, tabs.length - 1);
    this.subtitleDialogTab = tabs[nextIndex].id;
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);
    const selected = entries.findIndex((entry) => entry.selected);
    this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
    this.renderSubtitleDialog();
  },

  applySubtitleEntry(entry) {
    if (!entry || entry.disabled) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "avplaySubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.avplaySubtitleTrackIndex);
      const applied = typeof PlayerController.setAvPlaySubtitleTrack === "function"
        ? PlayerController.setAvPlaySubtitleTrack(targetTrackIndex)
        : false;
      if (!applied) {
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedAddonSubtitleId = null;
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "dashSubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.dashSubtitleTrackIndex);
      const applied = typeof PlayerController.setDashTextTrack === "function"
        ? PlayerController.setDashTextTrack(targetTrackIndex)
        : false;
      if (!applied) {
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedAddonSubtitleId = null;
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
      this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (entry.fallbackAddonSubtitle) {
      this.applyFallbackAddonSubtitle(entry.subtitleIndex);
      return;
    }

    const textTracks = this.getTextTracks();
    const targetIndex = Number(entry.trackIndex);

    const appliedByController = typeof PlayerController.setNativeTextTrack === "function"
      ? PlayerController.setNativeTextTrack(targetIndex)
      : false;
    if (appliedByController) {
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = targetIndex;
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    textTracks.forEach((track, index) => {
      try {
        track.mode = index === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort: some WebOS builds expose readonly mode.
      }
    });

    if (targetIndex < 0) {
      textTracks.forEach((track) => {
        try {
          track.mode = "disabled";
        } catch (_) {
          // Best effort.
        }
      });
    }

    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = targetIndex;
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  applyFallbackAddonSubtitle(subtitleIndex) {
    const subtitle = this.subtitles[subtitleIndex];
    if (!subtitle?.url) {
      return;
    }

    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (usingAvPlay) {
      const applied = typeof PlayerController.setAvPlayExternalSubtitle === "function"
        ? PlayerController.setAvPlayExternalSubtitle(subtitle.url)
        : false;
      if (applied) {
        this.selectedAddonSubtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
        this.selectedSubtitleTrackIndex = -1;
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
    }

    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.lang || `Sub ${subtitleIndex + 1}`;
    track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
    track.src = subtitle.url;
    track.default = true;
    video.appendChild(track);
    this.externalTrackNodes.push(track);

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    this.subtitleSelectionTimer = setTimeout(() => {
      const textTracks = this.getTextTracks();
      const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
      if (textTracks.length > builtInBoundary) {
        textTracks.forEach((textTrack, index) => {
          try {
            textTrack.mode = index === builtInBoundary ? "showing" : "disabled";
          } catch (_) {
            // Best effort.
          }
        });
      }
      this.refreshTrackDialogs();
    }, 160);

    this.selectedAddonSubtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  renderSubtitleDialog() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
    if (!this.subtitleDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const languages = this.getSubtitleLanguageRailItems();
    this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex, 0, Math.max(0, languages.length - 1));
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex, 0, Math.max(0, options.length - 1));
    const styleItems = this.getSubtitleStyleControls();
    this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex, 0, Math.max(0, styleItems.length - 1));
    const showOptionsRail = activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY;

    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("subtitle_dialog_title", {}, "Subtitles"))}</div>
      <div class="player-subtitle-overlay-grid">
        <div class="player-subtitle-rail player-subtitle-language-rail">
          ${languages.map((item, index) => `
            <div class="player-dialog-item${item.selected ? " selected" : ""}${this.subtitleFocusedRail === "language" && index === this.subtitleLanguageRailIndex ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
              <div class="player-dialog-item-sub">${item.key === SUBTITLE_LANGUAGE_OFF_KEY ? escapeHtml(t("subtitle_none", {}, "Off")) : escapeHtml(`${item.count} ${item.count === 1 ? "option" : "options"}`)}</div>
              <div class="player-dialog-item-check">${item.selected ? "&#10003;" : ""}</div>
            </div>
          `).join("")}
        </div>
        <div class="player-subtitle-rail player-subtitle-options-rail${showOptionsRail ? "" : " hidden"}">
          ${options.length ? options.map((item, index) => `
            <div class="player-dialog-item${item.selected ? " selected" : ""}${this.subtitleFocusedRail === "options" && index === this.subtitleOptionRailIndex ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(item.title || "")}</div>
              <div class="player-dialog-item-sub">${escapeHtml(item.secondary || "")}</div>
              <div class="player-dialog-item-check">${item.selected ? "&#10003;" : ""}</div>
            </div>
          `).join("") : `<div class="player-dialog-empty">${escapeHtml(t("subtitle_none", {}, "No subtitles"))}</div>`}
        </div>
        <div class="player-subtitle-rail player-subtitle-style-rail${showOptionsRail ? "" : " hidden"}">
          ${styleItems.map((item, index) => `
            <div class="player-dialog-item${this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
              <div class="player-dialog-item-sub">${escapeHtml(item.value || "")}</div>
              <div class="player-dialog-item-check">${item.id === "reset" ? "&#8635;" : ""}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    this.scrollSubtitleDialogIntoView();
  },

  handleSubtitleDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const styleItems = this.getSubtitleStyleControls();

    if (keyCode === 38) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex - 1, 0, Math.max(0, languages.length - 1));
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex - 1, 0, Math.max(0, options.length - 1));
      } else {
        this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex - 1, 0, Math.max(0, styleItems.length - 1));
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 40) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(this.subtitleLanguageRailIndex + 1, 0, Math.max(0, languages.length - 1));
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(this.subtitleOptionRailIndex + 1, 0, Math.max(0, options.length - 1));
      } else {
        this.subtitleStyleRailIndex = clamp(this.subtitleStyleRailIndex + 1, 0, Math.max(0, styleItems.length - 1));
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 37) {
      if (this.subtitleFocusedRail === "style") {
        this.subtitleFocusedRail = options.length ? "options" : "language";
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "language";
      } else {
        return false;
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 39) {
      if (this.subtitleFocusedRail === "language" && activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY && options.length) {
        this.subtitleFocusedRail = "options";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "style";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "style") {
        const styleItem = styleItems[this.subtitleStyleRailIndex];
        if (styleItem) {
          this.adjustSubtitleStyleControl(styleItem.id, 1);
        }
        return true;
      }
      return true;
    }
    if (keyCode === 13) {
      if (this.subtitleFocusedRail === "language") {
        const language = languages[this.subtitleLanguageRailIndex];
        if (!language) {
          return true;
        }
        if (language.key === SUBTITLE_LANGUAGE_OFF_KEY) {
          this.applySubtitleEntry(this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 });
        } else {
          const nextOptions = this.getSubtitleOptionsForLanguage(language.key);
          if (nextOptions.length) {
            this.subtitleFocusedRail = "options";
            this.subtitleOptionRailIndex = Math.max(0, nextOptions.findIndex((item) => item.selected));
          }
        }
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        const option = options[this.subtitleOptionRailIndex];
        if (option?.entry) {
          this.applySubtitleEntry(option.entry);
          this.subtitleFocusedRail = "style";
        }
        return true;
      }
      const styleItem = styleItems[this.subtitleStyleRailIndex];
      if (styleItem) {
        this.adjustSubtitleStyleControl(styleItem.id, styleItem.id === "delay" || styleItem.id === "fontSize" || styleItem.id === "verticalOffset" ? 1 : 1);
      }
      return true;
    }
    if (this.subtitleFocusedRail === "style" && (keyCode === 10009 || keyCode === 461)) {
      return false;
    }
    if (this.subtitleFocusedRail === "style" && keyCode === 189) {
      const styleItem = styleItems[this.subtitleStyleRailIndex];
      if (styleItem) {
        this.adjustSubtitleStyleControl(styleItem.id, -1);
      }
      return true;
    }
    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13;
  },

  getAudioEntries() {
    const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function"
      ? PlayerController.getAvPlayAudioTracks()
      : [];
    if (avplayAudioTracks.length) {
      const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function"
        ? PlayerController.getSelectedAvPlayAudioTrackIndex()
        : -1;
      return avplayAudioTracks.map((track, index) => {
        const avplayTrackIndex = Number(track?.avplayTrackIndex);
        const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-avplay-${normalizedTrackIndex}`,
          label: display.label,
          secondary: display.secondary,
          selected: normalizedTrackIndex === selectedAvPlayAudioTrack
            || (selectedAvPlayAudioTrack < 0 && normalizedTrackIndex === this.selectedAudioTrackIndex),
          avplayAudioTrackIndex: normalizedTrackIndex
        };
      });
    }

    const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function"
      ? PlayerController.getDashAudioTracks()
      : [];
    if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      return dashAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-dash-${index}-${track?.id ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedDashAudioTrack || (selectedDashAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          dashAudioTrackIndex: index
        };
      });
    }

    const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
      ? PlayerController.getHlsAudioTracks()
      : [];
    if (hlsAudioTracks.length) {
      const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function"
        ? PlayerController.getSelectedHlsAudioTrackIndex()
        : -1;
      return hlsAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-hls-${index}-${track?.id ?? track?.name ?? track?.lang ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedHlsAudioTrack || (selectedHlsAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          hlsAudioTrackIndex: index
        };
      });
    }

    const audioTracks = this.getAudioTracks();
    if (audioTracks.length) {
      return audioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-track-${index}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === this.selectedAudioTrackIndex,
          audioTrackIndex: index
        };
      });
    }

    if (this.manifestAudioTracks.length) {
      return this.manifestAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-manifest-${track.id}`,
          label: display.label,
          secondary: display.secondary,
          selected: this.selectedManifestAudioTrackId === track.id,
          manifestAudioTrackId: track.id
        };
      });
    }

    return [];
  },

  adjustAudioAmplification(delta = 0) {
    const nextDb = clamp(Number(this.audioAmplificationDb || 0) + Number(delta || 0), AUDIO_AMPLIFICATION_MIN_DB, AUDIO_AMPLIFICATION_MAX_DB);
    this.audioAmplificationDb = nextDb;
    this.persistPlayerPresentationSettings();
    this.applyAudioAmplification();
    this.renderAudioDialog();
  },

  togglePersistAudioAmplification() {
    this.persistAudioAmplification = !this.persistAudioAmplification;
    this.persistPlayerPresentationSettings();
    this.renderAudioDialog();
  },

  openAudioDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.audioDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    let entries = this.getAudioEntries();
    if (!entries.length) {
      this.ensureTrackDataWarmup();
      entries = this.getAudioEntries();
    }
    const selectedEntry = entries.findIndex((entry) => entry.selected);
    this.audioDialogIndex = Math.max(0, selectedEntry >= 0 ? selectedEntry : 0);
    this.audioFocusedColumn = "tracks";
    this.audioMixFocusIndex = 0;
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeAudioDialog() {
    this.audioDialogVisible = false;
    this.renderAudioDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyAudioTrack(index) {
    const entries = this.getAudioEntries();
    const selectedEntry = entries[index] || null;
    if (!selectedEntry) {
      return;
    }

    if (Number.isFinite(selectedEntry.avplayAudioTrackIndex)) {
      const applied = typeof PlayerController.setAvPlayAudioTrack === "function"
        ? PlayerController.setAvPlayAudioTrack(selectedEntry.avplayAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.avplayAudioTrackIndex;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (Number.isFinite(selectedEntry.dashAudioTrackIndex)) {
      const applied = typeof PlayerController.setDashAudioTrack === "function"
        ? PlayerController.setDashAudioTrack(selectedEntry.dashAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.dashAudioTrackIndex;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (Number.isFinite(selectedEntry.hlsAudioTrackIndex)) {
      const applied = typeof PlayerController.setHlsAudioTrack === "function"
        ? PlayerController.setHlsAudioTrack(selectedEntry.hlsAudioTrackIndex)
        : false;
      if (applied) {
        this.selectedAudioTrackIndex = selectedEntry.hlsAudioTrackIndex;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (selectedEntry.manifestAudioTrackId) {
      this.applyManifestTrackSelection({ audioTrackId: selectedEntry.manifestAudioTrackId });
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    const audioTracks = this.getAudioTracks();
    const nativeTrackIndex = Number(selectedEntry.audioTrackIndex);
    if (!audioTracks.length || !Number.isFinite(nativeTrackIndex) || nativeTrackIndex < 0 || nativeTrackIndex >= audioTracks.length) {
      return;
    }

    const appliedByController = typeof PlayerController.setNativeAudioTrack === "function"
      ? PlayerController.setNativeAudioTrack(nativeTrackIndex)
      : false;
    if (appliedByController) {
      this.selectedAudioTrackIndex = nativeTrackIndex;
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    audioTracks.forEach((track, trackIndex) => {
      const selected = trackIndex === nativeTrackIndex;
      try {
        if ("enabled" in track) {
          track.enabled = selected;
        }
      } catch (_) {
        // Best effort.
      }
      try {
        if ("selected" in track) {
          track.selected = selected;
        }
      } catch (_) {
        // Best effort.
      }
    });
    this.selectedAudioTrackIndex = nativeTrackIndex;
    this.renderControlButtons();
    this.renderAudioDialog();
  },

  renderAudioDialog() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.audioDialogVisible);
    if (!this.audioDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const entries = this.getAudioEntries();
    if (!entries.length) {
      const loading = this.isCurrentSourceAdaptiveManifest() && (this.manifestLoading || this.trackDiscoveryInProgress);
      const emptyMessage = loading ? "Loading audio tracks..." : this.getUnavailableTrackMessage("audio");
      dialog.innerHTML = `
        <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
        <div class="player-dialog-empty">${emptyMessage}</div>
      `;
      return;
    }

    this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);
    this.audioMixFocusIndex = clamp(this.audioMixFocusIndex, 0, 2);

    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
      <div class="player-audio-overlay-grid">
        <div class="player-dialog-list player-audio-track-list">
          ${entries.map((entry, index) => {
            const selected = entry.selected;
            const focused = this.audioFocusedColumn === "tracks" && index === this.audioDialogIndex;
            return `
              <div class="player-dialog-item${selected ? " selected" : ""}${focused ? " focused" : ""}">
                <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
                <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
                <div class="player-dialog-item-check">${selected ? "&#10003;" : ""}</div>
              </div>
            `;
          }).join("")}
        </div>
        <div class="player-audio-mix-panel">
          <div class="player-audio-mix-title">${escapeHtml(t("audio_boost_title", {}, "Audio Boost"))}</div>
          <div class="player-audio-mix-value">${escapeHtml(`${this.audioAmplificationDb} dB`)}</div>
          <div class="player-audio-mix-buttons">
            <div class="player-dialog-item player-audio-mix-btn${this.audioFocusedColumn === "mix" && this.audioMixFocusIndex === 0 ? " focused" : ""}${this.audioAmplificationDb <= AUDIO_AMPLIFICATION_MIN_DB || !this.audioAmplificationAvailable ? " disabled" : ""}">
              <div class="player-dialog-item-main">-</div>
              <div class="player-dialog-item-sub">${escapeHtml(t("common.decrease", {}, "Decrease"))}</div>
            </div>
            <div class="player-dialog-item player-audio-mix-btn${this.audioFocusedColumn === "mix" && this.audioMixFocusIndex === 1 ? " focused" : ""}${this.audioAmplificationDb >= AUDIO_AMPLIFICATION_MAX_DB || !this.audioAmplificationAvailable ? " disabled" : ""}">
              <div class="player-dialog-item-main">+</div>
              <div class="player-dialog-item-sub">${escapeHtml(t("common.increase", {}, "Increase"))}</div>
            </div>
          </div>
          <div class="player-dialog-item player-audio-mix-persist${this.audioFocusedColumn === "mix" && this.audioMixFocusIndex === 2 ? " focused" : ""}${this.persistAudioAmplification ? " selected" : ""}">
            <div class="player-dialog-item-main">${escapeHtml(t("audio_persist_amplification", {}, "Persist boost"))}</div>
            <div class="player-dialog-item-sub">${escapeHtml(this.persistAudioAmplification ? t("common.on", {}, "On") : t("common.off", {}, "Off"))}</div>
            <div class="player-dialog-item-check">${this.persistAudioAmplification ? "&#10003;" : ""}</div>
          </div>
        </div>
      </div>
    `;
  },

  handleAudioDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getAudioEntries();

    if (!entries.length) {
      return true;
    }

    if (keyCode === 37) {
      if (this.audioFocusedColumn === "mix") {
        this.audioFocusedColumn = "tracks";
        this.renderAudioDialog();
      }
      return true;
    }

    if (keyCode === 39) {
      this.audioFocusedColumn = "mix";
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 38) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex - 1, 0, 2);
      }
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 40) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex + 1, 0, 2);
      }
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 13) {
      if (this.audioFocusedColumn === "tracks") {
        this.applyAudioTrack(this.audioDialogIndex);
      } else if (this.audioMixFocusIndex === 0 && this.audioAmplificationDb > AUDIO_AMPLIFICATION_MIN_DB) {
        this.adjustAudioAmplification(-1);
      } else if (this.audioMixFocusIndex === 1 && this.audioAmplificationDb < AUDIO_AMPLIFICATION_MAX_DB) {
        this.adjustAudioAmplification(1);
      } else if (this.audioMixFocusIndex === 2) {
        this.togglePersistAudioAmplification();
      }
      return true;
    }

    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13;
  },

  openSpeedDialog() {
    const currentSpeed = Number(PlayerController.video?.playbackRate || 1);
    this.speedDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.findIndex((value) => value === currentSpeed));
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.renderSpeedDialog();
    this.updateModalBackdrop();
  },

  closeSpeedDialog() {
    this.speedDialogVisible = false;
    this.renderSpeedDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyPlaybackSpeed(speed = 1) {
    const video = PlayerController.video;
    if (!video) {
      return;
    }
    video.playbackRate = Number(speed || 1);
    this.renderControlButtons();
    this.renderSpeedDialog();
  },

  renderSpeedDialog() {
    const dialog = this.uiRefs?.speedDialog;
    if (!dialog) {
      return;
    }
    dialog.classList.toggle("hidden", !this.speedDialogVisible);
    if (!this.speedDialogVisible) {
      dialog.innerHTML = "";
      return;
    }
    const currentSpeed = Number(PlayerController.video?.playbackRate || 1);
    this.speedDialogIndex = clamp(this.speedDialogIndex, 0, PLAYER_SPEEDS.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("player_playback_speed", {}, "Playback speed"))}</div>
      <div class="player-dialog-list">
        ${PLAYER_SPEEDS.map((speed, index) => `
          <div class="player-dialog-item${speed === currentSpeed ? " selected" : ""}${index === this.speedDialogIndex ? " focused" : ""}">
            <div class="player-dialog-item-main">${escapeHtml(`${speed}x`)}</div>
            <div class="player-dialog-item-sub">${escapeHtml(speed === 1 ? t("common.normal", {}, "Normal") : t("player_playback_speed", {}, "Playback speed"))}</div>
            <div class="player-dialog-item-check">${speed === currentSpeed ? "&#10003;" : ""}</div>
          </div>
        `).join("")}
      </div>
    `;
  },

  handleSpeedDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 38) {
      this.speedDialogIndex = clamp(this.speedDialogIndex - 1, 0, PLAYER_SPEEDS.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (keyCode === 40) {
      this.speedDialogIndex = clamp(this.speedDialogIndex + 1, 0, PLAYER_SPEEDS.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (keyCode === 13) {
      this.applyPlaybackSpeed(PLAYER_SPEEDS[this.speedDialogIndex] || 1);
      return true;
    }
    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13;
  },

  getSourceFilters() {
    const addons = Array.from(new Set(this.streamCandidates.map((stream) => stream.addonName).filter(Boolean)));
    return ["all", ...addons];
  },

  getFilteredSources() {
    if (this.sourceFilter === "all") {
      return this.streamCandidates;
    }
    return this.streamCandidates.filter((stream) => stream.addonName === this.sourceFilter);
  },

  ensureSourcesFocus() {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }

    if (this.sourcesFocus.zone === "top") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
      return;
    }

    if (this.sourcesFocus.zone === "filter") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, filters.length - 1));
      return;
    }

    this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, list.length - 1));
    if (!list.length && filters.length) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }
  },
  setSourceFilter(filter) {
    const available = this.getSourceFilters();
    if (!available.includes(filter)) {
      this.sourceFilter = "all";
      return;
    }
    this.sourceFilter = filter;
    this.sourcesFocus = { zone: "filter", index: clamp(available.indexOf(filter), 0, available.length - 1) };
  },

  openSourcesPanel({ forceReload = false } = {}) {
    this.cancelSeekPreview({ commit: false });
    this.sourcesPanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.moreActionsVisible = false;

    const filters = this.getSourceFilters();
    this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1)) };

    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();

    if (forceReload || !this.streamCandidates.length) {
      this.reloadSources();
    }
  },

  closeSourcesPanel() {
    this.sourcesPanelVisible = false;
    this.sourcesError = "";
    this.renderSourcesPanel();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async reloadSources() {
    if (this.sourcesLoading) {
      return;
    }

    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "");
    if (!videoId) {
      return;
    }

    const token = this.sourceLoadToken + 1;
    this.sourceLoadToken = token;
    this.sourcesLoading = true;
    this.sourcesError = "";
    this.renderSourcesPanel();

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onChunk: (chunkResult) => {
        if (token !== this.sourceLoadToken) {
          return;
        }
        const chunkItems = flattenStreamGroups(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
        this.renderSourcesPanel();
      }
    };

    try {
      const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
      if (token !== this.sourceLoadToken) {
        return;
      }
      const merged = mergeStreamItems(this.streamCandidates, flattenStreamGroups(result));
      if (merged.length) {
        this.streamCandidates = merged;
      }
    } catch (error) {
      if (token === this.sourceLoadToken) {
        this.sourcesError = t("panel_failed_load_streams", {}, "Failed to load streams");
      }
    } finally {
      if (token === this.sourceLoadToken) {
        this.sourcesLoading = false;
        this.renderSourcesPanel();
      }
    }
  },

  renderSourcesPanel() {
    const panel = this.uiRefs?.sourcesPanel;
    if (!panel) {
      return;
    }

    panel.classList.toggle("hidden", !this.sourcesPanelVisible);
    if (!this.sourcesPanelVisible) {
      panel.innerHTML = "";
      return;
    }

    const filters = this.getSourceFilters();
    const filtered = this.getFilteredSources();
    this.ensureSourcesFocus();

    panel.innerHTML = `
      <div class="player-sources-header">
        <div class="player-sources-title">${escapeHtml(t("sources_title", {}, "Sources"))}</div>
        <div class="player-sources-actions">
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload">${escapeHtml(t("sources_reload", {}, "Reload"))}</button>
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close">${escapeHtml(t("sources_close", {}, "Close"))}</button>
        </div>
      </div>

      <div class="player-source-current-meta">
        ${escapeHtml(this.params?.season != null && this.params?.episode != null
          ? `S${this.params.season} E${this.params.episode}${this.params.playerSubtitle ? ` • ${this.params.playerSubtitle}` : ""}`
          : (this.params?.playerTitle || this.params?.itemId || ""))}
      </div>

      <div class="player-sources-filters">
        ${filters.map((filter, index) => {
          const selected = this.sourceFilter === filter;
          const focused = this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
          return `
            <div class="player-sources-filter${selected ? " selected" : ""}${focused ? " focused" : ""}">
              ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
            </div>
          `;
        }).join("")}
      </div>

      <div class="player-sources-list">
        ${this.sourcesLoading ? `<div class="player-sources-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>` : ""}
        ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
        ${!this.sourcesLoading && !filtered.length
          ? `<div class="player-sources-empty">${escapeHtml(t("sources_no_streams", {}, "No streams found"))}</div>`
          : filtered.map((stream, index) => {
            const focused = this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
            const isCurrent = this.streamCandidates[this.currentStreamIndex]?.url === stream.url;
            return `
              <article class="player-source-card${focused ? " focused" : ""}${isCurrent ? " selected" : ""}">
                <div class="player-source-main">
                  <div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>
                  <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                  <div class="player-source-tags">
                    <span class="player-source-tag">${escapeHtml(qualityLabelFromText(`${stream.label} ${stream.description}`))}</span>
                    <span class="player-source-tag">${escapeHtml(String(stream.sourceType || "stream") || "stream")}</span>
                  </div>
                </div>
                <div class="player-source-side">
                  <div class="player-source-addon">${escapeHtml(stream.addonName || t("nav_addons", {}, "Addon"))}</div>
                  ${isCurrent ? `<div class="player-source-playing">${escapeHtml(t("sources_playing", {}, "Playing"))}</div>` : ""}
                </div>
              </article>
            `;
          }).join("")}
      </div>
    `;

    const focusedCard = panel.querySelector(".player-source-card.focused");
    if (focusedCard) {
      focusedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  moveSourcesFocus(direction) {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();
    const zone = this.sourcesFocus.zone;
    let index = Number(this.sourcesFocus.index || 0);

    if (zone === "top") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
        return;
      }
      if (direction === "down") {
        if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else if (list.length) {
          this.sourcesFocus = { zone: "list", index: 0 };
        }
        return;
      }
      return;
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "filter", index: clamp(index - 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "filter", index: clamp(index + 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "up") {
        this.sourcesFocus = { zone: "top", index: 0 };
        return;
      }
      if (direction === "down" && list.length) {
        this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
      }
      return;
    }

    if (zone === "list") {
      if (direction === "up") {
        if (index > 0) {
          this.sourcesFocus = { zone: "list", index: index - 1 };
        } else if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else {
          this.sourcesFocus = { zone: "top", index: 0 };
        }
        return;
      }
      if (direction === "down") {
        this.sourcesFocus = { zone: "list", index: clamp(index + 1, 0, Math.max(0, list.length - 1)) };
      }
    }
  },

  async activateSourcesFocus() {
    const zone = this.sourcesFocus.zone;
    const index = Number(this.sourcesFocus.index || 0);
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (zone === "top") {
      if (index === 0) {
        await this.reloadSources();
        return;
      }
      this.closeSourcesPanel();
      return;
    }

    if (zone === "filter") {
      const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
      this.setSourceFilter(selected);
      this.renderSourcesPanel();
      return;
    }

    const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
    if (selectedStream?.url) {
      await this.playStreamByUrl(selectedStream.url, { preservePlaybackState: true });
    }
  },

  async handleSourcesPanelKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 82) {
      await this.reloadSources();
      return true;
    }

    if (keyCode === 37) {
      this.moveSourcesFocus("left");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 39) {
      this.moveSourcesFocus("right");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 38) {
      this.moveSourcesFocus("up");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 40) {
      this.moveSourcesFocus("down");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 13) {
      await this.activateSourcesFocus();
      return true;
    }

    return false;
  },

  showAspectToast(label) {
    const toast = this.uiRefs?.aspectToast;
    if (!toast) {
      return;
    }

    toast.textContent = label;
    toast.classList.remove("hidden");

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
    }

    this.aspectToastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 1400);
  },

  applyAspectMode({ showToast = false } = {}) {
    const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
    const video = PlayerController.video;
    if (video) {
      video.style.objectFit = mode.objectFit;
    }
    if (showToast) {
      this.showAspectToast(mode.label);
    }
  },

  cycleAspectMode() {
    this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
    this.applyAspectMode({ showToast: true });
  },
  renderParentalGuideOverlay() {
    const overlay = this.uiRefs?.parentalGuide;
    if (!overlay) {
      return;
    }

    overlay.classList.toggle("hidden", !this.parentalGuideVisible || !this.parentalWarnings.length);
    if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
      overlay.innerHTML = "";
      return;
    }

    overlay.innerHTML = `
      <div class="player-parental-line"></div>
      <div class="player-parental-list">
        ${this.parentalWarnings.map((warning, index) => `
          <div class="player-parental-item" style="animation-delay:${index * 120}ms">
            <span class="player-parental-label">${escapeHtml(warning.label)}</span>
            <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
          </div>
        `).join("")}
      </div>
    `;
  },

  showParentalGuideOverlay() {
    if (!this.parentalWarnings.length) {
      return;
    }

    this.parentalGuideVisible = true;
    this.parentalGuideShown = true;
    this.renderParentalGuideOverlay();

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
    }

    this.parentalGuideTimer = setTimeout(() => {
      this.parentalGuideVisible = false;
      this.renderParentalGuideOverlay();
    }, 5200);
  },

  toggleEpisodePanel() {
    if (!this.episodes.length) {
      return;
    }
    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return;
    }
    this.episodePanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.updateModalBackdrop();
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();
  },

  moveEpisodePanel(delta) {
    if (!this.episodePanelVisible || !this.episodes.length) {
      return;
    }
    const lastIndex = this.episodes.length - 1;
    this.episodePanelIndex = clamp(this.episodePanelIndex + delta, 0, lastIndex);
    this.renderEpisodePanel();
  },

  renderEpisodePanel() {
    this.container.querySelector("#episodeSidePanel")?.remove();
    if (!this.episodePanelVisible) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = "episodeSidePanel";
    panel.className = "player-episode-panel";

    const cards = this.episodes.slice(0, 80).map((episode, index) => {
      const selected = index === this.episodePanelIndex;
      const selectedClass = selected ? " selected" : "";
      return `
        <div class="player-episode-item${selectedClass}">
          <div class="player-episode-item-title">S${episode.season}E${episode.episode} ${escapeHtml(episode.title || t("episodes_episode", {}, "Episode"))}</div>
          <div class="player-episode-item-subtitle">${escapeHtml(episode.overview || "")}</div>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="player-episode-panel-title">${escapeHtml(t("episodes_panel_title", {}, "Episodes"))}</div>
      <div class="player-episode-panel-hint">${escapeHtml(buildEpisodePanelHint())}</div>
      ${cards}
    `;
    this.container.appendChild(panel);
  },

  hideEpisodePanel() {
    this.episodePanelVisible = false;
    this.container?.querySelector("#episodeSidePanel")?.remove();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async playEpisodeFromPanel() {
    if (this.switchingEpisode || !this.episodes.length) {
      return;
    }
    const selected = this.episodes[this.episodePanelIndex];
    if (!selected?.id) {
      return;
    }
    this.switchingEpisode = true;
    try {
      const itemType = this.params?.itemType || "series";
      const streamResult = await streamRepository.getStreamsFromAllAddons(normalizeItemType(itemType), selected.id);
      const streamItems = (streamResult?.status === "success")
        ? flattenStreamGroups(streamResult)
        : [];
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: selected.id,
        season: selected.season ?? null,
        episode: selected.episode ?? null,
        episodeLabel: `S${selected.season}E${selected.episode}`,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes,
        streamCandidates: streamItems,
        nextEpisodeVideoId: nextEpisode?.id || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
      });
    } finally {
      this.switchingEpisode = false;
    }
  },

  async loadSubtitles() {
    const requestToken = (this.subtitleLoadToken || 0) + 1;
    this.subtitleLoadToken = requestToken;
    this.subtitleLoading = true;

    const sidecarSubtitles = this.collectStreamSidecarSubtitles();
    const subtitleLookup = this.buildSubtitleLookupContext();
    try {
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.attachExternalSubtitles();
      this.refreshTrackDialogs();

      let repositorySubtitles = [];

      try {
        if (subtitleLookup.id && subtitleLookup.type) {
          repositorySubtitles = await subtitleRepository.getSubtitles(
            subtitleLookup.type,
            subtitleLookup.id,
            subtitleLookup.videoId || null
          );
        }
      } catch (error) {
        console.error("Subtitle fetch failed", error);
      }

      if (requestToken !== this.subtitleLoadToken) {
        return;
      }

      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, repositorySubtitles);
      this.attachExternalSubtitles();
      if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
        const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
        if (builtInBoundary <= 0 && this.subtitles.length > 0) {
          this.subtitleDialogTab = "addons";
          this.subtitleDialogIndex = 0;
        }
      }
      this.refreshTrackDialogs();
    } catch (error) {
      console.error("Subtitle attach failed", error);
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.refreshTrackDialogs();
    } finally {
      if (requestToken === this.subtitleLoadToken) {
        this.subtitleLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    this.builtInSubtitleCount = this.getTextTracks().length;
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (usingAvPlay) {
      return;
    }

    this.subtitles.forEach((subtitle, index) => {
      if (!subtitle.url) {
        return;
      }
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || `Sub ${index + 1}`;
      track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
      track.src = subtitle.url;
      video.appendChild(track);
      this.externalTrackNodes.push(track);
    });
  },
  moveControlFocus(delta) {
    const controls = this.getControlDefinitions();
    if (!controls.length) {
      return;
    }
    if (this.controlFocusZone === "progress") {
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = delta < 0 ? 0 : 0;
      this.renderControlButtons();
      return;
    }
    const nextIndex = clamp(this.controlFocusIndex + delta, 0, controls.length - 1);
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = nextIndex;
    this.renderControlButtons();
    this.resetControlsAutoHide();
  },

  performFocusedControl() {
    if (this.controlFocusZone === "progress") {
      this.cancelSeekPreview({ commit: true });
      this.resetControlsAutoHide();
      return;
    }
    const controls = this.getControlDefinitions();
    const current = controls[this.controlFocusIndex] || null;
    if (!current) {
      return;
    }
    this.performControlAction(current.action || "");
  },

  performControlAction(action) {
    if (action === "playPause") {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (action === "subtitleDialog") {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (action === "audioTrack") {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (action === "source") {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (action === "episodes") {
      this.toggleEpisodePanel();
      return;
    }

    if (action === "more") {
      this.moreActionsVisible = true;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(0, this.getControlDefinitions().findIndex((entry) => entry.action === "speed"));
      this.renderControlButtons();
      return;
    }

    if (action === "backFromMore") {
      this.moreActionsVisible = false;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(0, this.getControlDefinitions().findIndex((entry) => entry.action === "more"));
      this.renderControlButtons();
      return;
    }

    if (action === "speed") {
      this.openSpeedDialog();
      return;
    }

    if (action === "aspect") {
      this.cycleAspectMode();
      return;
    }
  },

  consumeBackRequest() {
    if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
      this.cancelSeekPreview({ commit: false });
      return true;
    }

    if (this.sourcesPanelVisible) {
      this.closeSourcesPanel();
      return true;
    }

    if (this.subtitleDialogVisible) {
      this.closeSubtitleDialog();
      return true;
    }

    if (this.audioDialogVisible) {
      this.closeAudioDialog();
      return true;
    }

    if (this.speedDialogVisible) {
      this.closeSpeedDialog();
      return true;
    }

    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return true;
    }

    if (this.moreActionsVisible) {
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.focusFirstControl();
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13) {
      event?.preventDefault?.();
    }

    if (this.sourcesPanelVisible) {
      if (await this.handleSourcesPanelKey(event)) {
        return;
      }
    }

    if (this.subtitleDialogVisible) {
      if (this.handleSubtitleDialogKey(event)) {
        return;
      }
    }

    if (this.audioDialogVisible) {
      if (this.handleAudioDialogKey(event)) {
        return;
      }
    }

    if (this.speedDialogVisible) {
      if (this.handleSpeedDialogKey(event)) {
        return;
      }
    }

    if (keyCode === 83) {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (keyCode === 84) {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (keyCode === 67) {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (keyCode === 69) {
      this.toggleEpisodePanel();
      return;
    }

    if (keyCode === 80) {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (this.episodePanelVisible) {
      if (keyCode === 38) {
        this.moveEpisodePanel(-1);
        return;
      }
      if (keyCode === 40) {
        this.moveEpisodePanel(1);
        return;
      }
      if (keyCode === 13) {
        this.playEpisodeFromPanel();
        return;
      }
    }

    if (!this.controlsVisible) {
      if (keyCode === 37) {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38 || keyCode === 40 || keyCode === 13) {
        this.cancelSeekPreview({ commit: true });
        this.setControlsVisible(true, { focus: keyCode === 13 });
        if (keyCode === 13) {
          this.togglePause();
          this.renderControlButtons();
        }
      }
      return;
    }

    if (this.controlFocusZone === "progress") {
      if (keyCode === 37) {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.setControlsVisible(false);
        return;
      }
      if (keyCode === 40) {
        this.controlFocusZone = "buttons";
        this.renderControlButtons();
        return;
      }
      if (keyCode === 13) {
        this.togglePause();
        this.renderControlButtons();
        return;
      }
    }

    if (keyCode === 37) {
      this.moveControlFocus(-1);
      return;
    }
    if (keyCode === 39) {
      this.moveControlFocus(1);
      return;
    }
    if (keyCode === 38) {
      this.focusProgressBar();
      return;
    }
    if (keyCode === 40) {
      this.setControlsVisible(false);
      return;
    }
    if (keyCode === 13) {
      this.performFocusedControl();
      return;
    }

    this.resetControlsAutoHide();
  },

  selectBestStreamUrl(streams = []) {
    if (!Array.isArray(streams) || !streams.length) {
      return null;
    }

    const hasCapabilityProbe = Boolean(PlayerController?.video);
    const isWebOsRuntime = Environment.isWebOS();
    const capabilities = hasCapabilityProbe && typeof PlayerController.getPlaybackCapabilities === "function"
      ? PlayerController.getPlaybackCapabilities()
      : null;
    const supports = (key, fallback = true) => {
      if (!capabilities) {
        return fallback;
      }
      return Boolean(capabilities[key]);
    };

    const scored = streams
      .filter((stream) => Boolean(stream?.url))
      .map((stream) => {
        const text = `${stream.title || stream.label || ""} ${stream.name || ""} ${stream.description || ""} ${stream.url || ""}`.toLowerCase();
        let score = 0;

        if (text.includes("2160") || text.includes("4k")) score += 60;
        else if (text.includes("1080")) score += 40;
        else if (text.includes("720")) score += 20;
        else if (text.includes("480")) score += 10;

        if (text.includes("web")) score += 8;
        if (text.includes("bluray")) score += 8;
        if (text.includes("cam")) score -= 70;
        if (text.includes("ts")) score -= 40;

        if (text.includes("hevc") || text.includes("h265") || text.includes("x265")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 12 : -90;
        }
        if (text.includes("av1")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (text.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -50;
        }
        if (text.includes(".mkv") || text.includes("matroska")) {
          score += supports("mkvH264", true) ? 8 : -60;
        }
        if (text.includes(".webm")) {
          score += supports("webmVp9", true) ? 6 : -45;
        }

        if (text.includes("hdr") || text.includes("hdr10") || text.includes("hlg")) {
          score += supports("hdrLikely", true) ? 16 : -35;
        }
        if (text.includes("dolby vision") || text.includes(" dv ")) {
          score += supports("dolbyVision", true) ? 18 : -45;
        }
        if (text.includes("atmos") || text.includes("eac3") || text.includes("ec-3")) {
          score += supports("atmosLikely", true) || supports("audioEac3", true) ? 14 : -30;
        }
        if (/\b(aac|mp4a)\b/.test(text)) {
          score += 16;
        }
        if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += 10;
        }
        if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += isWebOsRuntime ? -70 : -18;
        }
        if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
          score += isWebOsRuntime ? -85 : -40;
        }
        if (/\b(stereo|2\.0|2ch)\b/.test(text)) {
          score += isWebOsRuntime ? 10 : 4;
        }

        return { stream, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.stream?.url || streams[0]?.url || null;
  },

  async handlePlaybackEnded() {
    let nextVideoId = this.params?.nextEpisodeVideoId || null;
    let nextEpisodeLabel = this.params?.nextEpisodeLabel || null;
    let nextEpisode = null;
    if (!nextVideoId && this.params?.videoId && this.episodes.length) {
      const currentIndex = this.episodes.findIndex((episode) => episode.id === this.params.videoId);
      nextEpisode = currentIndex >= 0 ? this.episodes[currentIndex + 1] : null;
      nextVideoId = nextEpisode?.id || null;
      nextEpisodeLabel = nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null;
    }
    if (!nextEpisode && nextVideoId && this.episodes.length) {
      nextEpisode = this.episodes.find((episode) => episode.id === nextVideoId) || null;
    }
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextVideoId || itemType !== "series") {
      return;
    }

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, nextVideoId);
      const streamItems = (streamResult?.status === "success")
        ? flattenStreamGroups(streamResult)
        : [];
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: nextVideoId,
        season: nextEpisode?.season ?? null,
        episode: nextEpisode?.episode ?? null,
        episodeLabel: nextEpisodeLabel || null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisodeLabel || "",
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes || [],
        streamCandidates: streamItems,
        nextEpisodeVideoId: null,
        nextEpisodeLabel: null
      });
    } catch (error) {
      console.warn("Next episode auto-play failed", error);
    }
  },

  cleanup() {
    this.cancelSeekPreview({ commit: false });
    this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
    this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
    this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.subtitleLoading = false;
    this.manifestLoading = false;
    this.clearTrackDiscoveryTimer();
    this.clearPlaybackStallGuard();

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    this.clearControlsAutoHide();

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
      this.aspectToastTimer = null;
    }

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
      this.parentalGuideTimer = null;
    }

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    this.unbindVideoEvents();

    PlayerController.stop();

    if (this.container) {
      this.container.style.display = "none";
      this.container.querySelector("#playerUiRoot")?.remove();
      this.container.querySelector("#episodeSidePanel")?.remove();
    }
    this.uiRefs = null;
    this.lastUiTickState = null;

    if (this.endedHandler && PlayerController.video) {
      PlayerController.video.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }
  }

};
