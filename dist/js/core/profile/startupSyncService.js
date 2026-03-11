import { AuthManager } from "../auth/authManager.js";
import { addonRepository } from "../../data/repository/addonRepository.js";
import { ProfileSyncService } from "./profileSyncService.js";
import { LibrarySyncService } from "./librarySyncService.js";
import { WatchProgressSyncService } from "./watchProgressSyncService.js";
import { SavedLibrarySyncService } from "./savedLibrarySyncService.js";
import { WatchedItemsSyncService } from "./watchedItemsSyncService.js";
import { PluginSyncService } from "./pluginSyncService.js";

const SYNC_INTERVAL_MS = 120000;
const ADDON_PUSH_DEBOUNCE_MS = 1000;
const MAX_PULL_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const StartupSyncService = {
  started: false,
  intervalId: null,
  inFlight: false,
  addonPushTimer: null,
  unsubscribeAddonChanges: null,

  async start() {
    if (this.started) {
      return;
    }
    this.started = true;

    this.unsubscribeAddonChanges = addonRepository.onInstalledAddonsChanged(() => {
      this.scheduleAddonPush();
    });

    await this.syncPull();

    this.intervalId = setInterval(() => {
      this.syncCycle();
    }, SYNC_INTERVAL_MS);
  },

  stop() {
    this.started = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.addonPushTimer) {
      clearTimeout(this.addonPushTimer);
      this.addonPushTimer = null;
    }
    if (this.unsubscribeAddonChanges) {
      this.unsubscribeAddonChanges();
      this.unsubscribeAddonChanges = null;
    }
  },

  async syncPull() {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
      try {
        await ProfileSyncService.pull();
        await PluginSyncService.pull();
        await LibrarySyncService.pull();
        await SavedLibrarySyncService.pull();
        await WatchedItemsSyncService.pull();
        await WatchProgressSyncService.pull();
        return;
      } catch (error) {
        console.warn(`Startup sync pull failed (attempt ${attempt}/${MAX_PULL_ATTEMPTS})`, error);
        if (attempt < MAX_PULL_ATTEMPTS) {
          await sleep(3000);
        }
      }
    }
  },

  async syncPush() {
    if (!AuthManager.isAuthenticated) {
      return;
    }
    try {
      await ProfileSyncService.push();
      await PluginSyncService.push();
      await LibrarySyncService.push();
      await SavedLibrarySyncService.push();
      await WatchedItemsSyncService.push();
      await WatchProgressSyncService.push();
    } catch (error) {
      console.warn("Startup sync push failed", error);
    }
  },

  async syncCycle() {
    if (!this.started || this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      await this.syncPull();
      await this.syncPush();
    } finally {
      this.inFlight = false;
    }
  },

  scheduleAddonPush() {
    if (!this.started) {
      return;
    }
    if (this.addonPushTimer) {
      clearTimeout(this.addonPushTimer);
    }
    this.addonPushTimer = setTimeout(async () => {
      this.addonPushTimer = null;
      if (!AuthManager.isAuthenticated) {
        return;
      }
      try {
        await LibrarySyncService.push();
      } catch (error) {
        console.warn("Addon auto push failed", error);
      }
    }, ADDON_PUSH_DEBOUNCE_MS);
  }
};
