# Android Modern Home Parity Notes

Source of truth: `/Users/edin/Documents/NuvioTV/app/src/main/java/com/nuvio/tv/ui/screens/home`

Target state for this port:
- Theme: `WHITE`
- Font: `INTER`
- Layout: `MODERN`
- Hero enabled
- Legacy sidebar enabled
- Focused-poster expansion disabled
- Focused-poster trailer playback disabled

Locked Android values used for the modern web port:
- Hero focus debounce: `90ms`
- Directional key repeat throttle: `80ms`
- Hero text width fraction: `0.42`
- Hero media width fraction: `0.75`
- Hero media height fraction: `0.62`
- Modern row header focus inset: `40dp`
- Bottom row viewport height fraction: `0.52`
- Hero-to-row gap: `16dp`
- Row title bottom spacing: `14dp`
- Vertical row spacing: `24dp`
- Base poster card: `126dp x 189dp`, radius `12dp`

Modern-specific Android behavior reflected in the web implementation:
- No timed hero rotation in modern mode.
- Hero content changes only from focused-item changes after debounce.
- Continue Watching renders as the first carousel row when present.
- Catalog rows render as horizontal carousels with the hero acting as a live preview surface.
- Focus restoration preserves:
  - main vertical scroll
  - active row
  - active item within row
  - horizontal scroll position for each row
- Sidebar handoff keeps legacy sidebar behavior because that is the Android default target state for this phase.

Known intentional platform compromise:
- Jetpack Compose `dp` values are mapped into the existing web TV canvas and CSS variables rather than using a direct `1dp == 1px` translation. Ratios, ordering, debounce, spacing relationships, and motion timing are preserved from Android source.
