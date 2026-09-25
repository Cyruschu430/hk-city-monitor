// windgrid.ts — the sampling grid for the wind-flow layer.
//
// WHY A GRID AT ALL. HK City Monitor already had a wind layer, but it drew
// station BARBS: ~30 real observations, each a small arrow at the station that
// measured it. That answers "what is the wind at Cheung Chau" and does not answer
// "where is the wind going", which is what a flow animation is for. A particle
// field needs a value EVERYWHERE, and HKO publishes wind as stations, not as a
// field — so the field has to come from a model.
//
// THE HONEST DISTINCTION, and the reason both stay available:
//   · station barbs  = OBSERVED at a named instrument (weather_stations layer)
//   · this grid      = MODELLED by Open-Meteo, interpolated to a lattice
// They are different claims and the legend says so. A flow animation drawn from
// 30 station readings would look authoritative and be invented — interpolation
// across 100km of water is exactly the sort of confident guess this project
// refuses.
//
// WHY OPEN-METEO. Already registered (`open_meteo`, keyless, CC BY 4.0, ACAO=*),
// and it is the only registered source that returns a lattice rather than a
// point. MEASURED 2026-09-25: 352 points in ONE request, 144KB, ~0.9s, every
// point populated (speed 4.1-18.4 km/h, direction 37-68° on the sample day).
//
// IT RATE-LIMITS. Two of my own probe bursts returned HTTP 429, so a per-browser
// fetch of 144KB would break for real users on a busy day. The layer therefore
// goes through the Worker (`fetch: "proxy"`), whose 60s edge cache means one
// upstream request serves every visitor — the same reasoning as every other
// proxied source, and the reason this is not a `browser` fetch like its
// point-forecast sibling.

/** [west, south, east, north] — Hong Kong plus a margin, so particles do not
 *  die in a visible line at the edge of the frame. */
export const WIND_BOUNDS: [number, number, number, number] = [113.80, 22.13, 114.48, 22.60];

/** Lattice resolution. 22x16 = 352 samples over ~68km x ~52km is ~3km spacing —
 *  finer than the model's own grid, so a denser request would buy interpolated
 *  detail that does not exist. */
export const WIND_NX = 22;
export const WIND_NY = 16;

/** The lattice as two comma-separated strings, in row-major order (the order
 *  Open-Meteo returns: all longitudes for the first latitude, then the next).
 *
 *  The order matters and is NOT obvious: the response array is flat, so the
 *  consumer must re-associate each element with its own `latitude`/`longitude`
 *  fields rather than by index. `windPoints()` below does that, and this function
 *  exists only to build the request. */
export function windLattice(): { lats: string; lons: string; count: number } {
  const lats: string[] = [];
  const lons: string[] = [];
  for (let y = 0; y < WIND_NY; y++) {
    for (let x = 0; x < WIND_NX; x++) {
      lats.push((WIND_BOUNDS[1] + ((WIND_BOUNDS[3] - WIND_BOUNDS[1]) * y) / (WIND_NY - 1)).toFixed(4));
      lons.push((WIND_BOUNDS[0] + ((WIND_BOUNDS[2] - WIND_BOUNDS[0]) * x) / (WIND_NX - 1)).toFixed(4));
    }
  }
  return { lats: lats.join(","), lons: lons.join(","), count: WIND_NX * WIND_NY };
}

/** One modelled sample. `speed` in km/h, `direction` as the meteorological
 *  convention (the direction the wind blows FROM, degrees clockwise from north)
 *  — which is what Open-Meteo returns and what the barb glyphs already use, so
 *  the two layers cannot disagree about what a number means. */
export interface WindSample {
  lat: number;
  lon: number;
  speed: number;
  direction: number;
}

export interface WindField {
  samples: WindSample[];
  /** The model's own timestamp for the reading, not when we fetched it. */
  observedAt: Date | null;
  minSpeed: number;
  maxSpeed: number;
}

/** Turn an Open-Meteo multi-point response into samples.
 *
 *  Shape (measured): an ARRAY of per-point objects — not one object — each with
 *  `latitude`, `longitude` and `current.wind_speed_10m` / `current.wind_direction_10m`.
 *  A single-point request returns the object bare, so both are accepted; getting
 *  this wrong would silently produce a one-point "field" and an empty animation. */
export function parseWindField(json: unknown): WindField {
  const arr = Array.isArray(json) ? json : [json];
  const samples: WindSample[] = [];
  let observedAt: Date | null = null;
  for (const raw of arr) {
    const p = raw as {
      latitude?: number;
      longitude?: number;
      current?: { time?: string; wind_speed_10m?: number; wind_direction_10m?: number };
    };
    const lat = Number(p?.latitude);
    const lon = Number(p?.longitude);
    const speed = Number(p?.current?.wind_speed_10m);
    const direction = Number(p?.current?.wind_direction_10m);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!Number.isFinite(speed) || !Number.isFinite(direction)) continue;
    samples.push({ lat, lon, speed, direction });
    const t = p?.current?.time;
    if (t && !observedAt) {
      // Open-Meteo returns local time without an offset ("2026-09-25T08:30") and
      // the request pins timezone=Asia/Hong_Kong, so parse it as +08:00 rather
      // than letting the browser guess a zone.
      const d = new Date(/[+Z]/.test(t.slice(-6)) ? t : `${t}:00+08:00`);
      if (!Number.isNaN(d.getTime())) observedAt = d;
    }
  }
  const speeds = samples.map((s) => s.speed);
  return {
    samples,
    observedAt,
    minSpeed: speeds.length ? Math.min(...speeds) : 0,
    maxSpeed: speeds.length ? Math.max(...speeds) : 0,
  };
}
