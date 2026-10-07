# Self-Hosting Guide

HK City Monitor consists of a static bundle, a single Cloudflare Worker and a git branch. There is
no database, no user system and no API key in the shipped code, so self-hosting amounts to building
the bundle, deploying the Worker and pointing a small number of configuration values at your own
accounts.

Figures below were measured on 2026-09-28. Measured values are labelled as such; where a value is a
property of your own deployment, this is stated explicitly.

## Requirements

| Component | Required | Cost | Runs on |
|---|---|---|---|
| Node 22+ | Yes | — | Your machine / CI |
| Built bundle (`web/dist`) | Yes | — | Any static host |
| Cloudflare Worker | To see the full source set | Free plan, no card | Cloudflare |
| Cloudflare Pages | To publish | Free plan, unlimited requests | Cloudflare |
| Live collectors | Optional | Free | Any host with outbound network |

The source registry declares 206 sources; the Worker proxies those that cannot be read directly by
a browser, with an allow-list of 64 hosts.

## 1. Minimal setup (no accounts, no Worker)

```bash
git clone https://github.com/Cyruschu430/hk-city-monitor.git
cd hk-city-monitor/web
npm ci
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

Panels whose publishers send a permissive CORS header load directly and work with no further setup.
The remainder are proxy-backed: without the Worker they display an explicit error state
("unable to read data — Worker proxy required"). This is deliberate — a panel that cannot load says
so, rather than rendering an empty box.

## 2. Full source set (deploy the Worker)

```bash
cd worker
npx wrangler login          # free Cloudflare account; revoke the session key afterwards
npx wrangler deploy         # prints https://<name>.<account>.workers.dev
curl "https://<name>.<account>.workers.dev/health"
# {"ok":true,"version":"0.2.0","whitelistHosts":67}
```

Then point the front end at it and **rebuild**:

```bash
cd ../web && cp .env.example .env
# set VITE_WORKER_BASE=https://<name>.<account>.workers.dev
npm run build
```

`VITE_WORKER_BASE` is a **build-time** value. Vite inlines it, so the same bundle cannot switch
backends at runtime. If it is omitted, no error is raised — the proxy-backed panels simply fall back
to their error state. `data/build-manifest.json` is the only record of the backend a build used.

The Worker is a whitelist proxy. It refuses any host not listed in `sources.json`
(`worker/src/whitelist.generated.js`), refuses `http://` and credentials embedded in a URL, and
rate-limits per IP. It is not an open relay; verify this against your own deployment with
`node worker/test/probe-worker-security.mjs <your worker url>` before relying on it.

## 3. Live data files (optional)

Three feeds change every few minutes and cannot be served from the bundle: aircraft positions
(ADS-B), berth vacancy (MARDEP via CSDI) and water-suspension notices (WSD). `scripts/live_cycle.sh`
collects them, and `scripts/publish_live.py` force-publishes them as a single orphan commit to a
`live-data` branch. The browser reads that branch from `raw.githubusercontent.com`, which sends
`Access-Control-Allow-Origin: *` — no key and no build required.

**A fork must set `VITE_LIVE_BASE`.** The built-in default names this project's branch. Reading
another project's live data is not self-evident: the payload is well-formed and the timestamps are
real, they simply belong to a different deployment.

```
VITE_LIVE_BASE=https://raw.githubusercontent.com/<owner>/<repo>/<live-branch>
```

If it is left unset, the application reads the committed snapshots instead. The affected panels then
age to their stale state on their own, because every payload carries the publisher's own timestamp.

Running your own collectors requires one thing this repository cannot ship: a push credential on the
collector host. This project uses a repository-scoped deploy key, so a compromised collector can
write to exactly one public repository. `HKCM_REMOTE` selects the remote. Collection is outbound
only; nothing listens for inbound traffic.

## 4. Publishing

The bundle is static, so any host works. This project uses Cloudflare Pages because its free tier
permits commercial use and serves unlimited requests, and because exceeding the Worker's 100,000
requests/day limit fails closed rather than producing a bill.

```bash
cd web && npm run build
npx wrangler pages deploy dist --project-name=<your project> --branch=main
```

The measured cold-load cost is 26 Worker requests (budget 34, see `npm run check:quota`), so one
visitor consumes roughly 1/3,846 of the daily allowance. That figure is a property of the source
registry; re-measure it after adding panels.

## 5. Verifying a change

```bash
cd web
npm run typecheck                 # TypeScript, 0 errors expected
npm run check:all                 # 9 checks; needs a preview on 127.0.0.1:4173 first
python3 scripts/validate_config.py
```

The browser checks require Chromium. They default to the maintainer's Windows path, so on any other
machine set `CHROME_PATH` (and `HKCM_CHROME` for the older checks):

```bash
CHROME_PATH=/usr/bin/chromium npm run check:all
```

Claims about the interface are verified in the DOM, never from a screenshot — screenshots have
previously misreported a two-column grid as single-column and a correct light theme as dark.

## Non-negotiables

- **No credentials in the front end, ever.** A required key lives in the Worker's environment or on
  a server-side collector, never in the bundle.
- **AGPL-3.0.** A fork that you serve to others must remain under AGPL-3.0. `ATTRIBUTION.md` is
  generated by `scripts/build_attribution.py` from `sources.json` and must not be hand-edited.
- **Attribution is mandatory** on the map face and in every panel footer.
- **No implied official status.** This project is not affiliated with the HKSAR Government and is
  not part of its 「AI城市大腦」 programme.
