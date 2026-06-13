import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { TraktAuthService } from "../../../data/repository/traktAuthService.js";
import { SettingsScreen, bindSettingsScrollIndicators, scrollSettingsContentItem } from "../settings/settingsScreen.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}

function captureTraktScrollState(container) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  return {
    traktScrollTop: Number(scrollArea?.scrollTop || 0)
  };
}

function restoreTraktScrollState(container, scrollState) {
  const scrollArea = container?.querySelector?.(".settings-trakt-scroll-area");
  if (scrollArea && scrollState) {
    scrollArea.scrollTop = Number(scrollState.traktScrollTop || 0);
  }
}

function formatCountdown(valueMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(valueMs || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export const TraktScreen = Object.assign(Object.create(SettingsScreen), {
  async mount() {
    this.container = document.getElementById("trakt");
    ScreenUtils.show(this.container);
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = this.contentFocusKey || null;
    this.optionDialog = this.optionDialog || null;
    this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
    this.traktRouteEnterPending = true;
    if (!this.handleClickBound) {
      this.handleClickBound = this.handleClickEvent.bind(this);
      this.container.addEventListener("click", this.handleClickBound);
    }
    await this.render();
    this.startTraktClock();
  },

  async render({ refreshModel = true } = {}) {
    const previousScrollState = captureTraktScrollState(this.container);
    if (refreshModel || !this.model) {
      this.model = { trakt: this.collectTraktModel() };
    }
    this.actionMap = new Map();
    const rawPanelHtml = this.renderTraktSection(this.model);
    const panelHtml = this.traktRouteEnterPending
      ? rawPanelHtml
      : rawPanelHtml.replace("settings-slide-panel ", "");
    this.actionMap.set("trakt:back", () => Router.back());
    this.container.innerHTML = `
      <div class="nav-screen trakt-route-shell${this.traktRouteEnterPending ? " trakt-route-enter" : ""}">
        <div class="nav-screen-body trakt-route-content">
          ${panelHtml}
        </div>
        <div data-trakt-dialog>${this.renderOptionDialog()}</div>
      </div>
    `;
    restoreTraktScrollState(this.container, previousScrollState);
    ScreenUtils.indexFocusables(this.container);
    bindSettingsScrollIndicators(this.container);
    this.traktRouteEnterPending = false;
    this.suppressNextContentFocusScroll = true;
    this.applyFocus();
    restoreTraktScrollState(this.container, previousScrollState);
    this.updateTraktCountdowns();
  },

  startTraktClock() {
    if (this.traktClockTimer) {
      return;
    }
    this.updateTraktCountdowns();
    this.traktClockTimer = setInterval(() => {
      if (Router.getCurrent() !== "trakt") {
        this.stopTraktClock();
        return;
      }
      this.updateTraktCountdowns();
    }, 1000);
  },

  stopTraktClock() {
    if (!this.traktClockTimer) {
      return;
    }
    clearInterval(this.traktClockTimer);
    this.traktClockTimer = null;
  },

  updateTraktCountdowns() {
    if (!this.container) {
      return;
    }
    const auth = TraktAuthService.getCurrentAuthState();
    const deviceCountdown = this.container.querySelector("[data-trakt-device-countdown]");
    if (deviceCountdown && auth.expiresAt) {
      deviceCountdown.textContent = formatCountdown(Number(auth.expiresAt) - Date.now());
    }

    const tokenCountdown = this.container.querySelector("[data-trakt-token-countdown]");
    if (tokenCountdown && auth.createdAt && auth.expiresIn) {
      const expiresAtMs = (Number(auth.createdAt) + Number(auth.expiresIn)) * 1000;
      tokenCountdown.textContent = formatCountdown(expiresAtMs - Date.now());
    }
  },

  applyFocus() {
    this.container?.querySelectorAll?.(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    if (this.optionDialog) {
      const dialogNode = this.container.querySelector(`.settings-dialog-option[data-dialog-index="${this.dialogFocusIndex}"]`)
        || this.container.querySelector(".settings-dialog-option");
      if (dialogNode) {
        dialogNode.classList.add("focused");
        focusNode(dialogNode);
        scrollSettingsContentItem(dialogNode);
      }
      return;
    }

    const selector = this.contentFocusKey
      ? `.settings-content-focusable[data-focus-key="${String(this.contentFocusKey).replace(/["\\]/g, "\\$&")}"]`
      : null;
    const target = selector ? this.container.querySelector(selector) : null;
    const fallback = target || this.container.querySelector(".settings-content-focusable");
    if (!fallback) {
      return;
    }
    fallback.classList.add("focused");
    focusNode(fallback);
    if (this.suppressNextContentFocusScroll) {
      this.suppressNextContentFocusScroll = false;
    } else {
      scrollSettingsContentItem(fallback);
    }
    this.contentFocusKey = String(fallback.dataset.focusKey || "");
  },

  async handleClickEvent(event) {
    const target = event?.target?.closest?.(".settings-content-focusable, .settings-dialog-option");
    if (!target || !this.container?.contains?.(target)) {
      return;
    }
    event?.preventDefault?.();
    this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    if (target.classList.contains("settings-dialog-option")) {
      const dialogIndex = Number(target.dataset.dialogIndex);
      if (Number.isFinite(dialogIndex)) {
        this.dialogFocusIndex = dialogIndex;
      }
    } else {
      this.focusZone = "content";
      this.contentFocusKey = String(target.dataset.focusKey || this.contentFocusKey || "");
    }
    await this.activateFocused();
  },

  async activateFocused() {
    if (this.optionDialog) {
      const option = this.optionDialog.options[this.dialogFocusIndex];
      if (!option) {
        return;
      }
      if (typeof this.optionDialog.onSelect === "function") {
        await this.optionDialog.onSelect(option);
      }
      this.closeOptionDialog();
      await this.render();
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    const focusKey = String(current?.dataset?.focusKey || "");
    const action = this.actionMap.get(focusKey);
    if (!action) {
      return;
    }
    this.contentFocusKey = focusKey;
    await action();
    if (Router.getCurrent() === "trakt") {
      await this.render();
    }
  },

  focusContentByKey(focusKey) {
    const target = this.container?.querySelector(
      `.settings-content-focusable[data-focus-key="${String(focusKey || "").replace(/["\\]/g, "\\$&")}"]`
    );
    if (!target) {
      return false;
    }
    this.container?.querySelectorAll?.(".focusable.focused")?.forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusNode(target);
    scrollSettingsContentItem(target);
    this.contentFocusKey = String(target.dataset.focusKey || focusKey || "");
    return true;
  },

  moveFocus(direction) {
    const selector = this.optionDialog ? ".settings-dialog-option" : ".settings-content-focusable";
    const before = this.container.querySelector(`${selector}.focused`);
    const beforeFocusKey = String(before?.dataset?.focusKey || "");

    if (!this.optionDialog) {
      if (direction === "up" && beforeFocusKey === "trakt:librarySource" && this.focusContentByKey("trakt:disconnect")) {
        return;
      }
      if (direction === "down" && beforeFocusKey === "trakt:disconnect" && this.focusContentByKey("trakt:librarySource")) {
        return;
      }
    }

    ScreenUtils.moveFocusDirectional(this.container, direction, selector);
    const after = this.container.querySelector(`${selector}.focused`);
    if (after && after !== before) {
      if (this.optionDialog) {
        const dialogIndex = Number(after.dataset.dialogIndex);
        if (Number.isFinite(dialogIndex)) {
          this.dialogFocusIndex = dialogIndex;
        }
      } else {
        this.contentFocusKey = String(after.dataset.focusKey || "");
      }
      scrollSettingsContentItem(after);
    }
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.optionDialog) {
        this.closeOptionDialog();
        await this.render({ refreshModel: false });
        return;
      }
      await Router.back();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (this.optionDialog && (code === 37 || code === 39)) {
        return;
      }
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : "right";
      this.moveFocus(direction);
      return;
    }

    if (code === 13) {
      event?.preventDefault?.();
      await this.activateFocused();
    }
  },

  startTraktPolling(force = false) {
    if (this.traktPollTimer && !force) {
      return;
    }
    this.stopTraktPolling();
    const poll = async () => {
      const state = TraktAuthService.getCurrentAuthState();
      if (!state.deviceCode || Router.getCurrent() !== "trakt") {
        this.stopTraktPolling();
        return;
      }
      const result = await TraktAuthService.pollDeviceToken().catch((error) => ({
        type: "failed",
        message: String(error?.message || error || "Network error, will retry")
      }));
      if (result.type === "approved") {
        this.stopTraktPolling();
        this.traktStatusMessage = `Connected as ${result.username || "Trakt user"}`;
        this.traktErrorMessage = null;
        await this.loadTraktStats(true);
        await this.render();
        return;
      }
      if (result.type === "pending") {
        this.traktStatusMessage = "Waiting for approval...";
        this.traktErrorMessage = null;
      } else if (result.type === "slow_down") {
        this.traktStatusMessage = "Rate limited, slowing down polling...";
        this.traktErrorMessage = null;
      } else if (result.type === "expired") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = "Code expired. Generate a new code.";
      } else if (result.type === "denied") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = "Trakt authorization was denied.";
      } else if (result.type === "already_used") {
        this.stopTraktPolling();
        this.traktStatusMessage = null;
        this.traktErrorMessage = "This Trakt code was already used.";
      } else if (result.type === "failed") {
        this.traktStatusMessage = null;
        this.traktErrorMessage = result.message || "Token polling failed";
      }
      await this.render();
      const nextState = TraktAuthService.getCurrentAuthState();
      if (nextState.deviceCode && !this.traktPollTimer) {
        this.traktPollTimer = setTimeout(() => {
          this.traktPollTimer = null;
          void poll();
        }, Math.max(1, Number(nextState.pollInterval || 5)) * 1000);
      }
    };
    void poll();
  },

  consumeBackRequest() {
    if (!this.optionDialog) {
      return false;
    }
    this.closeOptionDialog();
    void this.render({ refreshModel: false });
    return true;
  },

  cleanup() {
    this.stopTraktPolling?.();
    this.stopTraktClock();
    if (this.container && this.handleClickBound) {
      this.container.removeEventListener("click", this.handleClickBound);
    }
    this.handleClickBound = null;
    this.activeSection = "trakt";
    this.focusZone = "content";
    this.contentFocusKey = null;
    this.optionDialog = null;
    this.dialogFocusIndex = 0;
    this.model = null;
    ScreenUtils.hide(this.container);
  }
});
