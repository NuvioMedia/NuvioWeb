import { ThemeStore } from "../../data/local/themeStore.js";
import { ThemeColors } from "./themeColors.js";

export const ThemeManager = {

  apply() {
    const theme = ThemeStore.get();
    const colors = ThemeColors[theme.mode] || ThemeColors.dark;

    Object.entries(colors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    document.documentElement.style.setProperty("--focus-color", "#f5f8fc");
  }

};
