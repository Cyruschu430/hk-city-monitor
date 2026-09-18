# AGENTS.md — HK City Monitor

> Read this file first. Then read `DESIGN_BRIEF.md` (the visual contract — non-negotiable)
> and `TECH_SPEC.md` (data sources, verified endpoints, legal boundaries).

## What this is

A Hong Kong–native real-time situational-awareness dashboard. Open source (AGPL-3.0).
Concept references: **World Monitor** (`koala73/worldmonitor`, AGPL-3.0) and the
"God's Eye View" city-monitor idea. Everything on screen is Hong Kong data from Hong Kong
sources.

**Not** affiliated with the HKSAR Government, and **not** part of the government's
「AI城市大腦」 programme — never use that name as the product name or imply official status.

## Current state

- `legacy/index.html` — v0.1 working prototype (single HTML file, MapLibre GL, no build step).
  Reference only. It is **live and verified**: 1013 運輸署 traffic cameras + 34 天文台 weather
  cameras, weather-warning / current-conditions / market panels, 3 YouTube live embeds.
  Read it. Do not delete it.
- `scripts/build_cameras.py` — builds `public/data/*.json` from two official catalogues.
  Re-running it is safe and idempotent. It has a `--check` self-check. Keep that behaviour.
- Your job (v0.2) is a **rebuild with a real toolchain and a much higher visual bar**, reusing
  the same data pipeline and the same verified source endpoints.

## Tech stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| Build | **Vite + TypeScript**, `strict: true` |
| Map | **CesiumJS — one engine, scene mode switch.** 2D is the default view; 3D is opt-in. Changed 2026-09-18: see PRIMITIVES.md §0.00 for why single-engine beats World Monitor's dual-engine (one layer implementation instead of two, and the 3D question can be deferred instead of decided) |
| Basemap | 2D default = **Esri World Imagery** (keyless) + OSM auto-fallback; 3D = Cesium ion token (eligible personal/non-commercial use) or Google Photorealistic 3D Tiles. *Never* an inline style object — see Pitfalls |
| **Layers** | `layers.json` definitions are **engine-agnostic**: one definition, rendered by the active engine. Never write a 2D set and a 3D set |
| UI | Vanilla TS + a small DOM helper. **No React/Vue/Svelte.** |
| Style | Hand-written CSS with custom properties. **No Tailwind, no CSS-in-JS, no component library.** |
| Data | `fetch` of static JSON + keyless official APIs. **Corrected 2026-09-18: a backend IS required** — 99 of 164 sources (60%) are CORS-closed and must go through a **Cloudflare Worker**. The earlier "no backend" claim held only for the camera wall. See PRIMITIVES.md §0.0 and SECURITY.md |
| Charts | Hand-rolled SVG sparklines. No charting library. |

Rationale: this must stay deployable as a static bundle to Cloudflare Pages, and must eventually
have its layers/panels liftable into a World Monitor fork — which is vanilla TS + Vite, no React.

## Project layout

```
/ (repo root, also the live nginx root for /hkmonitor/)
  AGENTS.md              ← this file
  DESIGN_BRIEF.md        ← visual contract
  TECH_SPEC.md           ← full verified source inventory + rules
  README.md
  index.html             ← v0.1, LIVE. Reference implementation. Do not break it.
  data/                  ← generated JSON, served at /hkmonitor/data/
  scripts/build_cameras.py
  web/                   ← v0.2 app (Vite + TS). Your working directory.
```

Build `web/`, then it deploys by copying `web/dist/*` over the root later. Until then the root
`index.html` stays live, so **never edit or delete it** — read it as your reference.

## Run sequence — do these in order, one dispatch each

**Do not attempt all of this in one run.** Work through these in order and stop after each.

- **Run 1 — shell + design system + map.** Vite/TS scaffold, `src/styles/tokens.css` from
  DESIGN_BRIEF §2, full-bleed map, `map/` with the TD + HKO camera layers copied faithfully from
  `legacy/index.html`, layer toggles, top status bar. Acceptance: page loads, 1047 cameras render
  as clusters, clicking a camera opens a focus drawer with the live image.
- **Run 2 — panels + states.** 天氣警告 / 本港現況 / 市場 / 相機牆 / 直播 / 資料來源, plus the
  four required states (loading skeleton, empty, stale, error) and the staleness chip.
  Acceptance: every panel shows real data and a real 更新時間; killing the network turns each
  panel into its stale/error state instead of blank.
- **Run 3 — polish.** Focus drawer transitions, camera-wall drag reorder, market sparklines,
  keyboard shortcuts (`?` help, `1–9` layer toggles, `Esc` close drawer), reduced-motion,
  mobile layout at 390px.
- **Run 4 — event layer skeleton.** `events.json` rendered as a map layer + feed panel. Use
  `public/data/events.sample.json` as the contract; the real collector comes later.
  **Do not write any scraper in v0.2.**

## Hard constraints

**Hosting（Cyrus 2026-09-18 定）**：Cloudflare，git push 即出街。**公開 repo。**
- 60% 嘅源 CORS 封閉 → 需要一個 **Cloudflare Worker** 做代理（順便藏 key、藏 origin IP）
- Worker 必須有**目標 URL 白名單** ＋ rate limit，**唔准做開放 proxy**（會俾人當跳板）
- 前端永遠冇 secret；key 只可以喺 Worker env（`wrangler secret put`）
- **唔准喺公開 repo 出現 VPS IP 或 duckdns hostname**
- 交貨前跑 `SECURITY.md` §6 檢查清單

