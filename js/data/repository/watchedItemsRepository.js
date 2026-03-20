import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
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
  }

  async unmark(contentId, options = null) {
    WatchedItemsStore.remove(contentId, activeProfileId(), options);
  }

  async replaceAll(items) {
    WatchedItemsStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchedItemsRepository = new WatchedItemsRepository();
