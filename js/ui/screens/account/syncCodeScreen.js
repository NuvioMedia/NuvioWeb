import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { LocalStore } from "../../../core/storage/localStore.js";

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
      <div class="row">
        <h2>Sync Code</h2>
        <p>Current code: ${value || "(empty)"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="setCode">Set Code</div>
        <div class="card focusable" data-action="clearCode">Clear Code</div>
        <div class="card focusable" data-action="back">Back</div>
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
      const value = window.prompt("Insert sync code", LocalStore.get(KEY, ""));
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
