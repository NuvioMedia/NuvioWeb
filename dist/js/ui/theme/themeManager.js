import { ThemeStore } from "../../data/local/themeStore.js";
import { ThemeColors } from "./themeColors.js";

const FONT_STACKS = {
  INTER: "\"Inter\", \"Segoe UI\", Arial, sans-serif",
  DM_SANS: "\"DM Sans\", \"Segoe UI\", Arial, sans-serif",
  OPEN_SANS: "\"Open Sans\", \"Segoe UI\", Arial, sans-serif"
};

export const ThemeManager = {

  apply() {
    const theme = ThemeStore.get();
    const colors = ThemeColors.getPalette(theme.themeName);

    Object.entries(colors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    document.documentElement.style.setProperty(
      "--app-font-family",
      FONT_STACKS[String(theme.fontFamily || "INTER").toUpperCase()] || FONT_STACKS.INTER
    );
  }

};
