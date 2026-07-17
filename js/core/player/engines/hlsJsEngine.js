import Hls from "hls.js";

export const hlsJsEngine = {
  isSupported() {
    return Hls.isSupported();
  },

  getConstructor() {
    return Hls;
  },

  create(config) {
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

  getSubtitleTracks(instance) {
    const trackList = instance?.subtitleTracks;
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
      if ("nextAudioTrack" in instance) {
        instance.nextAudioTrack = targetIndex;
      }
      instance.audioTrack = targetIndex;
      try {
        instance.startLoad?.();
      } catch (_) {
        // The track switch itself has already been requested.
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  getSelectedSubtitleTrackIndex(instance) {
    const selectedIndex = Number(instance?.subtitleTrack);
    if (!Number.isFinite(selectedIndex) || selectedIndex < 0) {
      return -1;
    }
    return selectedIndex;
  },

  setSubtitleTrack(instance, index) {
    const targetIndex = Number(index);
    const tracks = this.getSubtitleTracks(instance);
    if (!Number.isFinite(targetIndex) || targetIndex < -1 || targetIndex >= tracks.length) {
      return false;
    }
    try {
      if (targetIndex < 0) {
        if ("subtitleDisplay" in instance) {
          instance.subtitleDisplay = false;
        }
        instance.subtitleTrack = -1;
        return true;
      }
      if ("subtitleDisplay" in instance) {
        instance.subtitleDisplay = true;
      }
      instance.subtitleTrack = targetIndex;
      try {
        instance.startLoad?.();
      } catch (_) {
        // The track switch itself has already been requested.
      }
      return true;
    } catch (_) {
      return false;
    }
  }
};
