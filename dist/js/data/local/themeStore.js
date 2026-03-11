import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "themeSettings";
const ACCENT_MIGRATION_FLAG_KEY = "themeAccentMigratedToWhite";
const LEGACY_DEFAULT_ACCENT = "#ff3d00";

const DEFAULT_THEME = {
  mode: "dark",
  accentColor: "#f5f8fc"
};

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
      return {
        ...DEFAULT_THEME,
        ...migrated
      };
    }
    return {
      ...DEFAULT_THEME,
      ...stored
    };
  },

  set(partial) {
    LocalStore.set(KEY, { ...this.get(), ...(partial || {}) });
  }

};
