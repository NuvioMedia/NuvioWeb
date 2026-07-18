export const compatibilityPolicy = Object.freeze({
  // Official floor: Samsung 2019 (Tizen 5.0) and LG 2018 (webOS 4.x / Chromium 53).
  tizenSupportYear: 2019,
  webOsSupportYear: 2018,
  webOsRequiredVersion: "4.0.0",
  tizenRequiredVersion: "5.0",
  // esbuild + PostCSS baseline. Chromium 53 is webOS 4.x (2018-2019).
  chromiumVersion: 53,
  webOsServiceNodeVersion: 6
});
