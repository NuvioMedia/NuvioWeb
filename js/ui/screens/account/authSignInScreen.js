import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";

export const AuthSignInScreen = {

  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    this.container.innerHTML = `
      <div class="row">
        <h2>${I18n.t("auth.signIn.title")}</h2>
        <p>${I18n.t("auth.signIn.description")}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="openQr">${I18n.t("auth.signIn.openQrLogin")}</div>
        <div class="card focusable" data-action="devLogin">${I18n.t("auth.signIn.devEmailLogin")}</div>
        <div class="card focusable" data-action="back">${I18n.t("auth.signIn.back")}</div>
      </div>
    `;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  async onKeyDown(event) {
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
    if (action === "openQr") {
      Router.navigate("authQrSignIn");
      return;
    }
    if (action === "devLogin") {
      const email = window.prompt(I18n.t("auth.signIn.emailPrompt"));
      const password = window.prompt(I18n.t("auth.signIn.passwordPrompt"));
      if (email && password) {
        try {
          await AuthManager.signInWithEmail(email, password);
          Router.navigate("profileSelection");
        } catch (error) {
          console.error("SignIn failed", error);
        }
      }
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
