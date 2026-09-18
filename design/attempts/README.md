# Attempts — what already failed, and why

Four takes on the same brief, every one generated in a **single pass**. Read this before designing
so you do not rebuild any of them.

| File | What it is | Verdict |
|---|---|---|
| `attempt-1-tilewall.html` | 12×5 grid of equal tiles; big camera tiles on top, real data in every cell | **Rejected.** No hierarchy. Reads as a webpage of boxes. Equal-size tiles are the amateur tell. |
| `attempt-4-map-plus-panels.html` | Full-bleed map with a floating panel column on the right | **Rejected.** Map as wallpaper, panels not integrated. |
| `attempt-2-reference-grammar.html` | Hero map + HUD labels with leader lines + control rail + bottom panels + ticker | **Right structure, not finished.** Labels overlap in dense districts; panels leave dead space on the right; the market panel's relevance is questioned. |
| `attempt-3-v4pro-oneshot.html` | The same brief given to a stronger model, one shot | **6.5/10 — "competent but generic".** Labels look like absolutely-positioned HTML boxes floating over the map; the map reads as a placeholder, not a designed component; typography generic; no memorable idea. |

## The lesson across all four

Every attempt was one generation, then stop. The gap between competent and world-class is **not the
model** — it is that none of these ran the loop: render → look at the screenshot → name ONE concrete
defect → fix → look again.

`.jpg` next to each file is that attempt's actual render. Look at them.
