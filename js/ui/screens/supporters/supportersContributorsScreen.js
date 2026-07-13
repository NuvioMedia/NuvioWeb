import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import { DONATIONS_BASE_URL, DONATIONS_DONATE_URL } from "../../../config.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import {
  bindSettingsScrollIndicators,
  scrollSettingsContentItem,
  settingsScrollIndicatorMarkup
} from "../settings/settingsScreen.js";

const TABS = ["supporters", "sponsors"];
const DEFAULT_TAB = "supporters";
const DEFAULT_DONATE_URL = "https://ko-fi.com/tapframe";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

async function requestJson(url, errorMessage) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${errorMessage}: ${response.status}`);
  }
  return await response.json();
}

function parseTimestamp(rawDate) {
  const timestamp = Date.parse(String(rawDate || ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatDonationDate(rawDate) {
  const timestamp = parseTimestamp(rawDate);
  if (!Number.isFinite(timestamp)) {
    return String(rawDate || "");
  }
  try {
    return new Intl.DateTimeFormat(I18n.getLocale(), {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date(timestamp));
  } catch (_) {
    return new Date(timestamp).toLocaleDateString();
  }
}

function initialsForName(name) {
  return (
    String(name || "")
      .trim()
      .charAt(0)
      .toUpperCase() || "?"
  );
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") return;
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}

function visibleFocusableNodes(container) {
  return Array.from(container?.querySelectorAll?.(".focusable") || []).filter((node) => {
    if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
    const rect = node.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0;
  });
}

function findDirectionalTarget(nodes, current, direction) {
  if (!current || !nodes.length) return nodes[0] || null;
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;

  return (
    nodes
      .filter((node) => node !== current)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const nx = rect.left + rect.width / 2;
        const ny = rect.top + rect.height / 2;
        const primary = horizontal ? nx - cx : ny - cy;
        const secondary = horizontal ? Math.abs(ny - cy) : Math.abs(nx - cx);
        const alignedBonus =
          secondary <=
          (horizontal
            ? Math.max(currentRect.height, rect.height)
            : Math.max(currentRect.width, rect.width)) *
            0.7
            ? -10000
            : 0;
        return {
          node,
          primary,
          secondary,
          score: Math.abs(primary) * 1000 + secondary + alignedBonus
        };
      })
      .filter((entry) => entry.primary * sign > 2)
      .sort((left, right) => left.score - right.score)[0]?.node || null
  );
}

function sortedTabListItems(container, tab) {
  return Array.from(
    container?.querySelectorAll?.(`.supporters-person-card[data-tab="${tab}"]`) || []
  ).sort(
    (left, right) => Number(left.dataset.itemIndex || 0) - Number(right.dataset.itemIndex || 0)
  );
}

async function loadSupporters() {
  const baseUrl = normalizeBaseUrl(DONATIONS_BASE_URL);
  if (!baseUrl) {
    throw new Error(t("supporters_error_load", {}, "Unable to load supporters."));
  }
  const data = await requestJson(
    `${baseUrl}/api/donations?limit=200`,
    t("supporters_error_api_http", {}, "Donations API error")
  );
  return (Array.isArray(data?.donations) ? data.donations : [])
    .map((donation, index) => {
      const name = String(donation?.name || "").trim();
      const date = String(donation?.date || "").trim();
      if (!name || !date) return null;
      return {
        id: `${name}|${date}#${index}`,
        name,
        date,
        message: String(donation?.message || "").trim(),
        sortTimestamp: parseTimestamp(date)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}

