import "./runtime/polyfills.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { loadStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";

function isAddonRemoteMode() {
  try {
    return new URLSearchParams(window.location.search).get("addonsRemote") === "1";
  } catch {
    return false;
  }
}

async function bootstrapApp() {
  renderAppShell();
  Platform.init();
  await I18n.init();
  await loadStreamingLibs();

  console.log("Nuvio starting...", {
    platform: Platform.getName()
  });

  Router.init();
  PlayerController.init();
  FocusEngine.init();
  ThemeManager.apply();
  I18n.apply();

  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      Router.navigate("splash");
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      Router.navigate("authQrSignIn", {
        onboardingMode: !hasSeenQr
      });
    }

    if (state === AuthState.AUTHENTICATED) {
      StartupSyncService.start();
      Router.navigate("profileSelection");
    }
  });

  await AuthManager.bootstrap();
}

async function bootstrapAddonRemoteMode() {
  await renderAddonRemotePage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
    bootstrap().catch((error) => {
      console.error("App bootstrap failed", error);
    });
  }, { once: true });
} else {
  const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
  bootstrap().catch((error) => {
    console.error("App bootstrap failed", error);
  });
}
