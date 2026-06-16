import { Router } from "../navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";
import { I18n } from "../../i18n/index.js";
import { Platform } from "../../platform/index.js";

const ROOT_SIDEBAR_ITEMS = [
  {
    action: "gotoHome",
    route: "home",
    labelKey: "sidebar.home",
    iconType: "svg",
    viewBox: "0 0 256 256",
    iconMarkup: '<path d="M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z"/>',
    filledIconMarkup: '<path d="M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z"/>'
  },
  {
    action: "gotoSearch",
    route: "search",
    labelKey: "sidebar.search",
    iconType: "svg",
    viewBox: "0 0 256 256",
    iconMarkup: '<path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"></path>',
    filledIconMarkup: '<path d="M168,112a56,56,0,1,1-56-56A56,56,0,0,1,168,112Zm61.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88,88,0,1,1,11.32-11.31l50.06,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z"/>'
  },
  {
    action: "gotoLibrary",
    route: "library",
    labelKey: "sidebar.library",
    iconType: "svg",
    viewBox: "0 0 256 256",
    iconMarkup: '<path d="M208,88H48a16,16,0,0,0-16,16v96a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V104A16,16,0,0,0,208,88Zm0,112H48V104H208v96ZM48,64a8,8,0,0,1,8-8H200a8,8,0,0,1,0,16H56A8,8,0,0,1,48,64ZM64,32a8,8,0,0,1,8-8H184a8,8,0,0,1,0,16H72A8,8,0,0,1,64,32Z"></path>',
    filledIconMarkup: '<path d="M224,104v96a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V104A16,16,0,0,1,48,88H208A16,16,0,0,1,224,104ZM56,72H200a8,8,0,0,0,0-16H56a8,8,0,0,0,0,16ZM72,40H184a8,8,0,0,0,0-16H72a8,8,0,0,0,0,16Z"/>'
  },
  {
    action: "gotoPlugin",
    route: "plugin",
    labelKey: "sidebar.addons",
    iconType: "svg",
    viewBox: "0 0 256 256",
    iconMarkup: '<path d="M220.27,158.54a8,8,0,0,0-7.7-.46,20,20,0,1,1,0-36.16A8,8,0,0,0,224,114.69V72a16,16,0,0,0-16-16H171.78a35.36,35.36,0,0,0,.22-4,36.11,36.11,0,0,0-11.36-26.24,36,36,0,0,0-60.55,23.62,36.56,36.56,0,0,0,.14,6.62H64A16,16,0,0,0,48,72v32.22a35.36,35.36,0,0,0-4-.22,36.12,36.12,0,0,0-26.24,11.36,35.7,35.7,0,0,0-9.69,27,36.08,36.08,0,0,0,33.31,33.6,35.68,35.68,0,0,0,6.62-.14V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V165.31A8,8,0,0,0,220.27,158.54ZM208,208H64V165.31a8,8,0,0,0-11.43-7.23,20,20,0,1,1,0-36.16A8,8,0,0,0,64,114.69V72h46.69a8,8,0,0,0,7.23-11.43,20,20,0,1,1,36.16,0A8,8,0,0,0,161.31,72H208v32.23a35.68,35.68,0,0,0-6.62-.14A36,36,0,0,0,204,176a35.36,35.36,0,0,0,4-.22Z"></path>',
    filledIconMarkup: '<path d="M165.78,224H208a16,16,0,0,0,16-16V170.35A8,8,0,0,0,212.94,163a23.37,23.37,0,0,1-8.94,1.77c-13.23,0-24-11.1-24-24.73s10.77-24.73,24-24.73a23.37,23.37,0,0,1,8.94,1.77A8,8,0,0,0,224,109.65V72a16,16,0,0,0-16-16H171.78a35.36,35.36,0,0,0,.22-4,36,36,0,0,0-72,0,35.36,35.36,0,0,0,.22,4H64A16,16,0,0,0,48,72v32.22a35.36,35.36,0,0,0-4-.22,36,36,0,0,0,0,72,35.36,35.36,0,0,0,4-.22V208a16,16,0,0,0,16,16h42.22"/>'
  },
  {
    action: "gotoSettings",
    route: "settings",
    labelKey: "sidebar.settings",
    iconType: "svg",
    viewBox: "0 0 256 256",
    iconMarkup: '<path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"></path>',
    filledIconMarkup: '<path d="M216,130.16q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.6,107.6,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.29,107.29,0,0,0-26.25-10.86,8,8,0,0,0-7.06,1.48L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.6,107.6,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/>'
  }
];

