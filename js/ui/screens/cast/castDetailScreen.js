import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";
import { Environment } from "../../../platform/environment.js";
import { I18n } from "../../../i18n/index.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w780";
const POSTER_HOLD_DELAY_MS = 650;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function toImage(path) {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${IMAGE_BASE_URL}${value}`;
  }
  return value;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function toType(mediaType) {
  const value = String(mediaType || "").toLowerCase();
  if (value === "tv" || value === "series" || value === "show") {
    return "series";
  }
  return "movie";
}

export const CastDetailScreen = {
  async mount(params = {}) {
    this.container = document.getElementById("castDetail");
    ScreenUtils.show(this.container);
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    this.person = null;
    this.credits = [];
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    this.pendingPosterHoldTarget = null;
    this.pendingPosterHoldTimer = null;

    this.renderLoading();
    await this.loadCastDetails();
  },

  async getPersonIdFromName(name) {
    const settings = TmdbSettingsStore.get();
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey || !name) {
      return null;
    }
    const language = settings.language || "en-US";
    const url = `${TMDB_BASE_URL}/search/person?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&query=${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    return first?.id ? String(first.id) : null;
  },

  async loadCastDetails() {
    const token = this.loadToken;
    try {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || "").trim();
      if (!apiKey) {
        this.renderError("TMDB API key not configured.");
        return;
      }
      let personId = String(this.params?.castId || "").trim();
      if (!personId || !/^\d+$/.test(personId)) {
        personId = await this.getPersonIdFromName(this.params?.castName || "");
      }
      if (!personId) {
        this.renderError("Cast profile not found.");
        return;
      }

      const language = settings.language || "en-US";
      const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&append_to_response=combined_credits,images`;
      const response = await fetch(url);
      if (!response.ok) {
        this.renderError("Failed to load cast details.");
        return;
      }
      const person = await response.json();
      if (token !== this.loadToken) {
        return;
      }
      this.person = {
        id: String(person?.id || personId),
        name: person?.name || this.params?.castName || "Unknown",
        biography: person?.biography || "",
        birthday: person?.birthday || "",
        placeOfBirth: person?.place_of_birth || "",
        knownForDepartment: person?.known_for_department || "",
        profile: toImage(person?.profile_path || this.params?.castPhoto || "")
      };
      const credits = Array.isArray(person?.combined_credits?.cast)
        ? person.combined_credits.cast
        : [];
      this.credits = credits
        .map((item) => ({
          id: item?.id ? String(item.id) : "",
          itemId: item?.imdb_id || item?.id ? String(item.imdb_id || item.id) : "",
          type: toType(item?.media_type),
          name: item?.title || item?.name || "Untitled",
          subtitle: item?.character || "",
          poster: toImage(item?.poster_path || item?.backdrop_path || ""),
          popularity: Number(item?.popularity || 0)
        }))
        .filter((item) => Boolean(item.itemId))
        .sort((left, right) => right.popularity - left.popularity)
        .slice(0, 30);

      this.render();
    } catch (error) {
      console.warn("Cast detail load failed", error);
      this.renderError("Failed to load cast details.");
    }
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-loading">Loading cast profile...</div>
      </div>
    `;
  },

  renderError(message) {
    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-error">${message}</div>
        <button class="cast-detail-back focusable" data-action="back">Back</button>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  render() {
    const person = this.person || {};
    const creditsHtml = this.credits.length
      ? this.credits
          .map(
            (item) => `
          <article class="cast-credit-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.itemId}"
                   data-item-type="${item.type}"
                   data-item-title="${item.name}"
                   data-poster-src="${item.poster || ""}"
                   data-backdrop-src="${item.poster || ""}">
            <div class="cast-credit-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
            <div class="cast-credit-title">${item.name}</div>
            <div class="cast-credit-subtitle">${item.subtitle || item.type}</div>
          </article>
        `
          )
          .join("")
      : `<div class="cast-credit-empty">No titles found for this cast member.</div>`;

    this.container.innerHTML = `
      <div class="cast-detail-shell">
        <section class="cast-detail-hero">
          <button class="cast-detail-back focusable" data-action="back">Back</button>
          <div class="cast-detail-hero-content">
            <div class="cast-detail-avatar"${person.profile ? ` style="background-image:url('${person.profile}')"` : ""}></div>
            <div class="cast-detail-meta">
              <h2 class="cast-detail-name">${person.name || "Unknown"}</h2>
              <div class="cast-detail-facts">
                ${person.knownForDepartment ? `<span>${person.knownForDepartment}</span>` : ""}
                ${person.birthday ? `<span>${person.birthday}</span>` : ""}
                ${person.placeOfBirth ? `<span>${person.placeOfBirth}</span>` : ""}
              </div>
              <p class="cast-detail-bio">${person.biography || "No biography available."}</p>
            </div>
          </div>
        </section>
        <section class="cast-detail-credits">
          <h3 class="cast-detail-section-title">${t("cast_detail_known_for", {}, "Known For")}</h3>
          <div class="cast-credit-track">${creditsHtml}</div>
        </section>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  isPosterHoldTarget(node) {
    return (
      node instanceof HTMLElement &&
      node.classList.contains("cast-credit-card") &&
      String(node.dataset.action || "") === "openDetail"
    );
  },

  cancelPendingPosterHold() {
    if (this.pendingPosterHoldTimer) {
      clearTimeout(this.pendingPosterHoldTimer);
      this.pendingPosterHoldTimer = null;
    }
    this.pendingPosterHoldTarget = null;
  },

  hasPendingPosterHold(node) {
    return this.pendingPosterHoldTarget === node && Boolean(this.pendingPosterHoldTimer);
  },

  startPendingPosterHold(node) {
    this.cancelPendingPosterHold();
    if (!this.isPosterHoldTarget(node)) {
      return;
    }
    this.pendingPosterHoldTarget = node;
    this.pendingPosterHoldTimer = setTimeout(() => {
      this.pendingPosterHoldTimer = null;
      const target = this.pendingPosterHoldTarget;
      this.pendingPosterHoldTarget = null;
      if (target?.isConnected && target.classList.contains("focused")) {
        void this.openPosterOptionsMenu(target);
      }
    }, POSTER_HOLD_DELAY_MS);
  },

  completePendingPosterHold(node, event = null) {
    if (!this.pendingPosterHoldTarget) {
      return false;
    }
    const target = this.pendingPosterHoldTarget;
    const hadTimer = Boolean(this.pendingPosterHoldTimer);
    const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= POSTER_HOLD_DELAY_MS;
    this.cancelPendingPosterHold();
    if (hadTimer && target === node) {
      if (heldLongEnough) {
        void this.openPosterOptionsMenu(target);
      } else {
        this.openDetailFromNode(target);
      }
    }
    return true;
  },

  async openPosterOptionsMenu(node) {
    const item = posterItemFromNode(node);
    if (!item?.id) {
      return false;
    }
    this.posterOptionsFocusRestore = String(item.id || "").trim();
    if (!this.posterOptionsController) {
      this.posterOptionsController = new PosterOptionsDialogController({
        onDetails: (target) => {
          Router.navigate("detail", {
            itemId: target.id,
            itemType: target.type || "movie",
            fallbackTitle: target.title || "Untitled"
          });
        },
        onDismiss: () => {
          const itemId = this.posterOptionsFocusRestore;
          this.posterOptionsFocusRestore = null;
          const target = itemId
            ? this.container?.querySelector(
                `.cast-credit-card.focusable[data-item-id="${String(itemId).replace(/["\\]/g, "\\$&")}"]`
              )
            : null;
          if (!target) {
            return;
          }
          this.container.querySelectorAll(".focusable.focused").forEach((current) => {
            if (current !== target) current.classList.remove("focused");
          });
          target.classList.add("focused");
          target.focus?.({ preventScroll: true });
        }
      });
    }
    return this.posterOptionsController.open(item);
  },

  closePosterOptionsMenu() {
    if (!this.posterOptionsController?.dialog) {
      return false;
    }
    this.posterOptionsController.destroy();
    this.posterOptionsFocusRestore = null;
    return true;
  },

  openDetailFromNode(node) {
    Router.navigate("detail", {
      itemId: node.dataset.itemId,
      itemType: node.dataset.itemType || "movie",
      fallbackTitle: node.dataset.itemTitle || "Untitled"
    });
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    const current = this.container?.querySelector(".focusable.focused") || null;
    const isPosterHoldTarget = this.isPosterHoldTarget(current);
    if (!isPosterHoldTarget || code !== 13) {
      this.cancelPendingPosterHold();
    }

    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (code !== 13) {
      return;
    }
    if (!current) {
      return;
    }
    if (code === 13 && isPosterHoldTarget) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingPosterHold(current)) {
        this.startPendingPosterHold(current);
      }
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "back") {
      Router.back();
      return;
    }
    if (action === "openDetail") {
      this.openDetailFromNode(current);
    }
  },

  onKeyUp(event) {
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }
    const current = this.container?.querySelector(".cast-credit-card.focusable.focused") || null;
    if (this.completePendingPosterHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  consumeBackRequest() {
    return this.closePosterOptionsMenu();
  },

  cleanup() {
    this.loadToken = (this.loadToken || 0) + 1;
    this.cancelPendingPosterHold();
    this.posterOptionsController?.destroy?.({ restoreFocus: false });
    this.posterOptionsController = null;
    this.posterOptionsFocusRestore = null;
    ScreenUtils.hide(this.container);
  }
};
