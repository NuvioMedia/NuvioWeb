import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { catalogRepository } from "../../../data/repository/catalogRepository.js";
import { Environment } from "../../../platform/environment.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { focusWithoutAutoScroll } from "../../components/sidebarNavigation.js";

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

function extractReleaseYear(item = {}) {
  const candidates = [
    item?.released,
    item?.releaseDate,
    item?.release_date,
    item?.releaseInfo,
    item?.year
  ].filter(Boolean);

  for (const value of candidates) {
    const match = String(value).match(/\b(19|20)\d{2}\b/);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function groupNodesByOffsetTop(nodes = []) {
  const grouped = [];
  nodes.forEach((node) => {
    const top = Math.round(node.offsetTop);
    const bucket = grouped.find((entry) => Math.abs(entry.top - top) <= 6);
    if (bucket) {
      bucket.nodes.push(node);
      return;
    }
    grouped.push({ top, nodes: [node] });
  });
  grouped.sort((left, right) => left.top - right.top);
  return grouped.map((entry) => entry.nodes);
}

function setContainerScrollTop(container, top, behavior = "auto") {
  if (!(container instanceof HTMLElement)) {
    return 0;
  }
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const resolvedTop = Math.max(0, Math.min(maxScrollTop, Number(top || 0)));
  if (behavior === "smooth") {
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: resolvedTop, behavior: "smooth" });
    } else {
      container.scrollTop = resolvedTop;
    }
    return resolvedTop;
  }

  const previousBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = "auto";
  container.scrollTop = resolvedTop;
  void container.offsetHeight;
  container.style.scrollBehavior = previousBehavior;
  return resolvedTop;
}

