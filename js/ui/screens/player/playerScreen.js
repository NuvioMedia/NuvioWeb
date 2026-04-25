import { PlayerController } from "../../../core/player/playerController.js";
import { localMediaTracksRepository } from "../../../data/repository/localMediaTracksRepository.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { parentalGuideRepository } from "../../../data/repository/parentalGuideRepository.js";
import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
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
const SUBTITLE_VERTICAL_OFFSET_STEP = 0.01;
const AUDIO_AMPLIFICATION_MIN_DB = 0;
const AUDIO_AMPLIFICATION_MAX_DB = 10;
const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const NEXT_EPISODE_THRESHOLD_PERCENT = 0.97;
const SKIP_INTERVAL_CHECK_MS = 250;
const PAUSE_OVERLAY_DELAY_MS = 5000;
const MAX_PAUSE_OVERLAY_CAST = 8;
const UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS = new Set(["HDMV/PGS", "VOBSUB"]);

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

function extractReleaseYear(value) {
  return String(value ?? "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
}

function normalizeComparableText(value) {
  return cleanDisplayText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function extractPauseOverlayCast(data = {}) {
  const result = [];
  const seen = new Set();
  const collections = [
    data?.castItems,
    data?.castMembers,
    data?.cast,
    data?.credits?.cast
  ];

  const pushEntry = (entry) => {
    if (!entry) {
      return;
    }
    const name = typeof entry === "string"
      ? cleanDisplayText(entry)
      : cleanDisplayText(entry?.name || entry?.fullName || entry?.actor || "");
    if (!name) {
      return;
    }
    const character = typeof entry === "string"
      ? ""
      : cleanDisplayText(entry?.character || entry?.role || "");
    const key = normalizeComparableText(`${name}|${character}`);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ name, character });
  };

  collections.forEach((collection) => {
    if (!Array.isArray(collection)) {
      return;
    }
    collection.forEach(pushEntry);
  });

  return result.slice(0, MAX_PAUSE_OVERLAY_CAST);
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

function formatAudioCodecName(value) {
  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }

  if (text.includes("eac3-joc") || text.includes("ec-3-joc") || text.includes("atmos")) return "E-AC-3-JOC";
  if (text.includes("truehd")) return "TrueHD";
  if (text.includes("dts-hd")) return "DTS-HD";
  if (text.includes("dts express")) return "DTS Express";
  if (text.includes("dts")) return "DTS";
  if (text.includes("ec-3") || text.includes("eac3") || text.includes("ddp") || text.includes("dolby digital plus")) return "E-AC-3";
  if (text.includes("ac-3") || text.includes("ac3") || text.includes("dolby digital")) return "AC-3";
  if (text.includes("ac-4") || text.includes("ac4")) return "AC-4";
  if (text.includes("aac") || text.includes("mp4a")) return "AAC";
  if (text.includes("mp3") || text.includes("mpeg audio")) return "MP3";
  if (text.includes("mp2")) return "MP2";
  if (text.includes("vorbis")) return "Vorbis";
  if (text.includes("opus")) return "Opus";
  if (text.includes("flac")) return "FLAC";
  if (text.includes("alac")) return "ALAC";
  if (text.includes("wav") || text.includes("pcm")) return "WAV";
  if (text.includes("amr-wb")) return "AMR-WB";
  if (text.includes("amr-nb")) return "AMR-NB";
  if (text.includes("amr")) return "AMR";
  if (text.includes("iamf")) return "IAMF";
  if (text.includes("mpegh") || text.includes("mhm1") || text.includes("mha1")) return "MPEG-H";
  return "";
}

