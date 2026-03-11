import { SavedLibraryStore } from "../local/savedLibraryStore.js";

class SavedLibraryRepository {

  async getAll(limit = 200) {
    return SavedLibraryStore.list().slice(0, limit);
  }

  async isSaved(contentId) {
    return Boolean(SavedLibraryStore.findByContentId(contentId));
  }

  async save(item) {
    if (!item?.contentId) {
      return;
    }
    SavedLibraryStore.upsert(item);
  }

  async remove(contentId) {
    SavedLibraryStore.remove(contentId);
  }

  async toggle(item) {
    if (!item?.contentId) {
      return false;
    }
    const exists = SavedLibraryStore.findByContentId(item.contentId);
    if (exists) {
      SavedLibraryStore.remove(item.contentId);
      return false;
    }
    SavedLibraryStore.upsert(item);
    return true;
  }

  async replaceAll(items) {
    SavedLibraryStore.replaceAll(items || []);
  }

}

export const savedLibraryRepository = new SavedLibraryRepository();
