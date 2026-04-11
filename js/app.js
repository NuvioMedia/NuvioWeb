import "./runtime/polyfills.js";
import "intersection-observer";  
import "whatwg-fetch";

(function applyLegacyPatches() {
  const originalGetElementById = document.getElementById;
  document.getElementById = function(id) {
    if (id === undefined || id === null || id === "") return null;
    return originalGetElementById.call(document, id);
  };

  if (typeof Node === "undefined") {
    globalThis.Node = { ELEMENT_NODE: 1 };
  }
})();

import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { warmStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";

const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";

function formatErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error?.stack || error?.message || error);
}

function renderFatalError(error) {
  const message = formatErrorMessage(error);
  document.body.innerHTML = `
    <div style="min-height:100vh;background:#0f1115;color:#f4f7fb;padding:48px;font-family:Arial,sans-serif;">
      <div style="max-width:960px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:42px;">Nuvio TV failed to start</h1>
        <p style="margin:0 0 20px;font-size:20px;color:#c7d0dd;">Startup hit an error before the app UI rendered.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#171b22;border:1px solid #2b3340;border-radius:12px;padding:20px;font-size:18px;line-height:1.5;">${message}</pre>
      </div>
    </div>
  `;
}

function isLowEndDevice() {
  const hardware = Number(globalThis.navigator?.hardwareConcurrency || 0);
  const memory = Number(globalThis.navigator?.deviceMemory || 0);
  const lowCpu = Number.isFinite(hardware) && hardware > 0 && hardware <= 4;
  const lowMem = Number.isFinite(memory) && memory > 0 && memory <= 2;
  return lowCpu || lowMem;
}

function applyPerformanceMode() {
  const constrained = Platform.isWebOS() || Platform.isTizen() || isLowEndDevice();
  document.documentElement.classList.toggle("performance-constrained", constrained);
  document.body.classList.toggle("performance-constrained", constrained);
}

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
  applyPerformanceMode();
  await I18n.init();

  Router.init();
  PlayerController.init();
  
  FocusEngine.init(); 
  
  ThemeManager.apply();
  I18n.apply();
  warmStreamingLibs({ delayMs: 1400 });

  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      return;
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      const shouldBypassQr = Boolean(LocalStore.get(GUEST_QR_BYPASS_KEY, false));
      if (shouldBypassQr) {
        if (Router.getCurrent() !== "home") {
          Router.navigate("home", {}, {
            replaceHistory: true,
            skipStackPush: true
          });
        }
        return;
      }
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      Router.navigate("authQrSignIn", {
        onboardingMode: !hasSeenQr
      });
    }

    if (state === AuthState.AUTHENTICATED) {
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
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
      renderFatalError(error);
    });
  }, { once: true });
} else {
  const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
  bootstrap().catch((error) => {
    console.error("App bootstrap failed", error);
    renderFatalError(error);
  });
}

window.addEventListener("error", (event) => {
  if (!event?.error) {
    return;
  }
  renderFatalError(event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  renderFatalError(event?.reason);
});