function formatAudioChannelLayout(value) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    if (numericValue === 1) return "Mono";
    if (numericValue === 2) return "Stereo";
    if (numericValue === 6) return "5.1";
    if (numericValue === 8) return "7.1";
    return `${numericValue}ch`;
  }

  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("mono") || text === "1" || text === "1.0") return "Mono";
  if (text.includes("stereo") || text === "2" || text === "2.0") return "Stereo";
  if (text.includes("5.1") || text === "6") return "5.1";
  if (text.includes("7.1") || text === "8") return "7.1";
  const numericMatch = text.match(/\b(\d{1,2})(?:ch| channels?)\b/) || text.match(/^(\d{1,2})$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels}ch`;
}

function formatAudioTrackDisplay(track = {}, index = 0) {
  const rawLabel = getMeaningfulTrackLabel(track);
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  const languageLabel = getTrackLanguageLabel(track);
  const codecName = formatAudioCodecName(
    track?.sampleMimeType
    || track?.codec
    || track?.codecs
    || track?.audioCodec
    || getTrackMetadataStrings(track).join(" ")
  );
  const channelLayout = formatAudioChannelLayout(track?.channelCount || track?.channels);
  const sampleRate = Number(track?.sampleRate || track?.audioSampleRate || 0);
  const baseName = rawLabel || rawLanguage || audioLabel(index);
  const suffix = [codecName, channelLayout].filter(Boolean).join(" ");
  const label = suffix ? `${baseName} (${suffix})` : baseName;
  const secondaryParts = [];
  if (languageLabel && normalizeComparableText(languageLabel) !== normalizeComparableText(baseName)) {
    pushUniqueText(secondaryParts, languageLabel);
  }
  if (Number.isFinite(sampleRate) && sampleRate > 0) {
    pushUniqueText(secondaryParts, `${Math.round(sampleRate / 1000)} kHz`);
  }
  const secondary = secondaryParts.join(" | ");

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
  return normalized || "movie";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
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

function normalizeSubtitleVerticalOffset(value = 0) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const normalized = Number(clamp(parsed, -12, 12).toFixed(2));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function splitSubtitleVerticalOffset(value = 0) {
  const normalized = normalizeSubtitleVerticalOffset(value);
  const lineOffset = normalized < 0 ? Math.ceil(normalized) : Math.floor(normalized);
  const residualOffset = Number((normalized - lineOffset).toFixed(2));
  return {
    value: normalized,
    lineOffset,
    residualOffset: Object.is(residualOffset, -0) ? 0 : residualOffset
  };
}

function formatSubtitleVerticalOffset(value = 0) {
  return normalizeSubtitleVerticalOffset(value).toFixed(2);
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
  const label = getTrackLanguageLabel({ language: languageKey }) || String(languageKey || "").toUpperCase();
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  return label
    ? `${label.charAt(0).toLocaleUpperCase(locale)}${label.slice(1)}`
    : "";
}

function styleChipLabel(value = "") {
  return String(value || "").replace(/^#/, "").toUpperCase();
}

function createTrackDialogCache() {
  return {
    subtitleOptions: null,
    subtitleLanguageRail: null,
    subtitleOptionsByLanguage: new Map(),
    audioEntries: null,
    embeddedAudioByNativeIndex: null,
    embeddedAudioByEmbeddedIndex: null,
    embeddedSubtitleByNativeIndex: null,
    embeddedSubtitleByEmbeddedIndex: null
  };
}

function dbToGain(db = 0) {
  return Math.pow(10, Number(db || 0) / 20);
}

function supportsTvWebAudioAmplification() {
  return !Environment.isWebOS() && !Environment.isTizen();
}

function flattenStreamGroups(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  const flattened = [];
  (streamResult.data || []).forEach((group) => {
    const addonName = group.addonName || "Addon";
    (group.streams || []).forEach((stream, index) => {
      const entry = {
        id: `${addonName}-${index}-${stream.url || ""}`,
        label: stream.title || stream.name || `${addonName} stream`,
        description: stream.description || stream.name || "",
        addonName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      };
      if (entry.url) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
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

function buildLocalizedParentalWarnings(guide = {}) {
  const labels = {
    nudity: t("parental_nudity", {}, "Nudity"),
    violence: t("parental_violence", {}, "Violence"),
    profanity: t("parental_profanity", {}, "Profanity"),
    alcohol: t("parental_alcohol", {}, "Alcohol/Drugs"),
    frightening: t("parental_frightening", {}, "Frightening")
  };
  const severityLabels = {
    severe: t("parental_severity_severe", {}, "Severe"),
    moderate: t("parental_severity_moderate", {}, "Moderate"),
    mild: t("parental_severity_mild", {}, "Mild")
  };
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2
  };
  return Object.entries(labels)
    .map(([key, label]) => ({
      label,
      severityKey: String(guide?.[key] || "").trim().toLowerCase()
    }))
    .filter((entry) => entry.severityKey && entry.severityKey !== "none")
    .sort((left, right) => (severityRank[left.severityKey] ?? 50) - (severityRank[right.severityKey] ?? 50))
    .map((entry) => ({
      label: entry.label,
      severity: severityLabels[entry.severityKey] || entry.severityKey
    }))
    .slice(0, 5);
}

function normalizePlayableImdbId(value = "") {
  const candidate = String(value || "").trim().split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function buildSkipIntervalLabel(interval = {}) {
  const type = String(interval?.type || "").trim().toLowerCase();
  if (type === "recap") {
    return t("skip_recap", {}, "Skip Recap");
  }
  if (type === "outro" || type === "ed" || type === "mixed-ed") {
    return t("skip_outro", {}, "Skip Outro");
  }
  return t("skip_intro", {}, "Skip Intro");
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
    this.fallbackExternalFrameUrl = String(params.fallbackExternalFrameUrl || "").trim();
    this.externalFrameFallbackUsed = false;

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
    this.embeddedSubtitleTracks = [];
    this.subtitleDialogVisible = false;
    this.subtitleDialogTab = "builtIn";
    this.subtitleDialogIndex = 0;
    this.subtitleLanguageRailIndex = 0;
    this.subtitleOptionRailIndex = 0;
    this.subtitleStyleRailIndex = 0;
    this.subtitleStyleControlSide = "minus";
    this.subtitleFocusedRail = "language";
    this.subtitleDialogScrollMode = "nearest";
    this.selectedSubtitleTrackIndex = -1;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.startupAudioPreferenceApplied = false;
    this.startupAudioPreferenceApplying = false;
    this.startupTrackPreferenceReady = false;
    this.trackDialogCache = createTrackDialogCache();
    this.builtInSubtitleCount = 0;
    this.externalTrackNodes = [];
    this.externalSubtitleObjectUrls = [];
    this.subtitleCueStyleBindings = new Map();
    this.subtitleCueOriginalState = new WeakMap();

    this.audioDialogVisible = false;
    this.audioDialogIndex = 0;
    this.audioMixFocusIndex = 0;
    this.audioFocusedColumn = "tracks";
    this.selectedAudioTrackIndex = -1;
    this.embeddedAudioTracks = [];
    this.selectedEmbeddedAudioTrackIndex = -1;

    this.sourcesPanelVisible = false;
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourceFilter = "all";
    this.sourcesFocus = { zone: "filter", index: 0 };
    this.sourceLoadToken = 0;
    this.streamCandidatesByVideoId = new Map();

    this.aspectModeIndex = 0;
    this.aspectToastTimer = null;
    this.speedDialogVisible = false;
    this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.indexOf(1));

    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.episodePanelVisible = false;
    const explicitEpisodeIndex = this.episodes.findIndex((entry) => entry.id === params.videoId);
    const fallbackEpisodeIndex = this.episodes.findIndex((entry) => {
      const seasonMatch = params.season == null || Number(entry?.season) === Number(params.season);
      const episodeMatch = params.episode == null || Number(entry?.episode) === Number(params.episode);
      return seasonMatch && episodeMatch;
    });
    this.episodePanelIndex = Math.max(0, explicitEpisodeIndex >= 0 ? explicitEpisodeIndex : fallbackEpisodeIndex);
    this.switchingEpisode = false;

    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekCommitTimer = null;
    this.seekOverlayTimer = null;
    this.pauseOverlayVisible = false;
    this.pauseOverlayTimer = null;
    this.pauseOverlayDelayMs = PAUSE_OVERLAY_DELAY_MS;
    this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0);
    this.pauseOverlayMeta = null;
    this.nextEpisodeLaunching = false;
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;

    this.parentalWarnings = normalizeParentalWarnings(params.parentalWarnings || params.parentalGuide);
    this.parentalGuideVisible = false;
    this.parentalGuideShown = false;
    this.parentalGuideTimer = null;
    this.skipIntervals = [];
    this.activeSkipInterval = null;
    this.skipIntervalDismissed = false;
    this.subtitleSelectionTimer = null;
    this.subtitleLoadToken = 0;
    this.subtitleLoading = false;
    this.embeddedSubtitleLoadToken = 0;
    this.embeddedSubtitleLoading = false;
    this.embeddedAudioLoading = false;
    this.initialEmbeddedTrackBootstrapPromise = null;
    this.embeddedTrackRequestPromise = null;
    this.embeddedTrackRequestUrl = "";
    this.lastEmbeddedTrackProbeUrl = "";
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
          paused: false,
          attempts: 0,
          lastAttemptAt: 0
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
    this.hasPresentedPlaybackFrame = false;

    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.moreActionsVisible = false;
    this.controlFocusZone = "buttons";
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusIndex = 0;
    this.controlsHideTimer = null;
    this.tickTimer = null;
    this.skipIntervalCheckTimer = null;
    this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0);
    this.videoListeners = [];
    this.mediaSessionHandlersBound = false;
    this.mediaSessionActions = [];

    const playerSettings = PlayerSettingsStore.get();
    this.subtitleDelayMs = Number(playerSettings.subtitleDelayMs || 0);
    this.subtitleStyleSettings = {
      ...playerSettings.subtitleStyle,
      preferredLanguage: String(playerSettings.subtitleStyle?.preferredLanguage || playerSettings.subtitleLanguage || "off"),
      secondaryPreferredLanguage: String(playerSettings.subtitleStyle?.secondaryPreferredLanguage || playerSettings.secondarySubtitleLanguage || "off")
    };
    this.audioAmplificationDb = clamp(Number(playerSettings.audioAmplificationDb || 0), AUDIO_AMPLIFICATION_MIN_DB, AUDIO_AMPLIFICATION_MAX_DB);
    this.persistAudioAmplification = Boolean(playerSettings.persistAudioAmplification);
    this.audioAmplificationAvailable = supportsTvWebAudioAmplification()
      && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
    this.audioContext = null;
    this.audioGainNode = null;
    this.audioMediaSource = null;

    this.renderPlayerUi();
    this.pauseOverlayMeta = this.buildPauseOverlayMeta();
    if (!this.isExternalFrameMode()) {
      this.bindVideoEvents();
      this.bindMediaSessionHandlers();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      void this.fetchParentalGuide();
      void this.fetchSkipIntervals();
      void this.hydratePauseOverlayMeta();
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
      this.startSkipIntervalCheckTimer();
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

  attemptExternalFrameFallback(mediaErrorCode = 0) {
    if (!this.fallbackExternalFrameUrl || this.isExternalFrameMode() || this.externalFrameFallbackUsed) {
      return false;
    }
    if (Number(mediaErrorCode || 0) && Number(mediaErrorCode || 0) !== 4) {
      return false;
    }
    this.externalFrameFallbackUsed = true;
    this.externalFrameUrl = this.fallbackExternalFrameUrl;
    this.dismissPauseOverlay();
    this.clearPlaybackStallGuard();
    this.unbindVideoEvents();
    if (this.endedHandler && PlayerController.video) {
      PlayerController.video.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    PlayerController.stop();
    this.loadingVisible = false;
    this.updateLoadingVisibility();
    this.setControlsVisible(false);
    this.renderPlayerUi();
    return true;
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

  buildPlaybackIdentityContext() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const rawItemId = String(this.params?.itemId || "").trim();
    const rawVideoId = String(this.params?.videoId || "").trim();
    const season = Number(this.params?.season || 0);
    const episode = Number(this.params?.episode || 0);
    const imdbId = [
      normalizePlayableImdbId(rawVideoId),
      normalizePlayableImdbId(rawItemId)
    ].find(Boolean) || "";
    return {
      itemType,
      imdbId,
      season: Number.isFinite(season) && season > 0 ? season : null,
      episode: Number.isFinite(episode) && episode > 0 ? episode : null
    };
  },

  maybeShowParentalGuideOverlay() {
    if (this.parentalGuideShown || !this.parentalWarnings.length || this.paused) {
      return;
    }
    this.showParentalGuideOverlay();
  },

  async fetchParentalGuide() {
    if (globalThis.document?.body?.classList?.contains("performance-constrained")) {
      return;
    }
    const { itemType, imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId) {
      return;
    }
    const response = (itemType === "series" || itemType === "tv") && season && episode
      ? await parentalGuideRepository.getTvGuide(imdbId, season, episode)
      : await parentalGuideRepository.getMovieGuide(imdbId);
    const warnings = buildLocalizedParentalWarnings(response?.parentalGuide || {});
    if (!warnings.length) {
      return;
    }
    if (JSON.stringify(this.parentalWarnings || []) === JSON.stringify(warnings)) {
      return;
    }
    this.parentalWarnings = warnings;
    this.parentalGuideShown = false;
    this.renderParentalGuideOverlay();
    this.maybeShowParentalGuideOverlay();
  },

  async fetchSkipIntervals() {
    const requestToken = (this.skipIntervalsRequestToken || 0) + 1;
    this.skipIntervalsRequestToken = requestToken;
    if (!PlayerSettingsStore.get().skipIntroEnabled) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.renderSkipIntroButton();
      return;
    }
    const { imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId || !season || !episode) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.renderSkipIntroButton();
      return;
    }
    const intervals = await skipIntroRepository.getSkipIntervals(imdbId, season, episode);
    if (this.skipIntervalsRequestToken !== requestToken) {
      return;
    }
    this.skipIntervals = Array.isArray(intervals) ? intervals : [];
    this.skipIntervalDismissed = false;
    this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
  },

  updateActiveSkipInterval(currentTime = this.getPlaybackCurrentSeconds()) {
    const previous = this.activeSkipInterval;
    const active = (Array.isArray(this.skipIntervals) ? this.skipIntervals : []).find((interval) => {
      const start = Number(interval?.startTime);
      const end = Number(interval?.endTime);
      return Number.isFinite(start) && Number.isFinite(end) && currentTime >= start && currentTime < end;
    }) || null;
    const previousKey = previous ? `${previous.type}:${previous.startTime}:${previous.endTime}` : "";
    const nextKey = active ? `${active.type}:${active.startTime}:${active.endTime}` : "";
    if (previousKey !== nextKey) {
      this.skipIntervalDismissed = false;
    }
    this.activeSkipInterval = active;
    this.renderSkipIntroButton();
  },

  renderSkipIntroButton() {
    const button = this.uiRefs?.skipIntro;
    if (!button) {
      return;
    }
    const activeInterval = this.activeSkipInterval;
    const shouldShow = Boolean(activeInterval) && !this.skipIntervalDismissed;
    button.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) {
      button.innerHTML = "";
      return;
    }
    const label = buildSkipIntervalLabel(activeInterval);
    button.classList.toggle("is-raised", Boolean(this.controlsVisible));
    button.innerHTML = `
      <button class="player-skip-intro-btn${!this.controlsVisible ? " is-selected" : ""}" type="button" tabindex="-1">
        <span class="player-skip-intro-label">${escapeHtml(label)}</span>
      </button>
    `;
  },

  startSkipIntervalCheckTimer() {
    this.stopSkipIntervalCheckTimer();
    this.skipIntervalCheckTimer = setInterval(() => {
      if (this.isExternalFrameMode()) {
        return;
      }
      if (!PlayerSettingsStore.get().skipIntroEnabled) {
        return;
      }
      if (!Array.isArray(this.skipIntervals) || !this.skipIntervals.length) {
        return;
      }
      this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
    }, SKIP_INTERVAL_CHECK_MS);
  },

  stopSkipIntervalCheckTimer() {
    if (this.skipIntervalCheckTimer) {
      clearInterval(this.skipIntervalCheckTimer);
      this.skipIntervalCheckTimer = null;
    }
  },

  skipActiveInterval() {
    if (!this.activeSkipInterval) {
      return false;
    }
    const targetTime = Number(this.activeSkipInterval.endTime || 0) + 0.25;
    this.seekPlaybackSeconds(targetTime);
    this.skipIntervalDismissed = false;
    this.activeSkipInterval = null;
    this.renderSkipIntroButton();
    return true;
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

  canDiscoverEmbeddedSubtitleTracks() {
    const usingNativePlayback = typeof PlayerController.isUsingNativePlayback === "function"
      ? PlayerController.isUsingNativePlayback()
      : false;
    if (!usingNativePlayback) {
      return false;
    }

    const probeUrl = this.getTrackProbeUrl();
    if (!probeUrl || this.isCurrentSourceAdaptiveManifest()) {
      return false;
    }

    if (Environment.isWebOS()) {
      return true;
    }

    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (usingAvPlay && Environment.isTizen()) {
      return true;
    }

    return typeof PlayerController.isLikelyDirectFileUrl === "function"
      ? PlayerController.isLikelyDirectFileUrl(probeUrl)
      : false;
  },

  canDiscoverEmbeddedAudioTracks() {
    return this.canDiscoverEmbeddedSubtitleTracks();
  },

  shouldUseEmbeddedSubtitleTracks() {
    if (!this.canDiscoverEmbeddedSubtitleTracks() || this.embeddedSubtitleTracks.length <= 0) {
      return false;
    }

    return Environment.isWebOS() || this.getTextTracks().length <= 0;
  },

  normalizeEmbeddedSubtitleTracks(rawTracks = []) {
    return rawTracks
      .filter((track) => String(track?.type || "").toLowerCase() === "text")
      .filter((track) => !UNSUPPORTED_EMBEDDED_SUBTITLE_CODECS.has(String(track?.codec || "").trim().toUpperCase()))
      .map((track, index) => {
        const sourceTrackId = Number(track?.id);
        const normalizedLanguage = normalizeTrackLanguageCode(track?.lang);
        const languageKey = normalizeSubtitleLanguageKey(normalizedLanguage || String(track?.lang || ""));
        const fallbackLabel = languageKey && languageKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY
          ? subtitleLanguageLabel(languageKey)
          : subtitleLabel(index);
        return {
          id: `embedded-subtitle-${index}`,
          embeddedTrackIndex: index,
          sourceTrackId: Number.isFinite(sourceTrackId) ? sourceTrackId : -1,
          nativeTrackIndex: Number.isFinite(sourceTrackId) ? Math.max(0, sourceTrackId - 1) : -1,
          label: cleanDisplayText(track?.label) || fallbackLabel,
          language: normalizedLanguage || String(track?.lang || "").trim().toLowerCase(),
          secondary: String(normalizedLanguage || track?.lang || "").trim().toUpperCase(),
          codec: cleanDisplayText(track?.codec)
        };
      });
  },

  normalizeEmbeddedAudioTracks(rawTracks = []) {
    return rawTracks
      .filter((track) => String(track?.type || "").toLowerCase() === "audio")
      .filter((track) => !PlayerController.isLikelyUnsupportedWebOsAudioTrackDescription?.([
        track?.label,
        track?.codec,
        track?.audioCodec,
        track?.channels,
        track?.channelCount
      ].filter(Boolean).join(" ")))
      .map((track, index) => {
        const sourceTrackId = Number(track?.id);
        return {
          id: `embedded-audio-${index}`,
          embeddedTrackIndex: index,
          sourceTrackId: Number.isFinite(sourceTrackId) ? sourceTrackId : -1,
          nativeTrackIndex: Number.isFinite(sourceTrackId) ? Math.max(0, sourceTrackId - 1) : -1,
          label: cleanDisplayText(track?.label),
          language: normalizeTrackLanguageCode(track?.lang) || String(track?.lang || "").trim().toLowerCase(),
          lang: cleanDisplayText(track?.lang),
          codec: cleanDisplayText(track?.codec || track?.audioCodec),
          audioCodec: cleanDisplayText(track?.audioCodec || track?.codec),
          channels: track?.channels || track?.channelCount || "",
          channelCount: track?.channelCount || track?.channels || "",
          sampleRate: Number(track?.sampleRate || track?.audioSampleRate || 0) || 0
        };
      });
  },

  getUnavailableTrackMessage(kind = "audio") {
    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (!usingAvPlay && this.isCurrentSourceLikelyMkv()) {
      if (kind === "subtitle") {
        return Environment.isWebOS()
          ? "No embedded subtitle tracks detected."
          : "MKV internal subtitles are not exposed by the webOS web player.";
      }
      return Environment.isWebOS()
        ? "No embedded audio tracks detected."
        : "MKV internal audio tracks are not exposed by the webOS web player.";
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

    return this.streamCandidates.reduce((items, candidate) => {
      const mapped = mapSubtitles(candidate);
      if (mapped.length) {
        items.push(...mapped);
      }
      return items;
    }, []);
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
      paused: restorePaused,
      attempts: 0,
      lastAttemptAt: 0
    };

    this.activePlaybackUrl = targetUrl;
    const currentStreamCandidate = this.getCurrentStreamCandidate();
    PlayerController.play(targetUrl, this.buildPlaybackContext(currentStreamCandidate));
    this.paused = false;
    this.hasPresentedPlaybackFrame = false;
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
            scrolling="no"
          ></iframe>
        </div>
      `;
    } else {
      const header = this.getPlayerHeaderData();
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
        <div id="playerSkipIntro" class="player-skip-intro hidden"></div>

        <div id="playerAspectToast" class="player-aspect-toast hidden"></div>

        <div id="playerSeekOverlay" class="player-seek-overlay hidden">
          <div class="player-seek-overlay-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
          <div class="player-seek-overlay-bottom">
            <span id="playerSeekDirection" class="player-seek-direction"></span>
            <span id="playerSeekPreview" class="player-seek-preview">0:00 / 0:00</span>
          </div>
        </div>

        <div id="playerPauseOverlay" class="player-pause-overlay hidden"></div>

        <div id="playerNextEpisodeCard" class="player-next-episode-card hidden"></div>

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
              <div class="player-title">${escapeHtml(header.title)}</div>
              ${header.subtitle ? `<div class="player-subtitle">${escapeHtml(header.subtitle)}</div>` : ""}
              ${header.meta ? `<div class="player-meta-tertiary">${escapeHtml(header.meta)}</div>` : ""}
            </div>

            <div class="player-controls-bar">
              <div id="playerProgressShell" class="player-progress-shell" tabindex="-1">
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
      this.renderSkipIntroButton();
      this.renderSeekOverlay();
      this.renderPauseOverlay();
      this.renderNextEpisodeCard();
    }
  },

  cachePlayerUiRefs(root = null) {
    const uiRoot = root || this.container?.querySelector("#playerUiRoot");
    this.uiRefs = uiRoot ? {
      root: uiRoot,
      loadingOverlay: uiRoot.querySelector("#playerLoadingOverlay"),
      parentalGuide: uiRoot.querySelector("#playerParentalGuide"),
      skipIntro: uiRoot.querySelector("#playerSkipIntro"),
      aspectToast: uiRoot.querySelector("#playerAspectToast"),
      seekOverlay: uiRoot.querySelector("#playerSeekOverlay"),
      seekDirection: uiRoot.querySelector("#playerSeekDirection"),
      seekPreview: uiRoot.querySelector("#playerSeekPreview"),
      seekFill: uiRoot.querySelector("#playerSeekFill"),
      pauseOverlay: uiRoot.querySelector("#playerPauseOverlay"),
      nextEpisodeCard: uiRoot.querySelector("#playerNextEpisodeCard"),
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
    const header = this.getPlayerHeaderData();
    return {
      isPlaying: !this.paused,
      isBuffering: Boolean(this.loadingVisible),
      currentPosition: Math.round(this.getPlaybackCurrentSeconds() * 1000),
      duration: Math.round(this.getPlaybackDurationSeconds() * 1000),
      title: header.title,
      currentSeason: this.params?.season == null ? null : Number(this.params.season),
      currentEpisode: this.params?.episode == null ? null : Number(this.params.episode),
      currentEpisodeTitle: this.getDisplayEpisodeTitle() || null,
      releaseYear: header.meta || null,
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
      showPauseOverlay: Boolean(this.pauseOverlayVisible),
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

  resolvePauseOverlayEpisodeEntry(entries = []) {
    if (!Array.isArray(entries) || !entries.length) {
      return null;
    }
    const explicitVideoId = String(this.params?.videoId || "").trim();
    if (explicitVideoId) {
      const byId = entries.find((entry) => String(entry?.id || "").trim() === explicitVideoId);
      if (byId) {
        return byId;
      }
    }

    const season = Number(this.params?.season || 0);
    const episode = Number(this.params?.episode || 0);
    if (Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
      return entries.find((entry) => (
        Number(entry?.season || 0) === season
        && Number(entry?.episode || 0) === episode
      )) || null;
    }

    return null;
  },

  buildPauseOverlayMeta(meta = null) {
    const resolvedMeta = meta && typeof meta === "object" ? meta : {};
    const episodeEntry = this.resolvePauseOverlayEpisodeEntry(this.episodes);
    const metaEpisodeEntry = this.resolvePauseOverlayEpisodeEntry(resolvedMeta?.videos);
    const title = cleanDisplayText(
      this.params?.playerTitle
      || this.params?.itemTitle
      || resolvedMeta?.name
      || this.params?.itemId
      || "Untitled"
    ) || "Untitled";
    const releaseYear = cleanDisplayText(
      this.params?.playerReleaseYear
      || this.params?.releaseYear
      || this.params?.year
      || extractReleaseYear(resolvedMeta?.releaseInfo)
    );
    const season = Number(this.params?.season ?? episodeEntry?.season ?? metaEpisodeEntry?.season ?? 0);
    const episode = Number(this.params?.episode ?? episodeEntry?.episode ?? metaEpisodeEntry?.episode ?? 0);
    const hasEpisodeContext = Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = cleanDisplayText(
      this.getDisplayEpisodeTitle()
      || this.params?.playerEpisodeTitle
      || episodeEntry?.title
      || metaEpisodeEntry?.title
      || metaEpisodeEntry?.name
      || ""
    );
    const description = cleanDisplayText(
      this.params?.playerDescription
      || this.params?.description
      || this.params?.overview
      || episodeEntry?.overview
      || episodeEntry?.description
      || metaEpisodeEntry?.overview
      || metaEpisodeEntry?.description
      || resolvedMeta?.description
      || resolvedMeta?.overview
      || ""
    );
    const backdropUrl = cleanDisplayText(
      this.params?.playerBackdropUrl
      || this.params?.backdrop
      || resolvedMeta?.background
      || resolvedMeta?.poster
      || this.params?.poster
      || ""
    );
    const logoUrl = cleanDisplayText(
      this.params?.playerLogoUrl
      || resolvedMeta?.logo
      || this.params?.logo
      || ""
    );

    return {
      title,
      releaseYear,
      episodeCode,
      episodeTitle,
      description,
      backdropUrl,
      logoUrl,
      cast: extractPauseOverlayCast({
        castItems: this.params?.castItems,
        castMembers: this.params?.castMembers || resolvedMeta?.castMembers,
        cast: this.params?.cast || resolvedMeta?.cast,
        credits: this.params?.credits || resolvedMeta?.credits
      })
    };
  },

  async hydratePauseOverlayMeta() {
    const itemId = String(this.params?.itemId || "").trim();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!itemId || this.isExternalFrameMode()) {
      return;
    }

    const requestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
    this.pauseOverlayMetaRequestToken = requestToken;

    try {
      const result = await metaRepository.getMetaFromAllAddons(itemType, itemId);
      if (requestToken !== this.pauseOverlayMetaRequestToken || result?.status !== "success" || !result?.data) {
        return;
      }
      this.pauseOverlayMeta = this.buildPauseOverlayMeta(result.data);
      this.renderPauseOverlay();
    } catch (error) {
      if (requestToken === this.pauseOverlayMetaRequestToken) {
        console.warn("Pause overlay metadata fetch failed", error);
      }
    }
  },

  clearPauseOverlayTimer() {
    if (this.pauseOverlayTimer) {
      clearTimeout(this.pauseOverlayTimer);
      this.pauseOverlayTimer = null;
    }
  },

  canShowPauseOverlay() {
    return !this.isExternalFrameMode()
      && this.paused
      && !this.loadingVisible
      && !this.seekOverlayVisible
      && this.seekPreviewSeconds == null
      && !this.isDialogOpen()
      && !this.parentalGuideVisible
      && !this.moreActionsVisible
      && !this.isNextEpisodeCardVisible();
  },

  dismissPauseOverlay({ revealControls = false, focus = false } = {}) {
    this.clearPauseOverlayTimer();
    if (!this.pauseOverlayVisible && !revealControls) {
      return;
    }
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    if (revealControls && !this.loadingVisible) {
      this.setControlsVisible(true, { focus });
    }
  },

  schedulePauseOverlay() {
    this.clearPauseOverlayTimer();
    if (!this.canShowPauseOverlay()) {
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      return;
    }
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    this.pauseOverlayTimer = setTimeout(() => {
      this.pauseOverlayTimer = null;
      if (!this.canShowPauseOverlay()) {
        return;
      }
      this.pauseOverlayVisible = true;
      this.renderPauseOverlay();
    }, this.pauseOverlayDelayMs);
  },

  syncPauseOverlayState() {
    if (this.pauseOverlayVisible && !this.canShowPauseOverlay()) {
      this.dismissPauseOverlay();
      return;
    }
    if (!this.pauseOverlayVisible && this.pauseOverlayTimer && !this.canShowPauseOverlay()) {
      this.clearPauseOverlayTimer();
    }
  },

  renderPauseOverlay() {
    const overlay = this.uiRefs?.pauseOverlay;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    const hidden = !this.pauseOverlayVisible || this.loadingVisible;
    overlay.classList.toggle("hidden", hidden);
    controlsOverlay?.classList.toggle("pause-overlay-active", !hidden);
    if (hidden) {
      return;
    }

    const meta = this.pauseOverlayMeta || this.buildPauseOverlayMeta();
    const clockText = String(this.lastUiTickState?.clockText || this.uiRefs?.clock?.textContent || "--:--").trim() || "--:--";
    const endsAtText = String(
      this.lastUiTickState?.endsAtText
      || this.uiRefs?.endsAt?.textContent
      || t("player_ends_at", ["--:--"], "Ends at %1$s")
    ).trim() || t("player_ends_at", ["--:--"], "Ends at %1$s");
    overlay.innerHTML = `
      <div class="player-pause-overlay-top">
        <div class="player-pause-overlay-clock">${escapeHtml(clockText)}</div>
        <div class="player-pause-overlay-ends-at">${escapeHtml(endsAtText)}</div>
      </div>
      <div class="player-pause-overlay-shade"></div>
      <div class="player-pause-overlay-content">
        <div class="player-pause-kicker">${escapeHtml(t("pause_you_are_watching", {}, "You're watching"))}</div>
        ${meta.logoUrl ? `<img class="player-pause-logo" src="${escapeAttribute(meta.logoUrl)}" alt="${escapeAttribute(meta.title)}" />` : `<div class="player-pause-title">${escapeHtml(meta.title)}</div>`}
        ${meta.releaseYear || meta.episodeCode ? `<div class="player-pause-meta-line">${escapeHtml([meta.releaseYear, meta.episodeCode].filter(Boolean).join(" • "))}</div>` : ""}
        ${meta.episodeTitle ? `<div class="player-pause-episode-title">${escapeHtml(meta.episodeTitle)}</div>` : ""}
        ${meta.description ? `<div class="player-pause-description">${escapeHtml(meta.description)}</div>` : ""}
      </div>
    `;
  },

  getDisplayEpisodeTitle() {
    const rawEpisodeTitle = String(this.params?.playerEpisodeTitle || this.params?.episodeTitle || this.params?.playerSubtitle || "").trim();
    if (!rawEpisodeTitle) {
      return "";
    }
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    if (season == null || episode == null) {
      return rawEpisodeTitle;
    }
    return rawEpisodeTitle
      .replace(new RegExp(`^S0*${season}E0*${episode}\\s*[-\\u2022:]?\\s*`, "i"), "")
      .trim();
  },

  getPlayerHeaderData() {
    const title = String(this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled").trim() || "Untitled";
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    const hasEpisodeContext = Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = this.getDisplayEpisodeTitle();
    const subtitle = hasEpisodeContext
      ? [episodeCode, episodeTitle].filter(Boolean).join(" • ")
      : "";
    const meta = String(this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || "").trim();
    return { title, subtitle, meta };
  },

  hasEpisodeAired(released) {
    const raw = String(released || "").trim();
    if (!raw) {
      return true;
    }
    const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || raw;
    const parsedTime = Date.parse(datePortion);
    if (!Number.isFinite(parsedTime)) {
      return true;
    }
    return parsedTime <= Date.now();
  },

  resolveNextEpisodeInfo() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (itemType !== "series") {
      return null;
    }

    let nextEpisode = null;
    const explicitVideoId = String(this.params?.nextEpisodeVideoId || "").trim();
    if (explicitVideoId && this.episodes.length) {
      nextEpisode = this.episodes.find((episode) => String(episode?.id || "") === explicitVideoId) || null;
    }

    if (!nextEpisode && this.params?.videoId && this.episodes.length) {
      const currentIndex = this.episodes.findIndex((episode) => String(episode?.id || "") === String(this.params?.videoId || ""));
      if (currentIndex >= 0) {
        nextEpisode = this.episodes[currentIndex + 1] || null;
      }
    }

    if (!nextEpisode && this.episodes.length) {
      const currentSeason = Number(this.params?.season || 0);
      const currentEpisode = Number(this.params?.episode || 0);
      if (currentSeason > 0 && currentEpisode > 0) {
        const currentIndex = this.episodes.findIndex((episode) => (
          Number(episode?.season || 0) === currentSeason && Number(episode?.episode || 0) === currentEpisode
        ));
        if (currentIndex >= 0) {
          nextEpisode = this.episodes[currentIndex + 1] || null;
        }
      }
    }

    if (!nextEpisode && this.episodes.length > 1) {
      const fallbackIndex = clamp(Number(this.episodePanelIndex || 0), 0, Math.max(0, this.episodes.length - 1));
      nextEpisode = this.episodes[fallbackIndex + 1] || null;
    }

    const nextVideoId = String(nextEpisode?.id || explicitVideoId || "").trim();
    if (!nextVideoId) {
      return null;
    }

    const season = nextEpisode?.season ?? (this.params?.nextEpisodeSeason ?? null);
    const episode = nextEpisode?.episode ?? (this.params?.nextEpisodeEpisode ?? null);
    const episodeLabel = nextEpisode
      ? `S${nextEpisode.season}E${nextEpisode.episode}`
      : (this.params?.nextEpisodeLabel || "");
    const released = String(nextEpisode?.released || this.params?.nextEpisodeReleased || "").trim() || null;
    return {
      videoId: nextVideoId,
      season: season == null ? null : Number(season),
      episode: episode == null ? null : Number(episode),
      episodeLabel: episodeLabel || null,
      episodeTitle: String(nextEpisode?.title || this.params?.nextEpisodeTitle || "").trim() || null,
      released,
      hasAired: this.hasEpisodeAired(released)
    };
  },

  shouldShowNextEpisodeCard() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode) {
      return false;
    }
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(currentSeconds) || currentSeconds < 0) {
      return false;
    }
    return (currentSeconds / durationSeconds) >= NEXT_EPISODE_THRESHOLD_PERCENT;
  },

  dismissNextEpisodeCard({ revealControls = false, armExitOnNextBack = false } = {}) {
    this.nextEpisodeCardDismissed = true;
    this.nextEpisodeBackExitArmed = Boolean(armExitOnNextBack);
    if (revealControls) {
      this.setControlsVisible(true, { focus: true });
      return;
    }
    this.renderNextEpisodeCard();
  },

  resetNextEpisodeCardDismissal() {
    if (!this.nextEpisodeCardDismissed && !this.nextEpisodeBackExitArmed) {
      return;
    }
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;
    this.renderNextEpisodeCard();
  },

  isNextEpisodeCardVisible() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    return Boolean(
      nextEpisode
      && this.shouldShowNextEpisodeCard()
      && !this.nextEpisodeCardDismissed
      && !this.loadingVisible
      && !this.subtitleDialogVisible
      && !this.audioDialogVisible
      && !this.speedDialogVisible
      && !this.sourcesPanelVisible
      && !this.episodePanelVisible
      && !this.moreActionsVisible
      && !this.nextEpisodeLaunching
    );
  },

  async getPlayableStreamsForVideo(videoId, itemType) {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedType = normalizeItemType(itemType || this.params?.itemType || "movie");
    if (!normalizedVideoId) {
      return [];
    }
    const cacheKey = `${normalizedType}:${normalizedVideoId}`;
    const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      return Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
    }

    const streamResult = await streamRepository.getStreamsFromAllAddons(normalizedType, normalizedVideoId);
    const streamItems = (streamResult?.status === "success")
      ? flattenStreamGroups(streamResult)
      : [];
    if (streamItems.length) {
      cache.set(cacheKey, streamItems.map((stream) => ({ ...stream })));
    }
    return streamItems;
  },

  async playNextEpisode() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextEpisode?.videoId || itemType !== "series" || nextEpisode.hasAired === false || this.nextEpisodeLaunching) {
      return;
    }

    this.nextEpisodeLaunching = true;
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.setControlsVisible(false);
    this.renderNextEpisodeCard();

    try {
      const streamItems = await this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType);
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: nextEpisode.videoId,
        season: nextEpisode.season,
        episode: nextEpisode.episode,
        episodeLabel: nextEpisode.episodeLabel || null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
        playerEpisodeTitle: nextEpisode.episodeTitle || "",
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes || [],
        streamCandidates: streamItems,
        nextEpisodeVideoId: null,
        nextEpisodeLabel: null
      });
    } catch (error) {
      console.warn("Next episode play failed", error);
      this.nextEpisodeLaunching = false;
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.renderNextEpisodeCard();
    }
  },

  persistPlayerPresentationSettings() {
    PlayerSettingsStore.set({
      subtitleDelayMs: Number(this.subtitleDelayMs || 0),
      subtitleStyle: { ...this.subtitleStyleSettings },
      subtitleLanguage: this.subtitleStyleSettings?.preferredLanguage || "off",
      secondarySubtitleLanguage: this.subtitleStyleSettings?.secondaryPreferredLanguage || "off",
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      persistAudioAmplification: Boolean(this.persistAudioAmplification)
    });
  },

  ensureAudioAmplificationGraph() {
    const video = PlayerController.video;
    if (!supportsTvWebAudioAmplification()) {
      this.audioAmplificationAvailable = false;
      return false;
    }
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
    if (Number(this.audioAmplificationDb || 0) <= 0) {
      this.audioAmplificationAvailable = supportsTvWebAudioAmplification()
        && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
      if (this.audioGainNode) {
        try {
          this.audioGainNode.gain.value = 1;
        } catch (_) {
          // Best effort.
        }
      }
      return;
    }
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
    const verticalOffset = splitSubtitleVerticalOffset(style.verticalOffset);
    const subtitleColor = String(style.textColor || "#FFFFFF");
    const outlineColor = String(style.outlineColor || "#000000");
    const subtitleFontWeight = style.bold ? "800" : "500";
    const boldShadow = style.bold
      ? `0.45px 0 0 ${subtitleColor}, -0.45px 0 0 ${subtitleColor}, 0 0.45px 0 ${subtitleColor}, 0 -0.45px 0 ${subtitleColor}`
      : "";
    const outlineShadow = style.outlineEnabled ? `0 0 2px ${outlineColor}, 0 0 4px ${outlineColor}` : "";
    const subtitleShadow = [outlineShadow, boldShadow].filter(Boolean).join(", ") || "none";
    uiRoot.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    uiRoot.style.setProperty("--player-subtitle-outline-color", outlineColor);
    uiRoot.style.setProperty("--player-subtitle-font-size", `${clamp(Number(style.fontSize || 100), 70, 180)}%`);
    uiRoot.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    uiRoot.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    uiRoot.style.setProperty("--player-subtitle-offset", `${(verticalOffset.residualOffset * -2).toFixed(2)}vh`);
    video.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    video.style.setProperty("--player-subtitle-outline-color", outlineColor);
    video.style.setProperty("--player-subtitle-font-size", `${clamp(Number(style.fontSize || 100), 70, 180)}%`);
    video.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    video.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    video.style.setProperty("--player-subtitle-offset", `${(verticalOffset.residualOffset * -2).toFixed(2)}vh`);
    this.refreshSubtitleCueStyles();
  },

  getSubtitleCueTrackList() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return Array.from(trackList).filter(Boolean);
    } catch (_) {
      const tracks = [];
      const length = Number(trackList.length || 0);
      for (let index = 0; index < length; index += 1) {
        const track = trackList[index] || trackList.item?.(index) || null;
        if (track) {
          tracks.push(track);
        }
      }
      return tracks;
    }
  },

  clearSubtitleCueStyleBindings() {
    if (!(this.subtitleCueStyleBindings instanceof Map)) {
      this.subtitleCueStyleBindings = new Map();
      return;
    }
    this.subtitleCueStyleBindings.forEach((handler, track) => {
      try {
        track?.removeEventListener?.("cuechange", handler);
      } catch (_) {
        // Best effort.
      }
    });
    this.subtitleCueStyleBindings.clear();
  },

  getSubtitleCueSnapshot(cue) {
    if (!cue || typeof cue !== "object") {
      return null;
    }
    if (!(this.subtitleCueOriginalState instanceof WeakMap)) {
      this.subtitleCueOriginalState = new WeakMap();
    }
    let snapshot = this.subtitleCueOriginalState.get(cue);
    if (!snapshot) {
      snapshot = {
        line: cue.line,
        lineAlign: cue.lineAlign,
        position: cue.position,
        positionAlign: cue.positionAlign,
        snapToLines: cue.snapToLines
      };
      this.subtitleCueOriginalState.set(cue, snapshot);
    }
    return snapshot;
  },

  restoreSubtitleCueSnapshot(cue, snapshot) {
    if (!cue || !snapshot) {
      return;
    }
    try {
      cue.line = snapshot.line;
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("lineAlign" in cue) {
        cue.lineAlign = snapshot.lineAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("position" in cue) {
        cue.position = snapshot.position;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("positionAlign" in cue) {
        cue.positionAlign = snapshot.positionAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = snapshot.snapToLines;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
  },

  applySubtitleCueVerticalOffset(cue, snapshot, offset) {
    if (!cue || !snapshot) {
      return;
    }
    const { lineOffset } = splitSubtitleVerticalOffset(offset);
    if (lineOffset === 0) {
      this.restoreSubtitleCueSnapshot(cue, snapshot);
      return;
    }

    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = true;
      }
    } catch (_) {
      // Ignore cue styling failures.
    }

    const baseLine = Number.isFinite(Number(snapshot.line)) ? Number(snapshot.line) : -1;
    const adjustedLine = clamp(baseLine - lineOffset, -100, 100);
    try {
      cue.line = adjustedLine;
    } catch (_) {
      // Ignore cue styling failures.
    }
  },

  syncSubtitleCueStylesForTrack(track) {
    const cues = track?.activeCues;
    if (!cues || typeof cues.length !== "number") {
      return;
    }
    const style = this.subtitleStyleSettings || {};
    const verticalOffset = normalizeSubtitleVerticalOffset(style.verticalOffset);
    const cueCount = Number(cues.length || 0);
    for (let index = 0; index < cueCount; index += 1) {
      const cue = cues[index] || cues.item?.(index) || null;
      if (!cue) {
        continue;
      }
      const snapshot = this.getSubtitleCueSnapshot(cue);
      this.applySubtitleCueVerticalOffset(cue, snapshot, verticalOffset);
    }
  },

  refreshSubtitleCueStyles() {
    const tracks = this.getSubtitleCueTrackList();
    if (!tracks.length) {
      return;
    }

    tracks.forEach((track) => {
      if (!track) {
        return;
      }
      if (typeof track.addEventListener === "function" && !this.subtitleCueStyleBindings.has(track)) {
        const handler = () => {
          this.syncSubtitleCueStylesForTrack(track);
        };
        try {
          track.addEventListener("cuechange", handler);
          this.subtitleCueStyleBindings.set(track, handler);
        } catch (_) {
          // Ignore listener registration failures.
        }
      }
      this.syncSubtitleCueStylesForTrack(track);
    });
  },

  updateModalBackdrop() {
    const modalBackdrop = this.uiRefs?.modalBackdrop;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!modalBackdrop) {
      return;
    }
    const hasModal = this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible || this.speedDialogVisible;
    modalBackdrop.classList.toggle("hidden", !hasModal);
    controlsOverlay?.classList.toggle("modal-blocked", hasModal);
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const onWaiting = () => {
      this.dismissPauseOverlay();
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
      this.hasPresentedPlaybackFrame = true;
      this.markPlaybackProgress();
      this.clearPlaybackStallGuard();
      this.loadingVisible = false;
      this.paused = false;
      this.startupTrackPreferenceReady = true;
      this.dismissPauseOverlay();
      this.updateMediaSessionPlaybackState();
      this.updateLoadingVisibility();
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.attemptPendingPlaybackRestore();
      this.updateUiTick();
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
      }
      this.resetControlsAutoHide();
      this.maybeShowParentalGuideOverlay();
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
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
      this.renderControlButtons();
      this.schedulePauseOverlay();
    };

    const onTimeUpdate = () => {
      this.markPlaybackProgress();
      this.attemptPendingPlaybackRestore();
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      this.attemptPendingPlaybackRestore({ force: true });

      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.updateUiTick();
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.markPlaybackProgress();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.ensureTrackDataWarmup();
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
      setTimeout(() => {
        this.attemptSilentAudioRecovery("metadata");
      }, 500);
    };

    const onPlayable = () => {
      this.attemptPendingPlaybackRestore();
      this.startupTrackPreferenceReady = true;
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
      if (this.attemptExternalFrameFallback(mediaErrorCode)) {
        return;
      }
      if (this.recoverFromPlaybackError(mediaErrorCode)) {
        return;
      }

      this.clearPlaybackStallGuard();
      this.loadingVisible = false;
      this.paused = true;
      this.dismissPauseOverlay();
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
    const nextEpisode = this.resolveNextEpisodeInfo();
    const base = [
      {
        action: "playPause",
        label: this.paused ? ">" : "II",
        icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
        title: "Play/Pause",
        primary: true
      }
    ];

    if (nextEpisode?.hasAired && !this.nextEpisodeLaunching) {
      base.push({
        action: "playNextEpisode",
        icon: "assets/icons/ic_player_skip_next.svg",
        useMask: true,
        title: t("next_episode_label", {}, "Next episode")
      });
    }

    base.push({ action: "subtitleDialog", icon: "assets/icons/ic_player_subtitles.svg", title: t("subtitle_dialog_title", {}, "Subtitles") });

    base.push({
      action: "audioTrack",
      icon: this.selectedAudioTrackIndex >= 0 || this.selectedManifestAudioTrackId
        ? "assets/icons/ic_player_audio_filled.svg"
        : "assets/icons/ic_player_audio_outline.svg",
      useMask: true,
      title: t("audio_dialog_title", {}, "Audio")
    });

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
    if (this.stickyProgressFocus && this.controlsVisible && !this.isDialogOpen() && this.isSeekBarAvailable()) {
      this.controlFocusZone = "progress";
    }
    this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));

    wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable${control.primary ? " is-primary" : ""}"
              data-action="${control.action}"
              title="${escapeHtml(control.title || "")}">
        ${control.icon
          ? ((control.primary || control.useMask)
            ? `<span class="player-control-icon player-control-icon-mask" style="-webkit-mask-image:url('${escapeHtml(control.icon)}');mask-image:url('${escapeHtml(control.icon)}');" aria-hidden="true"></span>`
            : `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`)
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

    if (this.controlFocusZone === "progress") {
      buttons.forEach((button) => {
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      if (progressShell && document.activeElement !== progressShell && typeof progressShell.focus === "function") {
        progressShell.focus();
      }
    } else if (this.controlFocusZone === "buttons") {
      if (progressShell && document.activeElement === progressShell && typeof progressShell.blur === "function") {
        progressShell.blur();
      }
      const focusedButton = buttons[this.controlFocusIndex] || null;
      if (focusedButton && document.activeElement !== focusedButton && typeof focusedButton.focus === "function") {
        focusedButton.focus();
      }
    }
    this.renderNextEpisodeCard();
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
    this.renderSkipIntroButton();
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
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = 0;
    this.renderControlButtons();
    const firstButton = this.container.querySelector('.player-control-btn[data-action]');
    firstButton?.focus?.();
  },

  focusProgressBar() {
    if (!this.isSeekBarAvailable()) {
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "buttons";
      this.renderControlButtons();
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body && typeof activeElement.blur === "function") {
      activeElement.blur();
    }
    this.stickyProgressFocus = true;
    this.controlFocusZone = "progress";
    this.renderControlButtons();
    this.uiRefs?.progressShell?.focus?.();
    this.scheduleProgressBarRefocus();
  },

  scheduleProgressBarRefocus() {
    if (!this.controlsVisible || this.controlFocusZone !== "progress") {
      return;
    }
    const run = () => {
      if (!this.controlsVisible || this.controlFocusZone !== "progress") {
        return;
      }
      const buttons = Array.from(this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn") || []);
      buttons.forEach((button) => {
        button.classList.remove("focused");
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      this.uiRefs?.progressShell?.classList?.add("focused");
      this.uiRefs?.progressShell?.focus?.();
    };
    run();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    }
    setTimeout(run, 0);
  },

  isSeekBarAvailable() {
    return !this.loadingVisible;
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

  finalizePendingPlaybackRestore(restore = this.pendingPlaybackRestore) {
    if (!restore || this.pendingPlaybackRestore !== restore) {
      return;
    }
    this.pendingPlaybackRestore = null;
    if (restore.paused) {
      PlayerController.pause();
      this.paused = true;
      return;
    }
    this.paused = false;
  },

  attemptPendingPlaybackRestore({ force = false } = {}) {
    const restore = this.pendingPlaybackRestore;
    if (!restore) {
      return;
    }

    const requestedSeconds = Number(restore.timeSeconds || 0);
    if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
      this.finalizePendingPlaybackRestore(restore);
      return;
    }

    const durationSeconds = this.getPlaybackDurationSeconds();
    const targetSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.max(0, Math.min(requestedSeconds, Math.max(0, durationSeconds - 3)))
      : requestedSeconds;
    const currentSeconds = this.getPlaybackCurrentSeconds();
    const toleranceSeconds = Math.max(1.5, Math.min(8, targetSeconds * 0.03));

    if (Number.isFinite(currentSeconds) && currentSeconds >= Math.max(0, targetSeconds - toleranceSeconds)) {
      this.finalizePendingPlaybackRestore(restore);
      return;
    }

    const now = Date.now();
    if (!force && (now - Number(restore.lastAttemptAt || 0)) < 700) {
      return;
    }

    restore.timeSeconds = targetSeconds;
    restore.lastAttemptAt = now;
    restore.attempts = Number(restore.attempts || 0) + 1;

    const didSeek = this.seekPlaybackSeconds(targetSeconds);
    if (!didSeek && restore.attempts >= 8) {
      this.finalizePendingPlaybackRestore(restore);
    }
  },

  updateLoadingVisibility() {
    const overlay = this.uiRefs?.loadingOverlay;
    if (!overlay) {
      return;
    }
    const showLogoOnly = Boolean(
      this.loadingVisible
      && this.hasPresentedPlaybackFrame
      && this.params?.playerLogoUrl
    );
    overlay.classList.toggle("hidden", !this.loadingVisible);
    overlay.classList.toggle("logo-only", showLogoOnly);
    if (this.loadingVisible) {
      this.dismissPauseOverlay();
      if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
        this.cancelSeekPreview({ commit: false });
      }
      if (this.controlFocusZone === "progress") {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
      }
      this.renderControlButtons();
    } else if (this.paused) {
      this.schedulePauseOverlay();
    }
    this.renderNextEpisodeCard();
  },

  renderNextEpisodeCard() {
    const card = this.uiRefs?.nextEpisodeCard;
    if (!card) {
      return;
    }

    const nextEpisode = this.resolveNextEpisodeInfo();
    const hidden = !this.isNextEpisodeCardVisible();

    card.classList.toggle("hidden", hidden);
    if (hidden) {
      card.innerHTML = "";
      return;
    }

    const titleLine = [nextEpisode.episodeLabel, nextEpisode.episodeTitle].filter(Boolean).join(" • ");
    const statusText = nextEpisode.hasAired
      ? t("next_episode_play", {}, "Play")
      : t("next_episode_unaired", {}, "Unaired");
    const thumb = this.episodes.find((entry) => String(entry?.id || "") === String(nextEpisode.videoId || ""))?.thumbnail || "";

    card.innerHTML = `
      <div class="player-next-episode-card-inner${nextEpisode.hasAired ? " is-playable" : ""}${!this.controlsVisible ? " is-selected" : ""}">
        <div class="player-next-episode-thumb-wrap">
          ${thumb ? `<img class="player-next-episode-thumb" src="${escapeHtml(thumb)}" alt="" aria-hidden="true" />` : `<div class="player-next-episode-thumb player-next-episode-thumb-fallback"></div>`}
          <div class="player-next-episode-thumb-shade"></div>
        </div>
        <div class="player-next-episode-copy">
          <div class="player-next-episode-kicker">${escapeHtml(t("next_episode_label", {}, "Next episode"))}</div>
          <div class="player-next-episode-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
        </div>
        <div class="player-next-episode-pill${nextEpisode.hasAired ? " is-playable" : ""}">
          <span class="player-next-episode-pill-icon">&#9654;</span>
          <span class="player-next-episode-pill-text">${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  },

  updateUiTick() {
    if (this.isExternalFrameMode()) {
      return;
    }
    if (!this.shouldShowNextEpisodeCard()) {
      this.resetNextEpisodeCardDismissal();
    }
    const current = this.getPlaybackCurrentSeconds();
    this.updateActiveSkipInterval(current);
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

    if (this.pauseOverlayVisible) {
      const overlayClock = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-clock");
      if (overlayClock && overlayClock.textContent !== uiState.clockText) {
        overlayClock.textContent = uiState.clockText || "--:--";
      }
      const overlayEndsAt = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-ends-at");
      if (overlayEndsAt && overlayEndsAt.textContent !== uiState.endsAtText) {
        overlayEndsAt.textContent = uiState.endsAtText || t("player_ends_at", ["--:--"], "Ends at %1$s");
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

    this.syncPauseOverlayState();
    this.renderNextEpisodeCard();

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
    if (!this.isSeekBarAvailable()) {
      return;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return;
    }

    if (direction !== this.seekPreviewDirection || !isRepeat) {
      this.seekRepeatCount = 0;
    }
    this.seekPreviewDirection = direction;
    this.seekRepeatCount += 1;

    const stepSeconds = this.seekRepeatCount >= 18
      ? 120
      : this.seekRepeatCount >= 12
        ? 60
        : this.seekRepeatCount >= 7
          ? 30
          : this.seekRepeatCount >= 3
            ? 20
            : 10;
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
    }, 1000);
  },

  commitSeekPreview() {
    if (!PlayerController.video) {
      this.cancelSeekPreview({ commit: false });
      return;
    }

    if (this.seekPreviewSeconds != null) {
      this.seekPlaybackSeconds(Number(this.seekPreviewSeconds));
    }

    if (this.stickyProgressFocus && this.controlsVisible) {
      this.focusProgressBar();
      this.scheduleProgressBarRefocus();
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
      if (this.autoHideControlsAfterSeek && this.controlsVisible) {
        this.autoHideControlsAfterSeek = false;
        this.stickyProgressFocus = false;
        this.setControlsVisible(false);
        return;
      }
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
        this.scheduleProgressBarRefocus();
      }
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
    this.autoHideControlsAfterSeek = false;
    this.renderSeekOverlay();
  },

  togglePause() {
    const preserveProgressFocus = this.controlFocusZone === "progress";
    if (this.isExternalFrameMode()) {
      return;
    }
    if (this.paused) {
      this.dismissPauseOverlay();
      PlayerController.resume();
      this.paused = false;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      if (preserveProgressFocus) {
        this.controlFocusZone = "progress";
      }
      this.renderControlButtons();
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(true, { focus: !preserveProgressFocus });
    if (preserveProgressFocus) {
      this.controlFocusZone = "progress";
    }
    this.renderControlButtons();
    this.schedulePauseOverlay();
  },

  resolveMediaAction(event) {
    const key = String(event?.key || "");
    const code = String(event?.code || "");
    const keyCode = Number(event?.originalKeyCode || event?.keyCode || 0);

    const keyMap = {
      MediaPlayPause: "toggle",
      MediaPlay: "play",
      MediaPause: "pause",
      MediaStop: "stop",
      MediaFastForward: "fastForward",
      MediaRewind: "rewind",
      MediaTrackNext: "next",
      MediaTrackPrevious: "previous",
      Play: "play",
      Pause: "pause"
    };

    if (keyMap[key]) {
      return keyMap[key];
    }
    if (keyMap[code]) {
      return keyMap[code];
    }

    const codeMap = {
      179: "toggle",
      10252: "toggle",
      415: "play",
      19: "pause",
      413: "stop",
      178: "stop",
      417: "fastForward",
      412: "rewind",
      176: "next",
      177: "previous"
    };

    return codeMap[keyCode] || null;
  },

  applyMediaAction(action) {
    if (this.isExternalFrameMode() || !action) {
      return;
    }

    if (action === "play") {
      if (this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "pause" || action === "stop") {
      if (!this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "toggle") {
      this.togglePause();
      return;
    }

    if (action === "fastForward") {
      this.quickSeekBy(30);
      return;
    }

    if (action === "rewind") {
      this.quickSeekBy(-30);
    }
  },

  quickSeekBy(deltaSeconds) {
    if (!this.isSeekBarAvailable()) {
      return false;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return false;
    }
    const duration = this.getPlaybackDurationSeconds();
    let target = currentTime + Number(deltaSeconds || 0);
    if (duration > 0) {
      target = clamp(target, 0, duration);
    } else {
      target = Math.max(0, target);
    }
    this.seekPreviewSeconds = target;
    this.seekPreviewDirection = deltaSeconds < 0 ? -1 : 1;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();
    this.scheduleSeekPreviewCommit();
    return true;
  },

  bindMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionHandlersBound = true;
    this.mediaSessionActions = [];

    const safeBind = (action, handler) => {
      try {
        mediaSession.setActionHandler(action, handler);
        this.mediaSessionActions.push(action);
      } catch (_) {
        // Ignore unsupported actions.
      }
    };

    safeBind("play", () => this.applyMediaAction("play"));
    safeBind("pause", () => this.applyMediaAction("pause"));
    safeBind("stop", () => this.applyMediaAction("stop"));
    safeBind("seekforward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? offset : 30);
    });
    safeBind("seekbackward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? -offset : -30);
    });

    this.updateMediaSessionPlaybackState();
  },

  clearMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || !this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionActions.forEach((action) => {
      try {
        mediaSession.setActionHandler(action, null);
      } catch (_) {
        // Ignore unsupported actions.
      }
    });
    this.mediaSessionActions = [];
    this.mediaSessionHandlersBound = false;
    try {
      mediaSession.playbackState = "none";
    } catch (_) {
      // Ignore unsupported playback state.
    }
  },

  updateMediaSessionPlaybackState() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession) {
      return;
    }
    try {
      mediaSession.playbackState = this.paused ? "paused" : "playing";
    } catch (_) {
      // Ignore unsupported playback state.
    }
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

    this.hasPresentedPlaybackFrame = false;
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
        paused: Boolean(this.paused || (!usingAvPlay && video?.paused)),
        attempts: 0,
        lastAttemptAt: 0
      };
    } else {
      this.pendingPlaybackRestore = null;
    }
    this.markPlaybackProgress();
    this.clearPlaybackStallGuard();
    this.clearSubtitleCueStyleBindings();
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
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.startupAudioPreferenceApplied = false;
    this.startupAudioPreferenceApplying = false;
    this.startupTrackPreferenceReady = false;
    this.builtInSubtitleCount = 0;
    this.embeddedSubtitleTracks = [];
    this.clearSubtitleCueStyleBindings();
    this.clearMountedExternalSubtitleTracks();
    this.trackDiscoveryInProgress = true;
    this.clearTrackDiscoveryTimer();
    const sourceCandidate = this.getStreamCandidateByUrl(streamUrl) || this.getCurrentStreamCandidate();
    this.activePlaybackUrl = streamUrl;
    this.embeddedTrackRequestPromise = null;
    this.embeddedTrackRequestUrl = "";
    this.lastEmbeddedTrackProbeUrl = "";
    this.lastTrackWarmupAt = Date.now();
    const embeddedSubtitleWarmupPromise = this.loadEmbeddedSubtitleTracks();
    this.initialEmbeddedTrackBootstrapPromise = embeddedSubtitleWarmupPromise;
    embeddedSubtitleWarmupPromise.finally(() => {
      if (this.initialEmbeddedTrackBootstrapPromise === embeddedSubtitleWarmupPromise) {
        this.initialEmbeddedTrackBootstrapPromise = null;
      }
    });
    await this.waitForInitialEmbeddedTrackBootstrap();
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    PlayerController.play(this.activePlaybackUrl, {
      ...this.buildPlaybackContext(sourceCandidate),
      forceEngine
    });
    this.paused = false;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
    this.startTrackDiscoveryWindow();
    this.refreshTrackDialogs();
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

  getPlaybackStallTimeoutMs() {
    const playbackEngine = String(PlayerController.playbackEngine || "");
    if (Environment.isTizen()) {
      return playbackEngine.endsWith("avplay") ? 22000 : 16000;
    }
    if (Environment.isWebOS()) {
      return playbackEngine.endsWith("avplay") ? 16000 : 12000;
    }
    return 9000;
  },

  schedulePlaybackStallGuard() {
    this.clearPlaybackStallGuard();
    const stallTimeoutMs = this.getPlaybackStallTimeoutMs();
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
      const stalledWhilePlaying = elapsedFromProgress >= stallTimeoutMs && readyState < 3;
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
    }, stallTimeoutMs);
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
    if (this.startupTrackPreferenceReady) {
      this.applyStartupAudioPreference();
      this.applyStartupSubtitlePreference();
    }
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    if (this.subtitleDialogVisible) {
      this.renderSubtitleDialog();
    }
    if (this.audioDialogVisible) {
      this.renderAudioDialog();
    }
  },

  invalidateTrackDialogCaches() {
    this.trackDialogCache = createTrackDialogCache();
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
    return dashCount > 0
      || avplayCount > 0
      || hlsCount > 0
      || nativeCount > 0
      || (this.canDiscoverEmbeddedAudioTracks() && this.embeddedAudioTracks.length > 0)
      || this.manifestAudioTracks.length > 0
      || Boolean(this.getImplicitAudioEntry());
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
    return dashCount > 0
      || avplayCount > 0
      || nativeCount > 0
      || this.shouldUseEmbeddedSubtitleTracks()
      || this.manifestSubtitleTracks.length > 0
      || this.subtitles.length > 0;
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
        && !this.embeddedSubtitleLoading
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
    if (!force && (this.subtitleLoading || this.embeddedSubtitleLoading || this.manifestLoading)) {
      this.startTrackDiscoveryWindow();
      return;
    }
    this.lastTrackWarmupAt = now;
    this.loadSubtitles();
    this.loadEmbeddedSubtitleTracks();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null);
    this.startTrackDiscoveryWindow();
  },

  async waitForInitialEmbeddedTrackBootstrap(timeoutMs = 900) {
    const pending = this.initialEmbeddedTrackBootstrapPromise;
    if (!pending || typeof pending.then !== "function") {
      return;
    }
    try {
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(resolve, Math.max(150, Number(timeoutMs || 0))))
      ]);
    } catch (_) {
      // Ignore bootstrap probe failures and continue playback startup.
    }
  },

  async loadEmbeddedSubtitleTracks() {
    const probeUrl = this.getTrackProbeUrl();
    if (
      probeUrl
      && this.embeddedTrackRequestPromise
      && this.embeddedTrackRequestUrl === probeUrl
      && this.embeddedSubtitleLoading
    ) {
      return this.embeddedTrackRequestPromise;
    }

    const requestToken = (this.embeddedSubtitleLoadToken || 0) + 1;
    const preserveExistingTracks = Boolean(
      probeUrl
      && probeUrl === this.lastEmbeddedTrackProbeUrl
      && (this.embeddedSubtitleTracks.length > 0 || this.embeddedAudioTracks.length > 0)
    );
    this.embeddedSubtitleLoadToken = requestToken;
    this.embeddedSubtitleLoading = true;
    this.embeddedAudioLoading = true;
    if (!preserveExistingTracks) {
      this.embeddedSubtitleTracks = [];
      this.embeddedAudioTracks = [];
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedEmbeddedAudioTrackIndex = -1;
    }
    this.refreshTrackDialogs();

    const requestPromise = (async () => {
      const canLoadSubtitleTracks = this.canDiscoverEmbeddedSubtitleTracks();
      const canLoadAudioTracks = this.canDiscoverEmbeddedAudioTracks();
      if (!canLoadSubtitleTracks && !canLoadAudioTracks) {
        return;
      }

      const tracks = await localMediaTracksRepository.getTracks(probeUrl);
      if (requestToken !== this.embeddedSubtitleLoadToken) {
        return;
      }

      this.lastEmbeddedTrackProbeUrl = probeUrl;
      this.embeddedSubtitleTracks = canLoadSubtitleTracks ? this.normalizeEmbeddedSubtitleTracks(tracks) : [];
      this.embeddedAudioTracks = canLoadAudioTracks ? this.normalizeEmbeddedAudioTracks(tracks) : [];
      const selectedEmbeddedSubtitleTrack = typeof PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex === "function"
        ? PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex()
        : -1;
      const selectedEmbeddedAudioTrack = typeof PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex === "function"
        ? PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex()
        : -1;
      this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(selectedEmbeddedSubtitleTrack)
        ? selectedEmbeddedSubtitleTrack
        : -1;
      this.selectedEmbeddedAudioTrackIndex = Number.isFinite(selectedEmbeddedAudioTrack)
        ? selectedEmbeddedAudioTrack
        : -1;
      this.refreshTrackDialogs();
    })().catch((error) => {
      console.warn("Embedded subtitle discovery failed", error);
      if (requestToken !== this.embeddedSubtitleLoadToken) {
        return;
      }
      if (!preserveExistingTracks) {
        this.embeddedSubtitleTracks = [];
        this.embeddedAudioTracks = [];
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedEmbeddedAudioTrackIndex = -1;
      }
      this.refreshTrackDialogs();
    }).finally(() => {
      if (requestToken === this.embeddedSubtitleLoadToken) {
        this.embeddedSubtitleLoading = false;
        this.embeddedAudioLoading = false;
        this.refreshTrackDialogs();
      }
      if (this.embeddedTrackRequestPromise === requestPromise) {
        this.embeddedTrackRequestPromise = null;
        this.embeddedTrackRequestUrl = "";
      }
    });

    this.embeddedTrackRequestPromise = requestPromise;
    this.embeddedTrackRequestUrl = probeUrl;
    return requestPromise;
  },

  disableEmbeddedSubtitleSelection() {
    if (this.selectedEmbeddedSubtitleTrackIndex < 0) {
      return;
    }
    if (typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function") {
      PlayerController.setWebOsEmbeddedSubtitleTrack(-1);
    }
    this.selectedEmbeddedSubtitleTrackIndex = -1;
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

  getEmbeddedAudioTrack(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.embeddedAudioTracks[targetIndex] || null;
  },

  ensureEmbeddedTrackLookupCache() {
    const cache = this.trackDialogCache || (this.trackDialogCache = createTrackDialogCache());
    if (
      cache.embeddedAudioByNativeIndex
      && cache.embeddedAudioByEmbeddedIndex
      && cache.embeddedSubtitleByNativeIndex
      && cache.embeddedSubtitleByEmbeddedIndex
    ) {
      return cache;
    }

    const embeddedAudioByNativeIndex = new Map();
    const embeddedAudioByEmbeddedIndex = new Map();
    const embeddedSubtitleByNativeIndex = new Map();
    const embeddedSubtitleByEmbeddedIndex = new Map();

    (this.embeddedAudioTracks || []).forEach((track, index) => {
      const nativeTrackIndex = Number(track?.nativeTrackIndex);
      const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
      if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
        embeddedAudioByNativeIndex.set(nativeTrackIndex, track);
      }
      if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
        embeddedAudioByEmbeddedIndex.set(embeddedTrackIndex, track);
      } else {
        embeddedAudioByEmbeddedIndex.set(index, track);
      }
    });

    (this.embeddedSubtitleTracks || []).forEach((track, index) => {
      const nativeTrackIndex = Number(track?.nativeTrackIndex);
      const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
      if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
        embeddedSubtitleByNativeIndex.set(nativeTrackIndex, track);
      }
      if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
        embeddedSubtitleByEmbeddedIndex.set(embeddedTrackIndex, track);
      } else {
        embeddedSubtitleByEmbeddedIndex.set(index, track);
      }
    });

    cache.embeddedAudioByNativeIndex = embeddedAudioByNativeIndex;
    cache.embeddedAudioByEmbeddedIndex = embeddedAudioByEmbeddedIndex;
    cache.embeddedSubtitleByNativeIndex = embeddedSubtitleByNativeIndex;
    cache.embeddedSubtitleByEmbeddedIndex = embeddedSubtitleByEmbeddedIndex;
    return cache;
  },

  getEmbeddedAudioTrackByNativeIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedAudioByNativeIndex.get(targetIndex) || null;
  },

  getEmbeddedAudioTrackByEmbeddedIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedAudioByEmbeddedIndex.get(targetIndex) || null;
  },

  getEmbeddedSubtitleTrackByNativeIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByNativeIndex.get(targetIndex) || null;
  },

  getEmbeddedSubtitleTrackByEmbeddedIndex(index) {
    const targetIndex = Number(index);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return null;
    }
    return this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByEmbeddedIndex.get(targetIndex) || null;
  },

  buildSubtitleTrackSignature(track = {}, fallbackIndex = -1) {
    const normalizedLanguage = normalizeTrackLanguageCode(
      track?.language || track?.lang || track?.srclang || ""
    ) || String(track?.language || track?.lang || track?.srclang || "").trim().toLowerCase();
    const normalizedLabel = cleanDisplayText(track?.label || track?.name || "")
      .trim()
      .toLowerCase();
    if (normalizedLanguage || normalizedLabel) {
      return `${normalizedLanguage}|${normalizedLabel}`;
    }
    return `subtitle-${fallbackIndex}`;
  },

  dedupeBuiltInSubtitleTracks(builtInTracks = [], embeddedSubtitleTracks = []) {
    if (!Environment.isWebOS() || !embeddedSubtitleTracks.length || !builtInTracks.length) {
      return builtInTracks;
    }

    const embeddedNativeIndexes = new Set(
      embeddedSubtitleTracks
        .map((track) => Number(track?.nativeTrackIndex))
        .filter((index) => Number.isFinite(index) && index >= 0)
    );
    const embeddedSignatures = new Set(
      embeddedSubtitleTracks.map((track, index) => this.buildSubtitleTrackSignature(track, index))
    );

    return builtInTracks.filter((track, index) => {
      if (embeddedNativeIndexes.has(index)) {
        return false;
      }
      const signature = this.buildSubtitleTrackSignature(track, index);
      return !embeddedSignatures.has(signature);
    });
  },

  mergeAvPlaySubtitleTrackMetadata(track, index) {
    const avplayTrackIndex = Number(track?.avplayTrackIndex);
    const embeddedTrack = this.getEmbeddedSubtitleTrackByNativeIndex(
      Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index
    );
    if (!embeddedTrack) {
      return track;
    }
    return {
      ...track,
      label: cleanDisplayText(embeddedTrack.label) || track?.label || subtitleLabel(index),
      language: embeddedTrack.language || track?.language || "",
      secondary: embeddedTrack.secondary || String(embeddedTrack.language || track?.language || "").toUpperCase()
    };
  },

  mergeEmbeddedAudioTrackMetadata(track, index) {
    const embeddedTrack = this.getEmbeddedAudioTrack(index);
    if (!embeddedTrack) {
      return track;
    }
    return {
      ...track,
      label: cleanDisplayText(embeddedTrack.label) || track?.label || track?.name || "",
      name: cleanDisplayText(track?.name || embeddedTrack.label) || track?.name || "",
      language: embeddedTrack.language || track?.language || track?.lang || "",
      lang: embeddedTrack.lang || track?.lang || track?.language || "",
      codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
      audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
      channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
      channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
      sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0
    };
  },

  mergeAvPlayAudioTrackMetadata(track, index) {
    const avplayTrackIndex = Number(track?.avplayTrackIndex);
    const embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(
      Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index
    );
    if (!embeddedTrack) {
      return track;
    }
    return {
      ...track,
      label: cleanDisplayText(embeddedTrack.label) || track?.label || track?.name || "",
      name: cleanDisplayText(track?.name || embeddedTrack.label) || track?.name || "",
      language: embeddedTrack.language || track?.language || track?.lang || "",
      lang: embeddedTrack.lang || track?.lang || track?.language || "",
      codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
      audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
      channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
      channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
      sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0
    };
  },

  revokeExternalSubtitleObjectUrls() {
    if (!Array.isArray(this.externalSubtitleObjectUrls) || !this.externalSubtitleObjectUrls.length) {
      return;
    }
    this.externalSubtitleObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Best effort.
      }
    });
    this.externalSubtitleObjectUrls = [];
  },

  clearMountedExternalSubtitleTracks() {
    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];
    this.revokeExternalSubtitleObjectUrls();
  },

  getSubtitleRequestHeaders() {
    const baseHeaders = this.getCurrentStreamRequestHeaders();
    if (typeof PlayerController.normalizePlaybackHeaders === "function") {
      return PlayerController.normalizePlaybackHeaders(baseHeaders);
    }
    return { ...baseHeaders };
  },

  isLikelySrtSubtitleUrl(url) {
    const value = String(url || "").toLowerCase();
    return value.includes(".srt") || value.includes("format=srt");
  },

  convertSrtToVtt(content) {
    const raw = String(content || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!raw.trim()) {
      return "WEBVTT\n\n";
    }
    if (/^\s*WEBVTT/i.test(raw)) {
      return raw;
    }
    const withHours = raw.replace(/(\b\d{1,2}:\d{2}:\d{2}),(\d{3}\b)/g, "$1.$2");
    const normalized = withHours.replace(/(\b\d{1,2}:\d{2}),(\d{3}\b)/g, "00:$1.$2");
    return `WEBVTT\n\n${normalized}`;
  },

  async resolveSubtitlePlaybackUrl(url) {
    const original = String(url || "").trim();
    if (!original) {
      return "";
    }
    if (/^(blob:|data:)/i.test(original)) {
      return original;
    }
    try {
      const response = await fetch(original, {
        mode: "cors",
        headers: this.getSubtitleRequestHeaders()
      });
      if (!response.ok) {
        return original;
      }
      const body = await response.text();
      const contentType = String(response.headers?.get("content-type") || "").toLowerCase();
      const shouldConvertToVtt = this.isLikelySrtSubtitleUrl(original)
        || contentType.includes("subrip")
        || (!contentType.includes("vtt") && !/^\s*WEBVTT/i.test(body));
      const vttText = shouldConvertToVtt ? this.convertSrtToVtt(body) : body;
      const objectUrl = URL.createObjectURL(new Blob([vttText], { type: "text/vtt" }));
      this.externalSubtitleObjectUrls.push(objectUrl);
      return objectUrl;
    } catch (_) {
      return original;
    }
  },

  activateMountedExternalSubtitleTrack(trackNode) {
    const textTracks = this.getTextTracks();
    const targetTrack = trackNode?.track || null;
    if (!targetTrack && !textTracks.length) {
      return false;
    }

    let activatedIndex = -1;
    textTracks.forEach((textTrack, index) => {
      const shouldShow = targetTrack ? textTrack === targetTrack : index === textTracks.length - 1;
      try {
        textTrack.mode = shouldShow ? "showing" : "disabled";
        if (shouldShow) {
          activatedIndex = index;
        }
      } catch (_) {
        // Best effort.
      }
    });

    if (activatedIndex < 0 && targetTrack) {
      try {
        targetTrack.mode = "showing";
        activatedIndex = textTracks.indexOf(targetTrack);
      } catch (_) {
        // Best effort.
      }
    }

    if (activatedIndex >= 0) {
      this.selectedSubtitleTrackIndex = activatedIndex;
      this.refreshTrackDialogs();
      return true;
    }

    return false;
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
    const selectedEmbeddedSubtitleTrack = typeof PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex === "function"
      ? PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex()
      : -1;
    const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
      ? PlayerController.getHlsAudioTracks()
      : [];

    if (!this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length;
    } else if ((!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) && textTracks.length > this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
    }

    if (avplaySubtitleTracks.length) {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function"
        ? PlayerController.getSelectedAvPlaySubtitleTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedAvPlaySubtitleTrack)
        ? selectedAvPlaySubtitleTrack
        : -1;
    } else if (dashSubtitleTracks.length) {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function"
        ? PlayerController.getSelectedDashTextTrackIndex()
        : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedDashSubtitleTrack)
        ? selectedDashSubtitleTrack
        : -1;
    } else if (this.shouldUseEmbeddedSubtitleTracks()) {
      this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(selectedEmbeddedSubtitleTrack)
        ? selectedEmbeddedSubtitleTrack
        : -1;
      this.selectedSubtitleTrackIndex = -1;
    } else {
      this.selectedEmbeddedSubtitleTrackIndex = -1;
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
      this.invalidateTrackDialogCaches();
      return;
    }

    if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      this.selectedAudioTrackIndex = selectedDashAudioTrack >= 0 ? selectedDashAudioTrack : 0;
      this.invalidateTrackDialogCaches();
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
      this.invalidateTrackDialogCaches();
      return;
    }

    this.selectedAudioTrackIndex = audioTracks.findIndex((track) => Boolean(track?.enabled || track?.selected));
    this.invalidateTrackDialogCaches();
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
    const embeddedSubtitleTracks = this.shouldUseEmbeddedSubtitleTracks()
      ? this.embeddedSubtitleTracks
      : [];

    const builtInTracks = this.dedupeBuiltInSubtitleTracks(
      textTracks.filter((_, index) => index < builtInBoundary),
      embeddedSubtitleTracks
    );
    const addonTracks = textTracks.filter((_, index) => index >= builtInBoundary);
    const trackDiscoveryPending = this.embeddedSubtitleLoading
      || (this.isCurrentSourceAdaptiveManifest()
        && (this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading));

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
            const mergedTrack = this.mergeAvPlaySubtitleTrackMetadata(track, index);
            const avplayTrackIndex = Number(track?.avplayTrackIndex);
            const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
            return {
              id: `subtitle-avplay-${normalizedTrackIndex}`,
              label: mergedTrack?.label || subtitleLabel(index),
              secondary: mergedTrack?.secondary || String(mergedTrack?.language || "").toUpperCase(),
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

      const entries = [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.selectedSubtitleTrackIndex < 0 && this.selectedEmbeddedSubtitleTrackIndex < 0 && !this.selectedManifestSubtitleTrackId,
            trackIndex: -1
          },
          ...embeddedSubtitleTracks.map((track, index) => ({
            id: `subtitle-embedded-${track.embeddedTrackIndex}`,
            label: track.label || subtitleLabel(index),
            secondary: track.secondary || String(track.language || "").toUpperCase(),
            selected: track.embeddedTrackIndex === this.selectedEmbeddedSubtitleTrackIndex,
            trackIndex: null,
            embeddedSubtitleTrackIndex: track.embeddedTrackIndex
          })),
          ...builtInTracks.map((track, index) => ({
            id: `subtitle-built-${index}`,
            label: track.label || subtitleLabel(index),
            secondary: String(track.language || "").toUpperCase(),
            selected: this.selectedEmbeddedSubtitleTrackIndex < 0 && index === this.selectedSubtitleTrackIndex,
            trackIndex: index
          })),
        ...this.manifestSubtitleTracks.map((track) => ({
          id: `subtitle-manifest-${track.id}`,
          label: track.name || t("subtitle_dialog_title", {}, "Subtitle"),
          secondary: String(track.language || "").toUpperCase(),
          selected: this.selectedManifestSubtitleTrackId === track.id,
          trackIndex: null,
          manifestSubtitleTrackId: track.id
        }))
      ];

      if (embeddedSubtitleTracks.length || builtInTracks.length || !trackDiscoveryPending) {
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
      if (this.subtitles.length) {
        return this.subtitles.map((subtitle, index) => {
          const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
          const absoluteIndex = builtInBoundary + index;
          return {
            id: `subtitle-addon-fallback-${subtitleId}`,
            label: subtitle.lang || subtitleLabel(index),
            secondary: subtitle.addonName || t("nav_addons", {}, "Addon"),
            selected: this.selectedAddonSubtitleId === subtitleId
              || (this.selectedAddonSubtitleId == null && absoluteIndex === this.selectedSubtitleTrackIndex),
            trackIndex: null,
            subtitleIndex: index,
            fallbackAddonSubtitle: true
          };
        });
      }
      if (addonTracks.length) {
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
    const cachedOptions = this.trackDialogCache?.subtitleOptions;
    if (cachedOptions) {
      return cachedOptions;
    }
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
          sourceType: "off",
          isForced: false,
          entry
        });
        return;
      }
      const languageSource = normalizeTrackLanguageCode(entry.secondary) ? entry.secondary : entry.label;
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      const isForced = /\bforced\b/i.test(`${entry.label || ""} ${entry.secondary || ""}`);
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: languageLabel,
        secondary: [t("subtitle_tab_builtin", {}, "Built-in"), entry.label && normalizeComparableText(entry.label) !== normalizeComparableText(languageLabel) ? entry.label : ""].filter(Boolean).join(" • "),
        selected: Boolean(entry.selected),
        sourceType: "internal",
        isForced,
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
      const isForced = /\bforced\b/i.test(`${entry.title || ""} ${entry.label || ""} ${entry.secondary || ""}`);
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: languageLabel,
        secondary: [entry.secondary || t("subtitle_tab_addons", {}, "Addons"), entry.label && normalizeComparableText(entry.label) !== normalizeComparableText(languageLabel) ? entry.label : ""].filter(Boolean).join(" • "),
        selected: Boolean(entry.selected),
        sourceType: "addon",
        isForced,
        entry
      });
    });

    this.trackDialogCache.subtitleOptions = options;
    return options;
  },

  getSelectedSubtitleLanguageKey() {
    const selected = this.collectSubtitleOptionItems().find((entry) => entry.selected);
    return selected?.languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
  },

  getSubtitleLanguageRailItems() {
    const cachedLanguageRail = this.trackDialogCache?.subtitleLanguageRail;
    if (cachedLanguageRail) {
      return cachedLanguageRail;
    }
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
    this.trackDialogCache.subtitleLanguageRail = values;
    return values;
  },

  syncSubtitleOptionIndexForFocusedLanguage() {
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage = languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const selectedIndex = options.findIndex((item) => item.selected);
    this.subtitleOptionRailIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : 0);
  },

  selectSubtitleOption(option, { focusOptions = true } = {}) {
    if (!option?.entry || !option.languageKey || option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const languages = this.getSubtitleLanguageRailItems();
    const languageIndex = languages.findIndex((item) => item.key === option.languageKey);
    if (languageIndex >= 0) {
      this.subtitleLanguageRailIndex = languageIndex;
    }

    const options = this.getSubtitleOptionsForLanguage(option.languageKey);
    const optionIndex = options.findIndex((item) => item.id === option.id);
    this.subtitleOptionRailIndex = Math.max(0, optionIndex >= 0 ? optionIndex : 0);
    if (focusOptions) {
      this.subtitleFocusedRail = "options";
    }

    this.applySubtitleEntry(option.entry);
    return true;
  },

  selectFirstSubtitleOptionForLanguage(languageKey, { focusOptions = true } = {}) {
    if (!languageKey || languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const options = this.getSubtitleOptionsForLanguage(languageKey);
    if (!options.length) {
      return false;
    }
    return this.selectSubtitleOption(options[0], { focusOptions });
  },

  scrollSubtitleRailNodeIntoView(node, { center = false } = {}) {
    if (!(node instanceof HTMLElement)) {
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
  },

  scrollSubtitleDialogIntoView() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) {
      return;
    }
    const selectedLanguageNode = dialog.querySelector(".player-subtitle-language-rail .player-dialog-item.selected");
    const focusedLanguageNode = dialog.querySelector(".player-subtitle-language-rail .player-dialog-item.focused");
    const languageNode = focusedLanguageNode || selectedLanguageNode;
    const optionNode = dialog.querySelector(".player-subtitle-options-rail .player-dialog-item.focused");
    const styleNode = dialog.querySelector(".player-subtitle-style-rail .player-dialog-item.focused");

    if (this.subtitleFocusedRail === "language") {
      this.scrollSubtitleRailNodeIntoView(languageNode);
    } else if (this.subtitleFocusedRail === "options") {
      this.scrollSubtitleRailNodeIntoView(optionNode);
    } else {
      this.scrollSubtitleRailNodeIntoView(styleNode);
    }
    this.subtitleDialogScrollMode = "nearest";
  },

  getSubtitleOptionsForLanguage(languageKey = this.getSelectedSubtitleLanguageKey()) {
    const normalizedLanguageKey = languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
    const optionsByLanguage = this.trackDialogCache?.subtitleOptionsByLanguage;
    if (optionsByLanguage?.has(normalizedLanguageKey)) {
      return optionsByLanguage.get(normalizedLanguageKey);
    }
    const filteredOptions = this.collectSubtitleOptionItems().filter((entry) => entry.languageKey === normalizedLanguageKey && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    optionsByLanguage?.set(normalizedLanguageKey, filteredOptions);
    return filteredOptions;
  },

  isTrackDiscoveryWindowPending() {
    return Number(this.trackDiscoveryDeadline || 0) > Date.now();
  },

  isAudioPreferenceDiscoveryPending() {
    return Boolean(
      this.embeddedAudioLoading
      || this.manifestLoading
      || this.trackDiscoveryInProgress
      || (!this.getAudioEntries().length && this.isTrackDiscoveryWindowPending())
    );
  },

  isSubtitlePreferenceDiscoveryPending() {
    const hasSubtitleOptions = this.collectSubtitleOptionItems()
      .some((entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    return Boolean(
      this.subtitleLoading
      || this.embeddedSubtitleLoading
      || this.manifestLoading
      || this.trackDiscoveryInProgress
      || (!hasSubtitleOptions && this.isTrackDiscoveryWindowPending())
    );
  },

  getStartupPreferredSubtitleLanguageKey() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    const configured = String(settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off").trim().toLowerCase();
    if (!configured || configured === "off" || configured === "none" || configured === "forced") {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    if (configured === "system") {
      const locale = typeof I18n.getLocale === "function"
        ? I18n.getLocale()
        : (globalThis.navigator?.language || "");
      const systemLanguage = normalizeTrackLanguageCode(locale);
      return systemLanguage ? normalizeSubtitleLanguageKey(systemLanguage) : SUBTITLE_LANGUAGE_OFF_KEY;
    }

    return normalizeSubtitleLanguageKey(configured);
  },

  getStartupPreferredSubtitleLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return [];
    }

    const values = [
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off",
      settings.subtitleStyle?.secondaryPreferredLanguage || settings.secondarySubtitleLanguage || "off"
    ];

    const targets = values
      .map((value) => {
        const configured = String(value || "off").trim().toLowerCase();
        if (!configured || configured === "off" || configured === "none" || configured === "forced") {
          return "";
        }
        if (configured === "system") {
          const locale = typeof I18n.getLocale === "function"
            ? I18n.getLocale()
            : (globalThis.navigator?.language || "");
          return normalizeSubtitleLanguageKey(normalizeTrackLanguageCode(locale) || "");
        }
        return normalizeSubtitleLanguageKey(configured);
      })
      .filter(Boolean);

    return Array.from(new Set(targets));
  },

  getStartupForcedSubtitleLanguageTargets() {
    const targets = [
      ...this.getStartupPreferredAudioLanguageTargets()
    ];
    const selectedAudioOption = this.collectAudioOptionItems().find((entry) => entry.selected && entry.languageKey);
    if (selectedAudioOption?.languageKey) {
      targets.push(selectedAudioOption.languageKey);
    }
    return Array.from(new Set(targets.filter(Boolean)));
  },

  getStartupSubtitlePreferenceMode() {
    const settings = PlayerSettingsStore.get();
    const explicitTargets = this.getStartupPreferredSubtitleLanguageTargets();
    if (explicitTargets.length) {
      return settings.subtitlesEnabled ? "language" : "off";
    }
    return "audio-forced";
  },

  getStartupPreferredAudioLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    const configured = String(settings.preferredAudioLanguage || "system").trim().toLowerCase();
    if (!configured || configured === "off" || configured === "none") {
      return [];
    }

    if (configured === "system") {
      const locale = typeof I18n.getLocale === "function"
        ? I18n.getLocale()
        : (globalThis.navigator?.language || "");
      const systemLanguage = normalizeTrackLanguageCode(locale);
      return systemLanguage ? [systemLanguage] : [];
    }

    const normalized = normalizeTrackLanguageCode(configured);
    return normalized ? [normalized] : [];
  },

  collectAudioOptionItems() {
    return this.getAudioEntries().map((entry, index) => {
      const track = entry?.track || {};
      const languageKey = normalizeTrackLanguageCode(
        getTrackLanguageValue(track)
        || track?.label
        || track?.name
        || ""
      );
      return {
        id: entry?.id || `audio-option-${index}`,
        label: cleanDisplayText(entry?.label || ""),
        secondary: cleanDisplayText(entry?.secondary || ""),
        selected: Boolean(entry?.selected),
        languageKey,
        languageLabel: getTrackLanguageLabel(track),
        entry,
        entryIndex: index
      };
    });
  },

  matchesStartupAudioTarget(option, target) {
    if (!option || !target) {
      return false;
    }
    if (option.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const optionBase = String(option.languageKey || "").split("-")[0];
    if (targetBase && optionBase && targetBase === optionBase) {
      return true;
    }
    const targetLabel = normalizeComparableText(getTrackLanguageLabel({ language: target }) || "");
    if (!targetLabel) {
      return false;
    }
    return [option.languageLabel, option.label, option.secondary]
      .map((value) => normalizeComparableText(value))
      .some((value) => value === targetLabel);
  },

  findStartupPreferredAudioOption(targets = this.getStartupPreferredAudioLanguageTargets()) {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }
    const options = this.collectAudioOptionItems();
    for (const target of normalizedTargets) {
      const matchingOption = options.find((entry) => this.matchesStartupAudioTarget(entry, target));
      if (matchingOption) {
        return matchingOption;
      }
    }
    return null;
  },

  applyStartupAudioPreference() {
    if (this.startupAudioPreferenceApplied || this.startupAudioPreferenceApplying) {
      return false;
    }

    const preferredTargets = this.getStartupPreferredAudioLanguageTargets();
    if (!preferredTargets.length) {
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const isStillLoading = this.isAudioPreferenceDiscoveryPending();
    const selectedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    if (selectedOption && preferredTargets.some((target) => this.matchesStartupAudioTarget(selectedOption, target))) {
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const preferredOption = this.findStartupPreferredAudioOption(preferredTargets);
    if (!preferredOption?.entry || !Number.isFinite(preferredOption.entryIndex)) {
      if (!isStillLoading) {
        this.startupAudioPreferenceApplied = true;
      }
      return false;
    }

    this.startupAudioPreferenceApplying = true;
    try {
      this.applyAudioTrack(preferredOption.entryIndex);
    } finally {
      this.startupAudioPreferenceApplying = false;
    }

    const appliedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    const applied = Boolean(appliedOption && preferredTargets.some((target) => this.matchesStartupAudioTarget(appliedOption, target)));
    this.startupAudioPreferenceApplied = applied;
    return applied;
  },

  findStartupPreferredSubtitleOption(targets = this.getStartupPreferredSubtitleLanguageTargets(), mode = "language") {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }

    const options = this.collectSubtitleOptionItems().filter((entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const matchTarget = (entry, target) => this.matchesStartupSubtitleTarget(entry, target);
    const findMatch = (target, { sourceType = null, forced = null } = {}) => options.find((entry) => {
      if (sourceType && entry.sourceType !== sourceType) {
        return false;
      }
      if (forced === true && !entry.isForced) {
        return false;
      }
      if (forced === false && entry.isForced) {
        return false;
      }
      return matchTarget(entry, target);
    });

    for (const target of normalizedTargets) {
      if (mode === "audio-forced") {
        const forcedInternal = findMatch(target, { sourceType: "internal", forced: true });
        if (forcedInternal) return forcedInternal;
        const forcedAddon = findMatch(target, { sourceType: "addon", forced: true });
        if (forcedAddon) return forcedAddon;
        continue;
      }

      const internalMatch = findMatch(target, { sourceType: "internal", forced: false });
      if (internalMatch) return internalMatch;
      const addonMatch = findMatch(target, { sourceType: "addon", forced: false });
      if (addonMatch) return addonMatch;
      const forcedInternal = findMatch(target, { sourceType: "internal", forced: true });
      if (forcedInternal) return forcedInternal;
      const forcedAddon = findMatch(target, { sourceType: "addon", forced: true });
      if (forcedAddon) return forcedAddon;
    }

    return null;
  },

  matchesStartupSubtitleTarget(entry, target) {
    if (!entry || !target) {
      return false;
    }
    if (target === "forced") {
      return Boolean(entry.isForced);
    }
    if (entry.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const entryBase = String(entry.languageKey || "").split("-")[0];
    if (targetBase && entryBase && targetBase === entryBase) {
      return true;
    }
    const normalizedTitle = normalizeComparableText(entry.title || "");
    const normalizedLabel = normalizeComparableText(entry.languageLabel || "");
    const targetLabel = normalizeComparableText(subtitleLanguageLabel(target));
    return Boolean(targetLabel && (normalizedTitle === targetLabel || normalizedLabel === targetLabel));
  },

  applyStartupSubtitlePreference() {
    if (this.startupSubtitlePreferenceApplied || this.startupSubtitlePreferenceApplying) {
      return false;
    }

    const preferenceMode = this.getStartupSubtitlePreferenceMode();
    const preferredTargets = preferenceMode === "audio-forced"
      ? this.getStartupForcedSubtitleLanguageTargets()
      : this.getStartupPreferredSubtitleLanguageTargets();
    const isStillLoading = this.isSubtitlePreferenceDiscoveryPending();

    if (preferenceMode === "off") {
      if (this.selectedSubtitleTrackIndex >= 0 || this.selectedEmbeddedSubtitleTrackIndex >= 0 || this.selectedAddonSubtitleId || this.selectedManifestSubtitleTrackId) {
        const offEntry = this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 };
        this.startupSubtitlePreferenceApplying = true;
        try {
          this.applySubtitleEntry(offEntry);
        } finally {
          this.startupSubtitlePreferenceApplying = false;
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      if (!isStillLoading) {
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    const selectedOption = this.collectSubtitleOptionItems().find((entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const preferredOption = this.findStartupPreferredSubtitleOption(preferredTargets, preferenceMode);
    if (selectedOption && preferredOption?.id === selectedOption.id) {
      this.startupSubtitlePreferenceApplied = true;
      return true;
    }

    if (!preferredOption?.entry) {
      if (!isStillLoading) {
        if (selectedOption) {
          const offEntry = this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || { trackIndex: -1 };
          this.startupSubtitlePreferenceApplying = true;
          try {
            this.applySubtitleEntry(offEntry);
          } finally {
            this.startupSubtitlePreferenceApplying = false;
          }
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    this.startupSubtitlePreferenceApplying = true;
    try {
      this.selectSubtitleOption(preferredOption, { focusOptions: false });
    } finally {
      this.startupSubtitlePreferenceApplying = false;
    }

    const appliedOption = this.collectSubtitleOptionItems().find((entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY);
    const applied = Boolean(appliedOption && preferredTargets.some((target) => this.matchesStartupSubtitleTarget(appliedOption, target)));
    this.startupSubtitlePreferenceApplied = applied;
    return applied;
  },

  getSubtitleStyleControls() {
    const style = this.subtitleStyleSettings || {};
    return [
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay"), value: formatSubtitleDelay(this.subtitleDelayMs) },
      { id: "fontSize", label: t("subtitle_style_font_size", {}, "Font Size"), value: `${Number(style.fontSize || 100)}%` },
      { id: "bold", label: t("subtitle_style_bold", {}, "Bold"), value: style.bold ? t("subtitle_style_on", {}, "On") : t("subtitle_style_off", {}, "Off") },
      { id: "textColor", label: t("subtitle_style_text_color", {}, "Text Color"), value: styleChipLabel(style.textColor || "#FFFFFF") },
      { id: "outlineEnabled", label: t("subtitle_style_outline", {}, "Outline"), value: style.outlineEnabled ? t("subtitle_style_on", {}, "On") : t("subtitle_style_off", {}, "Off") },
      { id: "outlineColor", label: t("subtitle_style_outline_color", {}, "Outline Color"), value: styleChipLabel(style.outlineColor || "#000000") },
      { id: "verticalOffset", label: t("subtitle_style_bottom_offset", {}, "Bottom Offset"), value: formatSubtitleVerticalOffset(style.verticalOffset) },
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
      style.verticalOffset = normalizeSubtitleVerticalOffset(Number(style.verticalOffset || 0) + (delta * SUBTITLE_VERTICAL_OFFSET_STEP));
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

  getSubtitleStyleControlDelta(side = this.subtitleStyleControlSide) {
    return String(side || "").toLowerCase() === "plus" ? 1 : -1;
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
    this.subtitleStyleControlSide = "minus";
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
    this.subtitleStyleControlSide = "minus";
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

    const isEmbeddedEntry = Object.prototype.hasOwnProperty.call(entry, "embeddedSubtitleTrackIndex");
    if (!isEmbeddedEntry) {
      this.disableEmbeddedSubtitleSelection();
    }

    if (isEmbeddedEntry) {
      if (this.externalTrackNodes.length) {
        this.clearMountedExternalSubtitleTracks();
      }
      const targetTrackIndex = Number(entry.embeddedSubtitleTrackIndex);
      const embeddedTrack = this.getEmbeddedSubtitleTrackByEmbeddedIndex(targetTrackIndex);
      let applied = false;
      if (Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()) {
        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
        applied = typeof PlayerController.setAvPlaySubtitleTrack === "function" && Number.isFinite(nativeTrackIndex)
          ? PlayerController.setAvPlaySubtitleTrack(nativeTrackIndex)
          : false;
      } else {
        applied = typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function"
          ? PlayerController.setWebOsEmbeddedSubtitleTrack(targetTrackIndex)
          : false;
      }
      if (!applied) {
        return;
      }
      this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (!entry.fallbackAddonSubtitle && this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
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
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
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
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
      this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
      this.selectedSubtitleTrackIndex = -1;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (entry.fallbackAddonSubtitle) {
      void this.applyFallbackAddonSubtitle(entry.subtitleIndex);
      return;
    }

    if (this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }

    const textTracks = this.getTextTracks();
    const targetIndex = Number(entry.trackIndex);

    if (targetIndex < 0 && this.selectedManifestSubtitleTrackId) {
      this.applyManifestTrackSelection({ subtitleTrackId: null });
      this.selectedManifestSubtitleTrackId = null;
    } else if (this.selectedManifestSubtitleTrackId) {
      this.selectedManifestSubtitleTrackId = null;
    }

    const appliedByController = typeof PlayerController.setNativeTextTrack === "function"
      ? PlayerController.setNativeTextTrack(targetIndex)
      : false;
    if (appliedByController) {
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = targetIndex;
      this.selectedEmbeddedSubtitleTrackIndex = -1;
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
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
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.invalidateTrackDialogCaches();
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  async applyFallbackAddonSubtitle(subtitleIndex) {
    const subtitle = this.subtitles[subtitleIndex];
    if (!subtitle?.url) {
      return;
    }
    const subtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;

    const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function"
      ? PlayerController.isUsingAvPlay()
      : false;
    if (usingAvPlay) {
      const applied = typeof PlayerController.setAvPlayExternalSubtitle === "function"
        ? PlayerController.setAvPlayExternalSubtitle(subtitle.url)
        : false;
      if (applied) {
        this.selectedAddonSubtitleId = subtitleId;
        this.selectedSubtitleTrackIndex = -1;
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedManifestSubtitleTrackId = null;
        this.refreshSubtitleCueStyles();
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
    }

    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const currentTracks = this.getTextTracks();
    this.builtInSubtitleCount = this.externalTrackNodes.length
      ? Math.max(0, currentTracks.length - this.externalTrackNodes.length)
      : currentTracks.length;

    this.disableEmbeddedSubtitleSelection();
    this.clearMountedExternalSubtitleTracks();

    const resolvedSubtitleUrl = await this.resolveSubtitlePlaybackUrl(subtitle.url);
    if (!resolvedSubtitleUrl) {
      return;
    }

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.lang || subtitleLabel(subtitleIndex);
    track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
    track.src = resolvedSubtitleUrl;
    track.default = true;
    track.setAttribute("data-addon-subtitle-id", subtitleId);
    video.appendChild(track);
    this.externalTrackNodes.push(track);

    try {
      if (track.track) {
        track.track.mode = "hidden";
      }
    } catch (_) {
      // Best effort.
    }

    const activateTrack = () => this.activateMountedExternalSubtitleTrack(track);
    track.addEventListener("load", activateTrack, { once: true });
    track.addEventListener("error", () => {
      console.warn("Subtitle track failed to load", { subtitleUrl: subtitle.url });
    }, { once: true });

    const preferredIndex = this.builtInSubtitleCount;
    this.selectedAddonSubtitleId = subtitleId;
    this.selectedSubtitleTrackIndex = preferredIndex;
    this.selectedEmbeddedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.renderControlButtons();
    this.renderSubtitleDialog();

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    let activationAttempts = 0;
    const scheduleActivation = () => {
      this.subtitleSelectionTimer = setTimeout(() => {
        activationAttempts += 1;
        const activated = activateTrack();
        if (!activated && activationAttempts < 6) {
          scheduleActivation();
          return;
        }
        if (!activated) {
          this.selectedSubtitleTrackIndex = -1;
          this.refreshTrackDialogs();
          return;
        }
        this.refreshSubtitleCueStyles();
      }, activationAttempts === 0 ? 80 : 140);
    };
    scheduleActivation();
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
    const subtitleLoadingVisible = this.embeddedSubtitleLoading && this.canDiscoverEmbeddedSubtitleTracks();
    const showOptionsRail = activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY || subtitleLoadingVisible;
    const focusedStyleSide = this.subtitleStyleControlSide === "plus" ? "plus" : "minus";
    const emptySubtitleOptionsMarkup = subtitleLoadingVisible
      ? `<div class="player-dialog-empty">${escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks..."))}</div>`
      : `<div class="player-dialog-empty">${escapeHtml(t("subtitle_none", {}, "No subtitles"))}</div>`;

    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("subtitle_dialog_title", {}, "Subtitles"))}</div>
      <div class="player-subtitle-overlay-grid">
        <div class="player-subtitle-rail player-subtitle-language-rail">
          ${languages.map((item, index) => `
            <div class="player-dialog-item${item.selected ? " selected" : ""}${this.subtitleFocusedRail === "language" && index === this.subtitleLanguageRailIndex ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
              <div class="player-dialog-item-sub">${item.key === SUBTITLE_LANGUAGE_OFF_KEY && subtitleLoadingVisible ? escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks...")) : ""}</div>
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
          `).join("") : emptySubtitleOptionsMarkup}
        </div>
        <div class="player-subtitle-rail player-subtitle-style-rail${showOptionsRail ? "" : " hidden"}">
          ${styleItems.map((item, index) => `
            <div class="player-dialog-item player-dialog-style-item${this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex ? " focused" : ""}">
              <button class="player-dialog-step player-dialog-step-minus${this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "minus" ? " focused" : ""}" type="button" data-subtitle-style-action="decrease" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} -`)}">&#8722;</button>
              <div class="player-dialog-item-center">
                <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
                <div class="player-dialog-item-sub">${escapeHtml(item.value || "")}</div>
              </div>
              <button class="player-dialog-step player-dialog-step-plus${this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "plus" ? " focused" : ""}" type="button" data-subtitle-style-action="increase" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} +`)}">&#43;</button>
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
    const styleItem = styleItems[this.subtitleStyleRailIndex];
    
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
        if (this.subtitleStyleControlSide === "plus") {
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        } else {
          this.subtitleFocusedRail = options.length ? "options" : "language";
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        }
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
        this.subtitleStyleControlSide = "minus";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "style") {
        if (this.subtitleStyleControlSide === "minus") {
          this.subtitleStyleControlSide = "plus";
          this.renderSubtitleDialog();
          return true;
        }
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
          const selected = this.selectFirstSubtitleOptionForLanguage(language.key, { focusOptions: true });
          if (!selected) {
            const nextOptions = this.getSubtitleOptionsForLanguage(language.key);
            if (nextOptions.length) {
              this.subtitleFocusedRail = "options";
              this.subtitleOptionRailIndex = 0;
            }
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
          this.subtitleStyleControlSide = "minus";
        }
        return true;
      }
      if (styleItem) {
        this.adjustSubtitleStyleControl(styleItem.id, this.getSubtitleStyleControlDelta(this.subtitleStyleControlSide));
      }
      return true;
    }
    if (this.subtitleFocusedRail === "style" && (keyCode === 10009 || keyCode === 461)) {
      this.subtitleFocusedRail = options.length ? "options" : "language";
      this.subtitleStyleControlSide = "minus";
      this.renderSubtitleDialog();
      return true;
    }
    return keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13;
  },

  getAudioEntries() {
    const cachedEntries = this.trackDialogCache?.audioEntries;
    if (cachedEntries) {
      return cachedEntries;
    }
    const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function"
      ? PlayerController.getAvPlayAudioTracks()
      : [];
    let entries = [];
	    if (avplayAudioTracks.length) {
      const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function"
        ? PlayerController.getSelectedAvPlayAudioTrackIndex()
        : -1;
      entries = avplayAudioTracks.map((track, index) => {
        const mergedTrack = this.mergeAvPlayAudioTrackMetadata(track, index);
        const avplayTrackIndex = Number(track?.avplayTrackIndex);
        const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
        const display = formatAudioTrackDisplay(mergedTrack, index);
        return {
          id: `audio-avplay-${normalizedTrackIndex}`,
          label: display.label,
          secondary: display.secondary,
          selected: normalizedTrackIndex === selectedAvPlayAudioTrack
            || (selectedAvPlayAudioTrack < 0 && normalizedTrackIndex === this.selectedAudioTrackIndex),
          avplayAudioTrackIndex: normalizedTrackIndex,
          track: mergedTrack
        };
      });
    } else {
      const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function"
        ? PlayerController.getDashAudioTracks()
        : [];
      if (dashAudioTracks.length) {
      const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function"
        ? PlayerController.getSelectedDashAudioTrackIndex()
        : -1;
      entries = dashAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-dash-${index}-${track?.id ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedDashAudioTrack || (selectedDashAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          dashAudioTrackIndex: index,
          track
        };
      });
      } else {
        const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function"
          ? PlayerController.getHlsAudioTracks()
          : [];
        if (hlsAudioTracks.length) {
      const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function"
        ? PlayerController.getSelectedHlsAudioTrackIndex()
        : -1;
      entries = hlsAudioTracks.map((track, index) => {
        const display = formatAudioTrackDisplay(track, index);
        return {
          id: `audio-hls-${index}-${track?.id ?? track?.name ?? track?.lang ?? ""}`,
          label: display.label,
          secondary: display.secondary,
          selected: index === selectedHlsAudioTrack || (selectedHlsAudioTrack < 0 && index === this.selectedAudioTrackIndex),
          hlsAudioTrackIndex: index,
          track
        };
      });
        } else {
          const audioTracks = this.getAudioTracks();
          if (audioTracks.length) {
            entries = audioTracks.map((track, index) => {
              const mergedTrack = this.mergeEmbeddedAudioTrackMetadata(track, index);
              const display = formatAudioTrackDisplay(mergedTrack, index);
              return {
                id: `audio-track-${index}`,
                label: display.label,
                secondary: display.secondary,
                selected: index === this.selectedAudioTrackIndex,
                audioTrackIndex: index,
                track: mergedTrack
              };
            });
          } else if (this.embeddedAudioTracks.length) {
            entries = this.embeddedAudioTracks.map((track, index) => {
              const display = formatAudioTrackDisplay(track, index);
              return {
                id: `audio-embedded-${track?.embeddedTrackIndex ?? index}`,
                label: display.label,
                secondary: display.secondary,
                selected: Number(track?.embeddedTrackIndex) === this.selectedEmbeddedAudioTrackIndex,
                embeddedAudioTrackIndex: Number(track?.embeddedTrackIndex),
                track
              };
            });
          } else if (this.manifestAudioTracks.length) {
            entries = this.manifestAudioTracks.map((track, index) => {
              const display = formatAudioTrackDisplay(track, index);
              return {
                id: `audio-manifest-${track.id}`,
                label: display.label,
                secondary: display.secondary,
                selected: this.selectedManifestAudioTrackId === track.id,
                manifestAudioTrackId: track.id,
                track
              };
            });
          } else {
            const implicitEntry = this.getImplicitAudioEntry();
            entries = implicitEntry ? [implicitEntry] : [];
          }
        }
      }
    }

    this.trackDialogCache.audioEntries = entries;
    return entries;
  },

  getImplicitAudioEntry() {
    const currentStream = this.getCurrentStreamCandidate()?.raw || this.getCurrentStreamCandidate() || {};
    const hasPlaybackContext = Boolean(this.activePlaybackUrl || currentStream?.url || currentStream?.externalUrl || currentStream?.ytId);
    if (!hasPlaybackContext) {
      return null;
    }

    const track = {
      language: currentStream?.language || currentStream?.lang || currentStream?.track_lang || currentStream?.extraInfo?.language || currentStream?.extraInfo?.track_lang || "",
      sampleMimeType: currentStream?.sampleMimeType || currentStream?.mimeType || currentStream?.sourceType || currentStream?.type || "",
      codec: currentStream?.codec || currentStream?.codecs || currentStream?.audioCodec || currentStream?.extraInfo?.audioCodec || "",
      codecs: currentStream?.codecs || currentStream?.codec || currentStream?.audioCodec || currentStream?.extraInfo?.codecs || "",
      audioCodec: currentStream?.audioCodec || currentStream?.extraInfo?.audioCodec || "",
      channelCount: currentStream?.channelCount || currentStream?.audioChannels || currentStream?.channels || currentStream?.extraInfo?.audioChannels || "",
      channels: currentStream?.channels || currentStream?.audioChannels || currentStream?.channelCount || currentStream?.extraInfo?.audioChannels || "",
      sampleRate: currentStream?.sampleRate || currentStream?.audioSampleRate || currentStream?.extraInfo?.audioSampleRate || 0
    };
    const display = formatAudioTrackDisplay(track, 0);
    return {
      id: "audio-implicit-0",
      label: display.label,
      secondary: display.secondary,
      selected: true,
      implicitAudioTrack: true,
      audioTrackIndex: 0,
      track
    };
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
    this.applyAudioAmplification();
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
        this.invalidateTrackDialogCaches();
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
        this.invalidateTrackDialogCaches();
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
        this.invalidateTrackDialogCaches();
        this.refreshTrackDialogs();
      }
      return;
    }

    if (selectedEntry.manifestAudioTrackId) {
      this.applyManifestTrackSelection({ audioTrackId: selectedEntry.manifestAudioTrackId });
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    if (selectedEntry.implicitAudioTrack) {
      this.selectedAudioTrackIndex = 0;
      this.selectedEmbeddedAudioTrackIndex = -1;
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

	    if (Number.isFinite(selectedEntry.embeddedAudioTrackIndex)) {
	      const embeddedTrack = this.getEmbeddedAudioTrackByEmbeddedIndex(selectedEntry.embeddedAudioTrackIndex);
	      let applied = false;
	      if (Environment.isTizen() && typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()) {
	        const nativeTrackIndex = Number(embeddedTrack?.nativeTrackIndex);
	        applied = typeof PlayerController.setAvPlayAudioTrack === "function" && Number.isFinite(nativeTrackIndex)
	          ? PlayerController.setAvPlayAudioTrack(nativeTrackIndex)
	          : false;
	      } else {
	        applied = typeof PlayerController.setWebOsEmbeddedAudioTrack === "function"
	          ? PlayerController.setWebOsEmbeddedAudioTrack(selectedEntry.embeddedAudioTrackIndex)
	          : false;
	      }
		      if (applied) {
		        this.selectedEmbeddedAudioTrackIndex = selectedEntry.embeddedAudioTrackIndex;
		        this.selectedAudioTrackIndex = selectedEntry.embeddedAudioTrackIndex;
	        this.invalidateTrackDialogCaches();
	        this.renderControlButtons();
	        this.renderAudioDialog();
	      }
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
      this.selectedEmbeddedAudioTrackIndex = -1;
      this.invalidateTrackDialogCaches();
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
    this.selectedEmbeddedAudioTrackIndex = -1;
    this.invalidateTrackDialogCaches();
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
      const loading = this.embeddedAudioLoading
        || (this.isCurrentSourceAdaptiveManifest() && (this.manifestLoading || this.trackDiscoveryInProgress));
      const emptyMessage = loading ? "Loading audio tracks..." : this.getUnavailableTrackMessage("audio");
      dialog.innerHTML = `
        <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
        <div class="player-dialog-empty">${emptyMessage}</div>
      `;
      return;
    }

    this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
      <div class="player-dialog-list player-audio-track-list">
        ${entries.map((entry, index) => {
          const selected = entry.selected;
          const focused = index === this.audioDialogIndex;
          return `
            <div class="player-dialog-item${selected ? " selected" : ""}${focused ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
              <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
              <div class="player-dialog-item-check">${selected ? "&#10003;" : ""}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
    this.scrollAudioDialogIntoView();
  },

  scrollAudioDialogIntoView() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog || !this.audioDialogVisible) {
      return;
    }
    const target = dialog.querySelector(".player-audio-track-list .player-dialog-item.focused");
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  },

  handleAudioDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getAudioEntries();
    const isNavigationKey = keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13;

    if (!entries.length) {
      return isNavigationKey;
    }

    if (keyCode === 37 || keyCode === 39) {
      return true;
    }

    if (keyCode === 38) {
      this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 40) {
      this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 13) {
      this.applyAudioTrack(this.audioDialogIndex);
      return true;
    }

    return isNavigationKey;
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
      const streamItems = await this.getPlayableStreamsForVideo(selected.id, itemType);
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
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
        nextEpisodeSeason: nextEpisode?.season ?? null,
        nextEpisodeEpisode: nextEpisode?.episode ?? null,
        nextEpisodeTitle: nextEpisode?.title || "",
        nextEpisodeReleased: nextEpisode?.released || ""
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

    this.clearMountedExternalSubtitleTracks();

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
      const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || subtitleLabel(index);
      track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
      track.src = subtitle.url;
      track.default = false;
      track.setAttribute("data-addon-subtitle-id", subtitleId);
      video.appendChild(track);
      this.externalTrackNodes.push(track);
    });
  },
  moveControlFocus(delta) {
    const controls = this.getControlDefinitions();
    if (!controls.length) {
      return;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
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

    if (action === "playNextEpisode") {
      void this.playNextEpisode();
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
      this.stickyProgressFocus = false;
      this.moreActionsVisible = true;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(0, this.getControlDefinitions().findIndex((entry) => entry.action === "speed"));
      this.renderControlButtons();
      return;
    }

    if (action === "backFromMore") {
      this.stickyProgressFocus = false;
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
    if (this.pauseOverlayVisible) {
      this.dismissPauseOverlay({ revealControls: true, focus: false });
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      return true;
    }

    if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
      this.cancelSeekPreview({ commit: false });
      return true;
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      this.dismissNextEpisodeCard({ revealControls: true, armExitOnNextBack: true });
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

    if (this.controlsVisible && this.nextEpisodeBackExitArmed) {
      this.nextEpisodeBackExitArmed = false;
      return false;
    }

    if (this.controlsVisible) {
      this.setControlsVisible(false);
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (this.nextEpisodeBackExitArmed) {
      this.nextEpisodeBackExitArmed = false;
    }
    if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13) {
      event?.preventDefault?.();
    }
    const mediaAction = this.resolveMediaAction(event);
    if (this.pauseOverlayVisible) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (mediaAction === "play" || mediaAction === "toggle" || keyCode === 13) {
        this.dismissPauseOverlay();
        this.togglePause();
        this.renderControlButtons();
        return;
      }
      this.dismissPauseOverlay({ revealControls: true, focus: false });
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      return;
    }
    if (this.paused) {
      this.schedulePauseOverlay();
    }
    if (mediaAction) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.applyMediaAction(mediaAction);
      return;
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

    if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed) {
      if (keyCode === 13) {
        if (this.skipActiveInterval()) {
          return;
        }
      }
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      if (keyCode === 13) {
        await this.playNextEpisode();
        return;
      }
      if (keyCode === 38 || keyCode === 40) {
        this.setControlsVisible(true, { focus: true });
        return;
      }
    }

    if (!this.paused && this.controlsVisible && !this.isDialogOpen() && Boolean(event?.repeat) && (keyCode === 37 || keyCode === 39)) {
      this.focusProgressBar();
      this.beginSeekPreview(keyCode === 37 ? -1 : 1, true);
      return;
    }

    if (!this.controlsVisible) {
      if (keyCode === 37) {
        this.autoHideControlsAfterSeek = true;
        this.setControlsVisible(true, { focus: false });
        this.focusProgressBar();
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.autoHideControlsAfterSeek = true;
        this.setControlsVisible(true, { focus: false });
        this.focusProgressBar();
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (keyCode === 40) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (keyCode === 13) {
        this.autoHideControlsAfterSeek = false;
        this.cancelSeekPreview({ commit: true });
        this.setControlsVisible(true, { focus: true });
        this.togglePause();
        this.renderControlButtons();
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
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(false);
        return;
      }
      if (keyCode === 40) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
        this.renderControlButtons();
        return;
      }
      if (keyCode === 13) {
        this.autoHideControlsAfterSeek = false;
        this.togglePause();
        this.focusProgressBar();
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
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextEpisode?.videoId || itemType !== "series") {
      return;
    }

    try {
      const streamItems = await this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType);
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: nextEpisode.videoId,
        season: nextEpisode.season,
        episode: nextEpisode.episode,
        episodeLabel: nextEpisode.episodeLabel || null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
        playerEpisodeTitle: nextEpisode.episodeTitle || "",
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
    this.dismissPauseOverlay();
    this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
    this.streamCandidatesByVideoId?.clear?.();
    this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0) + 1;
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

    this.clearSubtitleCueStyleBindings();
    this.clearMountedExternalSubtitleTracks();

    this.clearControlsAutoHide();

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.stopSkipIntervalCheckTimer();

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
    this.clearMediaSessionHandlers();

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