function scrollNodeIntoContainerView(node, container, { center = false, padding = 18, behavior = "smooth" } = {}) {
  if (!(node instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return null;
  }
  const itemTop = node.offsetTop;
  const itemBottom = itemTop + node.offsetHeight;
  const currentTop = container.scrollTop;
  const viewTop = currentTop + padding;
  const viewBottom = currentTop + container.clientHeight - padding;
  let nextScrollTop = currentTop;

  if (center) {
    nextScrollTop = itemTop - ((container.clientHeight - node.offsetHeight) / 2);
  } else if (itemTop < viewTop) {
    nextScrollTop = itemTop - padding;
  } else if (itemBottom > viewBottom) {
    nextScrollTop = itemBottom - container.clientHeight + padding;
  }
  const resolvedTop = Math.max(0, nextScrollTop);
  if (Math.abs(resolvedTop - currentTop) <= 1) {
    return resolvedTop;
  }
  if (behavior === "smooth") {
    container.scrollTo({
      top: resolvedTop,
      behavior: "smooth"
    });
  } else {
    setContainerScrollTop(container, resolvedTop, "auto");
  }
  return resolvedTop;
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
    this.preserveViewportOnNextRender = false;
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
    this.preserveViewportOnNextRender = false;
    this.savedScrollTop = 0;
    this.loadToken = (this.loadToken || 0) + 1;

    if (navigationContext?.isBackNavigation && this.hydrateFromRouteState(navigationContext?.restoredState || null, params)) {
      this.loading = false;
      this.render();
      return;
    }

    this.render();
    if (!this.items.length) {
      await this.loadNextPage();
    }
  },

  async loadNextPage({ preserveViewport = false } = {}) {
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
    this.preserveViewportOnNextRender = Boolean(preserveViewport);
    if (!preserveViewport) {
      this.render();
    }
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
      this.preserveViewportOnNextRender = false;
      this.render();
      return;
    }
    const incoming = Array.isArray(result?.data?.items) ? result.data.items : [];
    let addedCount = 0;
    if (incoming.length) {
      const seen = new Set(this.items.map((item) => item.id));
      incoming.forEach((item) => {
        if (!item?.id || seen.has(item.id)) {
          return;
        }
        seen.add(item.id);
        this.items.push(item);
        addedCount += 1;
      });
      this.nextSkip = skip + 100;
    }
    this.hasMore = incoming.length > 0;
    this.loading = false;
    this.pendingRestoreFocus = true;
    this.preserveViewportOnNextRender = Boolean(preserveViewport && addedCount > 0);
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

  shouldAutoLoadMore(index) {
    if (this.loading || !this.hasMore) {
      return false;
    }
    const remaining = (this.items.length - 1) - Number(index || 0);
    return remaining <= 10;
  },

  shouldAutoLoadMoreFromScroll(shell) {
    if (!(shell instanceof HTMLElement) || this.loading || !this.hasMore) {
      return false;
    }
    const remaining = shell.scrollHeight - (shell.scrollTop + shell.clientHeight);
    return remaining <= 640;
  },

  buildNavigationModel() {
    const cards = Array.from(this.container?.querySelectorAll(".seeall-card.focusable") || []);
    const rows = groupNodesByOffsetTop(cards);
    rows.forEach((rowNodes, rowIndex) => {
      rowNodes.forEach((node, colIndex) => {
        node.dataset.navRow = String(rowIndex);
        node.dataset.navCol = String(colIndex);
      });
    });
    this.navModel = { rows };
  },

  rememberRowFocus(node) {
    if (!node?.dataset) {
      return;
    }
    const row = Number(node.dataset.navRow || -1);
    const col = Number(node.dataset.navCol || 0);
    if (row < 0) {
      return;
    }
    this.rowFocusedIndexByRow = {
      ...(this.rowFocusedIndexByRow || {}),
      [row]: Math.max(0, col)
    };
  },

  resolvePreferredNodeForRow(rowNodes = []) {
    if (!Array.isArray(rowNodes) || !rowNodes.length) {
      return null;
    }
    const rowIndex = Number(rowNodes[0]?.dataset?.navRow || -1);
    const storedIndex = rowIndex >= 0 ? Number(this.rowFocusedIndexByRow?.[rowIndex]) : Number.NaN;
    const preferredIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return rowNodes[Math.max(0, Math.min(rowNodes.length - 1, preferredIndex))] || rowNodes[0];
  },

  focusNode(target) {
    if (!target) {
      return false;
    }
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.lastFocusedKey = target.dataset.focusKey || this.lastFocusedKey;
    this.rememberRowFocus(target);
    const shell = this.container?.querySelector(".seeall-shell") || null;
    const isFirstRow = Number(target.dataset.navRow || 0) === 0;
    const shouldLoadMore = this.shouldAutoLoadMore(target.dataset.itemIndex);
    const nextScrollTop = isFirstRow
      ? setContainerScrollTop(shell, 0, "smooth")
      : scrollNodeIntoContainerView(target, shell, {
        center: false,
        padding: 20,
        behavior: shouldLoadMore ? "auto" : "smooth"
      });
    if (Number.isFinite(nextScrollTop)) {
      this.savedScrollTop = nextScrollTop;
    }
    if (shouldLoadMore) {
      this.loadNextPage({ preserveViewport: true });
    }
    return true;
  },

  handleGridDpad(event) {
    const code = Number(event?.keyCode || 0);
    const direction = code === 38 ? "up"
      : code === 40 ? "down"
        : code === 37 ? "left"
          : code === 39 ? "right"
            : null;
    if (!direction) {
      return false;
    }

    const nav = this.navModel;
    const current = this.container?.querySelector(".seeall-card.focused") || null;
    if (!nav?.rows?.length || !current) {
      return false;
    }

    event?.preventDefault?.();

    const row = Number(current.dataset.navRow || 0);
    const col = Number(current.dataset.navCol || 0);
    const rowNodes = nav.rows[row] || [];

    if (direction === "left") {
      return this.focusNode(rowNodes[col - 1] || current) || true;
    }

    if (direction === "right") {
      return this.focusNode(rowNodes[col + 1] || current) || true;
    }

    if (direction === "up" || direction === "down") {
      const delta = direction === "up" ? -1 : 1;
      const targetRowNodes = nav.rows[row + delta] || null;
      if (!targetRowNodes?.length) {
        if (direction === "up" && row === 0) {
          const shell = this.container?.querySelector(".seeall-shell") || null;
          this.savedScrollTop = setContainerScrollTop(shell, 0, "smooth");
        }
        return true;
      }
      return this.focusNode(this.resolvePreferredNodeForRow(targetRowNodes)) || true;
    }

    return false;
  },

  restoreFocusedCard({ scrollMode = "center" } = {}) {
    const shell = this.container?.querySelector(".seeall-shell");
    const target = (this.lastFocusedKey
      ? this.container?.querySelector(`.seeall-card[data-focus-key="${this.lastFocusedKey}"]`)
      : null)
      || this.container?.querySelector(".seeall-card.focusable")
      || null;

    if (shell) {
      this.savedScrollTop = setContainerScrollTop(shell, this.savedScrollTop, "auto");
    }

    if (!target) {
      return;
    }

    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) node.classList.remove("focused");
    });
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    this.rememberRowFocus(target);
    if (scrollMode !== "none") {
      scrollNodeIntoContainerView(target, shell, { center: scrollMode === "center", padding: 20 });
    }
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
            <div class="seeall-card-poster-wrap">
              ${item.poster
                ? `<img class="seeall-card-poster-image" src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.name || "content")}" />`
                : `<div class="seeall-card-poster placeholder"></div>`}
            </div>
            ${this.layoutPrefs?.posterLabelsEnabled !== false ? `
              <div class="seeall-card-title">${escapeHtml(item.name || "Untitled")}</div>
              <div class="seeall-card-year">${escapeHtml(extractReleaseYear(item))}</div>
            ` : ""}
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
    this.buildNavigationModel();
    this.bindCardEvents();
    this.bindShellEvents();
    if (this.pendingRestoreFocus) {
      const scrollMode = this.preserveViewportOnNextRender ? "none" : "center";
      this.pendingRestoreFocus = false;
      this.preserveViewportOnNextRender = false;
      this.restoreFocusedCard({ scrollMode });
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
      });
      node.addEventListener("mouseenter", () => {
        this.lastFocusedKey = node.dataset.focusKey || this.lastFocusedKey;
      });
    });
  },

  bindShellEvents() {
    const shell = this.container?.querySelector(".seeall-shell") || null;
    if (!shell || shell.__catalogSeeAllShellBound) {
      return;
    }
    shell.__catalogSeeAllShellBound = true;
    shell.addEventListener("scroll", () => {
      this.savedScrollTop = Number(shell.scrollTop || 0);
      if (this.shouldAutoLoadMoreFromScroll(shell)) {
        this.loadNextPage({ preserveViewport: true });
      }
    }, { passive: true });
  },

  async onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }
    if (this.handleGridDpad(event)) {
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
