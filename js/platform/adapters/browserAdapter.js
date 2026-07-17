import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";
import { hlsJsEngine } from "../../core/player/engines/hlsJsEngine.js";
import { dashJsEngine } from "../../core/player/engines/dashJsEngine.js";

export const browserAdapter = {
  name: "browser",

  init() {},

  exitApp() {
    try {
      globalThis.close?.();
    } catch (_) {
      // Browsers commonly block window.close(); ignore that.
    }
  },

  isBackEvent(event) {
    return isBackEvent(event, [461, 10009, 27, 8]);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event, [461, 10009, 27, 8]);
  },

  getDeviceLabel() {
    return "Web Browser";
  },

  getCapabilities() {
    return {
      hlsJs: hlsJsEngine.isSupported(),
      dashJs: dashJsEngine.isSupported(),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: false
    };
  },

  prepareVideoElement() {}
};
