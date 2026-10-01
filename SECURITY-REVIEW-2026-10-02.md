# SECURITY REVIEW — HK City Monitor (hk-city-monitor.pages.dev)

**Date:** 2026-10-02 · **Repo:** `Cyruschu430/hk-city-monitor` @ `master` (clone at `/home/admin/hkcm-live`, working tree clean) · **Scope:** pre-publish threat model for a stranger-facing public dashboard. Reviewed read-only; only this file was created.

---

## Verdict

No P0. This is a well-hardened project: no secret is committed in the tree or anywhere in git history, the Cloudflare Worker proxy is not an open proxy and its SSRF surface is closed (HTTPS-only, credentials refused, exact-host whitelist, redirects re-validated per hop), every HTML-string sink that renders third-party publisher data escapes it, and the GitHub Actions workflows cannot be triggered by a pull request or run untrusted input with their secrets. The residual risk is concentrated in **defence-in-depth that is missing rather than active holes**: there is no Content-Security-Policy on a page that renders third-party data and embeds third-party iframes, and the Worker's host whitelist does not bound the port. Those are the two things worth fixing before or shortly after launch; everything else is a note.

---

## Findings

### P1-1 — No Content-Security-Policy on a public page that renders third-party data and embeds third-party iframes

**What.** The deployed app has no CSP anywhere:
- `web/index.html` — no `<meta http-equiv="Content-Security-Policy">` (verified: 48 lines, head contains only charset/viewport/title/favicon).
- No `_headers`, `_routes.json`, or `_redirects` in `web/` or `web/public/` (verified by file search across the tree — zero matches). `wrangler.toml` (worker) has no `[headers]` block either.

**Why it matters.** The app's whole content model is "render third-party data" — every map popup is built from remote government feed fields, and the live wall embeds `https://www.youtube.com/embed/<id>` iframes plus third-party camera `<img>`s (web/src/lib/render.ts:462-464, web/src/ui/drawer.ts:47). Today every HTML sink is escaped (see "Checked and found clean"), so there is no live XSS. But escaping is exactly the control this project has *already drifted on* — see P2-2, where a comment claims two popups are unescaped when they are not. A CSP (`default-src 'self'; img-src 'self' https: data:; frame-src https://www.youtube.com; connect-src 'self' https:; script-src 'self'`) is the one backstop that caps the blast radius of the next unescaped sink or a compromised publisher. A malicious/compromised YouTube *channel* itself cannot touch the page origin (the iframe is cross-origin and `allow` omits `allow-same-origin`/`allow-scripts`), so the embed is not today's hole — CSP is the layer that keeps a future one contained. This is P1 not P0 because no bypass of the current escaping was demonstrated.

**Fix.** Add a `_headers` file at the Cloudflare Pages output root (`web/public/_headers` so Vite copies it into `dist/`):
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; frame-src https://www.youtube.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
```
Then verify the deployed page actually serves the header (`curl -sI https://hk-city-monitor.pages.dev/ | grep -i content-security`), because Pages only applies `_headers` if it lands in the deployed directory.

---

### P2-1 — Worker allow-list bounds host but not port

**What.** `worker/src/index.js` rejects targets on `target.host` only (line 288: `ALLOWED_HOSTS.has(target.host.toLowerCase())`) and never inspects `target.port`. `new URL("https://data.gov.hk:8443/x")` parses with `host === "data.gov.hk"` and `port === "8443"`, so it passes the check and `fetch` connects to `data.gov.hk:8443` from Cloudflare's egress.

**Why it matters.** A hostile visitor can use the Worker as a GET-only port scanner / weak SSRF against any of the 67 whitelisted government hosts — reaching a non-443 port (an admin panel, an internal service) that the publisher never intended to be public, from Cloudflare's IPs, which some government hosts may treat as more trusted than a random client. Bounded (exact host set, GET only, per-IP rate limit, no credential relay), so this is not an open proxy — but the whitelist claims to be a host allow-list, and ports are outside it.

**Fix.** After the host check in `handleProxy`:
```js
if (target.port && target.port !== "443") return jsonError(403, "port_not_allowed", "only default https port is proxied");
```

### P2-2 — Stale security comment misstates the popup escaping (misleads the next reviewer)

**What.** `web/src/map/overlays.ts:590-598` says: *"Nothing escapes it today — `controlPointLayer` and `drawWaterPoints` interpolate raw values into `setHTML`, so a feed value containing markup executes in the page… The older two are left alone deliberately."* That is false: `drawWaterPoints` (lines 211-220) and `controlPointLayer` (lines 795-806) both pass every interpolated value through `esc()`.

