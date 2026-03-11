import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { Environment } from "../../../platform/environment.js";

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export const CatalogSeeAllScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("catalogSeeAll");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.items = Array.isArray(params?.initialItems) ? [...params.initialItems] : [];
    this.nextSkip = this.items.length ? 100 : 0;
    this.loading = false;
    this.hasMore = true;
    this.loadToken = (this.loadToken || 0) + 1;

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
    this.render();
  },

  render() {
    const descriptor = this.params || {};
    const title = descriptor.catalogName
      ? `${descriptor.catalogName} - ${toTitleCase(descriptor.type)}`
      : "Catalog";
    const cards = this.items.length
      ? this.items.map((item) => `
          <article class="seeall-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.id}"
                   data-item-type="${item.type || descriptor.type || "movie"}"
                   data-item-title="${item.name || "Untitled"}">
            <div class="seeall-card-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
            <div class="seeall-card-title">${item.name || "Untitled"}</div>
            <div class="seeall-card-subtitle">${toTitleCase(item.type || descriptor.type || "movie")}</div>
          </article>
        `).join("")
      : `<div class="seeall-empty">No items available.</div>`;

    this.container.innerHTML = `
      <div class="seeall-shell">
        <header class="seeall-header">
          <button class="seeall-back focusable" data-action="back">Back</button>
          <h2 class="seeall-title">${title}</h2>
          <button class="seeall-load-more focusable${!this.hasMore || this.loading ? " disabled" : ""}"
                  data-action="loadMore"
                  ${!this.hasMore || this.loading ? "disabled" : ""}>
            ${this.loading ? "Loading..." : (this.hasMore ? "Load More" : "No More")}
          </button>
        </header>
        <section class="seeall-grid">
          ${cards}
        </section>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  async onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
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
    if (action === "back") {
      Router.back();
      return;
    }
    if (action === "loadMore") {
      await this.loadNextPage();
      return;
    }
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