1. **Every claim on screen is traceable.** Each panel shows its source name, a link to the
   source, and the observation timestamp. No invented numbers, no placeholder content, ever.
2. **Never present stale data as live.** Past its freshness threshold a camera or panel must
   visibly degrade (amber → red) per DESIGN_BRIEF §6.
3. **Do not add features that are not in the current run's scope.** If something looks missing,
   say so in your reply; do not build it.
4. **No PII, no individual names, no user-submitted content.** See TECH_SPEC §8.
5. **No new runtime dependency** without stating the reason in your reply.
6. **Comments explain *why*, not *what*.** A comment justifying a shortcut must name its ceiling
   and the upgrade path.
7. **Write in Traditional Chinese (Cantonese register) for all user-facing copy, English for code,
   comments and commit messages.**

## Verification — required before you report done

```bash
npm run typecheck        # must pass clean
npm run build            # must succeed
npm run preview          # then check the real page
```

- Prove the map renders: camera clusters present, one camera clicked, image loaded, focus drawer
  correct. Report the actual numbers you observed.
- Prove the states: with devtools network offline, every panel shows stale/error, not blank.
- Report honestly what did **not** work. A partial honest report beats a confident wrong one.

## Pitfalls already paid for — do not re-learn these

- **MapLibre GL 4.7.x silently ignores an inline `style` object** — `style._loaded` stays `false`,
  `getStyle()` returns `undefined`, the `load` event never fires, and you get a black map with no
  error. Use a **style URL**. (Verified, cost an hour.)
- **`isStyleLoaded()` is unreliable** — it stays `false` while any source is still fetching. Gate
  layer attachment on `map.getSource(id)` being absent instead.
- **`<div id="map">` shadows the global `map`** — an element id becomes a `window` property, so a
  top-level `let map` is shadowed in later scripts and in devtools. Expose the instance explicitly
  as `window.__map` for QA.
- **A backgrounded/occluded tab suspends `requestAnimationFrame`**, so MapLibre never paints and
  appears completely broken. Before concluding the map is broken, bring the tab to the foreground.
- **The 運輸署 camera CSV is UTF-16LE with a double BOM** (`\xff\xfe\xff\xfe`) — Python's `utf-16`
  codec leaves a stray `\ufeff` on the first field name and every row silently reads as empty.
- **`Open Sans Regular` 404s on the demotiles glyph server** (renamed to `Noto Sans Regular`).
  A `text-font` that does not exist on the basemap's glyph server means cluster counts never draw.
- **`queryRenderedFeatures` only returns what is currently painted** — assert with
  `querySourceFeatures` as well, or a not-yet-painted map looks like a data bug.

## Reporting back

Reply with: what you changed (file list), the real numbers you observed, what is still broken,
and any constraint above you could not satisfy. No summaries of intent.

### Pitfall 8 — a keyword search is not evidence of absence
data.gov.hk's `package_search` indexes only **539 of its 3,820 datasets**. Searching and finding
nothing does *not* mean the data does not exist. This cost us three wrong "it doesn't exist"
conclusions in one session (LCSD live court availability, Marine Department vessel arrivals,
Immigration's control-point queue times — all three exist). To answer "does this exist", use
`package_list` or actually fetch it. Reserve `package_search` for finding the URL of a dataset you
already know is there.

### Pitfall 9 — the four ways a probe says "not ok", and what each really means
- `422 needs-params` — the endpoint **exists**; it wants an id or a POST body. Normal for two-step
  APIs (list routes → then ask for an ETA). Not a dead source.
- `400 official parameter missing` — the parameter is real but undocumented. Budget one discovery
  pass, then record it as unknown rather than guessing.
- `403` — keyed or IP-gated. Confirm by retrying with `Referer` and `Origin` before writing it off:
  this was exactly how TDAS was shown to be gated rather than broken.
- `SSL handshake failure` — suspect **your own client first**. Older HK government TLS stacks only
  negotiate at `SECLEVEL=1` (see `set_ciphers("DEFAULT@SECLEVEL=1")` in `probe_sources.py`).
  Water Supplies went from red to green with no change to the source.

### Pitfall 10 — publisher RSS indexes are authoritative; guessed feed paths lie
RTHK's feed list comes from its own index page (`news.rthk.hk/rthk/ch/rss.htm`), which lists five
feeds. Guessing the paths produced three that returned **200 with an HTML app shell and zero items** —
a false success, and exactly why the probe classifies the payload instead of the status. One guess also
had a duplicated letter (`c_expressnews_cgreaterchina.xml` vs the real `c_expressnews_greaterchina.xml`),
which no amount of retrying would have fixed. Read the publisher's index; do not enumerate URLs from memory.

### Pitfall 11 — news RSS needs the server, not the browser
The event-layer feeds (news.gov.hk's seven categories, RTHK's five) are official and reliable, but
their CORS policy is closed (`sc.news.gov.hk` only for the government ones), so a static front end
cannot fetch them. They must go through the VPS collector that writes a static JSON the page reads —
this is the one part of the build that genuinely needs a server. RTHK's 交通消息 has **no RSS at all**
(page only); TD Special Traffic News is the authoritative traffic source, so nothing is lost.
