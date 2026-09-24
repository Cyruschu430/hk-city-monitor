# web/scripts — probes and gates

Three different kinds of file live here. Knowing which is which saves an hour.

| Kind | What it is | What to do with it |
|---|---|---|
| **Gate** | The acceptance test for a change. Must pass before you report done. | Run it. If it fails, the change is not done. |
| **Probe** | A one-question instrument written to answer a specific doubt. Prints numbers, asserts little. | Re-run when the same doubt returns. Superseded ones are listed below — do not extend them. |
| **Tool** | A repeatable job (data sync, attribution, baselines). | Run on its schedule. |

## The gates (run these, in this order)

```
npm run typecheck                              # 0 errors
npm test                                       # 6 suites, assert-style
python scripts/validate_config.py              # exit 0
node web/scripts/verify-browser.mjs http://localhost:4173/    # 66 DOM checks
```

`verify-browser.mjs` is the binding one for anything visual: **a UI claim is verified in the
DOM, not from a screenshot** (AGENTS.md, Pitfall 16). It starts by asserting the app's *own*
landing state before it clicks anything — added 2026-09-24 after a bug hid for hours behind a
harness that clicked through every mode before counting panels (Pitfall 19).

## Probes worth keeping, and the question each answers

| Probe | Question it answers |
|---|---|
| `probe-firstpaint.mjs` | How many panels mount on a **cold** load, sampled over time? This is what found the 18→1 collapse. |
| `probe-trigger-boot.mjs` | Which vertical did the trigger engine hoist at boot, and on what state? |
| `probe-staleness.mjs` | Per panel: state, chip, cadence, and the quiet tolerance applied. Distinguishes "genuinely quiet" from "misconfigured". |
| `probe-coldshot.mjs` | The **true** first-paint screenshot — no clicks, no layer toggles. The verify harness's own screenshots show a state no first-time visitor sees. |
| `probe-mount.mjs` | What is actually in `#panels`, and did any page error occur? |
| `audit-production.mjs` | Whole-page sweep: panel states, layout overflow, HTTP ≥400, console errors. **Note:** it clicks through tabs/modes, so it measures the post-interaction steady state — pair it with `probe-firstpaint.mjs`. |
| `probe-tpqueue-overflow.mjs` | Inner overflow on a dense grid panel (the 151px-cell bug). |
| `probe-status-cell.mjs` | The status bar cell layout. |
| `probe-production-worker.mjs` | The deployed Worker answers as expected. |
| `probe-3d-error.mjs` / `probe-3d-tileset.mjs` | The 3D layer's error path and tileset reachability. |
| `probe-baselines-live.mjs` | The hourly baseline collector is producing data the rules can consume. |
| `probe-water-districts.mjs` | Which districts the water layer lights, vs the raw records. |
| `probe-invalidstate-cause.mjs` / `probe-invalidstate-impact.mjs` | The MapLibre `InvalidStateError` — cause and measured impact (0 broken images). Conclusion is in `KNOWN_ISSUES.md` §1; do not re-investigate from scratch. |

## Browser harness conventions

Every probe here launches its **own** headless Chrome with the Playwright-managed binary. Do not
attach to the user's browser: Chrome 136+ refuses the debug port on the default profile.

**A readiness gate must be a predicate, not a timer.** `probe-staleness.mjs` used to wait a fixed
16s and printed a single row on a slow boot, which reads as a data fault when the app is fine.
Wait for `document.body.dataset.ready === "1"` *and* for a condition that means "settled" — e.g.
every `.panel[data-state]` present and none still `loading` — and fail loudly with the counts if
it never holds.

**Measure before you interact.** If a probe clicks a tab, toggles a layer, or switches a mode
before it reads a number, that number describes the probe's own setup, not what a user gets.

## Removed

Nine one-off `probe-decode-*.mjs` scripts were deleted 2026-09-24 once the `InvalidStateError`
was fully characterised and written up in `KNOWN_ISSUES.md` §1. The two that still answer a
useful question were kept and renamed (`probe-invalidstate-*`).
