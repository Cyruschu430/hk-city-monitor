# web/scripts

Browser and data-file checks for the front end. Run everything under **Gates** before calling a
change done; the **Probes** are diagnostics kept for the questions they still answer.

## Gates (run these)

| File | Purpose |
| --- | --- |
| `check-all.mjs` | Runs every static and browser gate in one pass and reports each verdict. |
| `check-basemap.mjs` | Proves every basemap tile host is in the source registry and the tile-order contract holds. |
| `check-contrast.mjs` | Renders both themes and fails any visible text below the WCAG contrast ratio. |
| `check-encoding.mjs` | Scans source and data files for double-encoded (mojibake) text. |
| `check-layers.mjs` | Drives every layer control and asserts the map's own layers change, not just the control. |
| `check-layout.mjs` | Asserts the shell geometry: no panel overlaps, the column scrolls, deferred panels release. |
| `check-livewall.mjs` | Exercises the live wall's region tabs and its inline player. |
| `check-quota.mjs` | Measures Worker requests on a cold load against the daily free-tier budget. |
| `check-shell.mjs` | Asserts the page chrome in the DOM: header, footer, placard, key and drone assistant. |
| `check-tokens.mjs` | Checks that every `var(--token)` resolves and that themed tokens stay off the dark map face. |
| `measure-boot.mjs` | Reports what crosses the wire on a cold first paint and fails if 3D code is hoisted. |
| `measure-mobile.mjs` | Measures the phone shell and fails if the map is covered or a panel is unreachable. |
| `sync-data.mjs` | Copies the repository's registries and data files into the build's public data directory. |
| `verify-browser.mjs` | The full DOM acceptance pass over the served app: map, panels, ticker, palette, water pins. |
| `verify-carpark.mjs` | Confirms the carpark panel renders real rows from its source. |

## Probes (diagnostics, run when needed)

| File | Purpose |
| --- | --- |
| `audit-production.mjs` | Whole-page sweep: panel states, layout overflow, HTTP errors and console errors. |
| `build-mtr-index.mjs` | Regenerates the baked MTR station index from the official CSV (`--check` verifies it). |
| `probe-en-audit.mjs` | Scans the rendered DOM in English mode for untranslated chrome text. |
| `probe-fixtures.mjs` | Refreshes the real source payloads the parser tests run against. |
| `probe-firstpaint.mjs` | Samples how many panels mount on a cold load over time. |
| `probe-live-data.mjs` | Checks the app reads the live-data branch and falls back to the committed snapshot. |
| `probe-livestreams.mjs` | Audits the curated live-stream list for video ids that no longer exist. |
| `probe-staleness.mjs` | Compares each panel's observation time with its source cadence and quiet tolerance. |
| `resolve-live-news.mjs` | Resolves channel handles to their current live video id. |
| `serve-dist.mjs` | A minimal static server for pointing the gates at a build on disk. |
| `probe-deferral.mjs` | Checks whether panels outside the viewport hold their fetch until scrolled in. |
| `probe-misslimit.mjs` | Fires a burst of distinct uncached URLs to confirm the Worker's miss rate limit still trips. |
| `probe-orphan-layers.mjs` | Enumerates the map's own layers after each mode switch and names any that outlived its mode. |
| `probe-palette.mjs` | Separates the first palette keypress from the toggle case, so a close is not read as a failure. |
| `probe-slowpanels.mjs` | Times panels reported as slow from first paint to leaving the loading state. |
| `probe-toggles.mjs` | Checks each layer row's checked state and whether the click adds a map source. |
| `probe-trafficfetch.mjs` | Traces the special-traffic-news request, including a direct fetch and console errors. |
| `probe-uiux-defects.mjs` | Measures objective UI defects: clipped text, overflow, tiny type, tap targets below minimum. |
| `probe-uiux.mjs` | Reports layout metrics (regions, type sizes, panel density) for comparison runs. |
| `probe-windfetch.mjs` | Confirms the wind grid arrives in a real browser rather than trusting a server-side fetch. |
| `shot-trails.mjs` | Screenshots the hiking-trail layer so its colour key can be checked against the map. |
