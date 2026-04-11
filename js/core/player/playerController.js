import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { Platform } from "../../platform/index.js";
import { WatchProgressSyncService } from "../profile/watchProgressSyncService.js";
import { nativeVideoEngine } from "./engines/nativeVideoEngine.js";
import { hlsJsEngine } from "./engines/hlsJsEngine.js";
import { dashJsEngine } from "./engines/dashJsEngine.js";
import { resolvePlatformAvplayEngine } from "./engines/platformAvplayEngine.js";
import { WebOsLunaService } from "../../platform/webos/webosLunaService.js";
import { loadStreamingLibs } from "../../runtime/loadStreamingLibs.js";

export const PlayerController = {

  video: null,
  isPlaying: false,
  currentItemId: null,
  currentItemType: null,
  currentVideoId: null,
  currentSeason: null,
  currentEpisode: null,
  progressSaveTimer: null,
  lastProgressPushAt: 0,
  lifecycleBound: false,
  lifecycleFlushHandler: null,
  visibilityFlushHandler: null,
  hlsInstance: null,
  dashInstance: null,
  playbackEngine: "none",
  avplayActive: false,
  avplayUrl: "",
  avplayAudioTracks: [],
  avplaySubtitleTracks: [],
  selectedAvPlayAudioTrackIndex: -1,
  selectedAvPlaySubtitleTrackIndex: -1,
  pendingAvPlayAudioTrackIndex: -1,
  avplayReady: false,
  avplayEnded: false,
  avplayCurrentTimeMs: 0,
  avplayDurationMs: 0,
  avplayTrackSyncAt: 0,
  lastPlaybackErrorCode: 0,
  currentPlaybackUrl: "",
  currentPlaybackHeaders: {},
  currentPlaybackMediaSourceType: null,
  avplayFallbackAttempts: new Set(),
  playbackEngineAttempts: new Map(),
  playRequestToken: 0,
  nativeMediaId: "",
  nativeMediaIdLookupToken: 0,
  selectedWebOsEmbeddedAudioTrackIndex: -1,
  selectedWebOsEmbeddedSubtitleTrackIndex: -1,
  webosDeviceInfoPromise: null,
  webosUnsupportedAudioCodecs: new Set(["dts", "truehd"]),
  viewportSyncHandler: null,

  isExpectedPlayInterruption(error) {
    const message = String(error?.message || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();
    if (name === "aborterror") {
      return true;
    }
    return message.includes("interrupted by a new load request")
      || message.includes("the play() request was interrupted");
  },

  normalizeMimeType(mimeType) {
    return String(mimeType || "").toLowerCase().split(";")[0].trim();
  },

  guessMediaMimeType(url) {
    const raw = String(url || "").trim();
    if (!raw) {
      return null;
    }

    const inferByPath = (pathname = "", search = null) => {
      const path = String(pathname || "").toLowerCase();
      const formatHint = String(
        search?.get?.("format")
        || search?.get?.("type")
        || search?.get?.("mime")
        || search?.get?.("output")
        || ""
      ).toLowerCase();
      if (path.endsWith(".m3u8")) {
        return "application/vnd.apple.mpegurl";
      }
      if (path.endsWith(".mpd")) {
        return "application/dash+xml";
      }
      if (path.includes(".ism/manifest") || path.includes(".isml/manifest")) {
        return "application/vnd.ms-sstr+xml";
      }
      if (formatHint === "m3u8" || formatHint === "hls") {
        return "application/vnd.apple.mpegurl";
      }
      if (formatHint === "mpd" || formatHint === "dash") {
        return "application/dash+xml";
      }
      if (path.includes("/playlist")) {
        return "application/vnd.apple.mpegurl";
      }
      const extensionMatch = path.match(/\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg|3gp|mp3|aac|flac)(?=($|[/?#&]))/i);
      if (extensionMatch) {
        const extension = String(extensionMatch[1] || "").toLowerCase();
        const directMimeMap = {
          "3gp": "video/3gpp",
          aac: "audio/aac",
          avi: "video/x-msvideo",
          flac: "audio/flac",
          m2ts: "video/mp2t",
          m4v: "video/mp4",
          mkv: "video/x-matroska",
          mov: "video/quicktime",
          mp3: "audio/mpeg",
          mp4: "video/mp4",
          mpeg: "video/mpeg",
          mpg: "video/mpeg",
          ts: "video/mp2t",
          webm: "video/webm",
          wmv: "video/x-ms-wmv"
        };
        return directMimeMap[extension] || null;
      }
      return null;
    };

    try {
      const parsed = new URL(raw);
      return inferByPath(parsed.pathname, parsed.searchParams);
    } catch (_) {
      return inferByPath(raw, null);
    }
  },

  isLikelyHlsMimeType(mimeType) {
    const normalized = this.normalizeMimeType(mimeType);
    return normalized === "application/vnd.apple.mpegurl"
      || normalized === "application/x-mpegurl"
      || normalized === "audio/mpegurl"
      || normalized === "audio/x-mpegurl";
  },

  isLikelyDashMimeType(mimeType) {
    return this.normalizeMimeType(mimeType) === "application/dash+xml";
  },

  isLikelySmoothStreamingMimeType(mimeType) {
    return this.normalizeMimeType(mimeType) === "application/vnd.ms-sstr+xml";
  },

  canUseHlsJs() {
    return hlsJsEngine.isSupported();
  },

  canUseDashJs() {
    return dashJsEngine.isSupported();
  },

  canPlayNatively(mimeType) {
    return nativeVideoEngine.canPlay(this.video, mimeType);
  },

  isUnsupportedSourceError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("no supported source")
      || message.includes("no supported sources")
      || message.includes("not supported");
  },

  getPlatformAvplayEngine() {
    return resolvePlatformAvplayEngine(Platform.getName());
  },

  getPlatformAvplayEngineName() {
    return this.getPlatformAvplayEngine().name;
  },

  getAvPlay() {
    return this.getPlatformAvplayEngine().getApi();
  },

  getAvPlayState() {
    if (!this.isUsingAvPlay()) {
      return "";
    }
    const avplay = this.getAvPlay();
    if (!avplay) {
      return "";
    }
    try {
      return String(avplay.getState?.() || "").trim().toUpperCase();
    } catch (_) {
      return "";
    }
  },

  canUseAvPlay() {
    return this.getPlatformAvplayEngine().isSupported();
  },

  isUsingNativePlayback() {
    return String(this.playbackEngine || "").startsWith("native");
  },

  refreshWebOsDeviceInfo() {
    if (!Platform.isWebOS()) {
      return Promise.resolve({
        unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
      });
    }
    if (this.webosDeviceInfoPromise) {
      return this.webosDeviceInfoPromise;
    }
    if (!WebOsLunaService.isAvailable()) {
      this.webosDeviceInfoPromise = Promise.resolve({
        unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
      });
      return this.webosDeviceInfoPromise;
    }

    this.webosDeviceInfoPromise = WebOsLunaService.request("luna://com.webos.service.config", {
      method: "getConfigs",
      parameters: {
        configNames: ["tv.model.edidType"]
      }
    }).then((result) => {
      const edidType = String(result?.configs?.["tv.model.edidType"] || "").toLowerCase();
      if (edidType.includes("dts")) {
        this.webosUnsupportedAudioCodecs.delete("dts");
      }
      if (edidType.includes("truehd")) {
        this.webosUnsupportedAudioCodecs.delete("truehd");
      }
      return {
        unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
      };
    }).catch(() => ({
      unsupportedAudioCodecs: this.getWebOsUnsupportedAudioCodecs()
    }));

    return this.webosDeviceInfoPromise;
  },

  getWebOsUnsupportedAudioCodecs() {
    return Array.from(this.webosUnsupportedAudioCodecs);
  },

  getWebOsUnsupportedAudioPenalty(text = "") {
    const normalizedText = String(text || "").toLowerCase();
    let penalty = 0;
    if (this.webosUnsupportedAudioCodecs.has("dts") && /\b(dts-hd|dts:x|dts)\b/.test(normalizedText)) {
      penalty -= 45;
    }
    if (this.webosUnsupportedAudioCodecs.has("truehd") && /\btruehd\b/.test(normalizedText)) {
      penalty -= 45;
    }
    return penalty;
  },

  isLikelyUnsupportedWebOsAudioTrackDescription(text = "") {
    return this.getWebOsUnsupportedAudioPenalty(text) < 0;
  },

  isLikelyDirectFileUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) {
      return false;
    }

    const probes = [raw];
    try {
      probes.push(decodeURIComponent(raw));
    } catch (_) {
      // Ignore decode failures.
    }

    return probes.some((value) => /\.(mkv|mp4|m4v|mov|webm|avi|wmv|ts|m2ts|mpg|mpeg|3gp)(?=($|[/?#&]))/i.test(String(value || "")));
  },

  isUsingAvPlay() {
    return String(this.playbackEngine || "").endsWith("avplay") && this.avplayActive;
  },

  emitVideoEvent(eventName, detail = null) {
    if (!this.video || !eventName) {
      return;
    }

    try {
      const event = typeof CustomEvent === "function"
        ? new CustomEvent(eventName, { detail: detail || null })
        : (() => {
          const legacyEvent = document.createEvent("CustomEvent");
          legacyEvent.initCustomEvent(eventName, false, false, detail || null);
          return legacyEvent;
        })();
      this.video.dispatchEvent(event);
    } catch (_) {
      // Ignore synthetic event failures.
    }
  },

  requestWebOsMediaCommand(method, parameters = {}) {
    if (!Platform.isWebOS() || !WebOsLunaService.isAvailable()) {
      return Promise.reject(new Error("webOS Luna media service unavailable"));
    }
    return WebOsLunaService.request("luna://com.webos.media", {
      method,
      parameters
    });
  },

  resetNativeMediaState() {
    this.nativeMediaId = "";
    this.nativeMediaIdLookupToken = Number(this.nativeMediaIdLookupToken || 0) + 1;
    this.selectedWebOsEmbeddedAudioTrackIndex = -1;
    this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
  },

  syncNativeMediaId() {
    const mediaId = String(this.video?.mediaId || "").trim();
    if (mediaId) {
      this.nativeMediaId = mediaId;
    }
    return this.nativeMediaId;
  },

  waitForNativeMediaId({ maxAttempts = 4, intervalMs = 300 } = {}) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return Promise.resolve(null);
    }

    const existingMediaId = this.syncNativeMediaId();
    if (existingMediaId) {
      return Promise.resolve(existingMediaId);
    }

    const lookupToken = Number(this.nativeMediaIdLookupToken || 0) + 1;
    this.nativeMediaIdLookupToken = lookupToken;

    return new Promise((resolve) => {
      let attempts = 0;
      const poll = () => {
        if (lookupToken !== this.nativeMediaIdLookupToken) {
          resolve(null);
          return;
        }
        const mediaId = this.syncNativeMediaId();
        if (mediaId || attempts >= maxAttempts) {
          resolve(mediaId || null);
          return;
        }
        attempts += 1;
        setTimeout(poll, intervalMs);
      };
      poll();
    });
  },

  refreshAvPlayTimeline(currentTimeMsFromCallback = null) {
    if (!this.isUsingAvPlay()) {
      return;
    }
    const avplay = this.getAvPlay();
    if (!avplay) {
      return;
    }
    if (currentTimeMsFromCallback !== null && Number.isFinite(currentTimeMsFromCallback) && currentTimeMsFromCallback >= 0) {
      this.avplayCurrentTimeMs = currentTimeMsFromCallback;
    } else {
      try {
        const currentMs = Number(avplay.getCurrentTime?.() || 0);
        if (Number.isFinite(currentMs) && currentMs >= 0) {
          this.avplayCurrentTimeMs = currentMs;
        }
      } catch (_) {
        // Ignore current-time polling failures.
      }
    }
    try {
      const durationMs = Number(avplay.getDuration?.() || 0);
      if (Number.isFinite(durationMs) && durationMs >= 0) {
        this.avplayDurationMs = durationMs;
      }
    } catch (_) {
      // Ignore duration polling failures.
    }
  },

  parseAvPlayExtraInfo(extraInfoValue) {
    if (!extraInfoValue) {
      return null;
    }
    if (typeof extraInfoValue === "object") {
      return extraInfoValue;
    }
    try {
      return JSON.parse(String(extraInfoValue));
    } catch (_) {
      return null;
    }
  },

  normalizeAvPlayTrackType(typeValue) {
    const type = String(typeValue || "").trim().toUpperCase();
    if (type === "AUDIO" || type === "TEXT" || type === "SUBTITLE" || type === "VIDEO") {
      return type;
    }
    if (type.includes("AUDIO")) {
      return "AUDIO";
    }
    if (type.includes("TEXT") || type.includes("SUBTITLE")) {
      return "TEXT";
    }
    if (type.includes("VIDEO")) {
      return "VIDEO";
    }
    return type;
  },

  pickAvPlayTrackLabel(track = {}, trackIndex = 0, prefix = "Track") {
    const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
    return String(
      track.name
      || track.label
      || extraInfo.name
      || extraInfo.label
      || extraInfo.track_lang
      || extraInfo.language
      || `${prefix} ${trackIndex + 1}`
    ).trim();
  },

  pickAvPlayTrackLanguage(track = {}) {
    const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
    return String(
      track.language
      || track.lang
      || extraInfo.track_lang
      || extraInfo.language
      || ""
    ).trim();
  },

  pickAvPlayExtraValue(extraInfo = {}, keys = []) {
    for (const key of keys) {
      const value = extraInfo?.[key];
      if (value === null || value === undefined) {
        continue;
      }
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
    return "";
  },

  syncAvPlayTrackInfo(options = {}) {
    if (!this.isUsingAvPlay()) {
      this.avplayAudioTracks = [];
      this.avplaySubtitleTracks = [];
      this.selectedAvPlayAudioTrackIndex = -1;
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.avplayTrackSyncAt = 0;
      return;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return;
    }

    const force = Boolean(options?.force);
    const now = Date.now();
    if (!force && (now - Number(this.avplayTrackSyncAt || 0)) < 220) {
      return;
    }
    this.avplayTrackSyncAt = now;

    const totalTracks = (() => {
      try {
        const value = avplay.getTotalTrackInfo?.();
        return Array.isArray(value) ? value : [];
      } catch (_) {
        return [];
      }
    })();

    const currentTracks = (() => {
      try {
        const value = avplay.getCurrentStreamInfo?.();
        return Array.isArray(value) ? value : [];
      } catch (_) {
        return [];
      }
    })();

    const currentAudio = currentTracks.find((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO");
    const currentText = currentTracks.find((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT");
    const selectedAudioIndex = Number(currentAudio?.index);
    const selectedTextIndex = Number(currentText?.index);

    this.avplayAudioTracks = totalTracks
      .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "AUDIO")
      .map((track, index) => {
        const trackIndex = Number(track?.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
        const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
        const forcedValue = this.pickAvPlayExtraValue(extraInfo, [
          "forced",
          "is_forced"
        ]);
        return {
          id: `avplay-audio-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Track"),
          language: this.pickAvPlayTrackLanguage(track),
          channels: this.pickAvPlayExtraValue(extraInfo, [
            "channels",
            "channel",
            "audio_channel",
            "audio_channel_count",
            "channel_layout"
          ]),
          codec: this.pickAvPlayExtraValue(extraInfo, [
            "codec",
            "audio_type",
            "audioType",
            "audioCodec",
            "fourCC"
          ]),
          characteristics: this.pickAvPlayExtraValue(extraInfo, [
            "characteristics",
            "role",
            "type"
          ]),
          forced: /^(1|true|yes)$/i.test(forcedValue),
          extraInfo,
          avplayTrackIndex: normalizedTrackIndex
        };
      });

    this.avplaySubtitleTracks = totalTracks
      .filter((track) => this.normalizeAvPlayTrackType(track?.type) === "TEXT")
      .map((track, index) => {
        const trackIndex = Number(track?.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
        return {
          id: `avplay-sub-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Subtitle"),
          language: this.pickAvPlayTrackLanguage(track),
          avplayTrackIndex: normalizedTrackIndex
        };
      });

    if (Number.isFinite(selectedAudioIndex)) {
      this.selectedAvPlayAudioTrackIndex = selectedAudioIndex;
      this.pendingAvPlayAudioTrackIndex = -1;
    } else if (Number.isFinite(this.pendingAvPlayAudioTrackIndex) && this.pendingAvPlayAudioTrackIndex >= 0) {
      this.selectedAvPlayAudioTrackIndex = this.pendingAvPlayAudioTrackIndex;
    } else if (this.avplayAudioTracks.length && this.selectedAvPlayAudioTrackIndex < 0) {
      this.selectedAvPlayAudioTrackIndex = this.avplayAudioTracks[0].avplayTrackIndex;
    } else if (!this.avplayAudioTracks.length) {
      this.selectedAvPlayAudioTrackIndex = -1;
    }

    if (Number.isFinite(selectedTextIndex)) {
      this.selectedAvPlaySubtitleTrackIndex = selectedTextIndex;
    } else if (!this.avplaySubtitleTracks.length) {
      this.selectedAvPlaySubtitleTrackIndex = -1;
    }
  },

  getAvPlayAudioTracks() {
    return this.avplayAudioTracks.slice();
  },

  getAvPlaySubtitleTracks() {
    return this.avplaySubtitleTracks.slice();
  },

  getSelectedAvPlayAudioTrackIndex() {
    return Number.isFinite(this.selectedAvPlayAudioTrackIndex) ? this.selectedAvPlayAudioTrackIndex : -1;
  },

  getSelectedAvPlaySubtitleTrackIndex() {
    return Number.isFinite(this.selectedAvPlaySubtitleTrackIndex) ? this.selectedAvPlaySubtitleTrackIndex : -1;
  },

  getSelectedWebOsEmbeddedAudioTrackIndex() {
    return Number.isFinite(this.selectedWebOsEmbeddedAudioTrackIndex)
      ? this.selectedWebOsEmbeddedAudioTrackIndex
      : -1;
  },

  getSelectedWebOsEmbeddedSubtitleTrackIndex() {
    return Number.isFinite(this.selectedWebOsEmbeddedSubtitleTrackIndex)
      ? this.selectedWebOsEmbeddedSubtitleTrackIndex
      : -1;
  },

  setAvPlayAudioTrack(trackIndex) {
    if (!this.isUsingAvPlay()) {
      return false;
    }
    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      return false;
    }

    const available = this.getAvPlayAudioTracks();
    if (!available.some((track) => Number(track?.avplayTrackIndex) === targetIndex)) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setSelectTrack !== "function") {
      return false;
    }

    const avplayState = this.getAvPlayState();
    if (avplayState === "PAUSED") {
      this.pendingAvPlayAudioTrackIndex = targetIndex;
      this.selectedAvPlayAudioTrackIndex = targetIndex;
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    }

    try {
      avplay.setSelectTrack("AUDIO", targetIndex);
      this.pendingAvPlayAudioTrackIndex = -1;
      this.selectedAvPlayAudioTrackIndex = targetIndex;
      this.syncAvPlayTrackInfo({ force: true });
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      setTimeout(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.syncAvPlayTrackInfo({ force: true });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      }, 400);
      return true;
    } catch (_) {
      return false;
    }
  },

  applyPendingAvPlayAudioTrackSelection() {
    const targetIndex = Number(this.pendingAvPlayAudioTrackIndex);
    if (!this.isUsingAvPlay() || !Number.isFinite(targetIndex) || targetIndex < 0) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setSelectTrack !== "function") {
      return false;
    }

    try {
      avplay.setSelectTrack("AUDIO", targetIndex);
      this.pendingAvPlayAudioTrackIndex = -1;
      this.selectedAvPlayAudioTrackIndex = targetIndex;
      this.syncAvPlayTrackInfo({ force: true });
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    } catch (_) {
      return false;
    }
  },

  setAvPlaySubtitleTrack(trackIndex) {
    if (!this.isUsingAvPlay()) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return false;
    }

    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      try {
        avplay.setSilentSubtitle?.(true);
      } catch (_) {
        // Ignore subtitle mute failures.
      }
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    }

    const available = this.getAvPlaySubtitleTracks();
    if (!available.some((track) => Number(track?.avplayTrackIndex) === targetIndex)) {
      return false;
    }

    try {
      avplay.setSilentSubtitle?.(false);
    } catch (_) {
      // Ignore subtitle unmute failures.
    }

    try {
      avplay.setSelectTrack?.("TEXT", targetIndex);
    } catch (_) {
      try {
        avplay.setSelectTrack?.("SUBTITLE", targetIndex);
      } catch (_) {
        return false;
      }
    }

    this.selectedAvPlaySubtitleTrackIndex = targetIndex;
    this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
    this.syncAvPlayTrackInfo({ force: true });
    this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
    return true;
  },

  setAvPlayExternalSubtitle(subtitleUrl) {
    if (!this.isUsingAvPlay()) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay || typeof avplay.setExternalSubtitlePath !== "function") {
      return false;
    }

    const path = String(subtitleUrl || "").trim();
    try {
      avplay.setExternalSubtitlePath(path);
      try {
        avplay.setSilentSubtitle?.(!path);
      } catch (_) {
        // Ignore subtitle mute/unmute failures.
      }
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    } catch (_) {
      return false;
    }
  },

  mapAvPlayErrorToMediaCode(errorValue) {
    const errorText = String(errorValue || "").toLowerCase();
    if (!errorText) {
      return 4;
    }
    if (errorText.includes("network") || errorText.includes("connection") || errorText.includes("timeout")) {
      return 2;
    }
    if (errorText.includes("decode")) {
      return 3;
    }
    return 4;
  },

  setAvPlayDisplayRect() {
    const avplay = this.getAvPlay();
    if (!avplay) {
      return;
    }
    const documentWidth = Number(document.documentElement?.clientWidth || 0);
    const documentHeight = Number(document.documentElement?.clientHeight || 0);
    const screenWidth = Number(globalThis.screen?.width || 0);
    const screenHeight = Number(globalThis.screen?.height || 0);
    const width = Math.max(1, Math.round(Math.max(Number(window.innerWidth || 0), documentWidth, screenWidth, 1920)));
    const height = Math.max(1, Math.round(Math.max(Number(window.innerHeight || 0), documentHeight, screenHeight, 1080)));
    try {
      avplay.setDisplayRect?.(0, 0, width, height);
    } catch (_) {
      // Ignore display-rect failures.
    }
    try {
      avplay.setDisplayMethod?.("PLAYER_DISPLAY_MODE_FULL_SCREEN");
    } catch (_) {
      // Ignore display-method failures.
    }
  },

  teardownAvPlay() {
    const avplay = this.getAvPlay();

    if (avplay) {
      try {
        avplay.setListener?.({});
      } catch (_) {
        // Ignore listener reset failures.
      }
      try {
        avplay.stop?.();
      } catch (_) {
        // Ignore stop failures.
      }
      try {
        avplay.close?.();
      } catch (_) {
        // Ignore close failures.
      }
    }

    const avplayObj = document.getElementById("avplayPlayer");
    if (avplayObj) {
      avplayObj.style.display = "none";
    }

    this.avplayActive = false;
    this.avplayUrl = "";
    this.avplayAudioTracks = [];
    this.avplaySubtitleTracks = [];
    this.selectedAvPlayAudioTrackIndex = -1;
    this.selectedAvPlaySubtitleTrackIndex = -1;
    this.pendingAvPlayAudioTrackIndex = -1;
    this.avplayReady = false;
    this.avplayEnded = false;
    this.avplayCurrentTimeMs = 0;
    this.avplayDurationMs = 0;
  },

  playWithAvPlay(url) {
    if (!this.canUseAvPlay()) {
      return false;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return false;
    }

    this.teardownAvPlay();

    this.avplayActive = true;
    this.avplayUrl = String(url || "");
    this.avplayReady = false;
    this.avplayEnded = false;
    this.avplayCurrentTimeMs = 0;
    this.avplayDurationMs = 0;
    this.lastPlaybackErrorCode = 0;
    this.playbackEngine = this.getPlatformAvplayEngineName();

    let avplayObj = document.getElementById("avplayPlayer");
    if (!avplayObj) {
      avplayObj = document.createElement("object");
      avplayObj.id = "avplayPlayer";
      avplayObj.type = "application/avplayer";
      avplayObj.style.position = "absolute";
      avplayObj.style.left = "0";
      avplayObj.style.top = "0";
      avplayObj.style.width = "100vw";
      avplayObj.style.height = "100vh";
      avplayObj.style.zIndex = "9999";
      document.body.appendChild(avplayObj);
    }
    avplayObj.style.display = "block";

    const videoEl = document.getElementById("videoPlayer");
    if (videoEl) {
      videoEl.style.display = "none";
    }

    this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });

    try {
      avplay.open(this.avplayUrl);
    } catch (error) {
      this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(error?.name || error?.message || error);
      this.teardownAvPlay();
      this.playbackEngine = "none";
      return false;
    }

    try {
      avplay.setListener?.({
        onbufferingstart: () => {
          this.avplayReady = false;
          this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
        },
        onbufferingcomplete: () => {
          this.avplayReady = true;
          this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
        },
        oncurrentplaytime: (currentTimeMs) => {
          const value = Number(currentTimeMs || 0);
          if (Number.isFinite(value) && value >= 0) {
            this.refreshAvPlayTimeline(value);
            this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine, currentTime: value / 1000 });
          }
        },
        onstreamcompleted: () => {
          this.avplayEnded = true;
          this.isPlaying = false;
          try {
            avplay.stop?.();
          } catch (_) {
            // Ignore stream-complete stop failures.
          }
          this.emitVideoEvent("ended", { playbackEngine: this.playbackEngine });
        },
        onerror: (errorValue) => {
          this.avplayReady = false;
          this.isPlaying = false;
          this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
          this.emitVideoEvent("error", {
            playbackEngine: this.playbackEngine,
            mediaErrorCode: this.lastPlaybackErrorCode,
            avplayError: String(errorValue || "")
          });
        }
      });
    } catch (_) {
      // Ignore listener setup failures; prepareAsync/play may still work.
    }

    this.setAvPlayDisplayRect();

    const onPrepared = () => {
      if (!this.isUsingAvPlay()) {
        return;
      }
      this.avplayReady = true;
      this.avplayEnded = false;
      this.refreshAvPlayTimeline();
      this.syncAvPlayTrackInfo({ force: true });
      this.emitVideoEvent("loadedmetadata", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("loadeddata", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      try {
        avplay.play?.();
        this.isPlaying = true;
        this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
        setTimeout(() => {
          this.applyPendingAvPlayAudioTrackSelection();
        }, 0);
        setTimeout(() => {
          if (!this.isUsingAvPlay()) {
            return;
          }
          this.applyPendingAvPlayAudioTrackSelection();
          this.syncAvPlayTrackInfo({ force: true });
          this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        }, 500);
      } catch (error) {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(error?.name || error?.message || error);
        this.isPlaying = false;
        this.emitVideoEvent("error", {
          playbackEngine: this.playbackEngine,
          mediaErrorCode: this.lastPlaybackErrorCode
        });
      }
    };

    const onPrepareError = (errorValue) => {
      this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
      this.isPlaying = false;
      this.teardownAvPlay();
      this.playbackEngine = "none";
      this.emitVideoEvent("error", {
        playbackEngine: this.getPlatformAvplayEngineName(),
        mediaErrorCode: this.lastPlaybackErrorCode,
        avplayError: String(errorValue || "")
      });
    };

    try {
      if (typeof avplay.prepareAsync === "function") {
        avplay.prepareAsync(onPrepared, onPrepareError);
      } else if (typeof avplay.prepare === "function") {
        avplay.prepare();
        onPrepared();
      } else {
        onPrepareError("prepare_not_supported");
      }
    } catch (error) {
      onPrepareError(error?.name || error?.message || error);
    }

    return true;
  },

  getCurrentTimeSeconds() {
    if (this.isUsingAvPlay()) {
      this.refreshAvPlayTimeline();
      return Math.max(0, Number(this.avplayCurrentTimeMs || 0) / 1000);
    }
    return Math.max(0, Number(this.video?.currentTime || 0));
  },

  getDurationSeconds() {
    if (this.isUsingAvPlay()) {
      this.refreshAvPlayTimeline();
      return Math.max(0, Number(this.avplayDurationMs || 0) / 1000);
    }
    return Math.max(0, Number(this.video?.duration || 0));
  },

  seekToSeconds(targetSeconds) {
    const seconds = Number(targetSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return false;
    }

    if (!this.isUsingAvPlay()) {
      if (!this.video) {
        return false;
      }
      this.video.currentTime = seconds;
      return true;
    }

    const avplay = this.getAvPlay();
    if (!avplay) {
      return false;
    }

    const targetMs = Math.max(0, Math.floor(seconds * 1000));
    try {
      this.avplayReady = false;
      this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
      this.emitVideoEvent("seeking", { playbackEngine: this.playbackEngine });
      if (typeof avplay.seekTo === "function") {
        avplay.seekTo(targetMs);
      } else {
        const currentMs = Number(avplay.getCurrentTime?.() || 0);
        if (targetMs > currentMs) {
          avplay.jumpForward?.(targetMs - currentMs);
        } else if (targetMs < currentMs) {
          avplay.jumpBackward?.(currentMs - targetMs);
        }
      }
      this.avplayCurrentTimeMs = targetMs;
      this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
      setTimeout(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.refreshAvPlayTimeline();
        this.avplayReady = true;
        this.emitVideoEvent("seeked", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
      }, 120);
      return true;
    } catch (_) {
      return false;
    }
  },

  isPlaybackEnded() {
    if (this.isUsingAvPlay()) {
      return Boolean(this.avplayEnded);
    }
    return Boolean(this.video?.ended);
  },

  getPlaybackReadyState() {
    if (this.isUsingAvPlay()) {
      return this.avplayReady ? 4 : 1;
    }
    return Number(this.video?.readyState || 0);
  },

  getLastPlaybackErrorCode() {
    return Number(this.lastPlaybackErrorCode || 0);
  },

  forceAvPlayFallbackForCurrentSource(reason = "fallback") {
    const url = String(this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || "").trim();
    if (!url || this.avplayFallbackAttempts.has(url) || !this.canUseAvPlay()) {
      return false;
    }

    this.avplayFallbackAttempts.add(url);
    console.warn("Forcing AVPlay fallback:", { reason, url });
    this.play(url, {
      itemId: this.currentItemId,
      itemType: this.currentItemType || "movie",
      videoId: this.currentVideoId,
      season: this.currentSeason,
      episode: this.currentEpisode,
      requestHeaders: { ...(this.currentPlaybackHeaders || {}) },
      mediaSourceType: this.currentPlaybackMediaSourceType || null,
      forceEngine: this.getPlatformAvplayEngineName()
    });
    return true;
  },

  getAttemptedPlaybackEngines(url = this.currentPlaybackUrl) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return new Set();
    }
    return new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
  },

  rememberPlaybackEngineAttempt(url, engineName, { reset = false } = {}) {
    const normalizedUrl = String(url || "").trim();
    const normalizedEngine = String(engineName || "").trim();
    if (!normalizedUrl || !normalizedEngine) {
      return;
    }
    const nextSet = reset
      ? new Set()
      : new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
    nextSet.add(normalizedEngine);
    this.playbackEngineAttempts.set(normalizedUrl, nextSet);
  },

  clearPlaybackEngineAttempts(url = null) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      this.playbackEngineAttempts.clear();
      return;
    }
    this.playbackEngineAttempts.delete(normalizedUrl);
  },

  isLivePlaybackItemType(itemType = this.currentItemType) {
    const normalized = String(itemType || "").trim().toLowerCase();
    return normalized === "channel"
      || normalized === "live"
      || normalized === "tvchannel"
      || normalized === "stream";
  },

  getPlaybackEngineCandidates(url, sourceType = null, itemType = this.currentItemType) {
    const normalizedSourceType = String(sourceType || this.guessMediaMimeType(url) || "").trim();
    const avplayEngine = this.getPlatformAvplayEngineName();
    const isTizenRuntime = Platform.isTizen();
    const isLivePlayback = this.isLivePlaybackItemType(itemType);
    const canUseAvPlay = this.canUseAvPlay();
    const canUseHlsJs = this.canUseHlsJs();
    const canUseDashJs = this.canUseDashJs();
    const canPlayNativeHls = this.canPlayNatively("application/vnd.apple.mpegurl");
    const canPlayNativeDash = this.canPlayNatively("application/dash+xml");
    const canPlayNativeSmooth = this.canPlayNatively("application/vnd.ms-sstr+xml");
    const pushCandidate = (target, candidate) => {
      const normalized = String(candidate || "").trim();
      if (!normalized || target.includes(normalized)) {
        return;
      }
      target.push(normalized);
    };

    if (this.isLikelyHlsMimeType(normalizedSourceType)) {
      const candidates = [];
      if (isLivePlayback && canUseHlsJs) {
        pushCandidate(candidates, "hls.js");
      }
      if (isTizenRuntime && canUseHlsJs) {
        pushCandidate(candidates, "hls.js");
      }
      if (canPlayNativeHls) {
        pushCandidate(candidates, "native-hls");
      }
      if (!isTizenRuntime && canUseHlsJs) {
        pushCandidate(candidates, "hls.js");
      }
      if (canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      return candidates;
    }

    if (this.isLikelyDashMimeType(normalizedSourceType)) {
      const candidates = [];
      if (isLivePlayback && canUseDashJs) {
        pushCandidate(candidates, "dash.js");
      }
      if (isTizenRuntime && canUseDashJs) {
        pushCandidate(candidates, "dash.js");
      }
      if (Platform.isWebOS() && canPlayNativeDash) {
        pushCandidate(candidates, "native-dash");
      }
      if (!isTizenRuntime && canUseDashJs) {
        pushCandidate(candidates, "dash.js");
      }
      if (canPlayNativeDash) {
        pushCandidate(candidates, "native-dash");
      }
      if (canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      return candidates;
    }

    if (this.isLikelySmoothStreamingMimeType(normalizedSourceType)) {
      const candidates = [];
      if (canPlayNativeSmooth) {
        pushCandidate(candidates, "native-file");
      }
      if (canUseAvPlay) {
        pushCandidate(candidates, avplayEngine);
      }
      return candidates;
    }

    const candidates = [];
    if (isTizenRuntime) {
      pushCandidate(candidates, "native-file");
    }
    pushCandidate(candidates, "native-file");
    if (!isTizenRuntime && canUseAvPlay) {
      pushCandidate(candidates, avplayEngine);
    }
    if (isTizenRuntime && canUseAvPlay) {
      pushCandidate(candidates, avplayEngine);
    }
    return candidates;
  },

  getAlternativePlaybackEngine(url = this.currentPlaybackUrl, sourceType = this.currentPlaybackMediaSourceType, itemType = this.currentItemType) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return null;
    }
    const attemptedEngines = this.getAttemptedPlaybackEngines(normalizedUrl);
    const currentEngine = String(this.playbackEngine || "").trim();
    const candidates = this.getPlaybackEngineCandidates(normalizedUrl, sourceType, itemType);
    return candidates.find((candidate) => candidate !== currentEngine && !attemptedEngines.has(candidate)) || null;
  },

  getPlaybackCapabilities() {
    const supports = (mimeType) => this.canPlayNatively(mimeType);
    const capabilities = {
      avplay: this.canUseAvPlay(),
      hls: supports("application/vnd.apple.mpegurl"),
      dash: supports("application/dash+xml"),
      smoothStreaming: supports("application/vnd.ms-sstr+xml"),
      mp4: supports("video/mp4"),
      mp4H264: supports('video/mp4; codecs="avc1.4d401f,mp4a.40.2"'),
      mp4Hevc: supports('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
      mp4HevcMain10: supports('video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.2.4.L153.B0,mp4a.40.2"'),
      mp4Av1: supports('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'),
      webmVp9: supports('video/webm; codecs="vp9,opus"'),
      webm: supports("video/webm"),
      mkvH264: supports('video/x-matroska; codecs="avc1.4d401f,mp4a.40.2"') || supports("video/x-matroska"),
      quicktime: supports("video/quicktime"),
      mpegTs: supports("video/mp2t"),
      audioAac: supports('audio/mp4; codecs="mp4a.40.2"'),
      audioMp3: supports("audio/mpeg"),
      audioFlac: supports("audio/flac"),
      audioAc3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
      audioEac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
      dolbyVision: supports('video/mp4; codecs="dvh1.05.06,ec-3"') || supports('video/mp4; codecs="dvhe.05.06,ec-3"')
    };
    capabilities.hdrLikely = capabilities.mp4HevcMain10 || capabilities.mp4Av1;
    capabilities.atmosLikely = capabilities.audioEac3;
    return capabilities;
  },

  teardownHlsInstance() {
    if (!this.hlsInstance) {
      return;
    }
    try {
      this.hlsInstance.destroy();
    } catch (_) {
      // Ignore HLS cleanup failures.
    }
    this.hlsInstance = null;
  },

  teardownDashInstance() {
    if (!this.dashInstance) {
      return;
    }
    try {
      this.dashInstance.reset?.();
    } catch (_) {
      // Ignore DASH cleanup failures.
    }
    this.dashInstance = null;
  },

  teardownAdaptiveInstances() {
    this.teardownHlsInstance();
    this.teardownDashInstance();
    if (!this.isUsingAvPlay()) {
      this.playbackEngine = "none";
    }
  },

  applyNativeSource(url, mimeType = null, engineName = "native-file") {
    const avplayObj = document.getElementById("avplayPlayer");
    if (avplayObj) {
      avplayObj.style.display = "none";
    }
    const videoEl = document.getElementById("videoPlayer");
    if (videoEl) {
      videoEl.style.display = "block";
    }
    if (!nativeVideoEngine.load(this.video, url, mimeType)) {
      return false;
    }
    this.playbackEngine = String(engineName || "native-file");
    return true;
  },

  shouldForwardHeaderToHls(name) {
    const lower = String(name || "").trim().toLowerCase();
    if (!lower) {
      return false;
    }
    if (lower === "range") {
      return false;
    }
    if (lower.startsWith("sec-")) {
      return false;
    }
    const forbidden = new Set([
      "host",
      "origin",
      "referer",
      "referrer",
      "user-agent",
      "content-length",
      "accept-encoding",
      "connection",
      "cookie"
    ]);
    return !forbidden.has(lower);
  },

  normalizePlaybackHeaders(headers) {
    if (!headers || typeof headers !== "object") {
      return {};
    }
    const entries = Object.entries(headers)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key, value]) => key && value)
      .filter(([key]) => this.shouldForwardHeaderToHls(key));
    return Object.fromEntries(entries);
  },

  buildHlsConfig(requestHeaders = {}) {
    const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
    const isWebOs = Platform.isWebOS();
    return {
      enableWorker: !isWebOs,
      lowLatencyMode: false,
      backBufferLength: isWebOs ? 30 : 90,
      maxBufferLength: isWebOs ? 18 : 30,
      maxMaxBufferLength: isWebOs ? 24 : 60,
      maxBufferHole: 0.5,
      startFragPrefetch: false,
      fragLoadingTimeOut: isWebOs ? 18000 : 20000,
      manifestLoadingTimeOut: isWebOs ? 18000 : 20000,
      xhrSetup: (xhr) => {
        Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
          try {
            xhr.setRequestHeader(headerName, headerValue);
          } catch (_) {
            // Ignore forbidden/unsupported browser headers.
          }
        });
      },
      fetchSetup: (context, initParams = {}) => {
        const headers = new Headers(initParams.headers || {});
        Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
          try {
            headers.set(headerName, headerValue);
          } catch (_) {
            // Ignore forbidden/unsupported browser headers.
          }
        });
        return new Request(context.url, {
          ...initParams,
          headers
        });
      }
    };
  },

  playWithHlsJs(url, requestHeaders = {}) {
    if (!this.video || !this.canUseHlsJs()) {
      return false;
    }

    const Hls = hlsJsEngine.getConstructor();
    if (!Hls) {
      return false;
    }
    this.teardownHlsInstance();
    this.teardownDashInstance();
    const hls = hlsJsEngine.create(this.buildHlsConfig(requestHeaders));
    if (!hls) {
      return false;
    }
    this.hlsInstance = hls;
    this.playbackEngine = "hls.js";
    let networkRecoveryAttempts = 0;
    let mediaRecoveryAttempts = 0;

    hls.on(Hls.Events.ERROR, (_, data = {}) => {
      if (!data?.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (networkRecoveryAttempts >= 1) {
          this.lastPlaybackErrorCode = 2;
          this.teardownHlsInstance();
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 2,
            hlsErrorType: String(data.type || ""),
            hlsErrorDetails: String(data.details || "")
          });
          return;
        }
        try {
          networkRecoveryAttempts += 1;
          hls.startLoad();
          return;
        } catch (_) {
          // Fall through and destroy on unrecoverable load errors.
        }
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRecoveryAttempts >= 1) {
          this.lastPlaybackErrorCode = 3;
          this.teardownHlsInstance();
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 3,
            hlsErrorType: String(data.type || ""),
            hlsErrorDetails: String(data.details || "")
          });
          return;
        }
        try {
          mediaRecoveryAttempts += 1;
          hls.recoverMediaError();
          return;
        } catch (_) {
          // Fall through and destroy on unrecoverable media errors.
        }
      }
      this.lastPlaybackErrorCode = 4;
      this.teardownHlsInstance();
      this.emitVideoEvent("error", {
        playbackEngine: "hls.js",
        mediaErrorCode: 4,
        hlsErrorType: String(data.type || ""),
        hlsErrorDetails: String(data.details || "")
      });
    });

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      try {
        hls.loadSource(url);
      } catch (error) {
        console.warn("HLS source attach failed", error);
        this.lastPlaybackErrorCode = 4;
        this.emitVideoEvent("error", {
          playbackEngine: "hls.js",
          mediaErrorCode: 4,
          hlsErrorType: "attach",
          hlsErrorDetails: String(error?.message || error || "")
        });
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("HLS playback start rejected", error);
        });
      }
    });

    this.video.removeAttribute("src");
    hls.attachMedia(this.video);
    return true;
  },

  playWithDashJs(url) {
    if (!this.video || !this.canUseDashJs()) {
      return false;
    }

    this.teardownDashInstance();
    this.teardownHlsInstance();

    let player = null;
    try {
      player = dashJsEngine.createPlayer();
      if (!player) {
        return false;
      }
      const isWebOs = Platform.isWebOS();
      player.updateSettings?.({
        streaming: {
          fastSwitchEnabled: !isWebOs,
          lowLatencyEnabled: false,
          scheduleWhilePaused: false,
          bufferToKeep: isWebOs ? 8 : 20,
          bufferPruningInterval: isWebOs ? 10 : 20,
          stableBufferTime: isWebOs ? 8 : 12
        }
      });
      player.initialize(this.video, url, true);
      const dashEvents = dashJsEngine.getEvents();
      const emitTracksChanged = () => {
        this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      };
      const emitDashError = (event = {}) => {
        const errorText = String(
          event?.error?.message
          || event?.event?.message
          || event?.message
          || ""
        ).toLowerCase();
        let mediaErrorCode = 4;
        if (errorText.includes("network") || errorText.includes("download") || errorText.includes("manifest")) {
          mediaErrorCode = 2;
        } else if (errorText.includes("decode") || errorText.includes("mediasource") || errorText.includes("append")) {
          mediaErrorCode = 3;
        }
        this.lastPlaybackErrorCode = mediaErrorCode;
        this.emitVideoEvent("error", {
          playbackEngine: "dash.js",
          mediaErrorCode,
          dashError: String(event?.error?.message || event?.message || "")
        });
      };
      try {
        player.on?.(dashEvents.STREAM_INITIALIZED, emitTracksChanged);
        player.on?.(dashEvents.TRACK_CHANGE_RENDERED, emitTracksChanged);
        player.on?.(dashEvents.TEXT_TRACKS_ADDED, emitTracksChanged);
        player.on?.(dashEvents.PERIOD_SWITCH_COMPLETED, emitTracksChanged);
        if (dashEvents.ERROR) {
          player.on?.(dashEvents.ERROR, emitDashError);
        }
        if (dashEvents.PLAYBACK_ERROR) {
          player.on?.(dashEvents.PLAYBACK_ERROR, emitDashError);
        }
      } catch (_) {
        // Ignore dash event binding issues.
      }
      this.dashInstance = player;
      this.playbackEngine = "dash.js";
      return true;
    } catch (error) {
      console.warn("DASH source attach failed", error);
      try {
        player?.reset?.();
      } catch (_) {
        // Ignore reset failures on partial init.
      }
      this.dashInstance = null;
      this.lastPlaybackErrorCode = 4;
      this.emitVideoEvent("error", {
        playbackEngine: "dash.js",
        mediaErrorCode: 4,
        dashError: String(error?.message || error || "")
      });
      return false;
    }
  },

  getDashAudioTracks() {
    const tracks = this.dashInstance?.getTracksFor?.("audio");
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.filter(Boolean).map((track, index) => ({
      id: String(track?.id ?? `dash-audio-${index}`),
      index,
      label: String(track?.labels?.[0]?.text || track?.lang || `Track ${index + 1}`),
      language: String(track?.lang || ""),
      raw: track
    }));
  },

  getSelectedDashAudioTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("audio");
    const tracks = this.getDashAudioTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex((track) => String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang);
  },

  setDashAudioTrack(index) {
    const targetIndex = Number(index);
    const tracks = this.getDashAudioTracks();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }
    const target = tracks[targetIndex]?.raw || null;
    if (!target || typeof this.dashInstance?.setCurrentTrack !== "function") {
      return false;
    }
    try {
      this.dashInstance.setCurrentTrack(target);
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getDashTextTracks() {
    const tracks = this.dashInstance?.getTracksFor?.("text");
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.filter(Boolean).map((track, index) => ({
      id: String(track?.id ?? `dash-text-${index}`),
      index,
      textTrackIndex: Number(track?.index),
      label: String(track?.labels?.[0]?.text || track?.lang || `Subtitle ${index + 1}`),
      language: String(track?.lang || ""),
      raw: track
    }));
  },

  getSelectedDashTextTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("text");
    const tracks = this.getDashTextTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex((track) => String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang);
  },

  setDashTextTrack(index) {
    const targetIndex = Number(index);
    const player = this.dashInstance;
    if (!player) {
      return false;
    }

    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      try {
        player.setTextTrack?.(-1);
      } catch (_) {
        // Ignore disable-text failures.
      }
      try {
        player.enableText?.(false);
      } catch (_) {
        // Ignore text disable fallback failures.
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    }

    const tracks = this.getDashTextTracks();
    if (targetIndex >= tracks.length) {
      return false;
    }

    const target = tracks[targetIndex] || null;
    try {
      player.enableText?.(true);
    } catch (_) {
      // Ignore text enable failures.
    }
    try {
      if (Number.isFinite(target?.textTrackIndex) && typeof player.setTextTrack === "function") {
        player.setTextTrack(target.textTrackIndex);
      } else if (target?.raw && typeof player.setCurrentTrack === "function") {
        player.setCurrentTrack(target.raw);
      } else {
        return false;
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getHlsAudioTracks() {
    return hlsJsEngine.getAudioTracks(this.hlsInstance);
  },

  getSelectedHlsAudioTrackIndex() {
    return hlsJsEngine.getSelectedAudioTrackIndex(this.hlsInstance);
  },

  setHlsAudioTrack(index) {
    return hlsJsEngine.setAudioTrack(this.hlsInstance, index);
  },

  setNativeAudioTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const audioTrackList = this.video.audioTracks || this.video.webkitAudioTracks || this.video.mozAudioTracks || null;
    let tracks = [];
    if (audioTrackList) {
      try {
        tracks = Array.from(audioTrackList).filter(Boolean);
      } catch (_) {
        const trackCount = Number(audioTrackList.length || 0);
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          const track = audioTrackList[trackIndex] || audioTrackList.item?.(trackIndex) || null;
          if (track) {
            tracks.push(track);
          }
        }
      }
    }
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }

    this.selectedWebOsEmbeddedAudioTrackIndex = -1;

    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      this.requestWebOsMediaCommand("selectTrack", {
        type: "audio",
        mediaId,
        index: targetIndex
      }).catch(() => {
        // Ignore Luna audio track selection failures and keep native toggles.
      });
    }

    tracks.forEach((track, trackIndex) => {
      const selected = trackIndex === targetIndex;
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
    return true;
  },

  setWebOsEmbeddedAudioTrack(trackIndex) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return false;
    }

    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      this.selectedWebOsEmbeddedAudioTrackIndex = -1;
      return false;
    }

    const applySelection = (mediaId) => {
      if (!mediaId) {
        return;
      }

      this.requestWebOsMediaCommand("selectTrack", {
        type: "audio",
        mediaId,
        index: targetIndex
      }).catch(() => {
        // Ignore Luna audio track selection failures.
      });

      const audioTrackList = this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks || null;
      if (!audioTrackList) {
        return;
      }

      let tracks = [];
      try {
        tracks = Array.from(audioTrackList).filter(Boolean);
      } catch (_) {
        const trackCount = Number(audioTrackList.length || 0);
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          const track = audioTrackList[trackIndex] || audioTrackList.item?.(trackIndex) || null;
          if (track) {
            tracks.push(track);
          }
        }
      }

      tracks.forEach((track, trackListIndex) => {
        const selected = trackListIndex === targetIndex;
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
    };

    this.selectedWebOsEmbeddedAudioTrackIndex = targetIndex;

    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      applySelection(mediaId);
      return true;
    }

    this.waitForNativeMediaId().then((resolvedMediaId) => {
      if (Number(this.selectedWebOsEmbeddedAudioTrackIndex) !== targetIndex) {
        return;
      }
      applySelection(resolvedMediaId);
    }).catch(() => {
      // Ignore media-id lookup failures.
    });

    return true;
  },

  setNativeTextTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const textTrackList = this.video.textTracks || this.video.webkitTextTracks || this.video.mozTextTracks || null;
    let tracks = [];
    if (textTrackList) {
      try {
        tracks = Array.from(textTrackList).filter(Boolean);
      } catch (_) {
        const trackCount = Number(textTrackList.length || 0);
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          const track = textTrackList[trackIndex] || textTrackList.item?.(trackIndex) || null;
          if (track) {
            tracks.push(track);
          }
        }
      }
    }
    if (!Number.isFinite(targetIndex) || targetIndex < -1 || targetIndex >= tracks.length) {
      return false;
    }

    this.selectedWebOsEmbeddedSubtitleTrackIndex = -1;

    const mediaId = this.syncNativeMediaId();
    if (mediaId && Platform.isWebOS()) {
      if (targetIndex < 0) {
        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: false
        }).catch(() => {
          // Ignore Luna subtitle disable failures and keep native toggles.
        });
      } else {
        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: true
        }).catch(() => {
          // Ignore Luna subtitle enable failures and keep native toggles.
        });
        setTimeout(() => {
          if (mediaId !== this.nativeMediaId) {
            return;
          }
          this.requestWebOsMediaCommand("selectTrack", {
            type: "text",
            mediaId,
            index: targetIndex
          }).catch(() => {
            // Ignore Luna subtitle track selection failures and keep native toggles.
          });
        }, 350);
      }
    }

    tracks.forEach((track, trackIndex) => {
      try {
        track.mode = targetIndex >= 0 && trackIndex === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort.
      }
    });

    return true;
  },

  setWebOsEmbeddedSubtitleTrack(trackIndex) {
    if (!Platform.isWebOS() || !this.video || !this.isUsingNativePlayback()) {
      return false;
    }

    const targetIndex = Number(trackIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < -1) {
      return false;
    }

    const applySelection = (mediaId) => {
      if (!mediaId) {
        return;
      }

      if (targetIndex < 0) {
        this.requestWebOsMediaCommand("setSubtitleEnable", {
          mediaId,
          enable: false
        }).catch(() => {
          // Ignore Luna subtitle disable failures.
        });
        return;
      }

      this.requestWebOsMediaCommand("setSubtitleEnable", {
        mediaId,
        enable: true
      }).catch(() => {
        // Ignore Luna subtitle enable failures.
      });

      setTimeout(() => {
        if (Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== targetIndex) {
          return;
        }
        if (this.nativeMediaId && mediaId !== this.nativeMediaId) {
          return;
        }
        this.requestWebOsMediaCommand("selectTrack", {
          type: "text",
          mediaId,
          index: targetIndex
        }).catch(() => {
          // Ignore Luna subtitle track selection failures.
        });
      }, 350);
    };

    this.selectedWebOsEmbeddedSubtitleTrackIndex = targetIndex;

    const mediaId = this.syncNativeMediaId();
    if (mediaId) {
      applySelection(mediaId);
      return true;
    }

    this.waitForNativeMediaId().then((resolvedMediaId) => {
      if (Number(this.selectedWebOsEmbeddedSubtitleTrackIndex) !== targetIndex) {
        return;
      }
      applySelection(resolvedMediaId);
    }).catch(() => {
      // Ignore media-id lookup failures.
    });

    return true;
  },

  attemptVideoPlay({ warningLabel = "Playback start rejected", onRejected = null, beforePlay = null, playToken = null } = {}) {
    if (!this.video) {
      return;
    }
    Promise.resolve()
      .then(() => beforePlay?.())
      .then(() => {
        if (playToken !== null && playToken !== this.playRequestToken) {
          return null;
        }
        return this.video.play();
      })
      .then((playPromise) => {
        if (!playPromise || typeof playPromise.catch !== "function") {
          return null;
        }
        return playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return null;
          }
          if (typeof onRejected === "function") {
            try {
              const handled = onRejected(error);
              if (handled) {
                return null;
              }
            } catch (_) {
              // Ignore rejection handler failures and continue to warning output.
            }
          }
          this.isPlaying = false;
          console.warn(warningLabel, error);
          return null;
        });
      })
      .catch((error) => {
        if (this.isExpectedPlayInterruption(error)) {
          return;
        }
        this.isPlaying = false;
        console.warn(warningLabel, error);
      });
  },

  choosePlaybackEngine(url, sourceType, itemType = this.currentItemType) {
    const candidates = this.getPlaybackEngineCandidates(url, sourceType, itemType);
    if (candidates.length) {
      return candidates[0];
    }
    if (this.canUseAvPlay()) {
      return this.getPlatformAvplayEngineName();
    }
    return "native-file";
  },

  async ensureAdaptiveLibrariesForSource(sourceType) {
    const normalizedSourceType = String(sourceType || "").trim();
    if (!normalizedSourceType) {
      return;
    }
    if (this.isLikelyHlsMimeType(normalizedSourceType) || this.isLikelyDashMimeType(normalizedSourceType)) {
      await loadStreamingLibs();
    }
  },

  init() {
    this.video = document.getElementById("videoPlayer");
    Platform.prepareVideoElement(this.video);
    this.video.muted = false;
    this.video.defaultMuted = false;
    this.video.volume = 1;
    this.refreshWebOsDeviceInfo();
    if (!this.viewportSyncHandler) {
      this.viewportSyncHandler = () => {
        if (this.isUsingAvPlay()) {
          this.setAvPlayDisplayRect();
        }
      };
      window.addEventListener("resize", this.viewportSyncHandler);
    }

    this.video.addEventListener("ended", () => {
      this.isPlaying = false;
      const context = this.createProgressContext();
      const durationMs = Math.floor(this.getDurationSeconds() * 1000);
      const completedMs = durationMs > 0
        ? durationMs
        : Math.floor(this.getCurrentTimeSeconds() * 1000);
      this.flushProgress(completedMs, durationMs > 0 ? durationMs : completedMs, false, context);
    });

    this.video.addEventListener("error", (e) => {
      const customErrorCode = Number(e?.detail?.mediaErrorCode || 0);
      const nativeErrorCode = Number(this.video?.error?.code || 0);
      const mediaErrorCode = customErrorCode || nativeErrorCode || this.getLastPlaybackErrorCode();
      console.error("Video error:", {
        event: e?.type || "error",
        mediaErrorCode,
        avplayError: e?.detail?.avplayError || "",
        currentSrc: this.video?.currentSrc || this.video?.src || "",
        playbackEngine: this.playbackEngine
      });
    });

    const syncNativeMediaId = () => {
      this.syncNativeMediaId();
    };
    this.video.addEventListener("loadedmetadata", syncNativeMediaId);
    this.video.addEventListener("loadeddata", syncNativeMediaId);
    this.video.addEventListener("canplay", syncNativeMediaId);
    this.video.addEventListener("playing", syncNativeMediaId);
    this.video.addEventListener("emptied", () => {
      this.resetNativeMediaState();
    });

    this.video.addEventListener("playing", () => {
      const audioTrackList = this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
      const audioTrackCount = Number(audioTrackList?.length || 0);
      const probeUrl = String(this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || "").trim();
      const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
      if (
        this.isUsingNativePlayback()
        && isDirectFile
        && audioTrackCount <= 0
        && Platform.isWebOS()
        && this.canUseAvPlay()
      ) {
        this.forceAvPlayFallbackForCurrentSource("native_playing_no_audio_tracks");
      }
    });

    this.video.addEventListener("loadedmetadata", () => {
      const audioTrackList = this.video?.audioTracks || this.video?.webkitAudioTracks || this.video?.mozAudioTracks;
      const textTrackList = this.video?.textTracks || this.video?.webkitTextTracks || this.video?.mozTextTracks;
      const audioTrackCount = Number(audioTrackList?.length || 0);
      const textTrackCount = Number(textTrackList?.length || 0);
      const probeUrl = String(this.currentPlaybackUrl || this.video?.currentSrc || this.video?.src || "").trim();
      const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
      const fallbackTried = this.avplayFallbackAttempts.has(probeUrl);
      if (
        this.isUsingNativePlayback()
        && isDirectFile
        && audioTrackCount <= 0
        && Platform.isWebOS()
        && this.canUseAvPlay()
      ) {
        this.forceAvPlayFallbackForCurrentSource("native_no_audio_tracks");
      }
    });

    if (!this.lifecycleBound) {
      this.lifecycleBound = true;
        this.lifecycleFlushHandler = () => {
          const context = this.createProgressContext();
          if (!context.itemId) {
            return;
          }
          this.flushProgress(
            Math.floor(this.getCurrentTimeSeconds() * 1000),
            Math.floor(this.getDurationSeconds() * 1000),
            false,
            context
          ).finally(() => {
            this.pushProgressIfDue(true);
          });
      };
      this.visibilityFlushHandler = () => {
        if (document.visibilityState === "hidden") {
          this.lifecycleFlushHandler?.();
        }
      };
      window.addEventListener("pagehide", this.lifecycleFlushHandler);
      window.addEventListener("beforeunload", this.lifecycleFlushHandler);
      document.addEventListener("visibilitychange", this.visibilityFlushHandler);
    }
  },

  async play(url, { itemId = null, itemType = "movie", videoId = null, season = null, episode = null, title = null, poster = null, background = null, episodeTitle = null, requestHeaders = {}, mediaSourceType = null, forceEngine = null } = {}) {
    if (!this.video) return;

    try {
      this.video.muted = false;
      this.video.defaultMuted = false;
      if (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0) {
        this.video.volume = 1;
      }
    } catch (_) {
      // Ignore unsupported volume/mute operations.
    }

    this.currentItemId = itemId;
    this.currentItemType = itemType;
    this.currentVideoId = videoId;
    this.currentSeason = season == null ? null : Number(season);
    this.currentEpisode = episode == null ? null : Number(episode);
    this.currentItemTitle = title || null;
    this.currentItemPoster = poster || null;
    this.currentItemBackground = background || null;
    this.currentEpisodeTitle = episodeTitle || null;
    this.currentPlaybackUrl = String(url || "").trim();
    this.currentPlaybackHeaders = { ...(requestHeaders || {}) };
    this.currentPlaybackMediaSourceType = mediaSourceType || null;
    this.lastPlaybackErrorCode = 0;
    const playToken = Number(this.playRequestToken || 0) + 1;
    this.playRequestToken = playToken;

    const sourceType = String(mediaSourceType || this.guessMediaMimeType(url) || "").trim() || null;
    await this.ensureAdaptiveLibrariesForSource(sourceType);
    if (Number(this.playRequestToken || 0) !== playToken || String(this.currentPlaybackUrl || "") !== String(url || "").trim()) {
      return;
    }
    const preferredEngine = forceEngine || this.choosePlaybackEngine(url, sourceType, itemType);
    console.log("[PlayerController] Selected playback engine:", preferredEngine);
    this.rememberPlaybackEngineAttempt(this.currentPlaybackUrl, preferredEngine, {
      reset: !forceEngine
    });

    this.teardownAdaptiveInstances();
    this.teardownAvPlay();
    Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.resetNativeMediaState();
    const nativeFallbackEngine = this.isLikelyHlsMimeType(sourceType)
      ? "native-hls"
      : this.isLikelyDashMimeType(sourceType)
        ? "native-dash"
        : "native-file";

    if (preferredEngine === this.getPlatformAvplayEngineName()) {
      const avplayStarted = this.playWithAvPlay(url);
      if (!avplayStarted) {
        this.applyNativeSource(url, sourceType || null, nativeFallbackEngine);
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId(),
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay()) {
              return false;
            }
            const fallbackStarted = this.playWithAvPlay(url);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      }
    } else if (preferredEngine === "hls.js") {
      const hlsStarted = this.playWithHlsJs(url, requestHeaders);
      if (!hlsStarted) {
        this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          playToken,
          beforePlay: () => this.waitForNativeMediaId()
        });
      }
    } else if (preferredEngine === "dash.js") {
      const dashStarted = this.playWithDashJs(url);
      if (!dashStarted) {
        this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      }
      this.attemptVideoPlay({
        warningLabel: "DASH playback start rejected",
        playToken,
        beforePlay: dashStarted ? null : () => this.waitForNativeMediaId()
      });
    } else if (preferredEngine === "native-hls") {
      this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
      this.attemptVideoPlay({
        warningLabel: "Native HLS playback start rejected",
        playToken,
        beforePlay: () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error)) {
            return false;
          }
          const fallbackStarted = this.playWithHlsJs(url, requestHeaders);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else if (preferredEngine === "native-dash") {
      this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      this.attemptVideoPlay({
        warningLabel: "Native DASH playback start rejected",
        playToken,
        beforePlay: () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error) || !this.canUseDashJs()) {
            return false;
          }
          const fallbackStarted = this.playWithDashJs(url);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else {
      this.applyNativeSource(url, sourceType || null, "native-file");
      this.attemptVideoPlay({
        warningLabel: "Playback start rejected",
        playToken,
        beforePlay: () => this.waitForNativeMediaId(),
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay() || !this.isLikelyDirectFileUrl(url)) {
            return false;
          }
          const fallbackStarted = this.playWithAvPlay(url);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    }

    this.isPlaying = true;

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
    }

    this.progressSaveTimer = setInterval(() => {
      const context = this.createProgressContext();
      this.flushProgress(
        Math.floor(this.getCurrentTimeSeconds() * 1000),
        Math.floor(this.getDurationSeconds() * 1000),
        false,
        context
      );
    }, 5000);
  },

  pause() {
    if (!this.video) return;

    if (this.isUsingAvPlay()) {
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      try {
        avplay.pause?.();
        this.isPlaying = false;
        this.emitVideoEvent("pause", { playbackEngine: this.playbackEngine });
      } catch (_) {
        // Ignore AVPlay pause failures.
      }
      return;
    }

    this.video.pause();
  },

  resume() {
    if (!this.video) return;

    if (this.isUsingAvPlay()) {
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      try {
        avplay.play?.();
        this.isPlaying = true;
        this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
        setTimeout(() => {
          this.applyPendingAvPlayAudioTrackSelection();
        }, 0);
        setTimeout(() => {
          this.applyPendingAvPlayAudioTrackSelection();
        }, 300);
      } catch (error) {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(error?.name || error?.message || error);
        console.warn("Playback resume rejected", error);
      }
      return;
    }

    const playPromise = this.video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        if (this.isExpectedPlayInterruption(error)) {
          return;
        }
        console.warn("Playback resume rejected", error);
      });
    }
  },

  stop() {
    if (!this.video) return;

    const context = this.createProgressContext();
    this.flushProgress(
      Math.floor(this.getCurrentTimeSeconds() * 1000),
      Math.floor(this.getDurationSeconds() * 1000),
      false,
      context
    ).finally(() => {
      this.pushProgressIfDue(true);
    });

    this.video.pause();
    this.teardownAdaptiveInstances();
    this.teardownAvPlay();
    this.resetNativeMediaState();
    this.video.removeAttribute("src");
    Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
    this.video.load();

    this.isPlaying = false;
    this.currentItemId = null;
    this.currentItemType = null;
    this.currentVideoId = null;
    this.currentSeason = null;
    this.currentEpisode = null;
    this.currentItemTitle = null;
    this.currentItemPoster = null;
    this.currentItemBackground = null;
    this.currentEpisodeTitle = null;
    this.currentPlaybackUrl = "";
    this.currentPlaybackHeaders = {};
    this.currentPlaybackMediaSourceType = null;
    this.playbackEngine = "none";
    this.lastPlaybackErrorCode = 0;
    this.playRequestToken = Number(this.playRequestToken || 0) + 1;
    this.clearPlaybackEngineAttempts();

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }
  },

  createProgressContext() {
    return {
      itemId: this.currentItemId,
      itemType: this.currentItemType || "movie",
      videoId: this.currentVideoId || null,
      season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
      episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null,
      title: this.currentItemTitle || null,
      poster: this.currentItemPoster || null,
      background: this.currentItemBackground || null,
      episodeTitle: this.currentEpisodeTitle || null
    };
  },

  async flushProgress(positionMs, durationMs, clear = false, context = null) {
    const active = context || this.createProgressContext();
    if (!active?.itemId) {
      return;
    }

    const safePosition = Number(positionMs || 0);
    const safeDuration = Number(durationMs || 0);
    const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;
    const isCompleted = hasFiniteDuration && safePosition / safeDuration > 0.95;

    if (isCompleted) {
      await watchedItemsRepository.mark({
        contentId: active.itemId,
        contentType: active.itemType || "movie",
        title: active.episodeTitle || active.title || active.itemId,
        season: active.season,
        episode: active.episode,
        watchedAt: Date.now()
      });
    }

    if (clear || isCompleted) {
      await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
      this.pushProgressIfDue(true);
      return;
    }

    if (!Number.isFinite(safePosition) || safePosition <= 0) {
      return;
    }

    await watchProgressRepository.saveProgress({
      contentId: active.itemId,
      contentType: active.itemType || "movie",
      videoId: active.videoId || null,
      season: active.season,
      episode: active.episode,
      title: active.title || null,
      poster: active.poster || null,
      background: active.background || null,
      episodeTitle: active.episodeTitle || null,
      positionMs: Math.max(0, Math.trunc(safePosition)),
      durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0
    });
    this.pushProgressIfDue(false);
  },

  pushProgressIfDue(force = false) {
    const now = Date.now();
    if (!force && (now - Number(this.lastProgressPushAt || 0)) < 30000) {
      return;
    }
    this.lastProgressPushAt = now;
    WatchProgressSyncService.push().catch((error) => {
      console.warn("Watch progress auto push failed", error);
    });
  }

};
