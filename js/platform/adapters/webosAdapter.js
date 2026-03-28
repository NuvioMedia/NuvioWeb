import { normalizeKeyEvent, isBackEvent } from "../sharedKeys.js";
import { WebOSPlayerExtensions } from "../webos/webosPlayerExtensions.js";
import { WebOsLunaService } from "../webos/webosLunaService.js";

function getAvplayApi() {
  const webapis = globalThis.webapis;
  const avplay = webapis?.avplay || webapis?.avPlay || globalThis.avplay || null;
  if (!avplay || typeof avplay.open !== "function") {
    return null;
  }
  return avplay;
}

export const webosAdapter = {
  name: "webos",

  init() {
    if (!WebOsLunaService.isAvailable()) {
      return;
    }

    WebOsLunaService.request("luna://com.nuvio.lg.service", {
      method: "ping",
      parameters: {}
    }).catch((error) => {
      console.warn("webOS companion service ping failed:", error);
    });
  },

  exitApp() {
    if (globalThis.webOSSystem && typeof globalThis.webOSSystem.close === "function") {
      globalThis.webOSSystem.close();
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 27, 8]);
  },

  getDeviceLabel() {
    return "webOS TV";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: Boolean(getAvplayApi()),
      tizenAvplay: false
    };
  },

  prepareVideoElement(videoElement) {
    WebOSPlayerExtensions.apply(videoElement);
  }
};
