import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { Platform } from "../../../platform/index.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { PUBLIC_APP_URL } from "../../../config.js";
import { isSearchOnlyCatalog } from "../../../core/addons/homeCatalogs.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getLegacySidebarNodes,
  getLegacySidebarSelectedNode,
  getModernSidebarNodes,
  getModernSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

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

function hasHomeVisibleCatalogs(addons) {
  return addons.some((addon) => Array.isArray(addon.catalogs)
    && addon.catalogs.some((catalog) => !isSearchOnlyCatalog(catalog)));
}

function formatCatalogSummary(addon) {
  const catalogCount = Array.isArray(addon?.catalogs) ? addon.catalogs.length : 0;
  const types = Array.isArray(addon?.rawTypes) && addon.rawTypes.length > 0
    ? addon.rawTypes
    : (Array.isArray(addon?.types) ? addon.types : []);
  return `Catalogs: ${catalogCount} - Types: ${types.join(", ") || "None"}`;
}

function getPhoneManagerUrl(addons) {
  const base = String(PUBLIC_APP_URL || window.location.origin + window.location.pathname).trim();
  if (!base) {
    return "";
  }
  const url = new URL(base, window.location.href);
  url.searchParams.set("addonsRemote", "1");
  url.hash = "#addons";
  url.searchParams.set("count", String(addons.length));
  return url.toString();
}

