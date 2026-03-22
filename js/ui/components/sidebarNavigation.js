import { Router } from "../navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";
import { I18n } from "../../i18n/index.js";
import { Platform } from "../../platform/index.js";

const ROOT_SIDEBAR_ITEMS = [
  { action: "gotoHome", route: "home", labelKey: "sidebar.home", iconType: "material", iconName: "home" },
  {
    action: "gotoSearch",
    route: "search",
    labelKey: "sidebar.search",
    iconType: "svg",
    viewBox: "0 0 20 20",
    iconMarkup: '<path fill-rule="evenodd" d="M4 9a5 5 0 1110 0A5 5 0 014 9zm5-7a7 7 0 104.2 12.6.999.999 0 00.093.107l3 3a1 1 0 001.414-1.414l-3-3a.999.999 0 00-.107-.093A7 7 0 009 2z"/>'
  },
  {
    action: "gotoLibrary",
    route: "library",
    labelKey: "sidebar.library",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup: '<path d="M8.50989 2.00001H15.49C15.7225 1.99995 15.9007 1.99991 16.0565 2.01515C17.1643 2.12352 18.0711 2.78958 18.4556 3.68678H5.54428C5.92879 2.78958 6.83555 2.12352 7.94337 2.01515C8.09917 1.99991 8.27741 1.99995 8.50989 2.00001Z"/><path d="M6.31052 4.72312C4.91989 4.72312 3.77963 5.56287 3.3991 6.67691C3.39117 6.70013 3.38356 6.72348 3.37629 6.74693C3.77444 6.62636 4.18881 6.54759 4.60827 6.49382C5.68865 6.35531 7.05399 6.35538 8.64002 6.35547L8.75846 6.35547L15.5321 6.35547C17.1181 6.35538 18.4835 6.35531 19.5639 6.49382C19.9833 6.54759 20.3977 6.62636 20.7958 6.74693C20.7886 6.72348 20.781 6.70013 20.773 6.67691C20.3925 5.56287 19.2522 4.72312 17.8616 4.72312H6.31052Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.67239 7.54204H15.3276C18.7024 7.54204 20.3898 7.54204 21.3377 8.52887C22.2855 9.5157 22.0625 11.0403 21.6165 14.0896L21.1935 16.9811C20.8437 19.3724 20.6689 20.568 19.7717 21.284C18.8745 22 17.5512 22 14.9046 22H9.09536C6.44881 22 5.12553 22 4.22834 21.284C3.33115 20.568 3.15626 19.3724 2.80648 16.9811L2.38351 14.0896C1.93748 11.0403 1.71447 9.5157 2.66232 8.52887C3.61017 7.54204 5.29758 7.54204 8.67239 7.54204ZM8 18.0001C8 17.5859 8.3731 17.2501 8.83333 17.2501H15.1667C15.6269 17.2501 16 17.5859 16 18.0001C16 18.4144 15.6269 18.7502 15.1667 18.7502H8.83333C8.3731 18.7502 8 18.4144 8 18.0001Z"/>'
  },
  {
    action: "gotoPlugin",
    route: "plugin",
    labelKey: "sidebar.addons",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup: '<path d="M2,9 C2,7.34315 3.34315,6 5,6 L7.85279,6 C8.15014,6 8.33369,5.69148 8.21898,5.41714 C8.16269,5.28251 8.11486,5.14448 8.0827,5 C7.75165,3.51305 8.87451,2 10.5,2 C12.1255,2 13.2483,3.51305 12.9173,5 C12.8851,5.14448 12.8373,5.28251 12.781,5.41714 C12.6663,5.69148 12.8499,6 13.1472,6 L15,6 C16.6569,6 18,7.34315 18,9 L18,10.8528 C18,11.1501 18.3085,11.3337 18.5829,11.219 C18.7175,11.1627 18.8555,11.1149 19,11.0827 C20.4869,10.7517 22,11.8745 22,13.5 C22,15.1255 20.4869,16.2483 19,15.9173 C18.8555,15.8851 18.7175,15.8373 18.5829,15.781 C18.3085,15.6663 18,15.8499 18,16.1472 L18,19 C18,20.6569 16.6569,22 15,22 L13.1066,22 C12.8194,22 12.6341,21.7088 12.7164,21.4337 C12.7583,21.2937 12.7892,21.1502 12.8021,21 C12.9129,19.7075 11.8988,18.5 10.5,18.5 C9.1012,18.5 8.08712,19.7075 8.1979,21 C8.21078,21.1502 8.2417,21.2937 8.28358,21.4337 C8.36589,21.7088 8.18055,22 7.89338,22 L5,22 C3.34315,22 2,20.6569 2,19 L2,16.1066 C2,15.8194 2.29121,15.6341 2.56632,15.7164 C2.7063,15.7583 2.84976,15.7892 3,15.8021 C4.29252,15.9129 5.5,14.8988 5.5,13.5 C5.5,12.1012 4.29252,11.0871 3,11.1979 C2.84976,11.2108 2.7063,11.2417 2.56633,11.2836 C2.29121,11.3659 2,11.1806 2,10.8934 L2,9 Z"/>'
  },
  {
    action: "gotoSettings",
    route: "settings",
    labelKey: "sidebar.settings",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup: '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224ZM12.5 15C14.1695 15 15.5228 13.6569 15.5228 12C15.5228 10.3431 14.1695 9 12.5 9C10.8305 9 9.47716 10.3431 9.47716 12C9.47716 13.6569 10.8305 15 12.5 15Z"/>'
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
      ${item?.iconMarkup || ""}
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

function getSelectedItem(routeName = "") {
  return ROOT_SIDEBAR_ITEMS.find((item) => item.route === String(routeName || "")) || ROOT_SIDEBAR_ITEMS[0];
}

function getItemForAction(action = "") {
  return ROOT_SIDEBAR_ITEMS.find((item) => item.action === String(action || "")) || null;
}

function getModernSidebarPresentation() {
  return {
    showPill: true,
    keepPillExpanded: true
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
  const activeProfileAvatarUrl = AvatarRepository.getAvatarImageUrl(activeProfile?.avatarId, avatarCatalog);

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
  const showProfileSelector = Boolean(profileState.showProfileSelector && profileState.activeProfileName);
  const collapsible = Boolean(layout?.collapseSidebar);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <aside class="home-sidebar root-sidebar root-sidebar-legacy${performanceConstrained ? " performance-constrained" : ""}"
           data-selected-route="${selectedRoute}"
           data-collapsible="${collapsible ? "true" : "false"}">
      ${showProfileSelector ? `
        <button class="home-profile-pill focusable"
                data-action="gotoAccount"
                aria-label="${t("sidebar.switchProfile")}">
          <span class="home-profile-avatar" style="background:${profileState.activeProfileColorHex || getThemeAccentFallback()}">
            ${profileState.activeProfileAvatarUrl
              ? `<img class="sidebar-profile-avatar-image" src="${profileState.activeProfileAvatarUrl}" alt="${profileState.activeProfileName || t("sidebar.profileFallback")}" />`
              : (profileState.activeProfileInitial || "P")}
          </span>
          <span class="home-profile-name">${profileState.activeProfileName || t("sidebar.profileFallback")}</span>
        </button>
      ` : ""}
      <div class="home-nav-list">
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
  const { showPill, keepPillExpanded } = getModernSidebarPresentation();
  const selectedLabel = itemLabel(selectedItem);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <div class="modern-sidebar-shell${expanded ? " expanded" : ""}${blurEnabled ? " blur-enabled" : ""}${keepPillExpanded ? " keep-pill-expanded" : ""}${performanceConstrained ? " performance-constrained" : ""}" data-selected-route="${selectedRoute}">
      ${showPill ? `
        <button class="modern-sidebar-pill${pillIconOnly && !keepPillExpanded ? " icon-only" : ""}" data-action="expandSidebar" aria-label="${t("sidebar.expandSidebar")}" aria-expanded="${expanded ? "true" : "false"}">
          <img class="modern-sidebar-pill-chevron" src="assets/icons/ic_chevron_compact_left.png" alt="" aria-hidden="true" />
          <span class="modern-sidebar-pill-chip">
            <span class="modern-sidebar-pill-icon-wrap">${iconMarkup(selectedItem, "modern-sidebar-pill-icon")}</span>
            <span class="modern-sidebar-pill-label">${selectedLabel}</span>
          </span>
        </button>
      ` : ""}
      <aside class="modern-sidebar-panel" aria-hidden="${expanded ? "false" : "true"}"${expanded ? "" : " hidden"}>
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
  container?.querySelectorAll(".home-sidebar .focusable, .modern-sidebar-panel .focusable").forEach((node) => {
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
}

export function setLegacySidebarExpanded(container, expanded) {
  const sidebar = container?.querySelector(".home-sidebar");
  if (!sidebar) {
    return;
  }
  sidebar.classList.toggle("expanded", Boolean(expanded));
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
  shell.classList.toggle("expanded", Boolean(expanded));
  if (panel) {
    panel.hidden = !expanded;
    panel.setAttribute("aria-hidden", expanded ? "false" : "true");
  }
  if (pill) {
    pill.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
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
