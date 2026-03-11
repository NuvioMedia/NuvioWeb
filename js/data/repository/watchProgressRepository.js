import { WatchProgressStore } from "../local/watchProgressStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

class WatchProgressRepository {

  async saveProgress(progress) {
    WatchProgressStore.upsert({
      ...progress,
      updatedAt: progress.updatedAt || Date.now()
    }, activeProfileId());
  }

  async getProgressByContentId(contentId) {
    return WatchProgressStore.findByContentId(contentId, activeProfileId());
  }

  async removeProgress(contentId, videoId = null) {
    WatchProgressStore.remove(contentId, videoId, activeProfileId());
  }

  async getRecent(limit = 30) {
    const byContent = new Map();
    WatchProgressStore.listForProfile(activeProfileId()).forEach((item) => {
      if (!item?.contentId) {
        return;
      }
      const existing = byContent.get(item.contentId);
      if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
        byContent.set(item.contentId, item);
      }
    });
    return Array.from(byContent.values())
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, limit);
  }

  async getAll() {
    return WatchProgressStore.listForProfile(activeProfileId());
  }

  async replaceAll(items) {
    WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const watchProgressRepository = new WatchProgressRepository();
