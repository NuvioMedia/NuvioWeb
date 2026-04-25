import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

let watchedItemsSyncTimer = null;
let watchedItemsSyncInFlight = null;

function queueWatchedItemsCloudSync(delayMs = 250) {
  if (watchedItemsSyncTimer) {
    clearTimeout(watchedItemsSyncTimer);
  }
  watchedItemsSyncTimer = setTimeout(() => {
    watchedItemsSyncTimer = null;
    const runPush = async () => {
      if (watchedItemsSyncInFlight) {
        await watchedItemsSyncInFlight.catch(() => false);
      }
      watchedItemsSyncInFlight = import("../../core/profile/watchedItemsSyncService.js")
        .then(({ WatchedItemsSyncService }) => WatchedItemsSyncService.push())
        .catch((error) => {
          console.warn("Watched items cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          watchedItemsSyncInFlight = null;
        });
      await watchedItemsSyncInFlight;
    };
    void runPush();
  }, delayMs);
}

class WatchedItemsRepository {

  async getAll(limit = 2000) {
    return WatchedItemsStore.listForProfile(activeProfileId()).slice(0, limit);
  }

  async isWatched(contentId, options = {}) {
    const allowEpisodeEntries = Boolean(options?.allowEpisodeEntries);
    const all = WatchedItemsStore.listForProfile(activeProfileId());
    return all.some((item) => {
      if (item.contentId !== String(contentId || "")) {
        return false;
      }
      return allowEpisodeEntries || (item.season == null && item.episode == null);
    });
  }

  async mark(item) {
    if (!item?.contentId) {
      return;
    }
    WatchedItemsStore.upsert({
      ...item,
      watchedAt: item.watchedAt || Date.now()
    }, activeProfileId());
    queueWatchedItemsCloudSync();
  }

  async unmark(contentId, options = null) {
    WatchedItemsStore.remove(contentId, activeProfileId(), options);
    queueWatchedItemsCloudSync();
  }

  async replaceAll(items) {
    WatchedItemsStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchedItemsRepository = new WatchedItemsRepository();
