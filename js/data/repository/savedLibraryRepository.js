import { SavedLibraryStore } from "../local/savedLibraryStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

let savedLibrarySyncTimer = null;
let savedLibrarySyncInFlight = null;

function queueSavedLibraryCloudSync(delayMs = 500) {
  if (savedLibrarySyncTimer) {
    clearTimeout(savedLibrarySyncTimer);
  }
  savedLibrarySyncTimer = setTimeout(() => {
    savedLibrarySyncTimer = null;
    const runPush = async () => {
      if (savedLibrarySyncInFlight) {
        await savedLibrarySyncInFlight.catch(() => false);
      }
      savedLibrarySyncInFlight = import("../../core/profile/savedLibrarySyncService.js")
        .then(({ SavedLibrarySyncService }) => SavedLibrarySyncService.push())
        .catch((error) => {
          console.warn("Saved library cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          savedLibrarySyncInFlight = null;
        });
      await savedLibrarySyncInFlight;
    };
    void runPush();
  }, delayMs);
}

class SavedLibraryRepository {

  async getAll(limit = 200) {
    return SavedLibraryStore.listForProfile(activeProfileId()).slice(0, limit);
  }

  async isSaved(contentId) {
    return Boolean(SavedLibraryStore.findByContentId(contentId, activeProfileId()));
  }

  async save(item) {
    if (!item?.contentId) {
      return;
    }
    SavedLibraryStore.upsert(item, activeProfileId());
    queueSavedLibraryCloudSync();
  }

  async remove(contentId) {
    SavedLibraryStore.remove(contentId, activeProfileId());
    queueSavedLibraryCloudSync();
  }

  async toggle(item) {
    if (!item?.contentId) {
      return false;
    }
    const profileId = activeProfileId();
    const exists = SavedLibraryStore.findByContentId(item.contentId, profileId);
    if (exists) {
      SavedLibraryStore.remove(item.contentId, profileId);
      queueSavedLibraryCloudSync();
      return false;
    }
    SavedLibraryStore.upsert(item, profileId);
    queueSavedLibraryCloudSync();
    return true;
  }

  async replaceAll(items) {
    SavedLibraryStore.replaceForProfile(activeProfileId(), items || []);
  }

}

export const savedLibraryRepository = new SavedLibraryRepository();
