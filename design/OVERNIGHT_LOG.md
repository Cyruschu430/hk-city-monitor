# OVERNIGHT_LOG.md — round-by-round log

Format per round (KIMI_BRIEF.md §5): Did / Evidence / Defect found and fixed / Still broken / Next.
A claim without a command output is not a result.

---

## Round 1 — Run 1: the Worker (CORS proxy + whitelist + rate limit + edge cache + 3D URL injection)

- Did: new `worker/` (Cloudflare Worker, `src/index.js`), `worker/src/whitelist.generated.js`
  (67 hosts, derived from `sources.json` by new `scripts/build_worker_whitelist.py` — run it again
  after any sources.json edit), `worker/wrangler.toml` (non-secret `[vars]` only), `worker/package.json`
  (devDependency: wrangler — build tooling, not a runtime dep), `worker/test/cors-test.html`
  (browser CORS fixture), one layout line in `AGENTS.md`. Routes: `GET /proxy?url=…`,
  `GET /config/3d`, `GET /health`. GET-only; https-only targets; host whitelist; 60 req/min/IP on
  data calls; 120 origin-fetches/min/IP on tile cache misses; edge cache 60s data / 24h tiles;
  upstream `Set-Cookie` never forwarded; client cookies never forwarded upstream.
  NOT deployed (hard stop) — all verification is against `wrangler dev` on 127.0.0.1:8787.

- Evidence (all run this round, real output):

  `curl "http://127.0.0.1:8787/proxy?url=https%3A%2F%2Fsecure1.info.gov.hk%2Fimmd%2Fmobileapps%2F2bb9ae17%2Fdata%2FCPQueueTimeR.json"` →
  HTTP 200, live ImmD payload: `{"HYW":{"arrQueue":99,"depQueue":99},"HZM":{"arrQueue":0,"depQueue":0},"LMC":…,"LSC":…,"LWS":…,"MKT":…,"SBC":…,"STK":…}` — the real control-point codes.

  `curl "…/proxy?url=https%3A%2F%2Fexample.com%2F"` →
  `{"error":{"code":"host_not_allowed","message":"host not in sources.json registry: example.com"}}` HTTP 403.
  Suffix-bypass probe `…/proxy?url=https%3A%2F%2Fsecure1.info.gov.hk.evil.example%2F` → same 403.

  Rate limit: `for /L %i in (1,1,65) do curl …` → sixty `200` then `429 429 429 429 429` — trips at request 61.

  Tile cache: two fetches of LandsD tile `…/xyz/basemap/WGS84/16/53546/28604.png` →
  first `X-HKCM-Cache: MISS`, second `x-hkcm-cache: HIT`, `Cache-Control: public, max-age=86400`,
  `Content-Type: image/png`, 16,176 bytes downloaded. Out-of-range tile → upstream 204 passed
  through with `X-HKCM-Cache: SKIP` (errors never cached).

  `curl http://127.0.0.1:8787/config/3d` → HTTP 200 with all three server-injected
  `data.map.gov.hk` tileset URLs. `POST /proxy` → 405. `http://` target → 400 `https_only`.
  Missing `url` param → 400 `missing_url`.

  Browser CORS (headless Chrome, fresh throwaway profile, fixture served from a different origin
  :8788 → worker :8787, `--dump-dom`):
  `1. proxy fetch: HTTP 200, keys=HYW,HZM,LMC,LSC,LWS,MKT,SBC,STK, controlPointKeys=true`
  `2. non-registry host: HTTP 403, code=host_not_allowed (refused, correct)`
  `3. /config/3d: HTTP 200, building=https://data.map.gov.hk/api/3d-data/3dsd/WGS84/building/tileset.json`
  `verdict: PASS` (document.title `CORS-TEST PASS`).

  `node --check worker/src/index.js` → exit 0. `py -3 scripts\build_worker_whitelist.py` →
  `self-check OK (67 hosts)`, wrote 1,798 bytes.

- Defect found and fixed: the first write of `worker/wrangler.toml` contained a garbled line —
  `TILES3D_BUILDING_URL = "https://data.map.gov.hk/api/3d-data/3dsd/WGS84/building-side injection of
  the Open3Dhk tileset URLs…"` (comment text spliced into the URL). Caught by reading the file back
  before testing; rewrote the file and verified `/config/3d` returns the clean URL (evidence above).
  Also fixed before testing: `handleProxy` read the execution context via `arguments[1]` — replaced
  with a named `ctx` parameter.

- Still broken / still weak:
  1. Rate limiter is per-isolate in-memory — best-effort only (ceiling named in code comments;
     upgrade path Durable Object / rate-limiting binding, needs a deployed account).
  2. `wrangler dev` died silently once mid-session (log ends cleanly, no error). Root cause not
     proven; the three earlier launch attempts that the shell tool killed on timeout left orphaned
     `workerd.exe` processes that re-grabbed port 8787 after cleanup. All orphans found and killed;
     verified `netstat` shows nothing on :8787/:8788 at round end. Future rounds: check the port
     before launching (per the new KIMI_BRIEF §4.5, which appeared on disk mid-round — left
     uncommitted, it is not my change).
  3. The 16 MiB upstream guard reads `Content-Length` only; a chunked response without it is not
     capped (noted in code).
  4. Acceptance says "curl the Worker" — done, but against local `wrangler dev`, not a deployed
     URL. Deployment is a hard stop, so deployed-URL verification is explicitly out of scope.

- Next: Run 2 — the renderer: Vite/TS scaffold in `web/`, `src/styles/tokens.css` from
  DESIGN_BRIEF.md, `render.mjs` + `context.mjs` per PRIMITIVES.md §5–6, all eight render types
  driven by `data/panels.json` fixtures with the four honesty states visible.