**Why it matters.** This is a documentation lie in the exact place a future reviewer reads before trusting the code. It cuts both ways: a reviewer may chase a phantom vuln, or — worse — trust the comment's framing and assume new popups need no escaping, or "fix" the working escape. The project's own rule is that comments must explain *why* truthfully.

**Fix.** Rewrite the comment to state that `drawWaterPoints`/`controlPointLayer` were retrofitted to use `esc()` and that every popup must keep doing so; delete the "left alone deliberately" sentence.

### P2-3 — Legacy `index.html` interpolates two weather values without escaping

**What.** `index.html:494` interpolates `t.value` / `h.value` and `:496` interpolates `u.value` directly into `innerHTML` without `esc()` (which is defined at `:392` and used on every *string* field on the page). These come from the HKO `rhrread` API (third-party data).

**Why it matters.** Only relevant if the v0.1 page at `/hkmonitor/` is actually served to strangers (AGENTS.md says the repo root is the "live nginx root for /hkmonitor/" but the Cloudflare Pages deploy ships only `web/dist`). The fields are numeric in practice, so risk is low — but it is the one unescaped sink on remote data in the repo, and it is the page the project has marked "LIVE, do not break".

**Fix.** Wrap `t.value`, `h.value`, `u.value` in `esc()` (or, better, retire `/hkmonitor/` if it is no longer the public entry point).

### P2-4 — Supply chain: floating ranges, no lockfile enforcement in a no-postinstall install

**What.** `web/package.json` pins every dependency with a caret (`^`) range (e.g. `vite ^7.0.0`, `typescript ^5.9.0`, `maplibre-gl ^4.7.1`); the lockfile resolves 234 packages. No dependency in either lockfile declares a `postinstall` script (verified: `grep -c postinstall` = 0 in `web/package-lock.json`, none in `worker/package-lock.json`).

**Why it matters.** A compromise of any published tarball runs in the *visitor's browser* for the two runtime deps (`maplibre-gl`, `maplibre-gl-wind`) or at build time on Cyrus's PC for the dev deps — the usual npm supply-chain exposure. It does **not** run in CI: both workflows are Python-only and never execute `npm install` or any JS. No postinstall means `npm ci`/`install` executes no arbitrary lifecycle scripts, which is the cheap win already in place.

**Fix.** Commit and use `npm ci` (the lockfile is already committed) for reproducible installs; nothing else is proportionate here. Note as a monitoring item, not a blocker.

---

## Checked and found clean

