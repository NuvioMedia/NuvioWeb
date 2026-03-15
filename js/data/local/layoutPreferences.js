import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "layoutPreferences";

const DEFAULTS = {
  homeLayout: "modern",
  heroSectionEnabled: true,
  searchDiscoverEnabled: true,
  posterLabelsEnabled: true,
  catalogAddonNameEnabled: true,
  catalogTypeSuffixEnabled: true,
  modernLandscapePostersEnabled: false,
  focusedPosterBackdropExpandEnabled: false,
  focusedPosterBackdropExpandDelaySeconds: 3,
  focusedPosterBackdropTrailerEnabled: false,
  focusedPosterBackdropTrailerMuted: true,
  focusedPosterBackdropTrailerPlaybackTarget: "hero_media",
  posterCardWidthDp: 126,
  posterCardCornerRadiusDp: 12,
  detailPageTrailerButtonEnabled: false,
  collapseSidebar: false,
  modernSidebar: false,
  modernSidebarBlur: false,
  hideUnreleasedContent: false
};

function normalizeLayoutPreferences(value = {}) {
  const merged = {
    ...DEFAULTS,
    ...(value || {})
  };
  const modernSidebar = Boolean(merged.modernSidebar);

  return {
    ...merged,
    modernLandscapePostersEnabled: Boolean(merged.modernLandscapePostersEnabled),
    focusedPosterBackdropExpandEnabled: Boolean(merged.focusedPosterBackdropExpandEnabled),
    focusedPosterBackdropExpandDelaySeconds: Math.max(0, Number(merged.focusedPosterBackdropExpandDelaySeconds ?? 3) || 0),
    focusedPosterBackdropTrailerEnabled: Boolean(merged.focusedPosterBackdropTrailerEnabled),
    focusedPosterBackdropTrailerMuted: merged.focusedPosterBackdropTrailerMuted !== false,
    focusedPosterBackdropTrailerPlaybackTarget: String(merged.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase() === "expanded_card"
      ? "expanded_card"
      : "hero_media",
    posterCardWidthDp: Math.max(72, Number(merged.posterCardWidthDp ?? 126) || 126),
    posterCardCornerRadiusDp: Math.max(0, Number(merged.posterCardCornerRadiusDp ?? 12) || 12),
    detailPageTrailerButtonEnabled: Boolean(merged.detailPageTrailerButtonEnabled),
    collapseSidebar: modernSidebar ? false : Boolean(merged.collapseSidebar),
    modernSidebar,
    modernSidebarBlur: modernSidebar ? Boolean(merged.modernSidebarBlur) : Boolean(merged.modernSidebarBlur)
  };
}

export const LayoutPreferences = {

  get() {
    return normalizeLayoutPreferences(LocalStore.get(KEY, {}) || {});
  },

  set(partial) {
    LocalStore.set(KEY, normalizeLayoutPreferences({ ...this.get(), ...(partial || {}) }));
  }

};
