# Legacy Compatibility Requirements

## Supported Floor

- LG webOS 4.x: Chromium 53
- Samsung Tizen 5.0
- WebOS services: Node 6

Do not raise these targets without changing the published support policy.

## Limitations

- No Flexbox `gap`, `row-gap`, or `column-gap`. Use child margins; wrapped
  layouts need container and child margins on both axes.
- No required CSS Grid layouts. Use Flexbox.
- No direct `Element.scrollIntoView({ ... })`. Use
  `js/ui/navigation/scrollIntoView.js`.
- Do not rely on `aspect-ratio`, `backdrop-filter`, or other post-Chromium-53
  CSS. Provide a baseline fallback; optional enhancements may use `@supports`.
- Do not use unverified browser APIs. Prefer existing helpers or local
  fallbacks over new compatibility dependencies.
- Do not use Node APIs newer than Node 6 in `services/webos/**`. Transpilation
  lowers syntax but does not polyfill runtime APIs.

## Requirements

- Keep app builds targeted at Chromium 53 and webOS services targeted at Node 6.
- Modern syntax under `js/**` is allowed only when the build transpiles it.
- New built-ins must be covered by the generated core-js bundle or a local
  fallback.
- Run `npm run build` and inspect `dist` for compatibility-sensitive changes.