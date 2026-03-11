export const ContentType = {
  MOVIE: "movie",
  SERIES: "series",
  TV: "tv",
  CHANNEL: "channel",
  ANIME: "anime",

  fromString(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
      return this.MOVIE;
    }
    return normalized;
  }
};
