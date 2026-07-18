# Repository Guidance

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