let sidebarAvatarCatalogPromise = null;

function profileInitial(name) {
  const raw = String(name || "").trim();
  return raw ? raw.charAt(0).toUpperCase() : "P";
}

function iconMarkup(item, className = "root-sidebar-icon") {
  if (item?.iconType === "material") {
    return `<span class="${className} root-sidebar-icon-material material-icons" aria-hidden="true">${item.iconName}</span>`;
  }

  return `
    <svg class="${className} root-sidebar-icon-svg"
         viewBox="${item?.viewBox || "0 0 24 24"}"
         aria-hidden="true"
         focusable="false">
      <g class="sidebar-icon-regular">${item?.iconMarkup || ""}</g>
      <g class="sidebar-icon-fill">${item?.filledIconMarkup || item?.iconMarkup || ""}</g>
    </svg>
  `;
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function getThemeAccentFallback() {
  const value = globalThis?.document
    ? getComputedStyle(document.documentElement).getPropertyValue("--secondary-color").trim()
    : "";
  return value || "#f5f5f5";
}

function itemLabel(item) {
  return t(item?.labelKey, {}, String(item?.label || item?.route || ""));
}

function getSidebarTextFitTargets(container) {
  return Array.from(container?.querySelectorAll([
    ".home-sidebar .home-nav-label",
    ".modern-sidebar-panel .modern-sidebar-nav-label",
    ".modern-sidebar-pill-label"
  ].join(", ")) || []);
}

function fitSidebarLabel(node, minFontSizePx) {
  if (!node || !node.isConnected) {
    return false;
  }

  const targetWidth = node.getBoundingClientRect().width;
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    return false;
  }

  const previousInlineSize = node.style.fontSize;
  node.style.fontSize = "";

  const computedSize = Number.parseFloat(globalThis?.getComputedStyle ? getComputedStyle(node).fontSize : "") || 0;
  if (!computedSize) {
    node.style.fontSize = previousInlineSize;
    return false;
  }

  const currentWidth = node.scrollWidth;
  if (currentWidth <= node.clientWidth + 1) {
    node.style.fontSize = "";
    return true;
  }

  const minSize = Math.max(12, Number(minFontSizePx) || 12);
  let low = minSize;
  let high = computedSize;
  let best = minSize;

  for (let index = 0; index < 8 && high - low > 0.25; index += 1) {
    const mid = (low + high) / 2;
    node.style.fontSize = `${mid}px`;
    if (node.scrollWidth <= node.clientWidth + 1) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  node.style.fontSize = `${best}px`;
  return true;
}

function fitRootSidebarText(container) {
  const targets = getSidebarTextFitTargets(container);
  targets.forEach((node) => {
    if (node.matches(".home-nav-label")) {
      fitSidebarLabel(node, 24);
      return;
    }
    if (node.matches(".modern-sidebar-pill-label")) {
      fitSidebarLabel(node, 28);
      return;
    }
    fitSidebarLabel(node, 30);
  });
}

function scheduleRootSidebarTextFit(container) {
  if (!container) {
    return;
  }
  if (container._rootSidebarTextFitRaf) {
    cancelAnimationFrame(container._rootSidebarTextFitRaf);
  }
  container._rootSidebarTextFitRaf = requestAnimationFrame(() => {
    container._rootSidebarTextFitRaf = null;
    fitRootSidebarText(container);
  });
}

function getSelectedItem(routeName = "") {
  return ROOT_SIDEBAR_ITEMS.find((item) => item.route === String(routeName || "")) || ROOT_SIDEBAR_ITEMS[0];
}

function getItemForAction(action = "") {
  return ROOT_SIDEBAR_ITEMS.find((item) => item.action === String(action || "")) || null;
}

function getModernSidebarPresentation(selectedRoute = "") {
  const route = String(selectedRoute || "").trim().toLowerCase();
  return {
    showPill: true,
    keepPillExpanded: route === "settings"
  };
}

function getSidebarAvatarCatalog() {
  if (!sidebarAvatarCatalogPromise) {
    sidebarAvatarCatalogPromise = AvatarRepository.getAvatarCatalog().catch(() => {
      sidebarAvatarCatalogPromise = null;
      return [];
    });
  }
  return sidebarAvatarCatalogPromise;
}

export async function getSidebarProfileState() {
  const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
  const [profiles, avatarCatalog] = await Promise.all([
    ProfileManager.getProfiles(),
    getSidebarAvatarCatalog()
  ]);
  const activeProfile = profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === activeProfileId)
    || profiles[0]
    || null;
  const activeProfileAvatarUrl = String(activeProfile?.avatarUrl || "").trim()
    || AvatarRepository.getAvatarImageUrl(activeProfile?.avatarId, avatarCatalog);

  return {
    activeProfileName: String(activeProfile?.name || t("sidebar.profileFallback")).trim() || t("sidebar.profileFallback"),
    activeProfileInitial: profileInitial(activeProfile?.name || t("sidebar.profileFallback")),
    activeProfileColorHex: String(activeProfile?.avatarColorHex || getThemeAccentFallback()),
    activeProfileAvatarUrl: String(activeProfileAvatarUrl || ""),
    showProfileSelector: Boolean(activeProfile)
  };
}

