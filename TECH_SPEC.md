# Technical Specification

**Project:** HK City Monitor — a real-time situational-awareness dashboard for Hong Kong
**Licence:** AGPL-3.0-only
**Status:** v0.2, live

This document specifies what the project is, how it is built, and the rules a change must satisfy.
The catalogue of individual data sources — endpoint, publisher, update cadence, authentication,
licence and last probe result — is generated in [SOURCES.md](SOURCES.md) and is not duplicated here.

## 1. Purpose and principles

> Data breadth, openness and publicness — this is what OSINT exists to advance.

- **Breadth.** If a source is free, public and filterable to Hong Kong, it is a candidate. The test
  is not "is it useful" but "is it real data".
- **Openness.** Every source is documented in this repository with its endpoint, cadence, key
  requirement and licence. There are no hidden sources.
- **Publicness.** Every displayed figure links back to its publisher, so it can be verified
  independently rather than trusted.
- **Boundary.** "Open" applies to *data*. The project publishes no unverified allegations about
  individuals, performs no person-tracking and stores no personal data.

## 2. Scope and non-goals

**In scope.** A single map and panel set consolidating live imagery, weather, transport, border,
aviation, marine, civic and market data — Hong Kong data, or global data filtered to the Hong Kong
bounding box.

**Out of scope.**

- The project is not part of, and is not affiliated with, any government system. It does not use
  the name 「AI城市大腦」, which is an official programme, as a product name.
- No ingestion of non-public data (internal departmental sensors, private back-ends).
- No unverified inference scores. Panels display traceable raw observations only.

## 3. Key decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Reference architecture follows `koala73/worldmonitor`, with a matching stack (Vite, TypeScript, MapLibre, deck.gl). | That codebase already emits multiple variants from one tree, so a Hong Kong variant is a supported path; layers, panels, i18n and the desktop shell are reusable. |
| D2 | The product uses its own brand, with a plain "Based on World Monitor" credit. | The AGPL permits reuse of the code, but the trademark policy requires a distinct brand and a factual attribution, with no implied official association. |
| D3 | The MVP has no backend of its own: key-free sources are fetched directly by the browser. | Hong Kong's official sources are key-free and hotlinkable, so the Redis layer that the reference architecture needs is unnecessary here. |
| D4 | The front end is a static bundle, published to Cloudflare Pages (or any static host). | Pages serves the shopfront; a host is only required for anything that must stay resident — live collectors, scheduled jobs. |
| D5 | Sources without CORS are reached through the Worker proxy, not through application logic. | A proxy adds the missing headers and keeps any future credential server-side; no application server is required. |

## 4. Architecture

```
  Browser  ──►  Static bundle (Cloudflare Pages)
                MapLibre + deck.gl, panels, verticals
                     │
      ┌──────────────┼──────────────────────────────┐
      │              │                              │
 Direct fetch   Edge proxy (Worker)          Static live data
 (publisher     (no ACAO header;             (high-frequency feeds,
  sends ACAO:*)  allow-list + rate limit)     pre-published as JSON)
      │              │                              │
      ▼              ▼                              ▼
  Gov / inst.    Gov / inst.                  Raw branch / static host
  APIs           APIs
```

**Contract.** Collectors emit static JSON and the front end only reads JSON. Adding a data source
means adding one collector and one panel; the core rendering logic is unchanged. Core logic is
decoupled from individual adapters, so a new source is an adapter, not a refactor.

## 5. Data-source model

### 5.1 Registry

`sources.json` is the single source of truth. Each entry declares, at minimum:

`id`, `group`, `name` / `name_en`, `type`, `url`, `auth`, `cadence`, `kind`, `fetch`
(`browser` | `proxy` | `collector`), `cors_note`, `cost`, `license`, and free-text `notes`
carrying per-source integration gotchas.

Nothing is hard-coded in the application; the registry drives the proxy allow-list, the source
catalogue and the attribution list.

### 5.2 Probing

`scripts/probe_sources.py` issues a real HTTP request against every declared source and regenerates
two artefacts:

- `SOURCES.md` — the human-readable catalogue: status, cadence, authentication, response shape and
  integration notes.
- `data/sources_report.json` — machine-readable results for the application and CI.

Status is recorded as ok / pending / failed. A source is documented as working only after a live
probe returns the expected payload.

### 5.3 Attribution

