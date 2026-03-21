import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";

export const PlaybackSettings = {

  getItems() {
    const settings = PlayerSettingsStore.get();
    const quality = String(settings.preferredQuality || "auto");
    const qualityLabel = quality === "2160p"
      ? "2160p"
      : quality === "1080p"
        ? "1080p"
        : quality === "720p"
          ? "720p"
          : "Auto";

    return [
      {
        id: "playback_toggle_autoplay",
        label: `Autoplay Next: ${settings.autoplayNextEpisode ? "ON" : "OFF"}`,
        description: "Toggle automatic next episode",
        action: () => {
          PlayerSettingsStore.set({
            autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode
          });
        }
      },
      {
        id: "playback_toggle_subtitles",
        label: `Subtitles: ${settings.subtitlesEnabled ? "ON" : "OFF"}`,
        description: "Toggle subtitles by default",
        action: () => {
          PlayerSettingsStore.set({
            subtitlesEnabled: !PlayerSettingsStore.get().subtitlesEnabled
          });
        }
      },
      {
        id: "playback_quality_cycle",
        label: `Quality target: ${qualityLabel}`,
        description: "Cycle Auto -> 2160p -> 1080p -> 720p",
        action: () => {
          const current = String(PlayerSettingsStore.get().preferredQuality || "auto");
          const next = current === "auto"
            ? "2160p"
            : current === "2160p"
              ? "1080p"
              : current === "1080p"
                ? "720p"
                : "auto";
          PlayerSettingsStore.set({ preferredQuality: next });
        }
      }
    ];
  }

};
