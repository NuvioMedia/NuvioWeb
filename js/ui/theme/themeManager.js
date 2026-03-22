import { ThemeStore } from "../../data/local/themeStore.js";
import { ThemeColors } from "./themeColors.js";

const FONT_STACKS = {
  INTER: "\"Inter\", \"Segoe UI\", Arial, sans-serif",
  DM_SANS: "\"DM Sans\", \"Segoe UI\", Arial, sans-serif",
  OPEN_SANS: "\"Open Sans\", \"Segoe UI\", Arial, sans-serif"
};

function toRgbChannels(hex, fallback = "255 255 255") {
  const value = String(hex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return fallback;
  }
  const normalized = match[1];
  return `${parseInt(normalized.slice(0, 2), 16)} ${parseInt(normalized.slice(2, 4), 16)} ${parseInt(normalized.slice(4, 6), 16)}`;
}

export const ThemeManager = {

  apply() {
    const theme = ThemeStore.get();
    const colors = ThemeColors.getPalette(theme.themeName);
    const derivedColors = {
      "--bg-color-rgb": toRgbChannels(colors["--bg-color"], "13 13 13"),
      "--bg-elevated-rgb": toRgbChannels(colors["--bg-elevated"], "26 26 26"),
      "--card-bg-rgb": toRgbChannels(colors["--card-bg"], "34 34 34"),
      "--secondary-color-rgb": toRgbChannels(colors["--secondary-color"], "245 245 245"),
      "--focus-color-rgb": toRgbChannels(colors["--focus-color"], "255 255 255"),
      "--player-secondary": colors["--secondary-color"],
      "--player-on-secondary": colors["--on-secondary"],
      "--player-focus-ring": colors["--focus-color"],
      "--player-focus-background": colors["--focus-bg"],
      "--player-background-elevated": colors["--bg-elevated"],
      "--player-background-card": colors["--card-bg"],
      "--player-text-primary": colors["--text-color"],
      "--player-text-secondary": colors["--text-secondary"],
      "--player-text-tertiary": colors["--text-tertiary"]
    };

    Object.entries({ ...colors, ...derivedColors }).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    document.documentElement.style.setProperty(
      "--app-font-family",
      FONT_STACKS[String(theme.fontFamily || "INTER").toUpperCase()] || FONT_STACKS.INTER
    );
    document.documentElement.style.setProperty("color-scheme", "dark");
  }

};
