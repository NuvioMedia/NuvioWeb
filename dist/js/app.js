import "./runtime/polyfills.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { loadStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";

async function bootstrapApp() {
  renderAppShell();
  Platform.init();
  await loadStreamingLibs();

  console.log("Nuvio starting...", {
    platform: Platform.getName()
  });

  Router.init();
  PlayerController.init();
  FocusEngine.init();
  ThemeManager.apply();

  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      Router.navigate("splash");
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      Router.navigate("authQrSignIn");
    }

    if (state === AuthState.AUTHENTICATED) {
      StartupSyncService.start();
      Router.navigate("profileSelection");
    }
  });

  await AuthManager.bootstrap();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrapApp().catch((error) => {
      console.error("App bootstrap failed", error);
    });
  }, { once: true });
} else {
  bootstrapApp().catch((error) => {
    console.error("App bootstrap failed", error);
  });
}
