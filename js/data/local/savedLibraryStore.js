import { LocalStore } from "../../core/storage/localStore.js";

const SAVED_LIBRARY_KEY = "savedLibraryItems";

export const SavedLibraryStore = {

  list() {
    return LocalStore.get(SAVED_LIBRARY_KEY, []);
  },

  upsert(item) {
    const items = this.list();
    const next = [
      {
        ...item,
        updatedAt: item.updatedAt || Date.now()
      },
      ...items.filter((entry) => entry.contentId !== item.contentId)
    ].slice(0, 1000);
    LocalStore.set(SAVED_LIBRARY_KEY, next);
  },

  findByContentId(contentId) {
    return this.list().find((item) => item.contentId === contentId) || null;
  },

  remove(contentId) {
    const next = this.list().filter((item) => item.contentId !== contentId);
    LocalStore.set(SAVED_LIBRARY_KEY, next);
  },

  replaceAll(items = []) {
    LocalStore.set(SAVED_LIBRARY_KEY, Array.isArray(items) ? items : []);
  }

};
