import { normalizeKeyEvent, isBackEvent } from "../sharedKeys.js";

function getAvplayApi() {
  const webapis = globalThis.webapis;
  const avplay = webapis?.avplay || webapis?.avPlay || globalThis.avplay || null;
  if (!avplay || typeof avplay.open !== "function") {
    return null;
  }
  return avplay;
}

export const tizenAdapter = {
  name: "tizen",

  init() {},

  exitApp() {
    try {
      globalThis.tizen?.application?.getCurrentApplication?.().exit?.();
    } catch (_) {
      try {
        globalThis.close?.();
      } catch (_) {
        // Ignore unsupported app-exit APIs in non-TV browsers.
      }
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Tizen TV";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: Boolean(getAvplayApi())
    };
  },

  prepareVideoElement() {}
};
