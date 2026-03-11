import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

class WatchedItemsRepository {

  async getAll(limit = 2000) {
    return WatchedItemsStore.listForProfile(activeProfileId()).slice(0, limit);
  }

  async isWatched(contentId) {
    const all = WatchedItemsStore.listForProfile(activeProfileId());
    return all.some((item) => item.contentId === String(contentId || ""));
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

  async unmark(contentId) {
    WatchedItemsStore.remove(contentId, activeProfileId());
  }

  async replaceAll(items) {
    WatchedItemsStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchedItemsRepository = new WatchedItemsRepository();
