import { AuthManager } from "../../../core/auth/authManager.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";

export const AccountScreen = {

  async mount() {
    this.container = document.getElementById("account");
    this.container.style.display = "block";
    this.state = {
      authState: AuthManager.getAuthState(),
      email: null,
      linkedDevices: []
    };

    this.unsubscribe = AuthManager.subscribe((state) => {
      this.state.authState = state;
      this.render();
    });

    this.render();
  },

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.container) {
      this.container.style.display = "none";
      this.container.innerHTML = "";
    }
  },

  async signOut() {
    await AuthManager.signOut();
    Router.navigate("authQrSignIn");
  },

  render() {
    if (!this.container) {
      return;
    }

    if (this.state.authState === "loading") {
      this.container.innerHTML = `<div class="account-wrapper"><h2>Loading account...</h2></div>`;
      return;
    }

    if (this.state.authState === "signedOut") {
      this.container.innerHTML = `
        <div class="account-wrapper">
          <h1>Account</h1>
          <p>Sign in to sync your library and preferences.</p>
          <div class="account-card focusable" data-action="signin">
            <h3>Sign In</h3>
            <p>Use QR sign-in from mobile.</p>
          </div>
        </div>
      `;
      this.attachFocus();
      return;
    }

    this.container.innerHTML = `
      <div class="account-wrapper">
        <h1>Account</h1>
        <div class="account-info">
          <span>Signed in as</span>
          <strong>${this.state.email || "User"}</strong>
        </div>
        <div class="logout-btn focusable" data-action="logout">Sign Out</div>
      </div>
    `;
    this.attachFocus();
  },

  attachFocus() {
    const focusables = this.container.querySelectorAll(".focusable");
    focusables.forEach((el, index) => {
      el.dataset.index = String(index);
    });
    focusables[0]?.classList.add("focused");
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }

    const current = this.container?.querySelector(".focused");

    if (event.keyCode === 13 && current) {
      const action = current.dataset.action;
      if (action === "signin") {
        Router.navigate("authQrSignIn");
      }
      if (action === "logout") {
        this.signOut();
      }
    }
  }

};
