const palettes = {
  WHITE: {
    "--bg-color": "#0d0d0d",
    "--bg-elevated": "#1a1a1a",
    "--card-bg": "#222222",
    "--secondary-color": "#f5f5f5",
    "--secondary-variant": "#e0e0e0",
    "--on-secondary": "#111111",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#ffffff",
    "--focus-bg": "#303030"
  },
  CRIMSON: {
    "--bg-color": "#0d0d0d",
    "--bg-elevated": "#1a1a1a",
    "--card-bg": "#241a1a",
    "--secondary-color": "#e53935",
    "--secondary-variant": "#c62828",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#ff5252",
    "--focus-bg": "#3d1a1a"
  },
  OCEAN: {
    "--bg-color": "#0d0d0f",
    "--bg-elevated": "#1a1a1e",
    "--card-bg": "#1a1f24",
    "--secondary-color": "#1e88e5",
    "--secondary-variant": "#1565c0",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#42a5f5",
    "--focus-bg": "#1a2d3d"
  },
  VIOLET: {
    "--bg-color": "#0d0d0f",
    "--bg-elevated": "#1a1a1e",
    "--card-bg": "#1f1a24",
    "--secondary-color": "#8e24aa",
    "--secondary-variant": "#6a1b9a",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#ab47bc",
    "--focus-bg": "#2d1a3d"
  },
  EMERALD: {
    "--bg-color": "#0d0d0d",
    "--bg-elevated": "#1a1a1a",
    "--card-bg": "#1a241a",
    "--secondary-color": "#43a047",
    "--secondary-variant": "#2e7d32",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#66bb6a",
    "--focus-bg": "#1a3d1e"
  },
  AMBER: {
    "--bg-color": "#0f0d0d",
    "--bg-elevated": "#1e1a1a",
    "--card-bg": "#24201a",
    "--secondary-color": "#fb8c00",
    "--secondary-variant": "#ef6c00",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#ffa726",
    "--focus-bg": "#3d2d1a"
  },
  ROSE: {
    "--bg-color": "#0d0d0d",
    "--bg-elevated": "#1a1a1a",
    "--card-bg": "#241a1f",
    "--secondary-color": "#d81b60",
    "--secondary-variant": "#c2185b",
    "--on-secondary": "#ffffff",
    "--text-color": "#ffffff",
    "--text-secondary": "#b3b3b3",
    "--text-tertiary": "#808080",
    "--border-color": "#333333",
    "--focus-color": "#ec407a",
    "--focus-bg": "#3d1a2d"
  }
};

export const ThemeColors = {
  dark: palettes.WHITE,
  palettes,

  getPalette(themeName = "WHITE") {
    return palettes[String(themeName || "WHITE").toUpperCase()] || palettes.WHITE;
  }
};
