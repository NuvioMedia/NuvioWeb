import dashjs from "dashjs";

export const dashJsEngine = {
  isSupported() {
    try {
      const player = dashjs.MediaPlayer();
      return Boolean(player && typeof player.create === "function");
    } catch (_) {
      return false;
    }
  },

  createPlayer() {
    return dashjs.MediaPlayer().create();
  },

  getEvents() {
    return dashjs.MediaPlayer.events;
  }
};
