import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { LibrarySyncService } from "../../../core/profile/librarySyncService.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { Platform } from "../../../platform/index.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PHONE_MANAGER_URL = "https://nuvio.tv/account?tab=addons";
const ADDONS_ROUTE_ENTER_DURATION_MS = 350;

async function getPhoneManagerUrl() {
  return PHONE_MANAGER_URL;
}

export const PluginScreen = {
  async mount() {
    this.container = document.getElementById("plugin");
    ScreenUtils.show(this.container);
    this.pluginRouteEnterPending = true;
    this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
    this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
    this.qrOverlayOpen = false;
    this.syncing = false;
    this.model = await this.collectModel();
    await this.render({ refreshModel: false });
    if (AuthManager.isAuthenticated) {
      this.scheduleInitialRefresh();
    }
  },

  scheduleInitialRefresh() {
    if (this.initialRefreshTimer) {
      clearTimeout(this.initialRefreshTimer);
    }
    this.initialRefreshTimer = setTimeout(() => {
      this.initialRefreshTimer = null;
      if (Router.getCurrent() === "plugin") {
        void this.refreshAddons();
      }
    }, ADDONS_ROUTE_ENTER_DURATION_MS + 80);
  },

  async collectModel() {
    const addonUrls = addonRepository.getInstalledAddonUrls();
    return {
      addonCount: addonUrls.length,
      authenticated: AuthManager.isAuthenticated,
      syncStatus: LibrarySyncService.getLastPullStatus(),
      phoneManagerUrl: await getPhoneManagerUrl()
    };
  },

  buildSyncStatusText() {
    if (this.syncing) {
      return "Syncing addons...";
    }
    if (!this.model?.authenticated) {
      return "Sign in on your phone to link addons.";
    }
    const status = this.model?.syncStatus || {};
    if (status.state === "error") {
      return "Couldn't reach the addon service. Check the TV internet connection and try Refresh.";
    }
    if (this.model?.addonCount > 0) {
      return "Addons are up to date.";
    }
    return "No addons linked yet. Add them on your phone, then press Refresh.";
  },

  async refreshAddons() {
    if (this.syncing) {
      return;
    }
    this.syncing = true;
    await this.render({ refreshModel: true });
    try {
      await LibrarySyncService.pull();
    } catch (error) {
      console.warn("Addon refresh failed", error);
    }
    this.syncing = false;
    if (Router.getCurrent() === "plugin") {
      await this.render({ refreshModel: true });
    }
  },

  setRowColumns(row, cols) {
    this.rowColumns.set(row, cols);
  },

  getAvailableRows() {
    return [...this.rowColumns.keys()].sort((left, right) => left - right);
  },

  getAvailableCols(row) {
    return this.rowColumns.get(row) || [0];
  },

  normalizeFocus() {
    const rows = this.getAvailableRows();
    this.contentRow = rows.includes(this.contentRow) ? this.contentRow : rows[0] || 0;
    const cols = this.getAvailableCols(this.contentRow);
    this.contentCol = cols.includes(this.contentCol) ? this.contentCol : cols[0];
  },

  ensureMainVisibility(target) {
    const container = this.container?.querySelector(".addons-main");
    if (!container || !target) {
      return;
    }
    const anchor =
      target.closest(".addons-installed-card, .addons-large-row, .addons-install-card") || target;
    const pad = 56;
    const containerRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorTop = anchorRect.top - containerRect.top + container.scrollTop;
    const anchorBottom = anchorRect.bottom - containerRect.top + container.scrollTop;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (anchorBottom > viewBottom - pad) {
      container.scrollTop = Math.min(
        container.scrollHeight - container.clientHeight,
        Math.max(0, anchorBottom - container.clientHeight + pad)
      );
    } else if (anchorTop < viewTop + pad) {
      container.scrollTop = Math.max(0, anchorTop - pad);
    }
  },

  renderQrCode() {
    if (!this.qrOverlayOpen || !this.model.phoneManagerUrl) {
      return;
    }
    const canvas = this.container?.querySelector(".addons-qr-canvas");
    if (!canvas) {
      return;
    }
    QrCodeGenerator.generate(canvas, this.model.phoneManagerUrl, 440);
  },

  async openQrOverlay() {
    this.qrOverlayOpen = true;
    await this.render({ refreshModel: false });
  },

  async closeQrOverlay() {
    if (!this.qrOverlayOpen) {
      return false;
    }
    this.qrOverlayOpen = false;
    await this.render({ refreshModel: false });
    return true;
  },

  bindContentEvents() {
    this.container.querySelectorAll(".addons-focusable[data-action-id]").forEach((node) => {
      node.addEventListener("keydown", (event) => {
        const code = Number(event?.keyCode || 0);
        if (code === 32) {
          event.preventDefault();
        }
      });

      node.addEventListener("click", async () => {
        this.contentRow = Number(node.dataset.row || 0);
        this.contentCol = Number(node.dataset.col || 0);
        this.applyFocus();
        await this.activateFocused();
      });
    });
  },

  async render({ refreshModel = true } = {}) {
    if (refreshModel || !this.model) {
      this.model = await this.collectModel();
    }
    this.rowColumns = new Map();
    this.actionMap = new Map();
    this.setRowColumns(0, [0]);
    this.setRowColumns(1, [0]);
    this.setRowColumns(2, [0]);

    this.actionMap.set("manage_from_phone", async () => {
      await this.openQrOverlay();
    });
    this.actionMap.set("reorder_home_catalogs", async () => {
      Router.navigate("catalogOrder");
    });
    this.actionMap.set("refresh_addons", async () => {
      await this.refreshAddons();
    });
    this.actionMap.set("close_qr_overlay", async () => {
      await this.closeQrOverlay();
    });

    const enterClass = this.pluginRouteEnterPending ? " nuvio-route-slide-enter" : "";
    this.container.innerHTML = `
      <div class="addons-shell addons-route-shell tv-route-shell">
        <div class="addons-route-content${enterClass}">
          <main class="home-main addons-main addons-main-centered">
            <div class="addons-panel addons-panel-centered">
              <section class="addons-hero-card">
                <h1 class="addons-title addons-title-centered">Addons</h1>
                <p class="addons-lede">
                  Manage addons and home catalogs from your phone.
                </p>
                <p class="addons-meta">${escapeHtml(`${this.model.addonCount} addon${this.model.addonCount === 1 ? "" : "s"} currently linked`)}</p>
                <p class="addons-sync-status">${escapeHtml(this.buildSyncStatusText())}</p>
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="0"
                     data-col="0"
                     data-action-id="manage_from_phone"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">qr_code_2</span>
                  <span class="addons-large-row-copy">
                    <strong>Manage from phone</strong>
                    <small>Scan a QR code to manage addons, catalogs, and collections from your phone</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">phone_android</span>
                  </span>
                </div>
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="1"
                     data-col="0"
                     data-action-id="reorder_home_catalogs"
                     tabindex="-1">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">tune</span>
                  <span class="addons-large-row-copy">
                    <strong>Reorder &amp; hide catalogs</strong>
                    <small>Change the order of home rows and hide catalogs you don't want shown</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">chevron_right</span>
                  </span>
                </div>
                <div role="button"
                     class="addons-large-row addons-large-row-centered addons-focusable"
                     data-zone="content"
                     data-row="2"
                     data-col="0"
                     data-action-id="refresh_addons"
                     tabindex="-1"
                     aria-disabled="${this.syncing ? "true" : "false"}">
                  <span class="addons-large-row-icon material-icons" aria-hidden="true">${this.syncing ? "hourglass_top" : "sync"}</span>
                  <span class="addons-large-row-copy">
                    <strong>${this.syncing ? "Refreshing..." : "Refresh addons"}</strong>
                    <small>Re-check your account for addons you enabled on your phone</small>
                  </span>
                  <span class="addons-large-row-tail-group">
                    <span class="addons-large-row-tail material-icons" aria-hidden="true">refresh</span>
                  </span>
                </div>
              </section>
            </div>
          </main>
        </div>
        ${
          this.qrOverlayOpen
            ? `
          <div class="addons-qr-overlay">
            <div class="addons-qr-dialog">
              <p class="addons-qr-instruction">Scan with your phone to manage addons, catalogs, and collections</p>
              <canvas class="addons-qr-canvas" width="440" height="440" aria-label="QR code"></canvas>
              <p class="addons-qr-url">${escapeHtml(this.model.phoneManagerUrl)}</p>
              <div role="button" class="addons-qr-close addons-focusable focused" data-action-id="close_qr_overlay" tabindex="-1">
                <span class="material-icons" aria-hidden="true">close</span>
                <span>Close</span>
              </div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
    this.pluginRouteEnterPending = false;
    this.bindContentEvents();
    this.normalizeFocus();
    this.applyFocus();
    this.renderQrCode();
  },

  applyFocus() {
    this.container
      .querySelectorAll(".addons-focusable.focused, .focusable.focused")
      .forEach((node) => node.classList.remove("focused"));

    if (this.qrOverlayOpen) {
      const closeButton = this.container.querySelector(".addons-qr-close");
      if (closeButton) {
        closeButton.classList.add("focused");
        closeButton.focus();
      }
      return;
    }

    const target =
      this.container.querySelector(
        `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="${this.contentCol}"]`
      ) ||
      this.container.querySelector(
        `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="0"]`
      ) ||
      this.container.querySelector(".addons-focusable[data-zone='content']");

    if (target) {
      target.classList.add("focused");
      this.ensureMainVisibility(target);
      target.focus();
    }
  },

  moveContent(deltaRow, deltaCol = 0) {
    if (deltaCol !== 0) {
      const cols = this.getAvailableCols(this.contentRow);
      const currentIndex = Math.max(0, cols.indexOf(this.contentCol));
      this.contentCol = cols[clamp(currentIndex + deltaCol, 0, cols.length - 1)];
      this.applyFocus();
      return;
    }

    const rows = this.getAvailableRows();
    const currentIndex = Math.max(0, rows.indexOf(this.contentRow));
    this.contentRow = rows[clamp(currentIndex + deltaRow, 0, rows.length - 1)] || 0;
    const cols = this.getAvailableCols(this.contentRow);
    this.contentCol = cols.includes(this.contentCol) ? this.contentCol : cols[0];
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container.querySelector(".addons-focusable.focused, .focusable.focused");
    if (!current) {
      return;
    }

    const action = this.actionMap.get(String(current.dataset.actionId || ""));
    if (!action) {
      return;
    }
    await action();
    if (Router.getCurrent() === "plugin") {
      this.normalizeFocus();
      this.applyFocus();
    }
  },

  consumeBackRequest() {
    if (this.qrOverlayOpen) {
      this.closeQrOverlay();
      return true;
    }
    return false;
  },

  async onKeyDown(event) {
    if (this.qrOverlayOpen) {
      if (Platform.isBackEvent(event)) {
        event?.preventDefault?.();
        await this.closeQrOverlay();
        return;
      }
      const code = Number(event?.keyCode || 0);
      if (code === 13) {
        event?.preventDefault?.();
        await this.closeQrOverlay();
      }
      return;
    }

    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (code === 38) this.moveContent(-1);
      else if (code === 40) this.moveContent(1);
      else if (code === 37) {
        if (this.contentCol > 0) {
          this.moveContent(0, -1);
        }
      } else if (code === 39) {
        this.moveContent(0, 1);
      }
      return;
    }

    if (code === 13) {
      await this.activateFocused();
    }
  },

  cleanup() {
    if (this.initialRefreshTimer) {
      clearTimeout(this.initialRefreshTimer);
      this.initialRefreshTimer = null;
    }
    ScreenUtils.hide(this.container);
  }
};
