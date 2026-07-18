# Repository Guidance

## Legacy platform baseline

The supported floor is LG webOS 4.x / Chromium 53 and Samsung Tizen 5.0.
Keep the application bundle target at Chromium 53 and the webOS service target
at Node 6 unless the published support policy changes.

Do not add the following to future code:

- Flexbox `gap`, `row-gap`, or `column-gap`. Use direct child margins. For
	wrapped flex layouts, use container/child margins and verify both axes.
- CSS Grid as required layout behavior. Use the existing Flexbox layout
	patterns instead.
- Direct `Element.scrollIntoView({ ... })` calls. Use
	`js/ui/navigation/scrollIntoView.js` as described below.
- CSS `aspect-ratio`, `backdrop-filter`, or other post-Chromium-53 features as
	the only implementation. Provide explicit dimensions/fallback styles first;
	put optional enhancements behind `@supports` when useful.
- Browser APIs solely because current desktop Chrome supports them. Confirm
	Chromium 53 support or use an existing local helper/polyfill. Do not add a
	new compatibility dependency when a small platform helper is sufficient.
- Node runtime APIs newer than Node 6 in `services/webos/**`. Esbuild can lower
	syntax, but it does not polyfill Node built-ins or newer runtime methods.

Application JavaScript under `js/**` is bundled by esbuild for Chromium 53, so
modern syntax is acceptable when the build lowers it. New built-in APIs still
need to be supported by the generated core-js bundle or handled locally.

When changing compatibility-sensitive code, run `npm run build` and inspect the
generated `dist` output rather than validating only in desktop Chrome.

## Scroll compatibility

The supported webOS floor is Chromium 53. Do not replace
`js/ui/navigation/scrollIntoView.js` with direct
`Element.scrollIntoView({ block, inline, behavior })` calls.

Chromium 53 exposes `Element.scrollIntoView`, but does not reliably implement
the options-object overload. Passing an object may be accepted while its
`block`, `inline`, and `behavior` fields are ignored and treated like the legacy
boolean form. This can move TV focus targets to the wrong edge of a scroll
container.

Use the shared helper instead. It uses the standards-based options API on
modern engines, Chromium 53's `scrollIntoViewIfNeeded(false)` for nearest-edge
behavior, and the legacy boolean API as a final fallback. Smooth scrolling is a
progressive enhancement on older TVs and may become an instant scroll.