- **No committed secrets — full tree and full git history.** Scanned the working tree and every commit (`git log -p --all`, `git grep` across all refs) for `sk-`, `ghp_`, `gho_`, `AIza`, `AKIA`, `xox`, private-key headers, `api_key=`/`secret=`/`password=`/`token=`/`bearer`, and any long token literal. The only hits were (a) the `OPENROUTER_API_KEY` *name* in `scripts/build_ai_summary.py` (read from `os.environ`, never a value — the key itself is a GitHub repository secret), and (b) base64 image `data:` URIs in `design/attempts/*.html` that false-positive on hex-looking substrings. No key value exists in any commit.
- **The ArcGIS key from the deleted sibling app is not here.** Grepped for `arcgis`, `AAPT…`, `.arcgis.com`, `client_secret`, `esri key`. Only references are `services.arcgisonline.com` (a keyless Esri tile host in the Worker whitelist), `arcgisonline` in a test filter, and SOURCES.md documenting CSDI's keyless ArcGIS FeatureServer pattern. No token, no key, nothing to rotate.
- **`.gitignore` covers the secret family.** `.env`, `.env.*` (with `!.env.example`), `.aisstream_key`, `.github_token`, `*.pem`/`.key`/`id_rsa`/`.netrc` are all ignored; `git ls-files` shows only `web/.env.example` (placeholder/example values only — `VITE_WORKER_BASE`/`VITE_LIVE_BASE` are public URLs) and no secret files are tracked.
- **Injection — every HTML sink is escaped.** The v0.2 app builds DOM with a `textContent`/`setAttribute` helper (`web/src/lib/dom.ts`) — no `innerHTML` in the panel/ticker/drawer renderers. The only HTML-string sinks are six MapLibre `Popup.setHTML()` calls in `web/src/map/overlays.ts`, and all six escape their interpolated values: `drawWaterPoints` (211-220), `aedPopup` (526-545), `attributeHtml` (604-652, including the `href` branch, gated by an `/^https?:\/\//` check so `javascript:` URLs never become links), `controlPointLayer` (795-806), `polygonLayer` (878-884). `render.ts`'s YouTube iframe and `drawer.ts`'s iframe interpolate only a video id into a fixed `youtube.com/embed/…` URL — `src` assignment cannot execute script, and those ids come from the committed, hand-curated `data/live_streams.json`, not from any remote feed.
- **Worker proxy is not an open proxy.** `worker/src/index.js`: GET/OPTIONS only (405 otherwise), HTTPS-only (282-284), credentials-in-URL refused (285-287), exact-host whitelist derived from `sources.json` via `scripts/build_worker_whitelist.py` (67 hosts, no wildcards), redirect chain re-validated per hop up to 3 with a registrable-domain rule (`fetchValidated`, 229-248), client cookies/headers never forwarded upstream (only its own `User-Agent` and `Accept`), `Set-Cookie` not relayed (352-353), response bodies size-capped including chunked (`capBytes`, 252-263), upstream errors never cached, and `CF-Connecting-IP` used for rate limits (not the spoofable `X-Forwarded-For`). A non-registry host returns `403 host_not_allowed`; `file://` and `http://` return `400 https_only` (SSRF closed — matches SECURITY.md §8.2's own probe results).
- **`/config/3d` cannot leak a key.** It refuses any `TILES3D_*` URL carrying `key=`/`token=`/`signature=` with a 503 (`KEYED_URL_RE`, `worker/src/index.js:387-405`); the committed `wrangler.toml` values are public keyless `data.map.gov.hk` tileset URLs.
- **CI cannot be driven by a stranger.** Both workflows (`.github/workflows/ai-brief.yml`, `live-publish.yml`) trigger only on `schedule` and `workflow_dispatch` — **no `pull_request` and no `pull_request_target`**, so a fork PR cannot run them or read their secrets. `permissions: contents: write` grants the GITHUB_TOKEN force-push rights, but the token is auto-masked in logs, is only reachable by collaborators via `workflow_dispatch`, and the workflows run only this repo's own committed Python (no checkout of untrusted code). The `OPENROUTER_API_KEY` is a named-free-model key (low value) and is never echoed or written to a file — `build_ai_summary.py` prints only the brief, not the key.
- **Case/IDN/trailing-dot/port-of-host tricks on the proxy** are defeated by the URL parser + `toLowerCase()` on both sides of the exact-host check (the only residual gap is *port*, P2-1).
- **No postinstall scripts** in either dependency tree (see P2-4).

---

*Method note: this review read every file named above and ran the secret/port/CSP/CI checks as real commands; no claim here rests on "looks fine" without the file:line or command output cited. The only file created is this one.*

---

## Verified after the review (Director, 2026-10-02, so the next reader does not re-chase these)

**P2-1 is a FALSE POSITIVE — no change made.** `URL.host` **includes** the port:

```
$ node -e 'const u=new URL("https://www.hko.gov.hk:8443/x"); console.log(u.host, u.hostname)'
www.hko.gov.hk:8443   www.hko.gov.hk
```

`worker/src/index.js:288` compares `target.host` (not `.hostname`) against `ALLOWED_HOSTS`, and
`ALLOWED_HOSTS` is built from `sources.json`, which contains **no URL with a port**. So
`https://whitelisted-host:8443/...` fails the set lookup and returns 403 — the strict behaviour.
Using `.host` rather than `.hostname` is what makes this safe; a "fix" to `.hostname` would have
created the hole the finding describes. Recorded here rather than changed.

**P2-3 — not fixed, by spec.** `index.html` is the v0.1 prototype and AGENTS.md says it is **live,
and must not be edited or deleted**; the two unescaped values are numeric readings
(`${t.value ?? "–"}°C`) from the HKO feed, not strings. Left alone deliberately.

**P1-1 (CSP) — still open, and it needs a real pass rather than a blind header.** The page talks to
map tiles, the Worker, raw.githubusercontent.com, YouTube embeds and third-party camera images, so
an allow-list has to be built from observed requests and then tested against every panel state.
Doing it at 3am without the ability to watch a violation would either break panels or ship a policy
nobody verified. Next session, with `Content-Security-Policy-Report-Only` on Cloudflare Pages first.
