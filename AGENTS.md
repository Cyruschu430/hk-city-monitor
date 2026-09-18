# AGENTS.md — HK City Monitor

> Read this file first. Then read `DESIGN_BRIEF.md` (a starting visual direction — improve on it; the facts marked MEASURED inside are the binding part)
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
| Map | **MapLibre GL JS (base) + deck.gl (overlay).** No globe, no Cesium — city scale means a flat map, decided 2026-09-18 after Cyrus pointed out that a globe is the wrong instrument for 18 districts and that 3D can come from Open3Dhk directly. See PRIMITIVES.md §0.00 |
| Basemap | **LandsD XYZ tiles** (keyless, verified): `mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png` + the **Traditional Chinese label overlay** `…/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png`, and `…/xyz/imagery/…` for aerial. Changed 2026-09-18: the official HK basemap is what makes this recognisably a Hong Kong product, and Google bills per use. CARTO/OSM stays only as a fallback. **Attribution is mandatory (LandsD logo on the map face).** Esri World Imagery is a keyless global alternative — but its tile order is `{z}/{y}/{x}`. *Never* an inline style object — see Pitfalls |
| **3D** | **A layer, not an engine.** Open3Dhk 3D Tiles via deck.gl `Tile3DLayer`, lazy-loaded only when a vertical asks for it. 12.2M triangles must never be on first paint |
| **Layers** | `layers.json` definitions are **engine-agnostic**: one definition, rendered by MapLibre (2D) or deck.gl (3D). Never write a 2D set and a 3D set |
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
  DESIGN_BRIEF.md        ← starting visual direction (facts marked MEASURED are binding)
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

**Do not attempt all of this in one run.** Each run is one dispatch and ends with a report.
The order is deliberate: **the primitives come before any vertical.** A vertical built first is
how every later one needs reworking, which is the whole thing this architecture exists to avoid.

**Do not treat `VERTICALS.md` as a task list.** It is a map of ~30 possible scenarios so the
shared parts could be found. Handing all of them to a coding agent produces scaffolding for
thirty features and none finished. Build the primitives, then one vertical, then two more by config.

---

- **Run 0 — prerequisites (Cyrus, not the agent).** Home PC reachable from the VPS and OpenCode
  with a working Kimi model configured and authenticated. Note: the VPS hostname must never be
  written into this repo — it is public. Verify with a trivial prompt through OpenCode first.

- **Run 1 — the Worker.** `worker/` — a Cloudflare Worker that is the project's only server-side
  piece. It must:
  1. serve as the CORS proxy for every `sources.json` entry whose `fetch` is `"proxy"` (99 of 171)
  2. **whitelist target hosts from `sources.json`** — it must refuse any URL not in the registry;
     an open proxy gets used as a free relay, which is worse than the CORS problem it solves
  3. apply a rate limit and **edge-cache tiles**, because the LandsD terms forbid request bursts
     and getting blocked is the one real outage risk (see `COST.md`)
  4. inject the 3D tileset URL server-side, the way HomeCheck does with `~/.tiles3d_url` — never
     hardcode it in the front end, even though keyless currently works
  **Acceptance**: `curl` the Worker from a terminal for an `immd_cp_queue` payload and get real
  data; then fetch the same through a browser page and get it without a CORS error. A request for
  a host not in `sources.json` must be refused. Paste both results.

- **Run 2 — the renderer.** Vite/TS scaffold, `src/styles/tokens.css` from `DESIGN_BRIEF.md`, plus
  `render.mjs` and `context.mjs` per `PRIMITIVES.md` §6 and §5. One renderer handles **all eight**
  render types — `big_number`, `list`, `table`, `image_single`, `image_wall`, `raster_map`,
  `gauge_grid`, `status_grid`. Adding a ninth is a spec change, not a coding decision.
  **Acceptance**: driven only by `data/panels.json`, all eight render types draw from fixtures, and
  the four honesty states (loading / live / stale / error) are each visible. Default language is
  Traditional Chinese with an English switch; every panel also shows its 更新時間.

- **Run 3 — trigger and context.** `lib/trigger.mjs` and `lib/context.mjs` as **pure functions**
  per `PRIMITIVES.md` §4 and §5, plus the two assert-based tests listed in `PRIMITIVES.md` §9.
  **No LLM on this path** — hoisting signals and rainstorm warnings are life-safety information and
  must be auditable, testable and explainable.
  **Acceptance**: `python3 scripts/validate_config.py` exits 0, and both test files run and print
  real assertions passing. Report the actual output.