`scripts/build_attribution.py` generates `ATTRIBUTION.md` from `sources.json`. Attribution is a
fact about each source, and the registry is where a source is declared, so a hand-maintained list
would drift the moment a source is added — and for HKSAR open data, drift is a licence breach, not
a cosmetic one. Both generated files carry a "do not edit by hand" header.

### 5.4 Fetch strategy

| Strategy | When | Cost |
|---|---|---|
| Direct browser fetch | Publisher sends a permissive `Access-Control-Allow-Origin`. | None. |
| Edge proxy | Publisher sends no CORS header, or a key is required. | Counts against the daily Worker allowance. |
| Scheduled collector | The feed is large, changes frequently, or requires a persistent connection. | Runs on the collector host and publishes static JSON. |

## 6. Panels and verticals

Data is presented through **panels** — a single readout with a source footer — arranged into
**verticals**, which are scenario-specific preset groupings (for example, a typhoon view). A
vertical is a UI-layer arrangement over the same data, not a separate data set.

Each panel must show the publisher name, a link to the source, the observation time and the update
cadence, and must define a stale state. A panel that cannot load displays an explicit error state;
it never renders an empty box or stale data presented as current.

## 7. Source onboarding requirements

Before a source is displayed:

1. Probe it for real; record HTTP status, size and update timestamp.
2. Surface, at panel level: source name, source link, observation time and cadence.
3. Implement stale and error states. Never crash and never display fabricated data.
4. Degrade visually past the freshness threshold rather than presenting stale data as live.
5. For sources with limited coverage (community ADS-B, AIS, sensor networks), **measure coverage
   before building the layer**. A layer that is 90% empty is indistinguishable from "there is
   nothing there" — both are misrepresentations.
6. Do not republish media content without a licence; RSS feeds are surfaced as headline plus link.

## 8. Verification and conventions

- **Verify against the real source.** A source is marked working only after a live probe.
- **Verify the UI in the DOM, not from a screenshot.** Browser checks assert on rendered DOM state.
- **Guard the request budget.** Cold-load Worker request count is asserted against a fixed budget
  in CI, and the check reports per-target counts so a regression points at a specific source.
- **Do not infer availability from search.** A keyword search over a data catalogue answers "is
  this indexed", not "does this exist"; availability is established from the full catalogue or from
  a direct probe.

## 9. Roadmap

- **v0.1 (delivered).** Static map, Transport Department and Observatory cameras, weather warnings,
  market panels, camera wall, live streams.
- **v0.2 (delivered).** Design-system rewrite, full-screen map with floating panels, focus drawer,
  staleness system, clustering, keyboard control.
- **v0.3.** Global free layers: aircraft (community ADS-B), earthquakes (USGS), natural events
  (NASA EONET), traffic speed, special traffic news, carpark vacancy, bus/minibus/ferry ETA, AQHI,
  radar and satellite imagery.
- **v0.3.5.** Civic services: border wait times, A&E waiting times, water-suspension notices, LCSD
  bookable sessions, AED locations, cross-border ferry arrivals.
- **v0.4.** Persistent-connection collectors: AIS vessel tracking (subject to a measured coverage
  test) and an event NLP layer.
- **v0.5.** 3D and variants: globe ↔ city view, CSDI 3D buildings, timeline scrubber, thematic
  variants (transport / weather / market).
- **v1.0 (vision).** Platform capabilities: programmatic access (MCP/REST API for agents), a desktop
  shell, the full variant set and an offline snapshot mode.

## 10. Legal and ethical boundaries

- **Licence.** AGPL-3.0-only. Modifications must remain open source under the same licence.
- **Trademark.** The World Monitor name and logo are not used as the primary brand, and no official
  association is implied. The name 「AI城市大腦」 is likewise not used.
- **Attribution.** Mandatory on the map face and in every panel footer. Weather warnings defer to
  the Observatory's official publication.
- **Openness is not accusation.** No unverified allegations about individuals, no person-tracking,
  no collection of personal data and no user-uploaded photographs. Any crowd-sourced submission
  goes only to a private inbox under manual review, with no automatic publication.
- **Official sources take precedence.** Where individuals are involved (missing persons, crime
  prevention), the project mirrors official announcements only, as headline plus link.

## 11. Open items

Tracked by `scripts/probe_sources.py`:

- AIS vessel coverage measurement before the layer is built (a free key is required).
- Verification of the remaining transport and airport APIs that require free registration.
- A public-transport fare converter (the source is published as large `.mdb` files).
- A slimming script for the large leisure-activity feed.
- Trend and event layers built from the official RSS backbone.