export function activateLegacySidebarAction(action, currentRoute = "") {
  const normalizedAction = String(action || "");
  if (!normalizedAction) {
    return;
  }
  if (normalizedAction === "gotoAccount") {
    Router.navigate("profileSelection");
    return;
  }

  const target = getItemForAction(normalizedAction);
  if (!target || target.route === currentRoute) {
    return;
  }
  Router.navigate(target.route);
}

export function isSelectedSidebarAction(action, selectedRoute = "") {
  return getItemForAction(action)?.route === String(selectedRoute || "");
}

export function renderLegacySidebar({
  selectedRoute = "home",
  profile = null,
  layout = {}
} = {}) {
  const selectedItem = getSelectedItem(selectedRoute);
  const profileState = profile || {};
  // const showProfileSelector = Boolean(profileState.showProfileSelector && profileState.activeProfileName);
  const collapsible = Boolean(layout?.collapseSidebar);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <aside class="home-sidebar root-sidebar root-sidebar-legacy${performanceConstrained ? " performance-constrained" : ""}"
           data-selected-route="${selectedRoute}"
           data-collapsible="${collapsible ? "true" : "false"}">
      <div class="home-brand-wrap">
        <img class="home-brand-mark" src="assets/brand/app_logo_marksmall.png" alt="Nuvio" />
        <img class="home-brand-wordmark" src="assets/brand/app_logo_wordmarksmall.png" alt="Nuvio" />
      </div>
      <div class="home-nav-list">
        <button class="home-nav-item profile focusable"
                data-action="gotoAccount"
                aria-label="${t("sidebar.switchProfile")}">
          <span class="home-profile-avatar" style="background:${profileState.activeProfileColorHex || getThemeAccentFallback()}">
            ${profileState.activeProfileAvatarUrl
              ? `<img class="sidebar-profile-avatar-image" src="${profileState.activeProfileAvatarUrl}" alt="${profileState.activeProfileName || t("sidebar.profileFallback")}" />`
              : (profileState.activeProfileInitial || "P")}
          </span>
          <span class="home-nav-label">${profileState.activeProfileName || t("sidebar.profileFallback")}</span>
        </button>
        ${ROOT_SIDEBAR_ITEMS.map((item) => `
          <button class="home-nav-item focusable${selectedItem.action === item.action ? " selected" : ""}"
                  data-action="${item.action}"
                  aria-label="${itemLabel(item)}">
            <span class="home-nav-icon-wrap">${iconMarkup(item, "home-nav-icon")}</span>
            <span class="home-nav-label">${itemLabel(item)}</span>
          </button>
        `).join("")}
      </div>
    </aside>
  `;
}

export function renderModernSidebar({
  selectedRoute = "home",
  profile = null,
  expanded = false,
  pillIconOnly = false,
  blurEnabled = false
} = {}) {
  const selectedItem = getSelectedItem(selectedRoute);
  const profileState = profile || {};
  const showProfileSelector = Boolean(profileState.showProfileSelector && profileState.activeProfileName);
  const { keepPillExpanded } = getModernSidebarPresentation(selectedRoute);
  const showPill = selectedItem.route !== "search";
  const selectedLabel = itemLabel(selectedItem);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <div class="modern-sidebar-shell${expanded ? " expanded panel-visible" : ""}${blurEnabled ? " blur-enabled" : ""}${keepPillExpanded ? " keep-pill-expanded" : ""}${performanceConstrained ? " performance-constrained" : ""}" data-selected-route="${selectedRoute}">
      ${showPill ? `
        <button class="modern-sidebar-pill${pillIconOnly && !keepPillExpanded ? " icon-only" : ""}" data-action="expandSidebar" aria-label="${t("sidebar.expandSidebar")}" aria-expanded="${expanded ? "true" : "false"}">
          <img class="modern-sidebar-pill-chevron" src="assets/icons/ic_chevron_compact_left.png" alt="" aria-hidden="true" />
          <span class="modern-sidebar-pill-chip">
            <span class="modern-sidebar-pill-icon-wrap">${iconMarkup(selectedItem, "modern-sidebar-pill-icon")}</span>
            <span class="modern-sidebar-pill-label">${selectedLabel}</span>
          </span>
        </button>
      ` : ""}
      <aside class="modern-sidebar-panel" aria-hidden="${expanded ? "false" : "true"}">
        ${showProfileSelector ? `
          <button class="modern-sidebar-profile focusable" data-action="gotoAccount" aria-label="${t("sidebar.switchProfile")}">
            <span class="modern-sidebar-profile-avatar" style="background:${profileState.activeProfileColorHex || getThemeAccentFallback()}">
              ${profileState.activeProfileAvatarUrl
                ? `<img class="sidebar-profile-avatar-image" src="${profileState.activeProfileAvatarUrl}" alt="${profileState.activeProfileName || t("sidebar.profileFallback")}" />`
                : (profileState.activeProfileInitial || "P")}
            </span>
            <span class="modern-sidebar-profile-name">${profileState.activeProfileName || t("sidebar.profileFallback")}</span>
          </button>
        ` : ""}
        <div class="modern-sidebar-nav-list">
          ${ROOT_SIDEBAR_ITEMS.map((item) => `
            <button class="modern-sidebar-nav-item focusable${selectedItem.action === item.action ? " selected" : ""}"
                    data-action="${item.action}"
                    aria-label="${itemLabel(item)}">
              <span class="modern-sidebar-nav-icon-circle">
                ${iconMarkup(item, "modern-sidebar-nav-icon")}
              </span>
              <span class="modern-sidebar-nav-label">${itemLabel(item)}</span>
            </button>
          `).join("")}
        </div>
      </aside>
    </div>
  `;
}

