import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";

export const AuthSignInScreen = {

  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    this.container.innerHTML = `
      <div class="row">
        <h2>Email Sign In</h2>
        <p>Press ENTER to open QR login or use the dev shortcut with preset credentials.</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="openQr">Open QR Login</div>
        <div class="card focusable" data-action="devLogin">Dev Email Login</div>
        <div class="card focusable" data-action="back">Back</div>
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
      const email = window.prompt("Email");
      const password = window.prompt("Password");
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
