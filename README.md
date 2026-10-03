# HK City Monitor

**A real-time situational-awareness dashboard for Hong Kong — one map, many open data sources, no API keys.**

[Live deployment](https://hk-city-monitor.pages.dev) · [Data sources](SOURCES.md) · [Attribution](ATTRIBUTION.md) · [Security](SECURITY.md) · [Self-hosting](SELF_HOSTING.md) · [Technical specification](TECH_SPEC.md)

---

## Overview

HK City Monitor is an open-source, browser-based dashboard that consolidates Hong Kong's public open data into a single live map. Traffic cameras, weather observations, transport schedules, border-crossing wait times, aircraft positions, market indices and civic-service data are rendered onto one MapLibre / deck.gl surface, with every reading traceable to its publisher.

The application is fully static. There is no database, no user account and no API key in the shipped bundle. Sources that a browser cannot read directly — because the publisher sends no permissive `Access-Control-Allow-Origin` header — are routed through a single whitelist-limited Cloudflare Worker proxy.

The goal is a *verifiable* picture of the territory: a reader should be able to click any number and reach the government or institutional page it came from.

## Objectives

The project is built around a single principle: **OSINT depends on breadth, openness and publicness.**

- **Breadth** — if a free, public, Hong Kong-filterable source exists, it is integrated. The question is never "is this useful" but "is this real data".
- **Openness** — every source is documented in this repository with its endpoint, update cadence, key requirement and licence. There are no hidden sources.
- **Publicness** — every figure links back to its origin, so a reader can verify it independently instead of trusting the dashboard.
- **A hard boundary** — "open" applies to *data*. The project publishes no unverified allegations about individuals, performs no person-tracking and stores no personal data. See [SECURITY.md](SECURITY.md).

### Non-goals

- HK City Monitor is **not** part of any government system and is **not** affiliated with the HKSAR Government. It does not use the name 「AI城市大腦」 (an official programme announced in the 2026 Policy Address) as a product name, to avoid any implication of official status.
- It does not ingest non-public data (internal departmental sensors, private back-ends).
- It does not compute or display unverified inference scores; panels show traceable raw observations only.

## Features

Data is organised into **panels** (individual readouts) that appear in context-specific **verticals** (pre-arranged views for a scenario, such as typhoon mode). The current build ships 24 panels.

**Live imagery**
- Transport Department traffic snapshots (1,013 cameras, ~2-minute cadence)
- Hong Kong Observatory weather cameras (34 stations, ~5-minute cadence)
- Camera wall and embedded television news streams

**Weather and environment**
- Weather warnings, current conditions and the 9-day forecast
- Weather radar and satellite imagery
- Air Quality Health Index (per-station, plus a 24-hour history)
- Rainfall nowcast and tide/radiation/earthquake feeds

**Transport**
- Driving-speed indication and special traffic news
- Carpark vacancy
- Bus ETA (KMB / CTB) and MTR next-train
- Public-transport routes and fares

**Border and civic services**
- Land boundary control-point waiting times (Security Bureau)
- Accident & Emergency waiting times
- Water-suspension notices, LCSD bookable-session availability, AED locations

**Aviation, marine and markets**
- Live aircraft positions (community ADS-B, multiple independent mirrors) and airport flight information
- Vessel arrivals/departures and berth vacancy
- Hong Kong and global market indices

**Spatial base**
- CSDI vector layers, address lookup (ALS) and place-name search
- 3D building models and terrain

## Tech stack

| Layer | Technology |
|---|---|
| Front end | TypeScript, Vite 7 |
| Map rendering | MapLibre GL JS, deck.gl 9 (2D and 3D) |
| Basemap & imagery | Esri ArcGIS Online public services — World Imagery, World Topographic Map, Light Gray Canvas (keyless) |
| Basemap (Hong Kong) | Lands Department topographic and imagery tiles |
| 3D tiles | `@loaders.gl/3d-tiles` |
| Edge proxy | Cloudflare Worker (single, whitelist-limited) |
| Static hosting | Cloudflare Pages |
| Scheduling | GitHub Actions / host cron (optional live collectors) |
| Browser tests | Playwright (Chromium) |

There is deliberately no application server, database or ORM. The only server-side component is the edge proxy, which exists solely to add CORS headers and keep any future credentials out of the client.

## Architecture

```
                    ┌──────────────────────────────────────────┐
  Browser  ───────► │  Static bundle (Cloudflare Pages)        │
                    │  MapLibre + deck.gl, panels, verticals   │
                    └───────────────┬──────────────────────────┘
                                    │
        ┌───────────────────────────┼─────────────────────────────┐
        │                           │                             │
  Direct fetch                Edge proxy (Worker)          Static live data
  (publisher sends            (publisher has no CORS;      (high-frequency feeds
   ACAO: *)                    whitelist + rate limit)      pre-published as JSON)
        │                           │                             │
        ▼                           ▼                             ▼
   Government /               Government /                  GitHub raw branch /
   institutional APIs         institutional APIs            static host
```

**Contract:** collectors always emit static JSON and the front end only ever reads JSON. Adding a data source means adding one collector and one panel; the core rendering logic does not change.

## Repository layout

```
.
├── web/                    Front-end application (TypeScript + Vite)
│   ├── src/
│   │   ├── data/           Panel and vertical definitions
│   │   ├── lib/            Parsers, adapters, formatting, rendering helpers
│   │   ├── map/            Map layers, symbols, popups, 3D overlays
│   │   ├── styles/         Application CSS
│   │   └── ui/             Panel and status-bar components
│   └── test/               Browser checks (Playwright)
├── worker/                 Cloudflare Worker edge proxy (whitelist + rate limit)
├── scripts/                Collectors, builders, probes and validators (Python / Node)
├── data/                   Static snapshots and generated registries
├── docs/                   Project landing page (GitHub Pages)
├── sources.json            Source registry — the single source of truth for data sources
├── SOURCES.md              Generated source catalogue (do not edit by hand)
├── ATTRIBUTION.md          Generated attribution list (do not edit by hand)
├── TECH_SPEC.md            Technical and data-source specification
├── SECURITY.md             Security policy and threat model
└── SELF_HOSTING.md         Deployment guide
```

## Getting started

Requires **Node 22+**.

```bash
git clone https://github.com/Cyruschu430/hk-city-monitor.git
cd hk-city-monitor/web
npm ci
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

This runs the front end against direct-fetch sources only. Around half of the panels load this way; the remainder are proxy-backed and display an explicit error state until the Worker is deployed. See [SELF_HOSTING.md](SELF_HOSTING.md) for the full procedure, including the Worker and the optional live collectors.

## Development workflow

The project follows a spec-driven workflow: sources are validated with a real network request before a panel is built, and a change is not considered complete until it is verified by a runnable check.

```bash
cd web
npm run typecheck        # TypeScript, 0 errors expected
npm run check:all        # 9 checks (needs a preview server on 127.0.0.1:4173)
python3 scripts/validate_config.py
```

Key conventions:

- **Verify against the real source.** A source is marked working only after a live probe returns the expected payload; `scripts/probe_sources.py` regenerates `SOURCES.md` from these results.
- **Verify the UI in the DOM, not from a screenshot.** Browser checks assert on rendered DOM state, because screenshots have previously misreported layout.
- **Guard the request budget.** A cold load is measured against a fixed Worker-request budget so that adding a panel cannot silently exhaust the free-tier quota.
- **Attribute everything.** Attribution is generated from `sources.json`; it is never hand-edited.

## Roadmap

Delivered:

- **v0.1** — static map, Transport Department and Observatory cameras, weather warnings, market panels, camera wall, live streams.
- **v0.2** — design-system rewrite, full-screen map with floating panels, focus drawer, staleness states, clustering, keyboard control.

Planned:

- **v0.3 — global free layers.** Aircraft (community ADS-B), earthquakes (USGS), natural events (NASA EONET), traffic speed, special traffic news, carpark vacancy, bus/minibus/ferry ETA, AQHI, radar and satellite imagery.
- **v0.3.5 — civic services.** Border wait times, A&E waiting times, water-suspension notices, LCSD bookable sessions, AED locations, cross-border ferry arrivals.
- **v0.4 — persistent-connection collectors.** AIS vessel tracking (subject to a measured coverage test), event NLP layer.
- **v0.5 — 3D and variants.** Globe ↔ city view, CSDI 3D buildings, timeline scrubber, thematic variants (transport / weather / market).
- **v1.0 — platform.** Programmatic access (MCP/REST API for agents), desktop shell, full variant set, and an offline snapshot mode.

## Data sources

Every source is declared in [`sources.json`](sources.json) and probed against the live network. The generated catalogue — endpoint, publisher, update cadence, key requirement, licence and last probe result — is in [`SOURCES.md`](SOURCES.md). Publisher attribution obligations are listed in [`ATTRIBUTION.md`](ATTRIBUTION.md).

Sources are predominantly Hong Kong Government open data (data.gov.hk, CSDI) and institutional feeds (the Observatory, the Airport Authority, the Consumer Council), supplemented by community and global open APIs filtered to the Hong Kong bounding box.

## Licensing and attribution

- Source code is licensed under **AGPL-3.0-only**.
- Data remains the property of its publishers; attribution is mandatory and is rendered on the map and in panel footers.
- The project is **not affiliated with, endorsed by, or part of the HKSAR Government**.

## Credits

Created and maintained by Cyrus Chu, a Hong Kong GIS practitioner.

Basemap and imagery are provided by **Esri ArcGIS Online public services** (World Imagery, World Topographic Map and Light Gray Canvas) and by the **Lands Department**. Both are credited on the map face and in the panel footers.

Architecture is inspired by [`koala73/worldmonitor`](https://github.com/koala73/worldmonitor) (AGPL-3.0); this project is an independent Hong Kong implementation.