export function renderRootSidebar({
  selectedRoute = "home",
  profile = null,
  layout = {},
  expanded = false,
  pillIconOnly = false
} = {}) {
  if (layout?.modernSidebar) {
    return renderModernSidebar({
      selectedRoute,
      profile,
      expanded,
      pillIconOnly,
      blurEnabled: Boolean(layout?.modernSidebarBlur)
    });
  }
  return renderLegacySidebar({ selectedRoute, profile, layout });
}

export function bindRootSidebarEvents(container, {
  currentRoute = "",
  onExpandSidebar = null,
  onSelectedAction = null
} = {}) {
  const focusables = Array.from(container?.querySelectorAll(".home-sidebar .focusable, .modern-sidebar-panel .focusable") || []);

  const moveSidebarFocus = (currentNode, delta) => {
    const nodes = focusables.filter((node) => node.isConnected);
    const currentIndex = nodes.indexOf(currentNode);
    if (currentIndex === -1) {
      return false;
    }
    const nextIndex = Math.max(0, Math.min(nodes.length - 1, currentIndex + delta));
    const target = nodes[nextIndex] || null;
    if (!target || target === currentNode) {
      return true;
    }
    nodes.forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    return true;
  };

  focusables.forEach((node) => {
    node.onclick = async (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const action = String(node.dataset.action || "");
      activateLegacySidebarAction(action, currentRoute);
      if (isSelectedSidebarAction(action, currentRoute) && typeof onSelectedAction === "function") {
        await onSelectedAction(node);
      }
    };

    node.onkeydown = (event) => {
      const keyCode = Number(event?.keyCode || 0);
      if (keyCode === 38) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        moveSidebarFocus(node, -1);
        return;
      }
      if (keyCode === 40) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        moveSidebarFocus(node, 1);
      }
    };
  });

  container?.querySelectorAll(".modern-sidebar-pill[data-action='expandSidebar']").forEach((node) => {
    node.onclick = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (typeof onExpandSidebar === "function") {
        onExpandSidebar(node);
      }
    };
  });

  container?.addEventListener("focusin", (event) => {
    const target = event?.target;
    if (!target) return;
    if (target.closest(".home-sidebar .focusable, .modern-sidebar-panel .focusable")) {
      if (typeof onExpandSidebar === "function") {
        onExpandSidebar(target);
      }
    }
  });

  scheduleRootSidebarTextFit(container);
}

