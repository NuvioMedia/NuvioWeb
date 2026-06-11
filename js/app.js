import "./runtime/polyfills.js";
import "intersection-observer";
import "whatwg-fetch";
import { detailWatchedEnrichmentService } from "./data/repository/detailWatchedEnrichmentService.js";
import {
  preloadStreamBadgeImages,
  resetAddonLogoCache,
} from "./ui/screens/stream/streamScreen.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { ProfileManager } from "./core/profile/profileManager.js";
import { ProfileSyncService } from "./core/profile/profileSyncService.js";
import { ProfileSettingsSyncService } from "./core/profile/profileSettingsSyncService.js";
import { LibrarySyncService } from "./core/profile/librarySyncService.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { warmStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";

(function applyLegacyPatches() {
  const originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    if (id === undefined || id === null || id === "") return null;
    return originalGetElementById.call(document, id);
  };

  if (typeof Node === "undefined") {
    globalThis.Node = { ELEMENT_NODE: 1 };
  }
})();

const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";
const SIGNED_OUT_ALLOWED_ROUTES = new Set(["trakt"]);
let hasSelectedProfileThisSession = false;
let appShellRendered = false;

function isSignedOutRouteAllowed() {
  return SIGNED_OUT_ALLOWED_ROUTES.has(Router.getCurrent());
}

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

function supportsFlexGap() {
  if (typeof document === "undefined" || !document.body) {
    return true;
  }

  const flex = document.createElement("div");
  flex.style.display = "flex";
  flex.style.flexDirection = "column";
  flex.style.rowGap = "1px";
  flex.style.position = "absolute";
  flex.style.top = "-9999px";
  flex.style.left = "-9999px";
  flex.appendChild(document.createElement("div"));
  flex.appendChild(document.createElement("div"));
  document.body.appendChild(flex);
  const supported = flex.scrollHeight === 1;
  document.body.removeChild(flex);
  return supported;
}

function supportsAspectRatio() {
  const css = globalThis.CSS;
  if (!css || typeof css.supports !== "function") {
    return false;
  }
  return css.supports("aspect-ratio", "1 / 1");
}

function applyPerformanceMode() {
  const constrained =
    Platform.isWebOS() || Platform.isTizen() || isLowEndDevice();
  const webOsMajorVersion = Platform.isWebOS()
    ? Number(Platform.getWebOsMajorVersion() || 0)
    : 0;
  const legacyWebOs = webOsMajorVersion > 0 && webOsMajorVersion <= 6;
  const legacyTizen = Platform.isTizen();
  const flexGapUnsupported = !supportsFlexGap();
  const aspectRatioUnsupported = !supportsAspectRatio();
  document.documentElement.classList.toggle(
    "performance-constrained",
    constrained,
  );
  document.body.classList.toggle("performance-constrained", constrained);
  document.documentElement.classList.toggle("legacy-webos", legacyWebOs);
  document.body.classList.toggle("legacy-webos", legacyWebOs);
  document.documentElement.classList.toggle("legacy-tizen", legacyTizen);
  document.body.classList.toggle("legacy-tizen", legacyTizen);
  document.documentElement.classList.toggle("no-flex-gap", flexGapUnsupported);
  document.body.classList.toggle("no-flex-gap", flexGapUnsupported);
  document.documentElement.classList.toggle(
    "no-aspect-ratio",
    aspectRatioUnsupported,
  );
  document.body.classList.toggle("no-aspect-ratio", aspectRatioUnsupported);
}

function isAddonRemoteMode() {
  try {
    return (
      new URLSearchParams(window.location.search).get("addonsRemote") === "1"
    );
  } catch {
    return false;
  }
}

async function shouldShowProfileSelection() {
  await ProfileSyncService.pull();
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const pinStates = await ProfileSyncService.pullProfileLockStates();
  const activeProfileHasPin = Boolean(
    pinStates?.[String(activeProfileId)] ||
    pinStates?.[Number(activeProfileId)],
  );

  return (
    !hasSelectedProfileThisSession &&
    (profiles.length > 1 || activeProfileHasPin)
  );
}

async function routeAfterAuthentication() {
  const showProfileSelection = await shouldShowProfileSelection();
  if (showProfileSelection) {
    Router.navigate("profileSelection");
    return;
  }

  hasSelectedProfileThisSession = true;
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const activeProfile =
    profiles.find(
      (profile) => String(profile.id) === String(activeProfileId),
    ) ||
    profiles[0] ||
    null;
  if (activeProfile) {
    await ProfileManager.setActiveProfile(activeProfile.id);
    detailWatchedEnrichmentService.invalidateAllCache();
    await Promise.all([
      ProfileSettingsSyncService.pull(activeProfile.id),
      LibrarySyncService.pull()
    ]);
  }
  Router.navigate("home");
}

async function bootstrapApp() {
  resetAddonLogoCache();
  renderAppShell();
  appShellRendered = true;
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
      hasSelectedProfileThisSession = false;
      const shouldBypassQr = Boolean(
        LocalStore.get(GUEST_QR_BYPASS_KEY, false),
      );
      if (isSignedOutRouteAllowed()) {
        return;
      }
      if (shouldBypassQr) {
        ProfileManager.clearActiveProfile();
        if (Router.getCurrent() !== "profileSelection") {
          Router.navigate(
            "profileSelection",
            {},
            {
              replaceHistory: true,
              skipStackPush: true,
            },
          );
        }
        return;
      }
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      Router.navigate("authQrSignIn", {
        onboardingMode: !hasSeenQr,
      });
    }

    if (state === AuthState.AUTHENTICATED) {
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
      StartupSyncService.start();
      routeAfterAuthentication().catch((error) => {
        console.warn("Failed to resolve authenticated route", error);
        Router.navigate("profileSelection");
      });
    }
  });

  await AuthManager.bootstrap();
}

async function bootstrapAddonRemoteMode() {
  resetAddonLogoCache();
  await renderAddonRemotePage();
  appShellRendered = true;
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const bootstrap = isAddonRemoteMode()
        ? bootstrapAddonRemoteMode
        : bootstrapApp;
      bootstrap().catch((error) => {
        console.error("App bootstrap failed", error);
        renderFatalError(error);
      });
    },
    { once: true },
  );
} else {
  const bootstrap = isAddonRemoteMode()
    ? bootstrapAddonRemoteMode
    : bootstrapApp;
  bootstrap().catch((error) => {
    console.error("App bootstrap failed", error);
    renderFatalError(error);
  });
}

window.addEventListener("error", (event) => {
  if (!event?.error) {
    return;
  }
  if (!appShellRendered) {
    renderFatalError(event.error);
    return;
  }
  console.warn("Unhandled runtime error", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  if (!appShellRendered) {
    renderFatalError(event?.reason);
    return;
  }
  console.warn("Unhandled promise rejection", event?.reason);
});
