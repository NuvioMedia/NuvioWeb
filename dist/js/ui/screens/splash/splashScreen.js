import { Router } from "../../navigation/router.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { AuthState } from "../../../core/auth/authState.js";

export const SplashScreen = {
  async mount() {
    const container = document.getElementById("splash");
    container.style.display = "block";
    container.innerHTML = `
      <div class="splash-container">
        <img src="assets/brand/app_logo_wordmark.png" class="splash-logo" />
      </div>
    `;

    await this.bootstrap();
  },

  async bootstrap() {
    // Simula tempo splash minimo
    await new Promise(resolve => setTimeout(resolve, 800));

    const authState = AuthManager.getAuthState();
    const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");

    if (!hasSeenQr && authState !== AuthState.AUTHENTICATED) {
      Router.navigate("authQrSignIn");
      return;
    }

    if (authState === AuthState.AUTHENTICATED) {
      Router.navigate("profileSelection");
    } else {
      Router.navigate("authQrSignIn");
    }
  },

  cleanup() {
    const container = document.getElementById("splash");
    if (!container) {
      return;
    }
    container.style.display = "none";
    container.innerHTML = "";
  }
};