export function setLegacySidebarExpanded(container, expanded) {
  const sidebar = container?.querySelector(".home-sidebar");
  if (!sidebar) return;

  if (sidebar._legacyOpenTimer) {
    clearTimeout(sidebar._legacyOpenTimer);
    sidebar._legacyOpenTimer = null;
  }

  if (expanded) {
    sidebar.classList.add("opening", "content-expanded", "expanded");
    sidebar._legacyOpenTimer = setTimeout(() => {
      sidebar.classList.remove("opening");
      sidebar._legacyOpenTimer = null;
      scheduleRootSidebarTextFit(container);
    }, 350);
    scheduleRootSidebarTextFit(container);
    return;
  }

  sidebar.classList.remove("opening", "content-expanded", "expanded");
  scheduleRootSidebarTextFit(container);
}

export function getLegacySidebarNodes(container) {
  return Array.from(container?.querySelectorAll(".home-sidebar .focusable") || [])
    .filter((node) => !node.closest(".modern-sidebar-panel"));
}

export function getLegacySidebarSelectedNode(container) {
  return container?.querySelector(".home-sidebar .home-nav-item.selected")
    || container?.querySelector(".home-sidebar .home-nav-item")
    || container?.querySelector(".home-sidebar .focusable")
    || null;
}

export function handleLegacySidebarBack(screen, event) {
  const keyCode = Number(event?.keyCode || 0);
  const isBackEvent = keyCode === 8 || keyCode === 27 || keyCode === 461 || keyCode === 10009;
  if (!isBackEvent) {
    return false;
  }

  event?.preventDefault?.();

  const current = screen?.container?.querySelector(".focusable.focused")
    || document.activeElement
    || null;
  const sidebarFocused = Boolean(current?.closest?.(".home-sidebar"));

  if (sidebarFocused) {
    Router.navigate("home");
    return true;
  }

  if (typeof screen?.focusSidebarNode === "function") {
    screen.focusSidebarNode();
    return true;
  }

  if (screen && typeof screen.applyFocus === "function") {
    const nodes = getLegacySidebarNodes(screen.container);
    const selected = getLegacySidebarSelectedNode(screen.container);
    screen.focusZone = "sidebar";
    screen.sidebarFocusIndex = Math.max(0, nodes.indexOf(selected));
    screen.applyFocus();
    return true;
  }

  return false;
}