async function loadSponsors() {
  const baseUrl = normalizeBaseUrl(DONATIONS_BASE_URL);
  if (!baseUrl) {
    throw new Error(t("sponsors_error_load", {}, "Unable to load sponsors."));
  }
  const data = await requestJson(
    `${baseUrl}/api/sponsors`,
    t("sponsors_error_api_http", {}, "Sponsors API error")
  );
  return (Array.isArray(data?.sponsors) ? data.sponsors : [])
    .map((sponsor, index) => {
      const name = String(sponsor?.name || "").trim();
      const createdAt = String(sponsor?.createdAt || "").trim();
      if (!name || !createdAt) return null;
      return {
        id: String(sponsor?.id || `${name}|${index}`).trim(),
        name,
        channelUrl: String(sponsor?.channelUrl || "").trim(),
        createdAt,
        sortTimestamp: parseTimestamp(createdAt)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}

export const SupportersContributorsScreen = {
  container: null,
  selectedTab: DEFAULT_TAB,
  focusKey: "tab:supporters",
  showDonateQr: false,
  dialog: null,
  routeEnterPending: false,
  routeEnterTimer: null,
  state: null,
  scrollTops: null,
  preserveListScrollAfterFocus: false,

  ensureState() {
    if (this.state) return;
    this.state = {
      supporters: { loading: false, loaded: false, items: [], error: null },
      sponsors: { loading: false, loaded: false, items: [], error: null }
    };
  },

  async mount() {
    this.container = document.getElementById("supportersContributors");
    ScreenUtils.show(this.container);
    this.ensureState();
    this.scrollTops = this.scrollTops || {};
    this.selectedTab = this.selectedTab || DEFAULT_TAB;
    this.focusKey = this.focusKey || `tab:${this.selectedTab}`;
    this.routeEnterPending = true;
    if (this.routeEnterTimer) {
      clearTimeout(this.routeEnterTimer);
    }
    this.routeEnterTimer = setTimeout(() => {
      this.routeEnterPending = false;
      this.routeEnterTimer = null;
    }, 420);
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    await this.render();
    void this.loadTabIfNeeded(this.selectedTab);
  },

  cleanup() {
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    if (this.routeEnterTimer) {
      clearTimeout(this.routeEnterTimer);
    }
    this.routeEnterTimer = null;
    this.routeEnterPending = false;
    this.handleClickBound = null;
    this.dialog = null;
    this.showDonateQr = false;
    ScreenUtils.hide(this.container);
  },

  async loadTabIfNeeded(tab, force = false) {
    this.ensureState();
    const tabState = this.state[tab];
    if (!tabState || tabState.loading || (!force && tabState.loaded)) return;
    tabState.loading = true;
    tabState.error = null;
    await this.render();
    try {
      const items = tab === "supporters" ? await loadSupporters() : await loadSponsors();
      tabState.items = items;
      tabState.loaded = true;
      tabState.error = null;
    } catch (error) {
      tabState.items = [];
      tabState.loaded = false;
      tabState.error = error?.message || String(error || "");
    } finally {
      tabState.loading = false;
      if (Router.getCurrent() === "supportersContributors") {
        await this.render();
      }
    }
  },

  async selectTab(tab, { focus = true } = {}) {
    if (!TABS.includes(tab)) return;
    this.selectedTab = tab;
    if (focus) this.focusKey = `tab:${tab}`;
    await this.render();
    void this.loadTabIfNeeded(tab);
  },

  renderBrand() {
    const donateUrl = String(DONATIONS_DONATE_URL || DEFAULT_DONATE_URL).trim();
    return `
      <section class="supporters-brand-card${this.showDonateQr ? " is-flipped" : ""}" aria-label="${escapeHtml(t("supporters_tab", {}, "Supporters"))}">
        <div class="supporters-brand-face supporters-brand-front">
          <div class="supporters-brand-copy">
            <img class="supporters-brand-logo" src="assets/brand/app_logo_wordmark.png" alt="Nuvio" />
            <div class="supporters-brand-heading-group">
              <h1 class="supporters-title">${escapeHtml(t("supporters_tab", {}, "Supporters"))}</h1>
              <p class="supporters-subtitle">${escapeHtml(t("supporters_contributors_supporters_copy", {}, "The people helping keep Nuvio online and in active development."))}</p>
            </div>
            <p class="supporters-primary-copy">${escapeHtml(t("supporters_contributors_supporters_copy", {}, "Supporters and donators help keep the project moving, fund infrastructure, and make room for ambitious features."))}</p>
            <p class="supporters-secondary-copy">${escapeHtml(t("supporters_contributors_donate_copy", {}, "Nuvio will stay free and open source. If you want to support the project, you can help cover the time and infrastructure behind it."))}</p>
          </div>
          <button class="supporters-donate-button supporters-focusable focusable" data-focus-key="brand:donate" data-action="showDonateQr">
            ${escapeHtml(t("supporters_contributors_donate_button", {}, "Donate to Nuvio"))}
          </button>
        </div>
        <div class="supporters-brand-face supporters-brand-back" aria-hidden="${this.showDonateQr ? "false" : "true"}">
          <div class="supporters-qr-copy">
            <h2>${escapeHtml(t("supporters_contributors_qr_title", {}, "Scan to donate"))}</h2>
            <p>${escapeHtml(t("supporters_contributors_qr_subtitle", {}, "Open the link on your phone and support Nuvio through Ko-fi."))}</p>
          </div>
          <canvas class="supporters-donate-qr" data-qr-content="${escapeHtml(donateUrl)}" aria-label="${escapeHtml(t("cd_donation_qr", {}, "Donation QR code"))}"></canvas>
          <button class="supporters-back-button supporters-focusable focusable" data-focus-key="brand:back" data-action="hideDonateQr">
            ${escapeHtml(t("supporters_contributors_back_button", {}, "Back to details"))}
          </button>
        </div>
      </section>
    `;
  },

  renderTabs() {
    const labels = {
      supporters: t("supporters_tab", {}, "Supporters"),
      sponsors: t("sponsors_tab", {}, "Sponsors")
    };
    return `
      <div class="supporters-tabs" role="tablist">
        ${TABS.map(
          (tab) => `
          <button class="supporters-tab supporters-focusable focusable${this.selectedTab === tab ? " selected" : ""}"
                  role="tab"
                  aria-selected="${this.selectedTab === tab ? "true" : "false"}"
                  data-tab="${tab}"
                  data-focus-key="tab:${tab}"
                  data-action="selectTab">
            ${escapeHtml(labels[tab])}
          </button>
        `
        ).join("")}
      </div>
    `;
  },

  renderTabBody() {
    const tabState = this.state?.[this.selectedTab] || {
      loading: false,
      loaded: false,
      items: [],
      error: null
    };
    if (tabState.loading) {
      const loading = this.selectedTab === "supporters"
        ? t("supporters_loading", {}, "Loading supporters...")
        : t("sponsors_loading", {}, "Loading sponsors...");
      return `<div class="supporters-status">${escapeHtml(loading)}</div>`;
    }
    if (tabState.error) {
      const title = this.selectedTab === "supporters"
        ? t("supporters_error_title", {}, "Couldn't load supporters")
        : t("sponsors_error_title", {}, "Couldn't load sponsors");
      return `
        <div class="supporters-error-state">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(tabState.error)}</p>
          <button class="supporters-retry-button supporters-focusable focusable" data-focus-key="retry:${this.selectedTab}" data-action="retry">
            ${escapeHtml(t("action_retry", {}, "Retry"))}
          </button>
        </div>
      `;
    }
    if (tabState.loaded && !tabState.items.length) {
      const empty = this.selectedTab === "supporters"
        ? t("supporters_empty", {}, "No supporters found yet.")
        : t("sponsors_empty", {}, "No sponsors found yet.");
      return `<div class="supporters-status">${escapeHtml(empty)}</div>`;
    }
    return `
      <div class="supporters-list-frame">
        <div class="supporters-list" role="tabpanel">
          ${tabState.items.map((item, index) => this.renderCard(item, index)).join("")}
        </div>
        ${settingsScrollIndicatorMarkup("vertical")}
      </div>
    `;
  },

  renderCard(item, index) {
    if (this.selectedTab === "sponsors") return this.renderSponsorCard(item, index);
    return this.renderSupporterCard(item, index);
  },

  renderNameAvatar(name) {
    return `<span class="supporters-avatar supporters-avatar-initials">${escapeHtml(initialsForName(name))}</span>`;
  },

  renderExternalIcon() {
    return `<svg class="supporters-card-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10M9 15 17 7M17 7h-5M17 7v5" /></svg>`;
  },

  renderSupporterCard(supporter, index) {
    return `
      <article class="supporters-person-card supporters-focusable focusable"
               data-focus-key="item:supporters:${index}"
               data-action="openItem"
               data-tab="supporters"
               data-item-index="${index}">
        ${this.renderNameAvatar(supporter.name)}
        <div class="supporters-card-copy">
          <h3>${escapeHtml(supporter.name)}</h3>
          <p>${escapeHtml(formatDonationDate(supporter.date))}</p>
          ${supporter.message ? `<p class="supporters-card-message">${escapeHtml(supporter.message)}</p>` : ""}
        </div>
        ${this.renderExternalIcon()}
      </article>
    `;
  },

  renderSponsorCard(sponsor, index) {
    return `
      <article class="supporters-person-card supporters-focusable focusable"
               data-focus-key="item:sponsors:${index}"
               data-action="openItem"
               data-tab="sponsors"
               data-item-index="${index}">
        ${this.renderNameAvatar(sponsor.name)}
        <div class="supporters-card-copy">
          <h3>${escapeHtml(sponsor.name)}</h3>
        </div>
        ${this.renderExternalIcon()}
      </article>
    `;
  },

  renderDialog() {
    if (!this.dialog) return "";
    const item = this.dialog.item;
    if (!item) return "";
    const type = this.dialog.type;
    if (type === "sponsors") return this.renderSponsorDialog(item);
    return this.renderSupporterDialog(item);
  },

  renderDialogShell({ title, subtitle, body, actions }) {
    return `
      <div class="supporters-dialog-backdrop" data-action="closeDialog">
        <section class="supporters-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="supporters-dialog-subtitle">${escapeHtml(subtitle)}</p>` : ""}
          <div class="supporters-dialog-body">${body}</div>
          <div class="supporters-dialog-actions">${actions}</div>
        </section>
      </div>
    `;
  },

  renderSupporterDialog(supporter) {
    return this.renderDialogShell({
      title: supporter.name,
      subtitle: formatDonationDate(supporter.date),
      body: `
        <div class="supporters-dialog-person-row">
          ${this.renderNameAvatar(supporter.name)}
          <p>${escapeHtml(supporter.message || t("supporters_no_message", {}, "No message shared."))}</p>
        </div>
      `,
      actions: `
        <button class="supporters-dialog-button primary focusable" data-focus-key="dialog:primary" data-action="openDonations">${escapeHtml(t("supporters_open_donations", {}, "Open donations page"))}</button>
        <button class="supporters-dialog-button focusable" data-focus-key="dialog:close" data-action="closeDialog">${escapeHtml(t("action_close", {}, "Close"))}</button>
      `
    });
  },

  renderSponsorDialog(sponsor) {
    return this.renderDialogShell({
      title: sponsor.name,
      subtitle:
        sponsor.channelUrl || t("sponsors_channel_unavailable", {}, "Sponsor channel unavailable."),
      body: `
        <div class="supporters-dialog-person-row">
          ${this.renderNameAvatar(sponsor.name)}
          <div>
            <p>${escapeHtml(t("sponsors_detail_copy", {}, "Sponsors help move Nuvio forward through support across the different parts of development."))}</p>
            ${sponsor.channelUrl ? `<small>${escapeHtml(sponsor.channelUrl)}</small>` : ""}
          </div>
        </div>
      `,
      actions: `
        <button class="supporters-dialog-button primary focusable" data-focus-key="dialog:primary" data-action="openSponsor"${sponsor.channelUrl ? "" : ' disabled aria-disabled="true"'}>${escapeHtml(t("sponsors_open_channel", {}, "Open sponsor channel"))}</button>
        <button class="supporters-dialog-button focusable" data-focus-key="dialog:close" data-action="closeDialog">${escapeHtml(t("action_close", {}, "Close"))}</button>
      `
    });
  },

  async render() {
    this.ensureState();
    this.captureListScrollTop();
    const enterClass = this.routeEnterPending ? " supporters-route-enter" : "";
    this.container.innerHTML = `
      <div class="supporters-route-shell${enterClass}">
        <div class="supporters-route-content">
          ${this.renderBrand()}
          <section class="supporters-content-card">
            ${this.renderTabs()}
            <div class="supporters-tab-panel">
              ${this.renderTabBody()}
            </div>
          </section>
        </div>
        ${this.renderDialog()}
      </div>
    `;
    this.generateQrCodes();
    ScreenUtils.indexFocusables(this.container);
    bindSettingsScrollIndicators(this.container);
    this.restoreListScrollTop();
    this.applyFocus();
    if (this.preserveListScrollAfterFocus) {
      this.restoreListScrollTop();
      this.preserveListScrollAfterFocus = false;
    }
  },

  captureListScrollTop() {
    const list = this.container?.querySelector?.(".supporters-list");
    if (!list) return;
    this.scrollTops = this.scrollTops || {};
    this.scrollTops[this.selectedTab] = Number(list.scrollTop || 0);
  },

  restoreListScrollTop() {
    const list = this.container?.querySelector?.(".supporters-list");
    if (!list) return;
    const scrollTop = Number(this.scrollTops?.[this.selectedTab] || 0);
    if (scrollTop > 0) {
      list.scrollTop = scrollTop;
    }
  },

  generateQrCodes() {
    this.container?.querySelectorAll?.("canvas[data-qr-content]").forEach((canvas) => {
      const content = String(canvas.getAttribute("data-qr-content") || "").trim();
      if (!content) return;
      const size = canvas.classList.contains("supporters-dialog-qr") ? 376 : 440;
      try {
        QrCodeGenerator.generate(canvas, content, size);
      } catch (error) {
        console.warn("Failed to generate supporters QR", error);
      }
    });
  },

  applyFocus() {
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const selector = `.focusable[data-focus-key="${String(this.focusKey || "").replace(/["\\]/g, "\\$&")}"]`;
    const fallbackSelector = this.dialog
      ? ".supporters-dialog .focusable:not([disabled])"
      : `.focusable[data-focus-key="tab:${this.selectedTab}"]`;
    const node =
      this.container?.querySelector?.(selector) ||
      this.container?.querySelector?.(fallbackSelector) ||
      this.container?.querySelector?.(".focusable");
    if (!node) return;
    node.classList.add("focused");
    focusNode(node);
    this.focusKey = String(node.dataset.focusKey || this.focusKey || "");
    scrollSettingsContentItem(node);
  },

  focusTarget(node) {
    if (!node) return;
    this.container
      ?.querySelectorAll?.(".focusable.focused")
      .forEach((entry) => entry.classList.remove("focused"));
    node.classList.add("focused");
    focusNode(node);
    this.focusKey = String(node.dataset.focusKey || "");
    scrollSettingsContentItem(node);
  },

  getDirectionalTarget(current, direction) {
    if (!current || this.dialog) {
      const nodes = visibleFocusableNodes(
        this.dialog ? this.container.querySelector(".supporters-dialog") : this.container
      );
      return findDirectionalTarget(nodes, current, direction);
    }

    if (current.dataset.action === "openItem" && (direction === "up" || direction === "down")) {
      const tab = String(current.dataset.tab || this.selectedTab);
      const items = sortedTabListItems(this.container, tab);
      const currentIndex = items.indexOf(current);
      if (direction === "down") {
        return items[currentIndex + 1] || null;
      }
      if (currentIndex > 0) {
        return items[currentIndex - 1];
      }
      return this.container.querySelector(`.supporters-tab[data-tab="${this.selectedTab}"]`);
    }

    if (current.dataset.action === "openItem" && (direction === "left" || direction === "right")) {
      const tab = String(current.dataset.tab || this.selectedTab);
      const tabIndex = TABS.indexOf(tab);
      const nextTab = TABS[tabIndex + (direction === "left" ? -1 : 1)];
      return nextTab
        ? this.container.querySelector(`.supporters-tab[data-tab="${nextTab}"]`)
        : null;
    }

    if (current.dataset.action === "selectTab" && direction === "down") {
      return sortedTabListItems(this.container, this.selectedTab)[0] || null;
    }

    if (current.dataset.action === "selectTab" && (direction === "left" || direction === "right")) {
      const tabs = Array.from(this.container?.querySelectorAll?.(".supporters-tab") || []);
      const currentIndex = tabs.indexOf(current);
      const nextIndex = currentIndex + (direction === "left" ? -1 : 1);
      return tabs[nextIndex] || null;
    }

    const nodes = visibleFocusableNodes(this.container);
    return findDirectionalTarget(nodes, current, direction);
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(".focusable, [data-action]");
    if (!target || !this.container?.contains?.(target)) return;
    if (target.classList?.contains("supporters-dialog-backdrop") && event?.target !== target)
      return;
    const focusable = target.classList.contains("focusable")
      ? target
      : target.closest(".focusable");
    if (focusable) this.focusTarget(focusable);
    const handled = await this.activateTarget(target);
    if (handled) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }
  },

  async activateTarget(target) {
    const action = String(target?.dataset?.action || "");
    if (!action) return false;
    if (action === "selectTab") {
      await this.selectTab(String(target.dataset.tab || DEFAULT_TAB));
      return true;
    }
    if (action === "showDonateQr") {
      this.showDonateQr = true;
      this.focusKey = "brand:back";
      await this.render();
      return true;
    }
    if (action === "hideDonateQr") {
      this.showDonateQr = false;
      this.focusKey = "brand:donate";
      await this.render();
      return true;
    }
    if (action === "retry") {
      await this.loadTabIfNeeded(this.selectedTab, true);
      return true;
    }
    if (action === "openItem") {
      const tab = String(target.dataset.tab || this.selectedTab);
      const index = Number(target.dataset.itemIndex || 0);
      const item = this.state?.[tab]?.items?.[index];
      if (item) {
        this.dialog = { type: tab, item, returnFocusKey: this.focusKey, showSupportQr: false };
        this.focusKey = "dialog:primary";
        await this.render();
      }
      return true;
    }
    if (action === "closeDialog") {
      const returnFocusKey = this.dialog?.returnFocusKey;
      this.dialog = null;
      this.focusKey = returnFocusKey || `tab:${this.selectedTab}`;
      this.preserveListScrollAfterFocus = true;
      await this.render();
      return true;
    }
    if (action === "openDonations") {
      window.open?.(normalizeBaseUrl(DONATIONS_BASE_URL), "_blank");
      return true;
    }
    if (action === "openSponsor") {
      const url = this.dialog?.item?.channelUrl;
      if (url) window.open?.(url, "_blank");
      return true;
    }
    return false;
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const key = String(event?.key || "");
    if (
      Platform.isBackEvent(event) ||
      code === 27 ||
      key === "Escape" ||
      key === "Esc" ||
      key === "Backspace"
    ) {
      event?.preventDefault?.();
      return this.handleBack();
    }
    const direction =
      code === 37
        ? "left"
        : code === 38
          ? "up"
          : code === 39
            ? "right"
            : code === 40
              ? "down"
              : null;
    if (direction) {
      event?.preventDefault?.();
      const nodes = visibleFocusableNodes(
        this.dialog ? this.container.querySelector(".supporters-dialog") : this.container
      );
      const current = this.container.querySelector(".focusable.focused") || nodes[0];
      const target = this.getDirectionalTarget(current, direction);
      if (target) {
        this.focusTarget(target);
        if (target.dataset.action === "selectTab" && target.dataset.tab !== this.selectedTab) {
          await this.selectTab(String(target.dataset.tab || DEFAULT_TAB), { focus: true });
        }
      }
      return;
    }
    const isActivate =
      code === 13 ||
      code === 23 ||
      ["Enter", "NumpadEnter", "OK", "Select"].includes(String(event?.key || ""));
    if (!isActivate) return;
    event?.preventDefault?.();
    const current = this.container.querySelector(".focusable.focused");
    await this.activateTarget(current);
  },

  consumeBackRequest() {
    if (!this.dialog && !this.showDonateQr) {
      return false;
    }
    void this.handleBack();
    return true;
  },

  async handleBack() {
    if (this.dialog) {
      const returnFocusKey = this.dialog.returnFocusKey;
      this.dialog = null;
      this.focusKey = returnFocusKey || `tab:${this.selectedTab}`;
      this.preserveListScrollAfterFocus = true;
      await this.render();
      return;
    }
    if (this.showDonateQr) {
      this.showDonateQr = false;
      this.focusKey = "brand:donate";
      await this.render();
      return;
    }
    Router.back();
  },

  onPointerFocus(target) {
    if (!target) return;
    this.focusKey = String(target.dataset.focusKey || this.focusKey || "");
    if (
      target.dataset.action === "selectTab" &&
      target.dataset.tab &&
      target.dataset.tab !== this.selectedTab
    ) {
      void this.selectTab(String(target.dataset.tab), { focus: true });
    }
  },

  async onPointerActivate(target) {
    return await this.activateTarget(target);
  }
};
