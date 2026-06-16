import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";
import { Platform } from "../../platform/index.js";
import { ROOT_SIDEBAR_ITEMS } from "./sidebarNavigation.js";

// Routes that take over the whole viewport (playback) or run before the app
// shell is usable (auth / profile picking). The bar stays out of the way there.
const HIDDEN_ROUTES = new Set([
  "player",
  "account",
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "syncCode"
]);

let barElement = null;
let screenObserver = null;

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function iconMarkup(item) {
  if (item?.iconType === "material") {
    return `<span class="mobile-nav-icon material-icons" aria-hidden="true">${item.iconName}</span>`;
  }
  return `
    <svg class="mobile-nav-icon" viewBox="${item?.viewBox || "0 0 24 24"}" aria-hidden="true" focusable="false">
      ${item?.iconMarkup || ""}
    </svg>
  `;
}

function buildBar() {
  const nav = document.createElement("nav");
  nav.className = "nuvio-mobile-nav";
  nav.setAttribute("role", "navigation");
  nav.setAttribute("aria-label", t("sidebar.title", "Navigation"));

  nav.innerHTML = ROOT_SIDEBAR_ITEMS.map((item) => {
    const label = t(item.labelKey, item.route);
    return `
      <button type="button" class="mobile-nav-item" data-route="${item.route}" aria-label="${label}">
        ${iconMarkup(item)}
        <span class="mobile-nav-label">${label}</span>
      </button>
    `;
  }).join("");

  nav.addEventListener("click", (event) => {
    const button = event.target.closest(".mobile-nav-item");
    if (!button) {
      return;
    }
    const route = button.dataset.route;
    if (!route || Router.getCurrent() === route) {
      return;
    }
    Router.navigate(route);
  });

  return nav;
}

function activeScreenId() {
  const app = document.getElementById("app");
  if (!app) {
    return null;
  }
  const screens = app.querySelectorAll(":scope > .screen");
  for (const screen of screens) {
    if (screen.style.display === "block") {
      return screen.id || null;
    }
  }
  return null;
}

function syncActiveState() {
  if (!barElement) {
    return;
  }
  const route = activeScreenId() || Router.getCurrent();
  const hidden = !route || HIDDEN_ROUTES.has(route);
  barElement.classList.toggle("is-hidden", hidden);
  document.body.classList.toggle("has-mobile-nav", !hidden);

  barElement.querySelectorAll(".mobile-nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === route);
  });
}

export function mountMobileNavBar() {
  // Only the browser/PWA build gets a touch bar. TV builds keep the D-pad rail.
  if (!Platform.isBrowser() || barElement || typeof document === "undefined") {
    return;
  }

  barElement = buildBar();
  document.body.appendChild(barElement);

  const app = document.getElementById("app");
  if (app && "MutationObserver" in window) {
    // Screens are shown/hidden by toggling inline display, so watching the
    // style attribute keeps the bar in sync with whatever navigates the app
    // (taps, back button, deep links) without coupling to the router.
    screenObserver = new MutationObserver(() => syncActiveState());
    app.querySelectorAll(":scope > .screen").forEach((screen) => {
      screenObserver.observe(screen, { attributes: true, attributeFilter: ["style"] });
    });
  }

  window.addEventListener("popstate", () => syncActiveState());
  syncActiveState();
}
