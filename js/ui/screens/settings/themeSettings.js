import { ThemeStore } from "../../../data/local/themeStore.js";
import { ThemeManager } from "../../theme/themeManager.js";

export const ThemeSettings = {

  getItems() {
    const theme = ThemeStore.get();
    const setAccent = (accentColor) => {
      ThemeStore.set({ accentColor });
      ThemeManager.apply();
    };
    return [
      {
        id: "theme_apply_dark",
        label: "Apply Dark Theme",
        description: `Current accent: ${theme.accentColor}`,
        action: () => {
          ThemeStore.set({ mode: "dark" });
          ThemeManager.apply();
        }
      },
      {
        id: "theme_accent_white",
        label: "Accent White",
        description: "Android default focus style",
        action: () => setAccent("#f5f8fc")
      },
      {
        id: "theme_accent_crimson",
        label: "Accent Crimson",
        description: "High contrast warm accent",
        action: () => setAccent("#ff4d4f")
      },
      {
        id: "theme_accent_ocean",
        label: "Accent Ocean",
        description: "Blue accent",
        action: () => setAccent("#42a5f5")
      },
      {
        id: "theme_accent_violet",
        label: "Accent Violet",
        description: "Purple accent",
        action: () => setAccent("#ba68c8")
      },
      {
        id: "theme_accent_emerald",
        label: "Accent Emerald",
        description: "Green accent",
        action: () => setAccent("#66bb6a")
      },
      {
        id: "theme_accent_amber",
        label: "Accent Amber",
        description: "Amber accent",
        action: () => setAccent("#ffca28")
      },
    ];
  }

};
