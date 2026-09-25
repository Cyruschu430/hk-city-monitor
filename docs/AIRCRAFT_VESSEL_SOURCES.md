# AIRCRAFT & VESSEL LIVE SOURCES — assessment for the two proposed map layers

**What this is.** An assessment of three candidate sources Cyrus proposed, against the question that
actually matters: **can this load in production?** Every claim below carries either a `PROBE` result
(a real HTTP request made from this machine on **2026-09-25**, 17:15–17:45 +08:00) or a `DOC` citation
with its URL. Where neither exists, the text says **NOT VERIFIED**.

**The prior finding this builds on, not rediscovers.** `web/src/main.ts` (RAIL_LAYERS comment, lines
84–93) and `AGENTS.md` record that the aircraft layer existed and was withdrawn 2026-09-23 because
adsb.fi and adsb.lol answer 200 from a home IP but return 403/429 to Cloudflare's egress. That
finding is **correct and unchanged**; nothing here contradicts it. The contribution of this document
is the part that was missing: *what to do instead*, and *what is still genuinely unknown*.

**Probe method (this matters — Pitfall 35).** Every request used a browser-like `User-Agent`
(`Mozilla/5.0 … Chrome/140 Safari/537.36`); a bare Node UA gets `403 error code: 1010`, which is
a block on the probe, not a dead source. **A control was run in the same process**: `api.adsb.lol`
returned `200` in the same minutes that `api.adsb.one` and `api.airplanes.live` returned `403`, which
is what separates "this source refused us" from "the network refused everything".

**The single most important sentence in this document.** The home-IP probe is the test that misled us
before. It is repeated here only for **payload shape and licence evidence**. **No result obtained from
this machine can settle the Cloudflare-egress question, and none is presented as if it can.**

---

## 0. What the repo already has (so nothing is re-derived)

| piece | state | where |
|---|---|---|
| `plane` glyph, drawn nose-up for per-track rotation | **EXISTS** | `web/src/map/symbols.ts:146` (`drawPlane`), registered `GLYPHS.plane` line 413 |
| `ferry` glyph (disc `#38bdf8`) | **EXISTS** | `symbols.ts:414` |
| `parseAdsb()` — accepts `aircraft`, `ac`, or a bare array; handles the seconds-vs-milliseconds `now` bug | **EXISTS** | `web/src/lib/parsers.ts:771` |
| `aircraftToGeoJson()` — emits `bearing` = `trackDeg ?? 0`, the field the layer rotates by | **EXISTS** | `parsers.ts:827` |
| `adsbStatus()` status-grid cells | **EXISTS** | `parsers.ts:793` |
| adapters `adsb_fi_hk` and `adsb_lol_hk` | **EXISTS** | `web/src/lib/adapters.ts:472, 485` |
| `layers.json` entry for `aircraft` | **GONE** | `data/layers.json` has 9 layers; none is aircraft |
| RAIL row + overview panel | **REMOVED** | `main.ts:93` (commented out) |
| QA toggle path for `aircraft`, deliberately kept and made to throw loudly | **EXISTS** | `main.ts:770–784` |
| registry entries: `adsb_lol_hk`, `adsb_fi_hk`, `opensky_hk`, `adsbdb`, `airplanes_live`, `aisstream`, `mardep_vessel_arrivals`, `mardep_crossboundary_ferry`, `hkia_flights` | **EXISTS** | `sources.json` |
| Worker whitelist already contains `api.adsb.lol`, `opendata.adsb.fi`, `api.airplanes.live`, `opensky-network.org`, `stream.aisstream.io`, `api.adsbdb.com`, `www.mardep.gov.hk` | **CONFIRMED** | `worker/src/whitelist.generated.js` — **no whitelist regeneration needed for any option below** |

**A gap worth naming.** `data/panels.json._withdrawn_panels` records `crypto_prices` and
`holiday_leave_table` — **the aircraft panel is not there.** Its withdrawal survives only as a code
comment and two registry notes. The file's own `_comment` states that a withdrawn panel goes there,
never into the `panels` array, so the next person looking for "why did the plane layer go" has no
entry to find. Restoring the layer should add that record, not just delete the comment.

---

## 1. The three sources

### 1.1 `https://api.adsb.lol/docs` — adsb.lol

**What it is.** Community ADS-B/Mode-S aggregation, REST/JSON. `PROBE`: the documented route shape is
`GET /v2/point/{lat}/{lon}/{radius_nm}`, with siblings `/v2/closest/{lat}/{lon}/{radius_nm}`,
`/v2/hex/{icao24}`, `/v2/me`. `DOC`
(`raw.githubusercontent.com/adsblol/api/main/README.md`): *"It runs in Kubernetes and is written in
Python / asyncio / aiohttp. **This API is compatible with the ADSBExchange Rapid API. It is a
drop-in replacement.**"*

**The `/docs` page itself is not a document.** `PROBE`: `https://api.adsb.lol/docs` returns `200` but
renders one line — "adsb.lol API". It is a JavaScript Swagger shell; `/docs/openapi.json`,
`/docs/swagger.json`, `/docs/openapi.yaml` and `/openapi.json` all return **404**. The real
documentation is the `adsblol/api` README. **So `https://api.adsb.lol/docs` as a URL to "read the
docs" is a dead end for an agent** — cite the README instead.

**Data / coverage / cadence.** Hex, callsign, registration `r`, type `t`, `alt_baro`, `alt_geom`,
ground speed `gs`, `track` (true track, °clockwise from north), `baro_rate`, `squawk`, `category`,
`lat`/`lon`, `seen_pos`. `PROBE` payload shape:

```
{"ac":[{"hex":"78030b","type":"adsb_icao","flight":"CSH9536 ","r":"B-5315","t":"B738",
"alt_baro":33100,"gs":437.9,"track":82.39,"mag_heading":81.91,"true_heading":78.80,
"lat":22.979954,"lon":112.553151,"squawk":"3120","category":"A3", …}],
"msg":…,"now":…,"total":…,"ctime":…,"ptime":…}
```