export function getModernSidebarNodes(container) {
  return Array.from(container?.querySelectorAll(".modern-sidebar-panel .focusable") || []);
}

export function getModernSidebarSelectedNode(container) {
  return container?.querySelector(".modern-sidebar-panel .modern-sidebar-nav-item.selected")
    || container?.querySelector(".modern-sidebar-panel .modern-sidebar-nav-item")
    || container?.querySelector(".modern-sidebar-panel .focusable")
    || null;
}

export function getRootSidebarNodes(container, layout = {}) {
  return layout?.modernSidebar ? getModernSidebarNodes(container) : getLegacySidebarNodes(container);
}

export function getRootSidebarSelectedNode(container, layout = {}) {
  return layout?.modernSidebar ? getModernSidebarSelectedNode(container) : getLegacySidebarSelectedNode(container);
}

export function isRootSidebarNode(node) {
  return Boolean(node?.closest?.(".home-sidebar, .modern-sidebar-panel"));
}

export function setModernSidebarPillIconOnly(container, iconOnly, keepExpanded = false) {
  const shell = container?.querySelector(".modern-sidebar-shell");
  const pill = container?.querySelector(".modern-sidebar-pill");
  const shouldKeepExpanded = Boolean(keepExpanded || shell?.classList?.contains("keep-pill-expanded"));
  if (!pill || shouldKeepExpanded) {
    pill?.classList.remove("icon-only");
    return;
  }
  pill.classList.toggle("icon-only", Boolean(iconOnly));
}

export function setModernSidebarExpanded(container, expanded) {
  const shell = container?.querySelector(".modern-sidebar-shell");
  if (!shell) {
    return false;
  }
  const panel = shell.querySelector(".modern-sidebar-panel");
  const pill = shell.querySelector(".modern-sidebar-pill");
  if (shell._modernOpenTimer) {
    clearTimeout(shell._modernOpenTimer);
    shell._modernOpenTimer = null;
  }
  if (shell._modernCloseStartTimer) {
    clearTimeout(shell._modernCloseStartTimer);
    shell._modernCloseStartTimer = null;
  }
  if (shell._modernCloseEndTimer) {
    clearTimeout(shell._modernCloseEndTimer);
    shell._modernCloseEndTimer = null;
  }

  if (expanded) {
    shell.classList.add("panel-visible", "opening");
    shell.classList.remove("collapsing");
    if (panel) {
      panel.setAttribute("aria-hidden", "false");
    }
    if (pill) {
      pill.setAttribute("aria-expanded", "true");
    }
    requestAnimationFrame(() => {
      shell.classList.add("expanded");
    });
    shell._modernOpenTimer = setTimeout(() => {
      shell.classList.remove("opening");
      shell._modernOpenTimer = null;
      scheduleRootSidebarTextFit(container);
    }, 365);
    scheduleRootSidebarTextFit(container);
    return true;
  }

  shell.classList.add("collapsing");
  shell.classList.remove("opening");
  if (pill) {
    pill.setAttribute("aria-expanded", "false");
  }
  shell._modernCloseStartTimer = setTimeout(() => {
    shell.classList.remove("expanded");
    shell._modernCloseStartTimer = null;
  }, 70);
  shell._modernCloseEndTimer = setTimeout(() => {
    shell.classList.remove("panel-visible", "collapsing");
    if (panel) {
      panel.setAttribute("aria-hidden", "true");
    }
    shell._modernCloseEndTimer = null;
    scheduleRootSidebarTextFit(container);
  }, 430);
  scheduleRootSidebarTextFit(container);
  return true;
}

export function focusWithoutAutoScroll(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}
