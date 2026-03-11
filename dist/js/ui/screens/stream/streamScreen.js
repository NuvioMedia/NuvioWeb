import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { Environment } from "../../../platform/environment.js";

function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4K";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  return "Auto";
}

function flattenStreams(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  return (streamResult.data || []).flatMap((group) => {
    const groupName = group.addonName || "Addon";
    return (group.streams || []).map((stream, index) => ({
      id: `${groupName}-${index}-${stream.url || ""}`,
      label: stream.title || stream.name || `${groupName} stream`,
      description: stream.description || stream.name || "",
      addonName: groupName,
      addonLogo: group.addonLogo || stream.addonLogo || null,
      sourceType: stream.type || stream.source || "",
      url: stream.url,
      raw: stream
    })).filter((entry) => Boolean(entry.url));
  });
}

function mergeStreamItems(existing = [], incoming = []) {
  const byKey = new Set();
  const merged = [];
  const push = (item) => {
    if (!item?.url) {
      return;
    }
    const key = [
      String(item.addonName || "Addon"),
      String(item.url || ""),
      String(item.sourceType || ""),
      String(item.label || "")
    ].join("::");
    if (byKey.has(key)) {
      return;
    }
    byKey.add(key);
    merged.push(item);
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return merged;
}

function normalizeType(itemType) {
  const normalized = String(itemType || "movie").toLowerCase();
  if (normalized === "tv") {
    return "series";
  }
  return normalized || "movie";
}

export const StreamScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("stream");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loading = true;
    this.streams = [];
    this.addonFilter = "all";
    this.focusState = { zone: "filter", index: 0 };
    this.loadToken = (this.loadToken || 0) + 1;

    this.render();
    await this.loadStreams();
  },

  async loadStreams() {
    const token = this.loadToken;
    const itemType = normalizeType(this.params?.itemType);
    const videoId = String(this.params?.videoId || this.params?.itemId || "");
    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onChunk: (chunkResult) => {
        if (token !== this.loadToken) {
          return;
        }
        const chunkItems = flattenStreams(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        this.streams = mergeStreamItems(this.streams, chunkItems);
        this.render();
      }
    };
    const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, videoId, options);
    if (token !== this.loadToken) {
      return;
    }
    this.streams = mergeStreamItems(this.streams, flattenStreams(streamResult));
    this.loading = false;
    this.render();
  },

  getFilteredStreams() {
    if (this.addonFilter === "all") {
      return this.streams;
    }
    return this.streams.filter((stream) => stream.addonName === this.addonFilter);
  },

  focusList(list, index) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const targetIndex = Math.max(0, Math.min(list.length - 1, index));
    const target = list[targetIndex];
    if (!target) {
      return false;
    }
    this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    const verticalList = target.closest(".series-stream-list");
    if (verticalList) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return true;
  },

  getFocusLists() {
    const filters = Array.from(this.container.querySelectorAll(".series-stream-filter.focusable"));
    const cards = Array.from(this.container.querySelectorAll(".series-stream-card.focusable"));
    const selectedFilterIndex = Math.max(0, filters.findIndex((node) => node.classList.contains("selected")));
    return { filters, cards, selectedFilterIndex };
  },

  syncFocusFromDom() {
    const { filters, cards, selectedFilterIndex } = this.getFocusLists();
    const active = document.activeElement;
    const filterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === active);
    if (filterIndex >= 0) {
      this.focusState = { zone: "filter", index: filterIndex };
      return;
    }
    const cardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === active);
    if (cardIndex >= 0) {
      this.focusState = { zone: "card", index: cardIndex };
      return;
    }
    this.focusState = { zone: filters.length ? "filter" : "card", index: selectedFilterIndex };
  },

  applyFocus() {
    const { filters, cards, selectedFilterIndex } = this.getFocusLists();
    if (!filters.length && !cards.length) {
      return;
    }
    let zone = this.focusState?.zone || "filter";
    let index = Number(this.focusState?.index || 0);
    if (zone === "filter" && !filters.length && cards.length) {
      zone = "card";
      index = 0;
    } else if (zone === "card" && !cards.length && filters.length) {
      zone = "filter";
      index = selectedFilterIndex;
    }
    if (zone === "filter") {
      index = Math.max(0, Math.min(filters.length - 1, index));
      this.focusState = { zone, index };
      this.focusList(filters, index);
      return;
    }
    index = Math.max(0, Math.min(cards.length - 1, index));
    this.focusState = { zone: "card", index };
    this.focusList(cards, index);
  },

  getHeaderMeta() {
    const isSeries = normalizeType(this.params?.itemType) === "series";
    const title = String(this.params?.itemTitle || this.params?.playerTitle || "Untitled");
    const subtitle = isSeries
      ? String(this.params?.episodeTitle || this.params?.playerSubtitle || "").trim()
      : String(this.params?.itemSubtitle || "").trim();
    const episodeLabel = isSeries && Number.isFinite(Number(this.params?.season)) && Number.isFinite(Number(this.params?.episode))
      ? `S${Number(this.params.season)} E${Number(this.params.episode)}`
      : "";
    return { isSeries, title, subtitle, episodeLabel };
  },

  render() {
    const { isSeries, title, subtitle, episodeLabel } = this.getHeaderMeta();
    const addons = Array.from(new Set(this.streams.map((stream) => stream.addonName).filter(Boolean)));
    const filtered = this.getFilteredStreams();
    const backdrop = this.params?.backdrop || this.params?.poster || "";
    const logo = this.params?.logo || "";

    const filterTabs = [
      `<button class="series-stream-filter focusable${this.addonFilter === "all" ? " selected" : ""}" data-action="setFilter" data-addon="all">All</button>`,
      ...addons.map((addon) => `
        <button class="series-stream-filter focusable${this.addonFilter === addon ? " selected" : ""}" data-action="setFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
    ].join("");

    const streamCards = filtered.length
      ? filtered.map((stream) => `
          <article class="series-stream-card focusable" data-action="playStream" data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("")
      : this.loading
        ? `<div class="series-stream-empty">Loading streams...</div>`
        : `<div class="series-stream-empty">No streams found for this filter.</div>`;

    this.container.innerHTML = `
      <div class="series-detail-shell stream-screen-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>
        <div class="series-stream-panel stream-screen-panel">
          <div class="series-stream-left stream-screen-left">
            ${logo ? `<img src="${logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${title}</div>`}
            ${episodeLabel ? `<div class="series-stream-episode">${episodeLabel}</div>` : `<div class="series-stream-episode">${title}</div>`}
            <div class="series-stream-episode-title">${subtitle || (isSeries ? "Select a source to start episode playback." : "Select a source to start playback.")}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    this.applyFocus();
  },

  playStream(streamId) {
    const filtered = this.getFilteredStreams();
    const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
    if (!selected?.url) {
      return;
    }
    const isSeries = normalizeType(this.params?.itemType) === "series";
    Router.navigate("player", {
      streamUrl: selected.url,
      itemId: this.params?.itemId || null,
      itemType: isSeries ? "series" : "movie",
      videoId: this.params?.videoId || null,
      episodeLabel: this.params?.season && this.params?.episode
        ? `S${this.params.season}E${this.params.episode}`
        : null,
      playerTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
      playerSubtitle: this.params?.episodeTitle || this.params?.playerSubtitle || "",
      playerBackdropUrl: this.params?.backdrop || this.params?.poster || null,
      playerLogoUrl: this.params?.logo || null,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode),
      episodes: Array.isArray(this.params?.episodes) ? this.params.episodes : [],
      streamCandidates: filtered,
      nextEpisodeVideoId: this.params?.nextEpisodeVideoId || null,
      nextEpisodeLabel: this.params?.nextEpisodeLabel || null
    });
  },

  onKeyDown(event) {
    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }

    const direction = getDpadDirection(event);
    if (direction) {
      const { filters, cards, selectedFilterIndex } = this.getFocusLists();
      const hasValidLocalFocus =
        this.focusState
        && ((this.focusState.zone === "filter" && filters.length && Number(this.focusState.index) >= 0 && Number(this.focusState.index) < filters.length)
          || (this.focusState.zone === "card" && cards.length && Number(this.focusState.index) >= 0 && Number(this.focusState.index) < cards.length));
      if (!hasValidLocalFocus) {
        this.syncFocusFromDom();
      }

      let zone = this.focusState?.zone || (filters.length ? "filter" : "card");
      let index = Number(this.focusState?.index || 0);
      if (zone === "filter" && !filters.length && cards.length) {
        zone = "card";
        index = Math.min(cards.length - 1, Math.max(0, index));
      } else if (zone === "card" && !cards.length && filters.length) {
        zone = "filter";
        index = selectedFilterIndex;
      }
      if (zone === "filter" && filters.length) {
        const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
        if (focusedFilterIndex >= 0) {
          index = focusedFilterIndex;
        }
      } else if (zone === "card" && cards.length) {
        const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
        if (focusedCardIndex >= 0) {
          index = focusedCardIndex;
        }
      }

      event?.preventDefault?.();

      if (zone === "filter") {
        if (direction === "left") {
          this.focusState = { zone: "filter", index: Math.max(0, index - 1) };
          this.applyFocus();
          return;
        }
        if (direction === "right") {
          this.focusState = { zone: "filter", index: Math.min(filters.length - 1, index + 1) };
          this.applyFocus();
          return;
        }
        if (direction === "down" && cards.length) {
          this.focusState = { zone: "card", index: Math.min(index, cards.length - 1) };
          this.applyFocus();
        }
        return;
      }

      if (zone === "card") {
        if (direction === "up") {
          if (index > 0) {
            this.focusState = { zone: "card", index: index - 1 };
          } else if (filters.length) {
            this.focusState = { zone: "filter", index: selectedFilterIndex };
          }
          this.applyFocus();
          return;
        }
        if (direction === "down") {
          this.focusState = { zone: "card", index: Math.min(cards.length - 1, index + 1) };
          this.applyFocus();
          return;
        }
        return;
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
    if (action === "setFilter") {
      this.addonFilter = current.dataset.addon || "all";
      const order = ["all", ...Array.from(new Set(this.streams.map((stream) => stream.addonName).filter(Boolean)))];
      this.focusState = { zone: "filter", index: Math.max(0, order.indexOf(this.addonFilter)) };
      this.render();
      return;
    }
    if (action === "playStream") {
      this.playStream(current.dataset.streamId);
    }
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    ScreenUtils.hide(this.container);
  }

};
