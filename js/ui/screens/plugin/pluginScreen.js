import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { Platform } from "../../../platform/index.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { ADDON_REMOTE_BASE_URL, PUBLIC_APP_URL } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
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
  setModernSidebarExpanded,
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

function t(key, fallback = key) {
  return I18n.t(key, {}, { fallback });
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized === "[::1]";
}

function buildPhoneManagerUrl(base, addonCount) {
  if (!base) {
    return "";
  }
  const url = new URL(base, window.location.href);
  url.searchParams.set("addonsRemote", "1");
  url.hash = "#addons";
  url.searchParams.set("count", String(Math.max(0, Number(addonCount) || 0)));
  return url.toString();
}

let detectedLanHostPromise = null;

function detectLanHost() {
  if (detectedLanHostPromise) {
    return detectedLanHostPromise;
  }

  detectedLanHostPromise = new Promise((resolve) => {
    const RtcPeerConnection = globalThis.RTCPeerConnection
      || globalThis.webkitRTCPeerConnection
      || globalThis.mozRTCPeerConnection
      || null;

    if (!RtcPeerConnection) {
      resolve("");
      return;
    }

    let finished = false;
    const connection = new RtcPeerConnection({ iceServers: [] });

    const finish = (value = "") => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        connection.onicecandidate = null;
        connection.close();
      } catch (_) {}
      resolve(value);
    };

    const timeoutId = setTimeout(() => finish(""), 2000);
    const parseCandidate = (candidateText) => {
      const match = String(candidateText || "").match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
      if (!match) {
        return;
      }
      const ip = String(match[1] || "").trim();
      if (!ip || isLoopbackHostname(ip)) {
        return;
      }
      clearTimeout(timeoutId);
      finish(ip);
    };

    connection.onicecandidate = (event) => {
      if (!event?.candidate) {
        return;
      }
      parseCandidate(event.candidate.candidate);
    };

    try {
      connection.createDataChannel("nuvio-lan");
      connection.createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timeoutId);
          finish("");
        });
    } catch (_) {
      clearTimeout(timeoutId);
      finish("");
    }
  });

  return detectedLanHostPromise;
}

async function getPhoneManagerUrl(addonCount) {
  const wrapperServerBase = String(ADDON_REMOTE_BASE_URL || "").trim();
  if (wrapperServerBase) {
    try {
      const wrapperUrl = new URL(wrapperServerBase, window.location.href);
      if (!isLoopbackHostname(wrapperUrl.hostname)) {
        return buildPhoneManagerUrl(wrapperUrl.toString(), addonCount);
      }
    } catch (_) {}
  }

  const currentUrl = new URL(window.location.href);
  if (!isLoopbackHostname(currentUrl.hostname)) {
    return buildPhoneManagerUrl(`${currentUrl.origin}${currentUrl.pathname}`, addonCount);
  }

  const lanHost = await detectLanHost();
  if (!lanHost) {
    return "";
  }

  const port = currentUrl.port ? `:${currentUrl.port}` : "";
  return buildPhoneManagerUrl(`${currentUrl.protocol}//${lanHost}${port}${currentUrl.pathname}`, addonCount);
}

export const PluginScreen = {

  async mount() {
    this.container = document.getElementById("plugin");
    ScreenUtils.show(this.container);
    this.pluginRouteEnterPending = true;
    this.layoutPrefs = LayoutPreferences.get();
    this.focusZone = "content";
    this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
    this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
    this.qrOverlayOpen = false;
    const [sidebarProfile, model] = await Promise.all([
      getSidebarProfileState(),
      this.collectModel()
    ]);
    this.sidebarProfile = sidebarProfile;
    this.model = model;
    await this.render({ refreshModel: false });
  },

  async collectModel() {
    const addonUrls = addonRepository.getInstalledAddonUrls();
    return {
      addonCount: addonUrls.length,
      phoneManagerUrl: await getPhoneManagerUrl(addonUrls.length)
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

  async render({ refreshModel = true } = {}) {
    if (refreshModel || !this.model) {
      this.model = await this.collectModel();
    }
    this.rowColumns = new Map();
    this.actionMap = new Map();
    this.setRowColumns(0, [0]);
    const manageFromPhonePlanned = true;

    this.actionMap.set("manage_from_phone", async () => {});
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
        <main class="home-main addons-main addons-main-centered">
          <div class="addons-panel addons-panel-centered">
            <section class="addons-hero-card">
              <h1 class="addons-title addons-title-centered">Addons</h1>
              <p class="addons-lede">
                Manage addons and home catalogs from your phone.
              </p>
              <p class="addons-meta">${escapeHtml(`${this.model.addonCount} addon${this.model.addonCount === 1 ? "" : "s"} currently linked`)}</p>
              <button type="button"
                      class="addons-large-row addons-large-row-centered addons-focusable${manageFromPhonePlanned ? " is-disabled is-planned" : ""}"
                      data-zone="content"
                      data-row="0"
                      data-col="0"
                      data-action-id="manage_from_phone"
                      tabindex="-1">
                <span class="addons-large-row-icon material-icons" aria-hidden="true">qr_code_2</span>
                <span class="addons-large-row-copy">
                  <strong>Manage addons</strong>
                  <small>Manage addons and home catalogs from your phone</small>
                </span>
                <span class="addons-large-row-tail-group">
                  ${manageFromPhonePlanned ? `<span class="addons-large-row-badge">${escapeHtml(t("common.soon", "Soon"))}</span>` : ""}
                  <span class="addons-large-row-tail material-icons" aria-hidden="true">phone_android</span>
                </span>
              </button>
            </section>
          </div>
        </main>
        ${this.qrOverlayOpen ? `
          <div class="addons-qr-overlay">
            <div class="addons-qr-dialog">
              <p class="addons-qr-instruction">Manage addons and home catalogs from your phone</p>
              ${this.model.phoneManagerUrl
                ? '<canvas class="addons-qr-canvas" width="440" height="440" aria-label="QR code"></canvas>'
                : '<div class="addons-qr-error">Open the app from a phone-reachable `http(s)` address or set `ADDON_REMOTE_BASE_URL` in the wrapper.</div>'}
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
      setModernSidebarExpanded(this.container, true);
      this.applyFocus();
      return;
    }
    this.focusZone = "sidebar";
    this.applyFocus();
  },

  async closeSidebarToContent() {
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
      this.applyFocus();
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
            setModernSidebarExpanded(this.container, false);
            this.applyFocus();
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
            setModernSidebarExpanded(this.container, true);
            this.applyFocus();
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
