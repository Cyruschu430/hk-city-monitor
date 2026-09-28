# Self-hosting HK City Monitor

The whole thing is **a static bundle, one Cloudflare Worker, and a git branch**. There is no
database, no user system, and no API key anywhere in the shipped code — so self-hosting is
mostly copying three values into a `.env` and pointing them at your own accounts.

Everything below was last run on 2026-09-28 on the maintainer's machine. Numbers are measured,
not estimated; where a number is a property of YOUR deployment, it says so.

## What you need

| Piece | Required? | What it costs | Host runs it |
|---|---|---|---|
| Node 22+ | yes | — | your machine / CI |
| The built bundle (`web/dist`) | yes | — | any static host |
| Cloudflare Worker | to see the full source set | free plan, no card | Cloudflare |
| Cloudflare Pages | to publish | free plan, unlimited requests | Cloudflare |
| The live collectors | optional | free | any host with outbound network |

## 1. The 5-command version (no accounts, no Worker)

```bash
git clone <this repo> && cd <repo>/web
npm ci
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

**MEASURED: 13 of the 24 panels work like this.** They are `analysis_brief`, `live_wall`,
`warnings_list`, `special_traffic_list`, `cameras_wall`, `water_suspension_list`,
`ae_waiting_grid`, `aqhi_gauge_grid`, `carpark_vacancy_list`, `stations_status`,
`mtr_next_train_list`, `kmb_eta_table`, `aircraft_status`.

The other 11 are **proxy-backed**: their publishers send no `access-control-allow-origin`, so a
browser cannot read them and they need the Worker. Without it they show their error state —
"未能讀取數據 — 需要 Worker 代理" — which is deliberate: a panel that cannot load says so
instead of rendering an empty box.

## 2. Full source set: deploy the Worker

```bash
cd worker
npx wrangler login          # free Cloudflare account; enable the project, then delete the key
npx wrangler deploy         # prints https://<name>.<you>.workers.dev
curl "https://<name>.<you>.workers.dev/health"   # {"ok":true,"version":"0.2.0","whitelistHosts":67}
```

Then point the front end at it and **rebuild**:

```bash
cd ../web && cp .env.example .env
# VITE_WORKER_BASE=https://<name>.<you>.workers.dev
npm run build
```

⚠️ **`VITE_WORKER_BASE` is BUILD-TIME.** Vite inlines it; the same bundle cannot switch
backends at runtime. Forgetting it does not error — the 11 proxy panels silently fall back to
their error state, and `data/build-manifest.json` is the only place that records what the build
used (`tilesVia`). This trap has already cost this project a round of debugging.

The Worker is a **whitelist** proxy: it refuses any host that is not in `sources.json`
(`whitelist.generated.js`, 67 hosts), refuses `http://` and credentials-in-URL, and rate-limits
per IP. Measured against the deployed instance: 15 of 15 refusal cases pass
(`node test/probe-worker-security.mjs <your worker url>`). It is not an open relay — verify that
on YOUR deployment before you rely on it.

## 3. Live files (optional, and the one non-obvious trap)

Three files change every few minutes and cannot come from the bundle: aircraft (ADS-B), berth
vacancy (MARDEP via CSDI) and water suspension (WSD). `scripts/live_cycle.sh` collects them and
`scripts/publish_live.py` force-pushes them as **one orphan commit** to a `live-data` branch,
which the browser reads from `raw.githubusercontent.com` (`access-control-allow-origin: *`, no
key, no build).

🔴 **A fork must set `VITE_LIVE_BASE`.** The built-in default names THIS project's branch.
Reading someone else's live data does not announce itself — the payload is well-formed and the
timestamps are real, they are simply not yours:

```
VITE_LIVE_BASE=https://raw.githubusercontent.com/<you>/<repo>/<live-branch>
```

Leave it unset and the app reads the committed snapshots instead. The panels then age to amber
on their own, because every payload carries the publisher's own timestamp — which is the honest
outcome, not a broken one.

Running your own collectors needs one thing this repo cannot ship: **a push credential on the
collector host** (this project uses a repo-scoped deploy key, so a compromised host can write
exactly one public repo). `HKCM_REMOTE` selects it. Collection is outbound-only; nothing listens.

## 4. Publish

The bundle is static, so any host works. This project uses **Cloudflare Pages** because its free
tier allows commercial use and unlimited requests, and because going over the Worker's
100,000 requests/day limit **fails** rather than bills.

```bash
cd web && npm run build
npx wrangler pages deploy dist --project-name=<your project> --branch=main
```

**MEASURED cold-load cost: 21 Worker requests** (budget 34, see `npm run check:quota`), so one
visitor costs 1/4,761 of the daily allowance. That number is a property of the source registry;
re-measure it after adding panels.

## 5. Verify a change before you believe it

```bash
cd web
npm run typecheck                 # 0 errors
npm run check:all                 # 9 checks; needs a preview on 127.0.0.1:4173 first
python3 scripts/validate_config.py
```

The browser checks need a Chromium. They default to the maintainer's Windows path, so on any
other machine set `CHROME_PATH` (and `HKCM_CHROME` for the older ones):

```bash
CHROME_PATH=/usr/bin/chromium npm run check:all
```

A claim about the UI is verified **in the DOM**, never from a screenshot — screenshots have
already called a two-column grid single-column, reported a fixed build as still broken, and made
a correct light theme look dark.

## Non-negotiables

- **No keys in the front end, ever.** A key that must exist lives on a server-side collector or
  in the Worker's environment, never in the bundle.
- **AGPL-3.0.** A fork that you serve to others stays AGPL-3.0. `ATTRIBUTION.md` is generated by
  `scripts/build_attribution.py` from `sources.json` — never hand-edit it.
- **Attribution is mandatory** on the map face (the LandsD logo) and in the panel footers.
- This project is **not affiliated with the HKSAR Government** and is **not** part of its
  「AI城市大腦」 programme. Never imply official status.
