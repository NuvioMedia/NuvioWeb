import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { DirectDebridResolver } from "./directDebridResolver.js";

const MAX_BACKGROUND_PREPARES_PER_MINUTE = 6;
const MAX_BACKGROUND_PREPARES_PER_HOUR = 30;
const minuteStarts = [];
const hourStarts = [];

function prune(list, cutoffMs) {
  while (list.length && list[0] < cutoffMs) {
    list.shift();
  }
}

function consumeBudget() {
  const now = Date.now();
  prune(minuteStarts, now - 60 * 1000);
  prune(hourStarts, now - 60 * 60 * 1000);
  if (minuteStarts.length >= MAX_BACKGROUND_PREPARES_PER_MINUTE || hourStarts.length >= MAX_BACKGROUND_PREPARES_PER_HOUR) {
    return false;
  }
  minuteStarts.push(now);
  hourStarts.push(now);
  return true;
}

function preparationKey(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  return [
    resolve.service,
    resolve.infoHash || stream.infoHash,
    resolve.fileIdx ?? stream.fileIdx,
    resolve.filename || stream.behaviorHints?.filename,
    resolve.torrentName,
    resolve.magnetUri,
    stream.name,
    stream.title
  ].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
}

export const DirectDebridStreamPreparer = {

  async prepare(streams = [], { season = null, episode = null, onPrepared = null } = {}) {
    const settings = DebridSettingsStore.get();
    const limit = Math.max(0, Math.min(5, Math.trunc(Number(settings.instantPlaybackPreparationLimit || 0))));
    if (!settings.enabled || limit <= 0) {
      return;
    }
    const seen = new Set();
    const candidates = (streams || [])
      .filter((stream) => !stream.url && !stream.externalUrl)
      .filter((stream) => DirectDebridResolver.canResolveStream(stream, { season, episode }))
      .filter((stream) => {
        const key = preparationKey(stream);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    for (const stream of candidates) {
      if (!consumeBudget()) {
        return;
      }
      const result = await DirectDebridResolver.resolve(stream, { season, episode }).catch(() => null);
      if (result?.status === "success" && result.stream?.url && typeof onPrepared === "function") {
        onPrepared(stream, result.stream);
      }
    }
  }

};