export const PluginScreen = {

  async mount() {
    this.container = document.getElementById("plugin");
    ScreenUtils.show(this.container);
    this.pluginRouteEnterPending = true;
    this.sidebarProfile = await getSidebarProfileState();
    this.layoutPrefs = LayoutPreferences.get();
    this.focusZone = "content";
    this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
    this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
    this.qrOverlayOpen = Boolean(this.qrOverlayOpen);
    await this.render();
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons();
    const addonUrls = addonRepository.getInstalledAddonUrls();
    return {
      addons,
      addonUrls,
      hasHomeVisibleCatalogs: hasHomeVisibleCatalogs(addons),
      phoneManagerUrl: getPhoneManagerUrl(addons)
    };
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
    this.contentRow = rows.includes(this.contentRow) ? this.contentRow : (rows[0] || 0);
    const cols = this.getAvailableCols(this.contentRow);
    this.contentCol = cols.includes(this.contentCol) ? this.contentCol : cols[0];
    const sidebarNodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
    this.sidebarFocusIndex = clamp(this.sidebarFocusIndex, 0, Math.max(0, sidebarNodes.length - 1));
  },

  ensureMainVisibility(target) {
    const container = this.container?.querySelector(".addons-main");
    if (!container || !target) {
      return;
    }
    const anchor = target.closest(".addons-installed-card, .addons-large-row, .addons-install-card") || target;
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
    await this.render();
  },

  async closeQrOverlay() {
    if (!this.qrOverlayOpen) {
      return false;
    }
    this.qrOverlayOpen = false;
    await this.render();
    return true;
  },

  bindContentEvents() {
    this.container.querySelectorAll(".addons-focusable[data-action-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusZone = "content";
        this.contentRow = Number(node.dataset.row || 0);
        this.contentCol = Number(node.dataset.col || 0);
        this.applyFocus();
        await this.activateFocused();
      });
    });

    this.container.querySelector(".addons-qr-close")?.addEventListener("click", async () => {
      await this.closeQrOverlay();
    });
  },

  async render() {
    this.model = await this.collectModel();
    this.rowColumns = new Map();
    this.actionMap = new Map();
    this.setRowColumns(0, [0]);
    if (this.model.hasHomeVisibleCatalogs) {
      this.setRowColumns(1, [0]);
    }

    const installedStartRow = this.model.hasHomeVisibleCatalogs ? 2 : 1;
    const addonRows = this.model.addons.map((addon, index) => {
      const baseUrl = addon.baseUrl || this.model.addonUrls[index] || "";
      const row = installedStartRow + index;
      const upActionId = `addon_up_${index}`;
      const downActionId = `addon_down_${index}`;
      const removeActionId = `addon_remove_${index}`;
      const focusCols = [];

      this.actionMap.set(upActionId, async () => {
        const urls = addonRepository.getInstalledAddonUrls();
        if (index <= 0 || index >= urls.length) {
          return;
        }
        const next = [...urls];
        const moved = next.splice(index, 1)[0];
        next.splice(index - 1, 0, moved);
        await addonRepository.setAddonOrder(next);
        this.contentRow = row - 1;
        await this.render();
      });

      this.actionMap.set(downActionId, async () => {
        const urls = addonRepository.getInstalledAddonUrls();
        if (index < 0 || index >= urls.length - 1) {
          return;
        }
        const next = [...urls];
        const moved = next.splice(index, 1)[0];
        next.splice(index + 1, 0, moved);
        this.contentRow = row + 1;
        await addonRepository.setAddonOrder(next);
        await this.render();
      });

      this.actionMap.set(removeActionId, async () => {
        await addonRepository.removeAddon(baseUrl);
        await this.render();
      });

      if (index > 0) {
        focusCols.push(0);
      }
      if (index < this.model.addons.length - 1) {
        focusCols.push(1);
      }
      focusCols.push(2);
      this.setRowColumns(row, focusCols);

      return `
        <article class="addons-installed-card">
          <div class="addons-installed-head">
            <div class="addons-installed-copy">
              <h3>${escapeHtml(addon.displayName || addon.name || "Unknown addon")}</h3>
              <p class="addons-installed-version">v${escapeHtml(addon.version || "0.0.0")}</p>
            </div>
            <div class="addons-installed-actions">
              <button type="button"
                      class="addons-action-btn ${index > 0 ? "addons-focusable" : "is-disabled"}"
                      ${index > 0 ? `data-zone="content" data-row="${row}" data-col="0" data-action-id="${upActionId}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
                <span class="material-icons" aria-hidden="true">arrow_upward</span>
              </button>
              <button type="button"
                      class="addons-action-btn ${index < this.model.addons.length - 1 ? "addons-focusable" : "is-disabled"}"
                      ${index < this.model.addons.length - 1 ? `data-zone="content" data-row="${row}" data-col="1" data-action-id="${downActionId}" tabindex="-1"` : 'tabindex="-1" aria-disabled="true"'}>
                <span class="material-icons" aria-hidden="true">arrow_downward</span>
              </button>
              <button type="button"
                      class="addons-action-btn addons-focusable addons-remove-btn"
                      data-zone="content"
                      data-row="${row}"
                      data-col="2"
                      data-action-id="${removeActionId}"
                      tabindex="-1">Remove</button>
            </div>
          </div>
          ${addon.description ? `<p class="addons-installed-description">${escapeHtml(addon.description)}</p>` : ""}
          <p class="addons-installed-meta">${escapeHtml(baseUrl)}</p>
          <p class="addons-installed-meta">${escapeHtml(formatCatalogSummary(addon))}</p>
        </article>
      `;
    }).join("");

    this.actionMap.set("manage_from_phone", async () => {
      await this.openQrOverlay();
    });
    this.actionMap.set("reorder_catalogs", async () => {
      await Router.navigate("catalogOrder");
    });
    this.actionMap.set("close_qr_overlay", async () => {
      await this.closeQrOverlay();
    });

    this.container.innerHTML = `
      <div class="home-shell addons-shell${this.pluginRouteEnterPending ? " addons-route-enter" : ""}">
        ${renderRootSidebar({
          selectedRoute: "plugin",
          profile: this.sidebarProfile,
          layout: this.layoutPrefs,
          expanded: Boolean(this.sidebarExpanded),
          pillIconOnly: Boolean(this.pillIconOnly)
        })}
        <main class="home-main addons-main">
          <div class="addons-panel">
            <h1 class="addons-title">Addons</h1>
            <button type="button"
                    class="addons-large-row addons-focusable"
                    data-zone="content"
                    data-row="0"
                    data-col="0"
                    data-action-id="manage_from_phone"
                    tabindex="-1">
              <span class="addons-large-row-icon material-icons" aria-hidden="true">qr_code_2</span>
              <span class="addons-large-row-copy">
                <strong>Manage from phone</strong>
                <small>Scan a QR code to manage addons and Home catalogs from your phone</small>
              </span>
              <span class="addons-large-row-tail material-icons" aria-hidden="true">phone_android</span>
            </button>
            ${this.model.hasHomeVisibleCatalogs ? `
              <button type="button"
                      class="addons-large-row addons-focusable"
                      data-zone="content"
                      data-row="1"
                      data-col="0"
                      data-action-id="reorder_catalogs"
                      tabindex="-1">
                <span class="addons-large-row-icon material-icons" aria-hidden="true">reorder</span>
                <span class="addons-large-row-copy">
                  <strong>Reorder home catalogs</strong>
                  <small>Controls catalog row order on Home (Classic + Modern + Grid)</small>
                </span>
                <span class="addons-large-row-tail material-icons" aria-hidden="true">arrow_downward</span>
              </button>
            ` : ""}
            <h2 class="addons-subtitle">Installed</h2>
            <section class="addons-installed-list">
              ${addonRows || '<div class="addons-empty">No addons installed. Add one to get started.</div>'}
            </section>
          </div>
        </main>
        ${this.qrOverlayOpen ? `
          <div class="addons-qr-overlay">
            <div class="addons-qr-dialog">
              <p class="addons-qr-instruction">Scan with your phone to manage addons and catalogs</p>
              ${this.model.phoneManagerUrl
                ? '<canvas class="addons-qr-canvas" width="440" height="440" aria-label="QR code"></canvas>'
                : '<div class="addons-qr-error">Set `PUBLIC_APP_URL` to enable phone management QR links in web builds.</div>'}
              ${this.model.phoneManagerUrl ? `<p class="addons-qr-url">${escapeHtml(this.model.phoneManagerUrl)}</p>` : ""}
              <button type="button" class="addons-qr-close addons-focusable focused" data-action-id="close_qr_overlay">
                <span class="material-icons" aria-hidden="true">close</span>
                <span>Close</span>
              </button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
    this.pluginRouteEnterPending = false;

    bindRootSidebarEvents(this.container, {
      currentRoute: "plugin",
      onSelectedAction: () => this.closeSidebarToContent(),
      onExpandSidebar: () => this.openSidebar()
    });
    this.bindContentEvents();
    this.normalizeFocus();
    this.applyFocus();
    this.renderQrCode();
  },

  applyFocus() {
    this.container.querySelectorAll(".addons-focusable.focused, .focusable.focused").forEach((node) => node.classList.remove("focused"));

    if (this.qrOverlayOpen) {
      const closeButton = this.container.querySelector(".addons-qr-close");
      if (closeButton) {
        closeButton.classList.add("focused");
        closeButton.focus();
      }
      return;
    }

    if (this.focusZone === "sidebar") {
      const sidebarNodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
      const node = sidebarNodes[this.sidebarFocusIndex]
        || (this.layoutPrefs?.modernSidebar ? getModernSidebarSelectedNode(this.container) : getLegacySidebarSelectedNode(this.container));
      if (node) {
        node.classList.add("focused");
        node.focus();
        if (!this.layoutPrefs?.modernSidebar) {
          setLegacySidebarExpanded(this.container, true);
        }
        return;
      }
      this.focusZone = "content";
    }

    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, false);
    }
    const target = this.container.querySelector(
      `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="${this.contentCol}"]`
    ) || this.container.querySelector(
      `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="0"]`
    ) || this.container.querySelector(".addons-focusable[data-zone='content']");

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

  moveSidebar(delta) {
    const sidebarNodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
    this.sidebarFocusIndex = clamp(this.sidebarFocusIndex + delta, 0, Math.max(0, sidebarNodes.length - 1));
    this.applyFocus();
  },

  async openSidebar() {
    const sidebarNodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
    const selected = this.layoutPrefs?.modernSidebar ? getModernSidebarSelectedNode(this.container) : getLegacySidebarSelectedNode(this.container);
    this.sidebarFocusIndex = Math.max(0, sidebarNodes.indexOf(selected));
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      this.focusZone = "sidebar";
      await this.render();
      return;
    }
    this.focusZone = "sidebar";
    this.applyFocus();
  },

  async closeSidebarToContent() {
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      await this.render();
      return;
    }
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container.querySelector(".addons-focusable.focused, .focusable.focused");
    if (!current) {
      return;
    }

    if (isRootSidebarNode(current)) {
      activateLegacySidebarAction(String(current.dataset.action || ""), "plugin");
      if (isSelectedSidebarAction(String(current.dataset.action || ""), "plugin")) {
        await this.closeSidebarToContent();
      }
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
    if (!this.qrOverlayOpen) {
      return false;
    }
    this.closeQrOverlay();
    return true;
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
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.openSidebar();
      }
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === 40) {
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === 38) {
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
      }
    }

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (this.focusZone === "sidebar") {
        if (code === 38) this.moveSidebar(-1);
        else if (code === 40) this.moveSidebar(1);
        else if (code === 39) {
          this.focusZone = "content";
          if (this.layoutPrefs?.modernSidebar) {
            this.sidebarExpanded = false;
            await this.render();
            return;
          }
          this.applyFocus();
        }
        return;
      }

      if (code === 38) this.moveContent(-1);
      else if (code === 40) this.moveContent(1);
      else if (code === 37) {
        if (this.contentCol > 0) {
          this.moveContent(0, -1);
        } else {
          const nodes = this.layoutPrefs?.modernSidebar ? getModernSidebarNodes(this.container) : getLegacySidebarNodes(this.container);
          const selected = this.layoutPrefs?.modernSidebar ? getModernSidebarSelectedNode(this.container) : getLegacySidebarSelectedNode(this.container);
          this.focusZone = "sidebar";
          this.sidebarFocusIndex = Math.max(0, nodes.indexOf(selected));
          if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
            this.sidebarExpanded = true;
            await this.render();
          } else {
            this.applyFocus();
          }
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
    ScreenUtils.hide(this.container);
  }

};
