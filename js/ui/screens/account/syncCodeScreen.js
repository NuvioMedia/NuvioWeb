import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { I18n } from "../../../i18n/index.js";

const KEY = "manualSyncCode";

export const SyncCodeScreen = {

  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    const value = LocalStore.get(KEY, "");
    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${I18n.t("auth.syncCode.title")}</h2>
          <p class="auth-simple-subtitle">${I18n.t("auth.syncCode.currentCode", { value: value || I18n.t("auth.syncCode.emptyValue") })}</p>
        </div>
        <div class="auth-simple-actions">
          <div class="auth-simple-card focusable" data-action="setCode">${I18n.t("auth.syncCode.setCode")}</div>
          <div class="auth-simple-card focusable" data-action="clearCode">${I18n.t("auth.syncCode.clearCode")}</div>
          <div class="auth-simple-card focusable" data-action="back">${I18n.t("auth.syncCode.back")}</div>
        </div>
      </div>
    `;
    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (event.keyCode !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = current.dataset.action;
    if (action === "setCode") {
      const value = window.prompt(I18n.t("auth.syncCode.prompt"), LocalStore.get(KEY, ""));
      if (value !== null) {
        LocalStore.set(KEY, String(value).trim());
        this.render();
      }
      return;
    }
    if (action === "clearCode") {
      LocalStore.remove(KEY);
      this.render();
      return;
    }
    if (action === "back") {
      Router.back();
    }
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }

};