HK bbox filtering is native — a point/radius query, not a client-side filter. Registry cadence "~10
seconds".

**Auth and cost.** Keyless today. `DOC` (same README) records the forward risk in the vendor's own
words: *"Rate limits are dynamic based on the environment load. If you get 4xx errors, you are doing
something wrong. **In the future, you will require an API key** which you can obtain by feeding
adsb.lol. This will be a way to ensure that the API is being used responsibly and by people who are
willing to contribute to the project."* Not metered, no billing — so it does not violate the
metered-key rule, but it is a documented plan to close the keyless door.

**Licence.** The registry carries `"ODbL 1.0 — 需標明 adsb.lol 出處"`. `DOC` corroboration is partial
and worth stating precisely: the `adsblol/api` repository (the API's **source code**) is
**BSD-3-Clause**; the `adsblol/globe_history_2024` / `globe_history_2025` repositories (the
**historical data**) are **ODbL-1.0**. ODbL 1.0 is the plausible data licence and requires
attribution — but **I did not find an explicit data-licence statement on the API itself.**
`ATTRIBUTION.md` is generated from `sources.json` by `scripts/build_attribution.py`, so the licence
field must be right *before* wiring, and the file must not be hand-edited either way.

**CORS.** `PROBE`: **no `Access-Control-Allow-Origin` header at all** → the browser cannot call it
directly; it must go through the Worker. This corroborates the registry's `fetch: "proxy"`.

**Egress.** `PROBE`, this machine, browser UA, ~1.2 s apart:

| call | status | content-type | bytes | body |
|---|---|---|---|---|
| `/v2/point/22.32/114.17/100` | **200** | `application/json` | 22,169 | 39 aircraft |
| same URL again | **200** | `application/json` | 22,056 | 39 aircraft |
| `/v2/closest/22.32/114.17/50` | **200** | `application/json` | 747 | 1 aircraft |
| `/v2/hex/400be3` | **429** | `text/html` | 564 | `<title>429 Too Many Requests</title> … nginx` |
| `/v2/me` | **503** | `text/html` | 592 | nginx "Service Temporarily Unavailable" |
| `/v2/0/0/0` | **503** | `text/html` | 592 | nginx "Service Temporarily Unavailable" |

**The 429 arrives on the fourth back-to-back request, from a residential IP, with a browser UA.** The
429 body is plain `nginx`, not a Cloudflare error page — the limiter is adsb.lol's own, and it is
tight and per-IP regardless of who is asking. That is a *mechanism* consistent with the recorded
Cloudflare finding (a Worker's egress IP is shared by many tenants, so a shared bucket is drained by
strangers, not by us) — but it is **not proof of what Cloudflare's egress gets.**

**Can it work from a Cloudflare Worker?** **NOT VERIFIED.** The registry records the measured
2026-09-23 result as `429` to Cloudflare's egress *on every endpoint tested, including a single
request after a 60 s cooldown* — i.e. it rate-limits the shared datacenter IP rather than any burst
of ours. That measurement stands. Today's home-IP result neither confirms nor overturns it.

### 1.2 `https://github.com/SkyLink-API/flight-tracking-api` — SkyLink API

**What it is.** Not a source at all — **a marketing README with no code.** `PROBE`: the GitHub API
reports the repository as `"size": 6` bytes, `"language": null`, created and last pushed
`2026-03-29`, `"stargazers_count": 2`, `"forks_count": 0`. It contains a README that advertises a
hosted service; the service itself lives on RapidAPI.

`DOC` (the README): `GET https://skylink-api.p.rapidapi.com/v3/adsb/aircraft`, with
`bbox=lat_min,lon_min,lat_max,lon_max`, `lat`/`lon`/`radius` (km), `callsign`, `icao24`,
`registration`, `airline`, `min_altitude`/`max_altitude`, `min_speed`/`max_speed`; response is
`{total_count, aircraft:[{icao24, callsign, registration, aircraft_type, latitude, longitude,
altitude, ground_speed, heading, vertical_rate, squawk, on_ground, last_seen, photo_url}]}` with
`heading` = true track, so rotation is trivially available. Cadence claimed "~10 seconds".

**Auth and cost — this is a hard stop.** `DOC` (README badges and Quick Start): **you must send
`x-rapidapi-key`**, and the free tier is **1,000 requests/month**, "no credit card required". The
repository's own MIT licence covers the README, not the service. Two independent reasons it cannot
ship here:

1. **It is a metered API key.** `AGENTS.md` and `COST.md`: *"Never add a metered API key. If usage
   growth increases the bill, it does not go in. The validator fails the build on a metered source."*
2. **1,000 requests/month is arithmetically absurd for this feature.** One aircraft layer at a
   60-second poll is `60 × 60 × 24 × 30 = 43,200` requests/month — **43× the entire monthly
   allowance**, exhausted in about 17 hours. Even a 10-minute poll is 4,320/month. The layer would
   die by the second day, every month.

There is no `license` field for it in `sources.json` and no citable data licence for the service.

**CORS / egress.** **NOT VERIFIED** — not probed, because a probe without a key returns an
auth error and a probe *with* a key would require creating the metered account this project forbids.
The question is moot: the metered key is disqualifying before CORS is reached.

### 1.3 `https://aisstream.io/` — AISStream

**What it is.** **WebSocket, not REST** — this is the crux, and it makes AISStream a different shape
of problem from every other source in `sources.json`. `DOC`
(`aisstream.io/documentation`): `wss://stream.aisstream.io/v0/stream`; connect, then send **one
complete JSON subscription within three seconds**:

```json
{ "APIKey": "<YOUR_API_KEY>",
  "BoundingBoxes": [[[22.13, 113.80], [22.60, 114.48]]],
  "FilterMessageTypes": ["PositionReport"] }
```

`BoundingBoxes` is **required**; MMSI and message-type filters are optional. HK bbox filtering is
native. `DOC`: `PositionReport` carries `Sog` (knots), `Cog` (course over ground, °), `TrueHeading`,
`NavigationalStatus`, `RateOfTurn`, `Latitude`, `Longitude`, `Timestamp`, `Valid`; `MetaData` carries
`MMSI`, `ShipName` and a last-known position. **`Cog`/`TrueHeading` is exactly what a rotated ship
glyph needs.** Frames are **binary** WebSocket frames containing UTF-8 JSON.

**Auth and cost.** Free API key (GitHub sign-in), server-side only. `DOC`: *"**Use WSS and
server-side secrets** … **Direct browser connections are not permitted.** Connect from your own server
and proxy only the information each client needs."* The free tier is limited by **concurrency, not
requests** — 3 subscribed connections per account, **3 open connections per originating IP**, 1
subscription update/second, 200 MMSIs, initial subscription within 3 s. **No per-request meter and no
billing**, so it does not violate the metered-key rule. `DOC` also states plainly: *"The service
currently provides no SLA or uptime guarantee, and events are not durably replayed."*

**Licence — this is unresolved.** The registry carries `"license": "aisstream.io 免費層 — 見服務條款"`
("see the terms of service"). `PROBE` + `DOC`: **there is no terms-of-service document to see.**
`/terms`, `/termsofservice`, `/terms-of-service`, `/legal`, `/LICENSE`, `/sitemap.xml` all return
**404**. The only legal page published is a **privacy policy** (which covers personal data, not the
data licence). The GitHub organisation publishes **five repositories, all with `license: none`**
(`aisstream`, `ais-message-models`, `example`, `issues`, `Projects-Using-aisstream.io`). So: **no
named data licence exists at any path I could reach.** That matters because the registry's own schema
comment says a missing licence means *"deliberately left blank rather than guessed, because a wrong
licence is worse than an absent one"*, and `docs/SOURCE_COVERAGE_REVIEW.md` treats a blank licence as
a **stop** for wiring. Here the licence is not blank — it is *pointing at a document that does not
exist*, which is worse, because it looks resolved.

**CORS.** Irrelevant in the usual sense: a browser cannot open this connection at all — by design, not
by CORS policy. `DOC`: *"Can I connect from a browser? No. Direct browser connections are not
permitted."*

**Egress — what the docs do and do not say.** `DOC` states a **3-connections-per-originating-IP**
limit that *"applies before authentication"* — which implies IPs in general are accepted, but it says
**nothing about datacenter or cloud IPs, and nothing about blocking them.** I found **no** statement
either way. **NOT VERIFIED.**

**Can it work from a Cloudflare Worker at all? Plainly: not as a proxy.** A Worker request handler is
short-lived; there is no way to hold a socket in one. The Cloudflare mechanics, all `DOC`-verified:

- **Outbound WebSockets from the Workers runtime are supported.** The runtime-API page documents
  `new WebSocket(url)` and `fetch()` with `Upgrade: websocket` → `resp.webSocket.accept(...)`, and
  notes *"Outbound WebSocket connections also count toward this [6-connection] limit."*
- **A Worker invocation cannot hold one.** Only a **Durable Object** can keep a connection alive and
  hold the latest snapshot for the static front end to poll — i.e. a DO per AISStream connection, plus
  a **Cron Trigger** to nudge reconnection (Workers Free allows **5 Cron Triggers per account**, 10 ms
  CPU each).
- **Durable Objects are available on the Workers Free plan**, but **SQLite-backed only**
  (`developers.cloudflare.com/durable-objects/platform/pricing/`), and the Worker has **no DO binding
  or class today** — `worker/wrangler.toml` declares only `main`, `compatibility_date` and four vars.
  Adding one means a new binding, a new class, a migration and a new failure surface.
- **The cost arithmetic is the part that decides it.** The same page states: *"An active outbound
  connection (via `connect()` or an outbound WebSocket) keeps a Durable Object in memory and causes it
  to incur duration charges … Duration is billed in wall-clock time as long as the Object is active
  and not eligible for hibernation"*, and *"Calling `accept()` on a WebSocket in an Object will incur
  duration charges for the entire time the WebSocket is connected."* Duration is billed at the DO's
  full 128 MB. So one always-on outbound socket costs

  ```
  86,400 s/day × 128 MB / 1 GB  =  10,800 GB-s/day
  Workers Free Durable Objects allocation = 13,000 GB-s/day
  → 83% of the account's ENTIRE free Durable Objects duration budget
  ```

  On the Free plan overage **fails, it does not bill** (`DOC`: *"If you exceed any one of the free
  tier limits, further operations of that type will fail with an error"*) — which is the property the
  project chose Cloudflare for — but it means one ships feature consumes the whole DO headroom, and
  the failure mode is a dead vessel layer, not a bill.
- **Other limits that constrain any Worker-side streaming design** (`DOC`,
  `developers.cloudflare.com/workers/platform/limits/`): Workers Free **CPU 10 ms per HTTP request and
  per Cron Trigger**; **50 subrequests per invocation**; **6 simultaneous outgoing connections per
  request**. The 10 ms CPU ceiling alone rules out parsing a continuous AIS feed inside a normal
  request handler.

**The coverage question, which is the one that actually gates the layer.** `TECH_SPEC.md` §3.5 is
explicit and binding: *"⚠️ 未量度之前唔准起呢個圖層"* — do not build this layer before measuring
coverage — because a near-empty vessel layer is indistinguishable from "Hong Kong has no ships", and
`TECH_SPEC` §3.5 calls that the most serious kind of lie. The measurement tool already exists:
`scripts/test_ais_coverage.py --minutes 10` (bbox default `21.8,113.3,22.7,114.6`, subscribes to
`PositionReport` and counts distinct vessels, printing GO / MARGINAL / NO-GO). **I did not run it: it
requires a free API key that I must not create, and the `websockets` package.** So **HK AIS coverage
is NOT VERIFIED**, and no layer may be built until that number exists.

One correction to the registry's own note: it says the vendor *"自己講覆蓋最強喺歐洲／大西洋、最弱喺
亞洲"*. **The documentation page fetched today makes no statement about regional coverage at all** —
it discusses filters, message types, limits and reconnects. So the registry's claim may be based on an
older version of the site and should not be relied on in either direction. Coverage is **unproven**,
not "known to be bad".

---

## 2. The egress question, answered directly

**Is `api.adsb.lol` usable from Cloudflare egress today? NOT VERIFIED.**

I cannot settle it from here, and neither can anyone else on a home connection — that is precisely the
test that misled us on 2026-09-23. What I can say, precisely:

- The recorded measurement (`429` to Cloudflare egress on every endpoint, including after a 60 s
  cooldown) **stands unchanged**. Nothing in today's work supersedes it.
- Today's home-IP probe shows a **per-IP limiter that trips on the fourth back-to-back request with a
  browser UA**. That is a mechanism that *would* explain a shared Worker egress IP failing while a
  residential IP mostly succeeds. It is a **hypothesis consistent with** the recorded finding, not
  evidence for it.
- `docs/SOURCE_COVERAGE_REVIEW.md` did not probe this. `data/sources_report.json` is dated
  2026-09-18 and is a *shape* verdict, not an egress verdict.

**The exact test that would settle it.** Add a **temporary diagnostic route to the existing Worker** —
not a new proxy, and not an open one:

```js
// TEMPORARY. Fixed URL list, no client-supplied parameter (an open diagnostic route is an
// open proxy with extra steps). Returns status metadata only, never the upstream body.
const EGRESS_PROBE = [
  "https://api.adsb.lol/v2/point/22.32/114.17/100",
  "https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100",
  "https://opensky-network.org/api/states/all?lamin=22.13&lomin=113.80&lamax=22.60&lomax=114.48",
];
// GET /selftest/egress  →  [{url, status, contentType, bytes}]  with body: null
```

Then `curl` that one path against the **deployed** Worker, read the JSON, and **delete the route in the
next commit**. Two properties make this the right test: the request originates from Cloudflare's real
egress, and the answer is a status code rather than an inference.

Two near-misses worth naming so nobody mistakes them for the test:

- **`wrangler dev --remote`** runs the Worker on Cloudflare's edge and *would* exercise real egress
  from your terminal — but it is a server, so it hangs forever in a non-interactive agent session
  (`AGENTS.md`, "Servers, and commands that never exit"). It is a human-in-a-terminal tool.
- **`@cloudflare/vitest-pool-workers` is NOT the test.** It runs in `workerd` **locally**, so it
  exercises the runtime and the bindings but **not Cloudflare's egress IP**. A green adsb.lol test in
  that harness would prove nothing about production — a check that cannot fail, which `AGENTS.md`
  Pitfall 23 calls worse than no check.

The same route answers the adsb.fi and OpenSky questions in the same deploy, which is why it is worth
one temporary route rather than three separate experiments.

---

## 3. Alternatives, ranked

### 3.1 The PC-side collector writing a static JSON — the pattern the repo already prescribes

This is not a fallback; it is the design the codebase already names twice. `main.ts:90–92`: *"re-add
the rail entry and the overview panel when a source that tolerates cloud egress is found, **or when a
PC-side collector publishes a static JSON the front end can read (the water-suspension pattern)**."*
And `TECH_SPEC.md:33`: *"VPS = 工廠（只放要常駐嘅嘢：AIS WebSocket、NLP collector、cron）"*.

The pattern is already load-bearing and its shape is fixed by precedent:

- `wsd_water_suspension` in `sources.json` has `"fetch": "n/a"` and a `url` that is the **static
  file**; `scripts/build_water_suspension.py` fetches upstream and writes
  `data/water_suspension.json` (`OUT = os.path.join(ROOT, "data", "water_suspension.json")`), which
  the front end reads. Its own registry note explains why the collector exists at all: the WSD host
  negotiates a TLS cipher that workerd/BoringSSL cannot, so **the Worker can never reach it** — the
  same class of conclusion as "the Worker can never reach adsb.fi".
- `hk_live_cams_community` is the same shape for a curated list, and is the project's precedent for
  a source that is *not* official open data (it is labelled 第三方直播 on screen).
- The collector's output is a file in `data/`, i.e. served by Pages. **No new Worker surface, no new
  binding, no key in the front end, and no collector host or IP written into this public repo** — which
  is the constraint that rules out naming the VPS.

**Why this is the strongest option for aircraft specifically:** the evidence that adsb.fi works from
this PC is **10/10 HTTP 200** (registry, 2026-09-23) and **200 with 32 aircraft** in today's probe. It
is the only path to the aircraft layer with a working measurement behind it.

**Honest cost of the pattern:** the layer is only as fresh as the collector's last run. It must
therefore **never be labelled 即時**, it must carry its observation timestamp, and it must visibly
degrade past its freshness threshold (`DESIGN_BRIEF` §6, `AGENTS.md` hard constraint 2). A collector
that stops is a **stale** layer, not a silent one.

### 3.2 OpenSky Network — UNSUITABLE, on two independent documented grounds

This is the alternative that looks best on the surface and is the one that must be ruled out
explicitly, because the probe is genuinely encouraging.

**`PROBE` (200, works right now, from a residential IP):**

| call | status | bytes | `X-Rate-Limit-Remaining` | states |
|---|---|---|---|---|
| `/states/all?lamin=22.13&lomin=113.80&lamax=22.60&lomax=114.48` | 200 | 2,693 | **395** | 22 |
| again | 200 | 2,689 | 394 | 22 |
| again | 200 | 2,689 | 393 | 22 |

So: keyless anonymous access works, the HK bbox costs **exactly 1 credit** (matching the documented
"≤ 25 sq° → 1 credit" band — the HK box is 0.47° × 0.68° ≈ 0.32 sq°), the anonymous bucket is
**400/day**, and the sample state vector is the documented bare array:
`["8840f8","BKP806  ","Thailand",1790329438,1790329438,113.9193,22.3059,null,true,11.83,250.31,
null,null,null,null,false,0]` — index 10 is `true_track`, i.e. a ready-made rotation value. CORS is
**not** permissive (`ACAO: https://opensky-network.org`, an echo of its own origin), so it needs the
Worker.

**Ground 1 — the licence forbids exactly this use.** `DOC`
(`openskynetwork.github.io/opensky-api/index.html` and, fetched with a browser UA because its nginx
403s ordinary fetchers, `opensky-network.org/about/terms-of-use`):

> "the live API … lets you retrieve live airspace information for research and non-commerical purposes"
>
> "LICENSE … solely for the purpose of **non-profit research and non-profit education**. No license is
> granted for any other purpose"
>
> "**Operational use of the REST API in any live product, service, or automated system also requires a
> written license, regardless of the entity's non-profit status.**"

HK City Monitor is a live product on a public URL. A written licence is unobtainable for a
no-budget project. This is not a grey area — it is the vendor ruling out the exact use, in writing.

**Ground 2 — the docs state they block datacenter ranges.** The same documentation page says:

> "Note that we may block AWS and other hyperscalers due to generalized abuse from these IPs."

Cloudflare's Worker egress is a hyperscaler datacenter range. This is a *documented* statement of the
same failure mode the aircraft layer was withdrawn for, from the source's own mouth — so even if the
licence were resolved, OpenSky would need the temporary egress test before it could be trusted.

**A third, softer point:** the anonymous bucket is **per-IP**, and a Worker egress IP is shared with
other Cloudflare tenants. From a residential IP the bucket was essentially full (395/400). From a
shared datacenter IP it may already be drained by strangers — **NOT VERIFIED**, and unfixable from
here. Note the tension: a 5-minute edge cache would fit inside 400/day (288 requests) *if the bucket
were ours*; it is not.

**Also worth recording:** `opensky_hk` is currently `auth: "register"` in the registry, described as
the "fallback mirror". That description should change — it is not a fallback, it is a licence
prohibition combined with a documented egress block.

### 3.3 `adsb.one` — UNSUITABLE as-is; and the reason is not the one `TECH_SPEC` gives

`TECH_SPEC.md:79` records `airplanes.live／adsb.one` as *"兩者都回 403，唔使試"*. My probe agrees on
the status but distinguishes the causes, and the distinction matters:

- `api.airplanes.live/v2/point/…` → **403**, `application/json`, 164 B, body `{"error":"…"}` — an
  **application-level** refusal (needs credentials), matching the registry note.
- `api.adsb.one/v2/point/…` → **403**, `text/html`, 4,910 B, body
  `<title>Attention Required! | Cloudflare</title> … Sorry, you have been blocked … You are unable to
  access adsb.one`, with `server: cloudflare`, `cf-ray: …-HKG`, and
  `server-timing: cfEdge;dur=2,cfOrigin;dur=0`. **The origin was never reached.** `api.adsb.one/`
  (the root) is blocked identically, so this is a **zone-wide Cloudflare bot/WAF rule**, not an auth
  gate on the API route.

That is Pitfall 35's exact shape: a company name is not a doc URL, and `403` here may mean "Cloudflare
refused the client's fingerprint", not "the source is dead". **A real browser may well be let
through — NOT VERIFIED.** But the same reasoning means a Cloudflare *Worker* subrequest (also a
non-browser client) is equally unproven, and the practical conclusion is unchanged: **do not pursue
adsb.one.** (Note it is also absent from `sources.json` and from the Worker whitelist, so using it
would mean new registry and whitelist entries.)

### 3.4 ADS-B Exchange — no keyless public API; do not pursue

`PROBE`: `globe.adsbexchange.com` returns **200** and serves its map shell (so the *website* is
reachable), and `adsbexchange.com/data/` returns **200** with a WordPress "Data Products" page — i.e.
a **commercial data-products catalogue** (JETNET-owned). No keyless public REST endpoint is documented
for the product's use, and the historical "free API for feeders" arrangement is not a public keyless
feed. Not probed further because no candidate endpoint is documented; **NOT VERIFIED** whether any
free tier exists, and it is not worth one, given adsb.fi already works from the PC.

### 3.5 Hong Kong Government / Marine Department — real, licensed, and it is NOT vessel positions

This is the alternative Cyrus did not name, and it needs saying clearly because it is easy to conflate
two different things.

**Method note (Pitfall 8).** A keyword search is not evidence of absence: `data.gov.hk`'s
`package_search` indexes only a fraction of the catalogue. `PROBE` of `package_search` for `ais`,
`船舶`, `船隻`, `vessel+position`, `automatic+identification`, `marine+traffic` returned **`count=0`
for every one of the six terms.** Per the pitfall, that proves nothing. So I enumerated the catalogue
instead: `PROBE` `package_list` returned **3,821 packages**, and I filtered the full list.

**Result: there is no AIS or vessel-position dataset in the Hong Kong catalogue.** What exists is
vessel *movement* information, which is a different thing:

| catalogue id | what it actually is | resources (`PROBE` via `package_show`) |
|---|---|---|
| `hk-md-mardep-non-convention-vessel-arrivals-and-departures` | arrival/departure **list** — "Vessels arrived in last 36 Hours", "due to arrive", "in port", "due to depart in next 72 Hours", "Departed in Last 36 Hours" | `RN0010/RN0020/RN0030/RN0040/RN0050.XML` |
| `hk-md-mardep-vessel-arrivals-and-departures` | the ocean-going counterpart | `RP05005i/RP04005i/RP06005i/RP05505i.XML` |
| `hk-md-mardep-vessel-traffic-management-system-report` | **VTS report** — "Arrival and departure information of ocean-going and non-convention vessels", i.e. **ETAs, not fixes** | `RP04005/RP04505/RP05005/RP05505/RP06005/RP11501.XML` + `LOCATION.XML` |
| `hk-md-mardep-pcwa-berth-vacancy` | berth vacancy at Public Cargo Working Areas (CSV; also a CSDI API) | `PCWA_Berth_Vacancy_{EN,TC,SC}.csv` |
| `hk-md-mardep-shipping-directory-of-hong-kong`, `…list-of-vessels-with-operating-license-endorsed`, `…private-mooring-areas`, `…marine-accident-statistics` | registers and statistics | — |

`PROBE` of the registry's own `mardep_vessel_arrivals` URL confirms the shape and the semantics:
`https://www.mardep.gov.hk/e_files/en/opendata/RN0010.XML` → **200**, `application/xml`, **673,830 B**,
`<?xml version="1.0" encoding="UTF-8"?><RN0010><G_SQL1><VESSEL_NAME>---</VESSEL_NAME>
<SHIP_TYPE_DESC>PLEASURE VESSEL / YACHT</SHIP_TYPE_DESC><LIC_MD_REF>112768</LIC_MD_REF>
<ARRIVAL_DATETIME>14/04/2026 …` — vessel names, types, licence refs and arrival timestamps.
**No latitude, no longitude, no heading.** There is nothing here to put a ship glyph on, and no
amount of parsing will produce one.

What it **is** good for: the first marine **panel** on the dashboard (the marine group is 0-for-5
wired today — `docs/SOURCE_COVERAGE_REVIEW.md` §2 row 8 ranks `mardep_vessel_arrivals` as recommended
action #6). It is keyless, licensed (`HKSAR Government 開放數據 (data.gov.hk 條款)`), already
whitelisted, and it pairs naturally with the existing `mardep_crossboundary_ferry` layer and the
immigration queue times. That is a genuinely worthwhile ship-shaped **panel**. It is not the requested
**layer**.

**Ranked, therefore:**

| # | option | verdict | why |
|---|---|---|---|
| 1 | **adsb.fi → PC collector → static `data/aircraft.json`** | **SUITABLE** | only aircraft path with a working measurement (10/10 200 from this PC; 32 aircraft today) |
| 2 | OpenSky → Worker | **UNSUITABLE** | licence: live-product use needs a written licence regardless of non-profit status; docs state hyperscaler blocking |
| 3 | SkyLink API | **UNSUITABLE** | metered RapidAPI key (project-forbidden); 1,000 req/mo is 1/43 of a one-minute poll |
| 4 | adsb.lol → Worker | **NOT VERIFIED** (recorded as unusable) | `429` to CF egress measured 2026-09-23; today's home probe shows a tight per-IP limiter |
| 5 | adsb.one, airplanes.live, ADS-B Exchange | **UNSUITABLE as-is** | 403 (Cloudflare WAF / credentials) or no keyless public API |
| 6 | HK Marine Department vessel feeds | **SUITABLE for a PANEL, NOT for a positions layer** | real, licensed, already whitelisted — but carries no coordinates |
| 7 | **AISStream → persistent collector → static `data/vessels.json`** | **SUITABLE WITH A SHIM, conditional** | only free live AIS; gated on (a) the coverage measurement returning GO and (b) a licence being established |

---

## 4. Concrete recommendation

### 4.1 Aircraft — restore the layer on the PC-collector path, not on a live API

Do **not** re-enable `adsb_lol_hk` through the Worker. Do this instead:

1. **Collector** (new, sibling to `scripts/build_water_suspension.py`; runs on the PC, not on
   Cloudflare): poll `https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100` on a **slow**
   cadence — **60 s minimum, 120 s preferred** — with a browser-like UA, one retry, and a
   **higher-and-further-out bounding geometry than the map** so aircraft are already in frame when
   they enter the HK box. Serialise the upstream envelope **verbatim** to `data/aircraft.json`, plus
   `fetched_at`.
2. **Zero new parser code, deliberately.** `parseAdsb()` (`parsers.ts:771`) already accepts
   `aircraft`, `ac` **or a bare array**, and already handles the adsb.fi-seconds vs adsb.lol-
   milliseconds `now` bug. Storing the raw envelope means the existing adapter + parser + glyph + test
   path all work unchanged — which is the whole point of keeping the code path intact in 2026-09-23.
3. **Registry**: add the collector output as a source with `"fetch": "n/a"` and a `url` pointing at the
   static file, exactly as `wsd_water_suspension` and `hk_live_cams_community` do. **Verify the
   licence field** — ODbL 1.0, attribution to adsb.fi — because `ATTRIBUTION.md` is generated from
   `sources.json` and must not be hand-edited.
4. **`layers.json`**: re-add the `aircraft` entry with `"symbol": "plane"` and rotation bound to the
   `bearing` property that `aircraftToGeoJson()` already emits. `hasGlyph("plane")` is `true`
   (`symbols.ts:413`), so Pitfall 33's blank-mark failure cannot recur here — but leave the `hasGlyph`
   guard in the legend path anyway.
5. **`main.ts`**: uncomment the RAIL row (`main.ts:93`), restore the overview panel, and **add the
   `_withdrawn_panels` record** that is currently missing from `data/panels.json`.
6. **Filter to the map, not to the feed.** The 100 nm circle covers ~185 km of the Pearl River Delta;
   the layer must clip to HK waters/airspace or the map fills with Shenzhen, Macau and Guangzhou
   traffic. Clipping in the layer is config, not code.

**Symbol.** Reuse **`plane`** exactly as drawn. Its comment (`symbols.ts:146`) explains it is drawn
full-size in a warm off-white specifically because aircraft are the only moving layer and a pure-white
speck against the dark basemap is easy to lose — that reasoning still holds. Rotation comes from
`track` → `bearing`, with the existing convention that a missing track becomes `bearing: 0` rather
than dropping the aircraft (`parsers.ts:817–826`).

**Risks.** (a) The collector's uptime *is* the layer's uptime — a stopped collector must read as
**stale**, never as "no aircraft". (b) `adsblol/api`'s README announces a coming key requirement; the
same volunteer-mirror fragility applies to adsb.fi. (c) Do not name the collector host or IP anywhere
in this repo.

### 4.2 Vessels — measure first; the source is the last decision, not the first

**Do not build this layer yet.** Three gates, in order, and the first two are cheap:

1. **Measure HK coverage — mandatory (`TECH_SPEC` §3.5).** Register a free AISStream key, set
   `AISSTREAM_API_KEY`, and run `python3 scripts/test_ais_coverage.py --minutes 10`. The tool already
   reports GO / MARGINAL / NO-GO and a vessel count. **NO-GO means no layer, and that is a successful
   outcome**, not a failure — a sparse vessel layer is the "no ships vs no coverage" lie `TECH_SPEC`
   names as the worst one. (I could not run it: it needs a key I must not create and the `websockets`
   package. Not installed, not run, **NOT VERIFIED**.)
2. **Establish a licence.** AISStream publishes no terms-of-service and no data licence anywhere I
   could reach, and all five of its GitHub repositories are `license: none`. Per the registry's own
   rule this is a **stop** until it is resolved in writing. Unlike coverage, this is a question for the
   vendor, not a test.
3. **Only then** choose the transport shape.

**Collector shape (recommended if the gates pass).** A persistent collector on the same side as the
existing `build_water_suspension.py` pattern — the project's existing "factory" — holding the
AISStream socket, maintaining an in-memory latest-snapshot keyed by MMSI (AIS is event-driven and has
no snapshot endpoint, so the collector must accumulate), and writing a small `data/vessels.json`
periodically. The front end then reads a static file exactly like the water-suspension layer: **no key
in the front end, no new Worker route, no exposed collector address.** It must state its own coverage
limitation on screen (terrestrial AIS — vessels beyond roughly 40 nm offshore vanish) and degrade
honestly when the collector stops.

**The Worker/DO shape, if Cloudflare must host it.** Technically possible — Durable Objects are on the
Workers Free plan, outbound WebSockets from the runtime are documented, and a Cron Trigger can drive
reconnection — but **not recommended**: one always-on outbound socket consumes **≈10,800 of the
13,000 GB-s/day** free Durable Objects duration allocation (**83%** of the account's entire budget for
that resource), and it adds a DO binding, class and migration to a Worker that has none today. It also
does not answer the coverage or licence gates, which are the actual blockers. The static snapshot the
DO would publish is the same artifact a collector would write, so the DO buys nothing that changes the
verdict.

**Symbol — add a `vessel` glyph; do not reuse `ferry`.** `symbols.ts:414` registers `ferry` with disc
`#38bdf8`; that glyph is the cross-boundary **ferry-route** icon and already means something specific
in this product (`mardep_crossboundary_ferry`, `TECH_SPEC` §3.5). Using it for "any vessel" would make
two different claims with one mark. Add a **`vessel`** glyph: a hull silhouette (pointed bow, straight
transom) with a superstructure block aft — top-down, nose-up, so it rotates the same way `plane` does —
and give it the marine cyan disc (`#38bdf8`) so it reads as "on water". Rotate from **`Cog`**, falling
back to **`TrueHeading`**, then `0`, mirroring the aircraft convention and documenting it in the code
comment. Register it in `GLYPHS`, which also puts it inside `hasGlyph()` — the check that exists
because a `symbol` string in JSON fails completely silently (Pitfall 33).

**Risks.** (a) Coverage unmeasured — the whole layer may be a lie. (b) No licence — a legal blocker, not
a technical one. (c) `DOC`: no SLA, no durable replay, messages dropped if not read continuously, so
the collector needs reconnect-with-backoff and its output needs an honest age. (d) AIS is
terrestrial-only and dark ships are out of scope by design. (e) The DO route is a budget trap.
(f) Whatever the shape, the free key must live in an environment variable or a file outside the repo —
never in a committed file, exactly as `test_ais_coverage.py` already assumes.

### 4.3 What to do next, in one line each

1. Add the temporary Worker `/selftest/egress` route, deploy, `curl` it, delete it — settles adsb.lol,
   adsb.fi and OpenSky in one deploy.
2. Build the adsb.fi → `data/aircraft.json` collector and restore the aircraft layer on it; that path
   needs **no** egress answer to proceed.
3. Run `scripts/test_ais_coverage.py --minutes 10` against a free AISStream key; report the GO/NO-GO
   number and the vessel count before any vessel code is written.
4. Ask AISStream for a data licence in writing, and record the answer in `sources.json`.
5. Separately, and worth doing regardless of any of the above: wire the **Marine Department vessel
   arrivals/departures** feed as the marine group's first **panel** — keyless, licensed, already
   whitelisted, and `docs/SOURCE_COVERAGE_REVIEW.md` §6 already ranks it.

---

## 5. What I did NOT verify

Mandatory section, stated plainly.

**Egress — the central unknown.**

- **Whether `api.adsb.lol` works from Cloudflare's egress: NOT VERIFIED.** My probes all originate from
  a residential connection, which is the test that misled us before. The recorded `429`-to-egress
  measurement of 2026-09-23 stands and is not contradicted. The `/selftest/egress` route in §2 is the
  test that would settle it, and **I did not create or deploy it** (no deploys, and the task forbids
  modifying any file but this report).
- **Whether `opendata.adsb.fi` works from Cloudflare's egress: NOT VERIFIED**, for the same reason. Its
  recorded `403` from the Worker likewise stands.
- **Whether `opensky-network.org` works from a shared Cloudflare egress IP: NOT VERIFIED.** I measured
  the anonymous bucket from a residential IP (`X-Rate-Limit-Remaining: 395` of 400, 1 credit per HK
  bbox call) and I have the documented statement that hyperscalers may be blocked — but not the state
  of a shared datacenter IP's bucket.
- **Whether `api.adsb.one` blocks real browsers, or only non-browser clients: NOT VERIFIED.** I saw a
  Cloudflare "you have been blocked" page with `cfOrigin;dur=0` and could not distinguish a
  fingerprint block from a genuine zone-level block, because no browser was driven. Not pursued,
  because `TECH_SPEC` §3.5 already rules it out on other grounds.

**Sources I could not probe at all.**

- **SkyLink API: NOT PROBED.** Every endpoint needs `x-rapidapi-key`; probing it would require creating
  the metered account the project forbids. The verdict rests on the README's own documented
  requirements (metered RapidAPI key; 1,000 requests/month), which is sufficient, since the metered
  key is disqualifying before CORS or egress is reached.
- **AISStream: the socket was never opened.** No key was created, nothing was subscribed, no
  `PositionReport` was ever received. Everything about its payload, limits and browser prohibition is
  `DOC` citation only.
- **`api.adsb.lol` under sustained load: deliberately not tested.** I made three successful calls and
  saw a `429` on the fourth, then **stopped** rather than probing harder. I did not capture
  `Retry-After`, and I did not test whether a single request after a cooldown succeeds. The limiter's
  exact shape (window, burst, per-endpoint variation) is **uncharacterised**.

**Coverage — the gate on the vessel layer.**

- **Hong Kong AIS coverage: NOT VERIFIED.** `scripts/test_ais_coverage.py --minutes 10` was **not run**
  — it needs a free AISStream key I must not create and the `websockets` Python package. The vessel
  layer's entire justification rests on a number that does not exist yet, and `TECH_SPEC` §3.5 forbids
  building the layer before it does.
- **Whether AISStream's docs still claim weak Asian coverage: NOT VERIFIED — and the registry's note
  appears stale.** The documentation page fetched today says nothing about regional coverage. I did
  not find an older or alternative page carrying that claim, so I recorded it as unsubstantiated rather
  than confirmed or refuted.

**Licences — the parts I could not close.**

- **adsb.lol's data licence: partially verified.** `adsblol/api` (code) is BSD-3-Clause and
  `adsblol/globe_history_20xx` (historical data) is ODbL-1.0, per the GitHub API. I did **not** find an
  explicit data-licence statement governing the live `/v2/*` API responses. The registry's "ODbL 1.0"
  is plausible and consistent, but it is **an inference, not a citation**, and the attribution
  requirement it implies is therefore also inferred.
- **AISStream's data licence: NOT FOUND, and this is a negative finding, not an untested one.** I
  probed `/terms`, `/termsofservice`, `/terms-of-service`, `/legal`, `/LICENSE` and `/sitemap.xml`
  (all 404) and enumerated its GitHub organisation (five repositories, all `license: none`). The only
  legal page published is a privacy policy. So the registry's pointer to "服務條款" points at a
  document that does not exist at any path I could reach. **NOT VERIFIED whether a licence exists
  somewhere I did not look** — but the burden is now on the vendor.
- **OpenSky's licence: the operative sentences were verified** (from `opensky-network.org/about/terms-of-use`,
  fetched with a browser UA because its nginx returns `403` to ordinary fetchers). I did not read the
  full agreement, only the licence grant and the two sentences about operational use; other clauses may
  matter.
- **SkyLink's data licence: NOT VERIFIED and not resolvable without an account.** Its GitHub repository
  is MIT, but that covers the README, not the hosted service.

**Technical claims I reasoned about rather than measured.**

- **The Durable Objects duration arithmetic is mine, from documented inputs**, not a measured bill:
  86,400 s/day × 128 MB ÷ 1 GB = 10,800 GB-s/day against a documented 13,000 GB-s/day free allocation.
  Both terms are cited; the multiplication is an estimate, and it ignores hibernation nuances (an
  always-open **outbound** socket is documented as keeping a DO in memory, which is why hibernation
  does not apply here).
- **I did not deploy, build, test or run any server.** No `npm run build`, no `npm test`,
  `no wrangler dev`, no deploy. `worker/wrangler.toml` was read, not executed, and it declares no
  Durable Objects binding — that is a statement about the file, not about what the deployed account
  has.
- **I did not exercise any map render.** The `plane` and `ferry` glyphs were read in source; no canvas
  pixels were sampled, and the proposed `vessel` glyph does not exist.
- **Cross-source aircraft counts are not comparable, and I did not treat them as such.** adsb.lol `39`,
  adsb.fi `32` and OpenSky `22–26` were observed within the same hour, but the ADS-B feeds were queried
  over a **100 nm radius (≈185 km)** centred on 22.32/114.17 while OpenSky was queried over the **HK
  bbox (≈57 × 72 km)**. The geometries differ by roughly an order of area, so no density or accuracy
  conclusion is drawn from these numbers.

**Repo-reading scope.** I read `AGENTS.md`, `TECH_SPEC.md` §3.5 and the aviation/marine rows,
`docs/SOURCE_COVERAGE_REVIEW.md`, the `RAIL_LAYERS` block and the `aircraft` QA path in
`web/src/main.ts`, `adapters.ts` (`adsb_*`), `parsers.ts` (`parseAdsb`, `adsbStatus`,
`aircraftToGeoJson`), `data/layers.json`, `data/panels.json._withdrawn_panels`, `symbols.ts`
(`GLYPHS`), `worker/src/index.js` limits, `worker/src/whitelist.generated.js` and
`worker/wrangler.toml`. **I did not read the whole of `TECH_SPEC.md`, `AGENTS.md`'s remaining
pitfalls, `COST.md` or `SECURITY.md`**; a constraint in an unread section could bear on this
assessment. Nothing outside this file was modified.
