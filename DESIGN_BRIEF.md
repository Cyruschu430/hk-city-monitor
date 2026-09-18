# DESIGN_BRIEF.md — HK City Monitor

> This is the visual contract. It is not inspiration, it is the spec.
> "一定要靚" is a requirement, not a preference. Vague prettiness is not acceptable;
> every claim below is a number you can check. If you deviate, say so and say why.

## 0. CORRECTION 2026-09-18 — read this before §1

The layout below was written as **full-bleed map + floating panel column**. That is WRONG.
Cyrus corrected the direction: it is a **big-screen tile wall** with **embedded video as the
headline**, and categories are a drill-down on top. The reference is Palantir, not a web
dashboard.

**The real contract:**

- **A wall of tiles filling a 12 × 5 grid at 1920×1080.** Tiles are flush; the 1px grid line *is*
  the divider. **The packing must be exact (60/60 cells)** — a one-cell hole in a video wall reads
  as a dead feed, not as whitespace.
- **Video and cameras are the biggest tiles, at the top.** They carry the screen.
- **A category strip across the top** (`全部 / 供水 / 醫療 / 交通 / 天氣 / 口岸`) with live counts.
  Pressing a category narrows the wall. Nobody sees all 171 sources at once.
- **No floating glass cards, no rounded corners, no shadows.** Flat tiles, hairline borders,
  a corner accent. Depth comes from the grid, not from blur.

### ⚠️ Live video: the finding that changes the design

The v0.1 app embedded YouTube with `youtube.com/embed/live_stream?channel=<CHANNEL_ID>`.
**That pattern is unreliable and must not be used.**

- Rendered over `file://` → **YouTube Error 153** (player configuration error).
- Rendered over `https://` with a real referrer → **"This video is unavailable"**.
- Checked all three channels at 2026-09-18 21:44 → **none was live**
  (`isLiveNow=false`, no `videoId`, no `hlsManifestUrl`).

So a hardcoded channel embed is a black rectangle most of the time, and the panel labelled
「直播」 in v0.1 was probably showing nothing.

**The fix — and it makes the wall better:**

1. **Camera stills are the video backbone.** 1,013 TD traffic cameras + 34 HKO weather cameras,
   keyless, 2–5 minute refresh, **always populated**. Three HKO HD feeds at 1920×1080 carry the
   top row, and one of them burns in its own timestamp — proof the frame is current.
2. **TV becomes a resolved status tile, not an embed.** A collector checks each channel for a live
   `videoId` and writes it to a static JSON. The tile shows the stream when one exists and says
   「現時無直播」 when none does. **An honest empty state beats a black rectangle pretending to be
   a feed** — the same rule as §6.

## 1. The feeling, in one line

A **control-room instrument**, not a website. Dense, calm, precise, dark — closer to a wall of
instrument panels than a page of cards. The reference register is a command centre, tuned to
Hong Kong.

Three words that must survive every design decision: **dense, legible, honest.**

- **Dense** — information per unit area is the point. Do not pad to look airy.
- **Legible** — nothing below 10px, everything on a fixed type scale, all numbers tabular.
- **Honest** — the UI never dresses stale, missing or partial data up as live. Truthfulness is
  part of the aesthetic; a degraded panel must *look* degraded.

## 2. Design tokens — copy these exactly

```css
:root{
  /* surfaces */
  --void:        #05070d;   /* page background, map surround */
  --panel:       rgba(12,18,30,.72);
  --panel-solid: #0c121e;
  --shade:       rgba(4,7,13,.86);   /* drawer / modal */
  --hairline:    rgba(140,190,255,.14);
  --hairline-hi: rgba(140,190,255,.34);

  /* ink */
  --txt:         #e9f2ff;
  --dim:         #8ea6c4;
  --faint:       #5d7a9b;

  /* signal */
  --cyan:        #22d3ee;   /* 運輸署 cameras, primary accent, live */
  --violet:      #a855f7;   /* 天文台 cameras, secondary accent */
  --amber:       #fbbf24;   /* warning issued, stale 4–10 min */
  --alert:       #ff5d6c;   /* critical, stale >10 min, market up (HK convention) */
  --ok:          #34d399;   /* nominal */

  /* market — HONG KONG CONVENTION: red = up, green = down. Label this in the UI. */
  --mkt-up:      #ff5d6c;
  --mkt-down:    #2ee6a8;

  /* depth */
  --shadow:      0 18px 44px -20px rgba(0,0,0,.95);
  --glass:       blur(14px) saturate(140%);
  --radius-sm:   8px;
  --radius:      14px;
  --radius-pill: 999px;
}
```

`--faint: #5d7a9b`.

## 3. Typography

- UI: `Inter`, `-apple-system`, `PingFang HK`, `Noto Sans TC`, sans-serif.
- **All numbers: `JetBrains Mono`** with `font-variant-numeric: tabular-nums`. Prices, counts,
  times, coordinates, cluster badges. This one rule is most of what makes a dashboard look
  professional — numbers that shift width while ticking read as amateur.

Type scale (px): `10 · 11 · 12 · 13 · 15 · 20 · 30 · 44`

Rules:
- Panel titles: `11px`, `letter-spacing:.2em`, `uppercase`, `--dim`.
- Body/labels: `12–13px`. Micro labels (units, source, timestamps): `10–10.5px` — floor is 10.
- Headline figures (temperature, index level): `20–30px`, weight 600.
- Never more than 3 weights on screen: 400 / 500 / 600.
- No text-shadow for readability — use surface contrast instead.

## 4. Layout

**Desktop (≥ 1100px)** — full-bleed map, floating glass over it:

```
┌────────────────────────────────────────────────────────────┐
│ status bar (full width, 40px, hairline bottom)             │
├──────┬──────────────────────────────────────────┬──────────┤
│ rail │                                          │  panels  │
│ 56px │              MAP (full bleed)            │  340px   │
│      │                                          │ (float)  │
│      │   [layer toggles bottom-left]            │          │
│      │   [attribution bottom-right]             │          │
└──────┴──────────────────────────────────────────┴──────────┘
```

- **Left rail (56px)**: vertical icon strip — layer groups + variant switcher. Icons 18px, 1.5px
  stroke, no fills. Active item: `--cyan` icon + 2px left accent bar.
- **Map**: full bleed behind everything. No card, no border, no rounding.
- **Panels column (340px)**, floating with `--panel` + `--glass` + hairline, `--radius`, `--shadow`,
  12px from the viewport edge, `gap: 10px`. Scrolls independently with a thin dark scrollbar.
- **Focus drawer**: opens from the right, **over** the panels column, width 400px, `--shade` bg,
  200ms slide + 150ms fade. `Esc` or the close chevron closes it. This replaces v0.1's map popup.
- **Status bar**: left = product name + live pulse; right = camera count, last-refresh age,
  clock. `10.5px`, `--dim`.

**Mobile (< 880px)**: map becomes `58vh` fixed at the top, panels stack and scroll beneath.
The rail becomes a horizontal scrollable strip. Focus drawer becomes a bottom sheet at 70vh.
Wall tiles go 2-up. **Test at 390px wide.**

## 5. Motion budget — respect the ceiling

Motion exists to prove data is alive, never to decorate.

- Live pulse: 7px dot, `2.4s` ease-in-out, ring-expand shadow. One per live surface, max 3 on screen.
- Value changes: number colour-flashes for `600ms` then settles. No counting-UP animations.
- Hover: `120ms`. Panel enter: `180ms`. Drawer: `200ms`. Nothing above `240ms`.
- Layer toggles: `160ms` opacity + 1px border shift. Never animate the camera dots themselves.
- **`@media (prefers-reduced-motion: reduce)` → all animation and transition off**, pulses become
  static dots. This is required, not optional.
- No particle fields, no starfields, no animated gradients, no bloom. If you are adding an effect
  that does not encode information, delete it.

## 6. Honesty states — the part most dashboards get wrong

Every data surface implements all four, visually distinct:

| State | Look |
|---|---|
| `loading` | skeleton: `--hairline` bars at 40% opacity with a 1.4s shimmer. Reserve the final height so nothing jumps. |
| `live` | normal, plus a freshness chip: `10.5px` mono, `CH · 2分鐘前` |
| `stale` | panel border → `--amber` at 40%; a chip reading `數據 +6分鐘` in `--amber`; no pulse |
| `error` | panel content replaced by one `12px` `--dim` line naming the source and the failure, plus a `重試` button. Never a blank panel, never a fake value. |

Freshness thresholds — cameras: amber after `2 ×` the source cadence, red after `5 ×`.
Weather warnings: immediately on a failed fetch. Market: amber outside trading hours, red on error.

**Any figure whose source failed is removed, not greyed out.** (House rule: 顯示唔到就唔好留.)

## 7. Component specs

**Camera dot / cluster** — TD `--cyan`, HKO `--violet`. Individual dot radius 4.5px (TD) / 6px (HKO)
with a 1.2px `--void` stroke. Cluster: radius steps `15 / 21 / 27 / 33` by count, fill at 18%
opacity, 1.4px stroke at 85%, mono count centred. Cluster→zoom expansion on click with a 420ms ease.

**Camera wall tile** — 4:3, `--radius-sm`, 1px hairline, `object-fit: cover`. Chrome, not baked into
the image: name bottom-left on a `--void`→transparent gradient, freshness chip top-right, remove
`×` top-right on hover only (touch: always visible). A dead camera shows `暫時未能提供` over a
`--void` 86% wash. Drag to reorder; persist order to `localStorage`.

**Market row** — `name · price · change%` on a 2-column grid, mono, `--mkt-up` / `--mkt-down`.
One 40×12px SVG sparkline per row, `currentColor` at 60% opacity, no axes, no fill. A `延遲報價`
chip must be permanently visible — this is not real-time and must not look like it is.

**Weather warning item** — 2px `--amber` left border, no fill, name at 12.5px, issue/expiry times in
`10.5px` `--dim` mono below. No alarm red for anything below warning level.

**Event feed item (Run 4)** — timestamp (mono, `--dim`), type chip, location, then source link.
A mandatory `未經核實` chip on anything not from an official source, and the panel footer states
「本頁唔轉載內容，只連回原文」.

**Icons** — inline SVG only, 18/20px, `stroke-width: 1.5`, `currentColor`, round caps. Never an
emoji. Never an icon font.

## 8. Definition of 靚 — check these before you say done

1. Load it at 1440×900. Is the map full-bleed with no visible seams, and do the floating panels
   read as glass over it?
2. Do all numbers use tabular mono and align in their columns while values update?
3. Does any panel jump, shift or resize as data arrives? It must not.
4. Zoom the map: do clusters split smoothly, and does hover/click feel instant?
5. Open the focus drawer, close it with `Esc`, re-open another camera. Smooth 200ms both ways?
6. Throttle the network to Slow 3G. Do skeletons hold the layout instead of collapsing?
7. Go offline. Does **every** panel degrade per §6 rather than going blank?
8. Resize to 390px. Nothing clipped, no horizontal scroll, tap targets ≥ 44px.
9. Turn on OS "reduce motion". Does all animation stop?
10. Squint at a screenshot. Is it one coherent dark instrument, or a pile of boxes?

If item 10 fails, the problem is almost always: too much padding, borders that are too visible,
too many type sizes, or accent colour used decoratively rather than semantically.
