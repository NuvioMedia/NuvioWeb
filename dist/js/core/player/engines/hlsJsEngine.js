function getHlsConstructor() {
  return globalThis.Hls || null;
}

export const hlsJsEngine = {
  name: "hls.js",

  isSupported() {
    const Hls = getHlsConstructor();
    return Boolean(Hls && typeof Hls.isSupported === "function" && Hls.isSupported());
  },

  getConstructor() {
    return getHlsConstructor();
  },

  create(config) {
    const Hls = getHlsConstructor();
    if (!Hls) {
      return null;
    }
    return new Hls(config);
  },

  getAudioTracks(instance) {
    const trackList = instance?.audioTracks;
    if (!trackList) {
      return [];
    }
    try {
      return Array.from(trackList).filter(Boolean);
    } catch (_) {
      return [];
    }
  },

  getSelectedAudioTrackIndex(instance) {
    const selectedIndex = Number(instance?.audioTrack);
    if (!Number.isFinite(selectedIndex) || selectedIndex < 0) {
      return -1;
    }
    return selectedIndex;
  },

  setAudioTrack(instance, index) {
    const targetIndex = Number(index);
    const tracks = this.getAudioTracks(instance);
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }
    try {
      instance.audioTrack = targetIndex;
      return true;
    } catch (_) {
      return false;
    }
  }
};
