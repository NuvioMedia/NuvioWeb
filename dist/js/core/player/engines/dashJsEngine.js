function getDashGlobal() {
  return globalThis.dashjs || null;
}

export const dashJsEngine = {
  name: "dash.js",

  isSupported() {
    const dashjs = getDashGlobal();
    if (!dashjs || typeof dashjs.MediaPlayer !== "function") {
      return false;
    }
    try {
      const player = dashjs.MediaPlayer();
      return Boolean(player && typeof player.create === "function");
    } catch (_) {
      return false;
    }
  },

  createPlayer() {
    const dashjs = getDashGlobal();
    return dashjs?.MediaPlayer?.().create?.() || null;
  },

  getEvents() {
    return getDashGlobal()?.MediaPlayer?.events || {};
  }
};