- **Run 4 — 停水模式, end to end. ⚠️ This is the gate, not a feature.** The smallest vertical:
  one panel, one layer, one source (`wsd_water_suspension`). Wire it from config alone.
  **Acceptance is not "it looks right"** — it is: (a) the vertical renders live WSD notice data,
  and (b) **a written answer to "did this need any code change outside the config?"** If yes, the
  primitives are wrong, and you fix the primitives before Run 5. That answer is the entire point
  of doing the smallest vertical first.

- **Run 5 — 颱風模式 and 口岸模式, config only.** Adding these two must touch `verticals.json` and
  nothing else. If either needs a new render type or a code path, stop and report — that is the
  design failing, and it is cheap to find out here.
  **Acceptance**: both verticals render from config, and `git diff` for the run shows changes in
  `data/verticals.json` (and `panels.json` at most) and no logic files.

- **Run 6 — the basemap.** LandsD XYZ tiles: topographic basemap plus the **Traditional Chinese
  label overlay**, with the Esri World Imagery fallback. Mind that LandsD uses `{z}/{x}/{y}` and
  Esri uses `{z}/{y}/{x}`. The **LandsD logo and copyright notice are mandatory on the map face**.
  Add the Open3Dhk 3D Tiles layer as a **lazy-loaded** extra, off by default — 12.2M triangles must
  never be on first paint.
  **Acceptance**: the map shows Hong Kong place names in Traditional Chinese, attribution is
  visible, and disabling network turns the 3D layer into its error state rather than a blank scene.

---

## What NOT to build

- No plugin system, registry class, event bus, state-management library or DI container — the
  registries are JSON and the renderer is a function (`PRIMITIVES.md` §8)
- No per-vertical renderer, and no per-vertical code path at all
- No LLM anywhere in the runtime path
- No metered API key ever, and no scraper in v0.2
- No secret in the repo, ever — the repo is public and a committed secret is a leaked secret

## Unattended overnight runs

If you are working this project in a long unattended session (or were dispatched by an overnight
runner), read **`KIMI_BRIEF.md`** as well. It adds tonight's scope, the working discipline, the
hard stop rules (no deploying, no pushing to `master`, no secrets, no VPS hostname in any file) and
the round-log format. This file remains the authority on *what* to build.

## Who builds this, and where

**Front end: OpenCode + Kimi on Cyrus's home PC** (decided 2026-09-18). Hermes writes the specs,
the source registry, the validators and the data pipeline; the coding agent builds the app.
The PC reaches the VPS over a reverse SSH tunnel, so the working copy may be on either machine.

**Public repo: `github.com/Cyruschu430/hk-city-monitor`** — public, and hosting is Cloudflare
(`git push` deploys).

**First vertical: 停水模式 (water supply).** Deliberately the smallest — one panel, one layer,
one source. It exists to falsify the primitive design cheaply. If it needs a code change beyond
config, the primitives are wrong and you must fix them before adding a second vertical.

## Hard constraints

**Hosting（Cyrus 2026-09-18 定）**：Cloudflare，git push 即出街。**公開 repo。**
- 60% 嘅源 CORS 封閉 → 需要一個 **Cloudflare Worker** 做代理（順便藏 key、藏 origin IP）
- Worker 必須有**目標 URL 白名單** ＋ rate limit，**唔准做開放 proxy**（會俾人當跳板）
- 前端永遠冇 secret；key 只可以喺 Worker env（`wrangler secret put`）
- **唔准喺公開 repo 出現 VPS 嘅 IP 或者網域**（連規則文字都唔寫出具體值，免得掃描器誤報）
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

## Cost constraints (free public project — see COST.md)

- **Never add a metered API key.** If usage growth increases the bill, it does not go in.
  Google Maps was ruled out for this reason. The validator fails the build on a metered source.
- **No LLM in the runtime path.** Every collector is a plain HTTP fetch. The trigger engine is
  rule-based. Geocoding uses the gazetteer + ALS, never an LLM (it invents coordinates).
  If a future feature wants an LLM, it must be low-frequency (daily/weekly) with a small context,
  and the frequency + context size get reported before it is added.
- Free-tier overage must FAIL, not BILL. Workers Free caps at 100k req/day and stops, with no
  card on file — that property is why the stack is Cloudflare.
- The Worker needs a target-URL whitelist, a rate limit and edge caching. That is a cost control,
  not an optimisation: without caching, a popular day gets *us* blocked by LandsD.

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
