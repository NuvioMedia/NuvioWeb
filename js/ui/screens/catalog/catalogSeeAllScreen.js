import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { Environment } from "../../../platform/environment.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const CatalogSeeAllScreen = {

  getRouteStateKey(params = {}) {
    const addonBaseUrl = String(params?.addonBaseUrl || "").trim();
    const catalogId = String(params?.catalogId || "").trim();
    const type = String(params?.type || "movie").trim() || "movie";
    if (!addonBaseUrl || !catalogId) {
      return null;
    }
    return `catalogSeeAll:${addonBaseUrl}:${catalogId}:${type}`;
  },

  captureRouteState() {
    this.captureViewState();
    return {
      params: this.params ? { ...this.params } : {},
      items: Array.isArray(this.items) ? [...this.items] : [],
      nextSkip: Number(this.nextSkip || 0),
      hasMore: Boolean(this.hasMore),
      lastFocusedKey: this.lastFocusedKey ? String(this.lastFocusedKey) : null,
      savedScrollTop: Number(this.savedScrollTop || 0)
    };
  },

  hydrateFromRouteState(restoredState = null, params = {}) {
    const snapshot = restoredState && typeof restoredState === "object" ? restoredState : null;
    if (!snapshot?.params) {
      return false;
    }
    const currentKey = this.getRouteStateKey(params);
    const snapshotKey = this.getRouteStateKey(snapshot.params);
    if (!currentKey || !snapshotKey || currentKey !== snapshotKey) {
      return false;
    }
    this.params = params || {};
    this.items = Array.isArray(snapshot.items) ? [...snapshot.items] : [];
    this.nextSkip = Number(snapshot.nextSkip || 0);
    this.hasMore = Boolean(snapshot.hasMore);
    this.lastFocusedKey = snapshot.lastFocusedKey ? String(snapshot.lastFocusedKey) : null;
    this.savedScrollTop = Number(snapshot.savedScrollTop || 0);
    this.pendingRestoreFocus = true;
    return true;
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("catalogSeeAll");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.items = Array.isArray(params?.initialItems) ? [...params.initialItems] : [];
    this.nextSkip = this.items.length ? 100 : 0;
    this.layoutPrefs = LayoutPreferences.get();
    this.loading = false;
    this.hasMore = true;
    this.lastFocusedKey = this.items[0]?.id ? `item:${this.items[0].id}` : null;
    this.pendingRestoreFocus = false;
    this.savedScrollTop = 0;
    this.loadToken = (this.loadToken || 0) + 1;

    if (this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
      this.loading = false;
      this.render();
      return;
    }

    this.render();
    if (!this.items.length) {
      await this.loadNextPage();
    }
  },

  async loadNextPage() {
    if (this.loading || !this.hasMore) {
      return;
    }
    const descriptor = this.params || {};
    if (!descriptor.addonBaseUrl || !descriptor.catalogId || !descriptor.type) {
      this.hasMore = false;
      this.render();
      return;
    }
    this.loading = true;
    this.captureViewState();
    this.pendingRestoreFocus = true;
    this.render();
    const token = this.loadToken;
    const skip = Math.max(0, Number(this.nextSkip || 0));
    const result = await catalogRepository.getCatalog({
      addonBaseUrl: descriptor.addonBaseUrl,
      addonId: descriptor.addonId,
      addonName: descriptor.addonName,
      catalogId: descriptor.catalogId,
      catalogName: descriptor.catalogName,
      type: descriptor.type,
      skip,
      supportsSkip: true
    });
    if (token !== this.loadToken) {
      return;
    }
    if (result.status !== "success") {
      this.loading = false;
      this.hasMore = false;
      this.render();
      return;
    }
    const incoming = Array.isArray(result?.data?.items) ? result.data.items : [];
    if (incoming.length) {
      const seen = new Set(this.items.map((item) => item.id));
      incoming.forEach((item) => {
        if (!item?.id || seen.has(item.id)) {
          return;
        }
        seen.add(item.id);
        this.items.push(item);
      });
      this.nextSkip = skip + 100;
    }
    this.hasMore = incoming.length > 0;
    this.loading = false;
    this.pendingRestoreFocus = true;
    this.render();
  },

  captureViewState() {
    const shell = this.container?.querySelector(".seeall-shell");
    if (shell) {
      this.savedScrollTop = shell.scrollTop;
    }
    const focused = this.container?.querySelector(".seeall-card.focused");
    if (focused?.dataset?.focusKey) {
      this.lastFocusedKey = focused.dataset.focusKey;
    }
  },

  maybeAutoLoadMore(index) {
    if (this.loading || !this.hasMore) {
      return;
    }
    const remaining = (this.items.length - 1) - Number(index || 0);
    if (remaining <= 10) {
      this.loadNextPage();
    }
  },

  restoreFocusedCard() {
    const shell = this.container?.querySelector(".seeall-shell");
    const target = (this.lastFocusedKey
      ? this.container?.querySelector(`.seeall-card[data-focus-key="${this.lastFocusedKey}"]`)
      : null)
      || this.container?.querySelector(".seeall-card.focusable")
      || null;

    if (shell) {
      shell.scrollTop = Number(this.savedScrollTop || 0);
    }

    if (!target) {
      return;
    }

    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    target.focus();
    target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
  },

  render() {
    const descriptor = this.params || {};
    const title = descriptor.catalogName || "Catalog";
    const cards = this.items.length
      ? this.items.map((item, index) => `
          <article class="seeall-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.id || ""}"
                   data-item-type="${item.type || descriptor.type || "movie"}"
                   data-item-title="${escapeHtml(item.name || "Untitled")}"
                   data-focus-key="item:${item.id || index}"
                   data-item-index="${index}">
            <div class="seeall-card-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
            ${this.layoutPrefs?.posterLabelsEnabled !== false ? `<div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>` : ""}
          </article>
        `).join("")
      : `<div class="seeall-empty">No items available.</div>`;

    this.container.innerHTML = `
      <div class="seeall-shell">
        <header class="seeall-header">
          <h2 class="seeall-title">${escapeHtml(title)}</h2>
          ${this.layoutPrefs?.catalogAddonNameEnabled !== false && descriptor.addonName
            ? `<div class="seeall-subtitle">from ${escapeHtml(descriptor.addonName)}</div>`
            : ""}
        </header>
        <section class="seeall-grid">
          ${cards}
        </section>
        ${this.loading ? `<div class="seeall-loading">Loading...</div>` : ""}
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.bindCardEvents();
    if (this.pendingRestoreFocus) {
      this.pendingRestoreFocus = false;
      this.restoreFocusedCard();
      return;
    }
    ScreenUtils.setInitialFocus(this.container);
  },

  bindCardEvents() {
    this.container?.querySelectorAll(".seeall-card.focusable").forEach((node) => {
      if (node.__boundFocusHandlers) return;
      node.__boundFocusHandlers = true;
      node.addEventListener("focus", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
        this.savedScrollTop = this.container?.querySelector(".seeall-shell")?.scrollTop || 0;
        this.maybeAutoLoadMore(node.dataset.itemIndex);
      });
      node.addEventListener("mouseenter", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
      });
    });
  },

  async onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      const focused = this.container.querySelector(".seeall-card.focused");
      if (focused) {
        this.lastFocusedKey = focused.dataset.focusKey || this.lastFocusedKey;
        focused.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
        this.maybeAutoLoadMore(focused.dataset.itemIndex);
      }
      return;
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "openDetail") {
      Router.navigate("detail", {
        itemId: current.dataset.itemId,
        itemType: current.dataset.itemType || "movie",
        fallbackTitle: current.dataset.itemTitle || "Untitled"
      });
    }
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    ScreenUtils.hide(this.container);
  }

};
