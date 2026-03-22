import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "themeSettings";
const ACCENT_MIGRATION_FLAG_KEY = "themeAccentMigratedToWhite";
const LEGACY_DEFAULT_ACCENT = "#ff3d00";

const DEFAULT_THEME = {
  mode: "dark",
  themeName: "WHITE",
  accentColor: "#ffffff",
  fontFamily: "INTER",
  language: null
};

const THEME_BY_ACCENT = new Map([
  ["#ffffff", "WHITE"],
  ["#f5f5f5", "WHITE"],
  ["#f5f8fc", "WHITE"],
  ["#ff4d4f", "CRIMSON"],
  ["#ff5252", "CRIMSON"],
  ["#42a5f5", "OCEAN"],
  ["#ba68c8", "VIOLET"],
  ["#ab47bc", "VIOLET"],
  ["#66bb6a", "EMERALD"],
  ["#ffca28", "AMBER"],
  ["#ffa726", "AMBER"],
  ["#ec407a", "ROSE"]
]);

const ACCENT_BY_THEME = {
  WHITE: "#f5f5f5",
  CRIMSON: "#e53935",
  OCEAN: "#1e88e5",
  VIOLET: "#8e24aa",
  EMERALD: "#43a047",
  AMBER: "#fb8c00",
  ROSE: "#d81b60"
};

function normalizeTheme(settings = {}) {
  const accent = String(settings?.accentColor || DEFAULT_THEME.accentColor).toLowerCase();
  const themeName = String(
    settings?.themeName
    || THEME_BY_ACCENT.get(accent)
    || DEFAULT_THEME.themeName
  ).toUpperCase();
  const normalizedAccent = String(ACCENT_BY_THEME[themeName] || accent || DEFAULT_THEME.accentColor).toLowerCase();

  return {
    ...DEFAULT_THEME,
    ...settings,
    themeName,
    accentColor: normalizedAccent
  };
}

export const ThemeStore = {

  get() {
    const stored = (LocalStore.get(KEY, {}) || {});
    if (
      String(stored?.accentColor || "").toLowerCase() === LEGACY_DEFAULT_ACCENT
      && !LocalStore.get(ACCENT_MIGRATION_FLAG_KEY, false)
    ) {
      const migrated = { ...stored, accentColor: DEFAULT_THEME.accentColor };
      LocalStore.set(KEY, migrated);
      LocalStore.set(ACCENT_MIGRATION_FLAG_KEY, true);
      return normalizeTheme(migrated);
    }
    return normalizeTheme(stored);
  },

  set(partial) {
    LocalStore.set(KEY, normalizeTheme({ ...this.get(), ...(partial || {}) }));
  }

};
