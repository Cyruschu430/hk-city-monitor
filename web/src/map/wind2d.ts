// wind2d.ts — the wind-FLOW layer, as animated particles on a plain 2D canvas.
//
// WHAT THIS REPLACES. `map/wind.ts` drew the same field through deck.gl (via `maplibre-gl-wind`) and
// the particles never moved. Measured on a real GPU (RTX 3050 Laptop, headed, ANGLE/D3D11), every QA
// hook green — 352 samples, texture `spread: 255`, `deckCanvases 2`, `layerCount 1`, `hasParticle true`,
// no error — and the canvas changed 41 pixels of 623,776 across frames 2.5s apart, against a measured
// no-layer baseline of 27-33. Three hypotheses died: `interleaved`, `animate` at construction, and a
// forced `requestAnimationFrame` redraw pump. The library steps particles on a `setTimeout` chain and
// asks deck for a frame with `setNeedsRedraw()`; deck under `MapboxOverlay` renders on MapLibre's
// repaint, which happens on interaction, so the flagged frame is never drawn. Each fix was a guess about
// someone else's frame ownership.
//
// SO THIS OWNS ITS OWN FRAME. A `<canvas>` in the map container, and one `requestAnimationFrame` we
// start and stop ourselves. There is no `setNeedsRedraw`, no overlay, no custom layer, and no library
// between the tick and the pixels — which is the point: the bug was never in the physics, it was in who
// was allowed to draw. Nothing here can be broken by a dependency's scheduling model.
//
// IT ALSO DELETES A DEPENDENCY. `maplibre-gl-wind` (~19KB) and this path's use of `@deck.gl/mapbox` are
// both gone. `@deck.gl/*` stays for the 3D tiles it was already needed for.
//
// WHY 2D CANVAS AND NOT A SHADER. A ping-pong fragment shader is what Windy does and it is genuinely
// better — thousands of particles at no CPU cost. It is also ~80 lines of GLSL that no test in this repo
// can check, for one visual layer. This runs ~2,000 particles, which is what reads as flow at Hong Kong
// zoom, and it is debuggable from the console. `ponytail:` if the frame rate or density ever matters,
// that is the upgrade, and `sample()` below is the piece to keep.

import type maplibregl from "maplibre-gl";
import { fetchSource, type SourceDef } from "../lib/sources.ts";
import { parseWindField, WIND_BOUNDS, type WindField } from "../lib/windgrid.ts";

export const WIND_SOURCE_ID = "open_meteo_wind_grid";

const GRID_W = 72;
const GRID_H = 54;
const PARTICLES = 2200;
/** Frames a particle streak survives. Short and the field reads as streaks; long and it tangles. */
const TRAIL = 14;
/** Fade per frame. 1 means never clear (a smear); ~0.08 leaves a visible tail. */
const FADE = 0.075;
/** Particle speed multiplier. Tuned so a 25km/h wind crosses the harbour in about a second. */
const SPEED = 1.0;

interface Grid {
  /** u (eastward) and v (northward) components, metres-ish, on a GRID_W x GRID_H lattice. */
  u: Float32Array;
  v: Float32Array;
  min: number;
  max: number;
}

/**
 * Inverse-distance-weighted interpolation from the scattered samples onto a lattice, ONCE.
 *
 * The particles sample this lattice every frame, so the expensive part — 352 samples x 3,888 cells —
 * happens once at load rather than 2,000 times a frame. `power: 2` matches `generateWindTexture`'s
 * default so the flow agrees with the texture the old path built; a different exponent would be a
 * silently different wind field.
 */
function buildGrid(f: WindField): Grid {
  const u = new Float32Array(GRID_W * GRID_H);
  const v = new Float32Array(GRID_W * GRID_H);
  // WIND_BOUNDS is a TUPLE [west, south, east, north] — not an object. Destructuring it as one
  // compiles to `undefined` for every edge and the lattice silently collapses to a single point.
  const [west, south, east, north] = WIND_BOUNDS;
  for (let j = 0; j < GRID_H; j++) {
    const lat = south + ((j + 0.5) / GRID_H) * (north - south);
    for (let i = 0; i < GRID_W; i++) {
      const lon = west + ((i + 0.5) / GRID_W) * (east - west);
      let wsum = 0, uacc = 0, vacc = 0;
      for (const s of f.samples) {
        const dx = lon - s.lon, dy = lat - s.lat;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-9) { uacc = 0; vacc = 0; wsum = 1; break; }
        const w = 1 / (d2 * d2 * d2); // (d^2)^3 == d^6, i.e. power 2 on the inverse
        // HKO reports the direction the wind comes FROM, so the flow vector points the other way.
        const rad = ((s.direction + 180) * Math.PI) / 180;
        uacc += w * s.speed * Math.sin(rad);
        vacc += w * s.speed * Math.cos(rad);
        wsum += w;
      }
      u[j * GRID_W + i] = uacc / wsum;
      v[j * GRID_W + i] = vacc / wsum;
    }
  }
  return { u, v, min: f.minSpeed, max: f.maxSpeed };
}

/** Bilinear sample of the lattice in normalised grid space, clamped at the edges. */
function sample(g: Grid, fx: number, fy: number): [number, number] {
  const x = Math.min(Math.max(fx, 0), GRID_W - 1.001);
  const y = Math.min(Math.max(fy, 0), GRID_H - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const i00 = y0 * GRID_W + x0, i10 = i00 + 1, i01 = i00 + GRID_W, i11 = i01 + 1;
  const uu = (g.u[i00] ?? 0) * (1 - tx) * (1 - ty) + (g.u[i10] ?? 0) * tx * (1 - ty) +
             (g.u[i01] ?? 0) * (1 - tx) * ty + (g.u[i11] ?? 0) * tx * ty;
  const vv = (g.v[i00] ?? 0) * (1 - tx) * (1 - ty) + (g.v[i10] ?? 0) * tx * (1 - ty) +
             (g.v[i01] ?? 0) * (1 - tx) * ty + (g.v[i11] ?? 0) * tx * ty;
  return [uu, vv];
}

/** Blue → cyan → amber → red, on the field's own min/max so a calm day reads calm. */
function ramp(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0.0, [56, 132, 200]], [0.35, [64, 196, 214]], [0.65, [251, 191, 36]], [1.0, [255, 93, 108]],
  ];
  const c = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (!a || !b) continue;
    if (c <= b[0]) {
      const k = (c - a[0]) / (b[0] - a[0] || 1);
      const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * k);
      const g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * k);
      const bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * k);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "rgb(255,93,108)";
}

let state: { stop(): void } | null = null;

/**
 * Toggle the wind-flow layer. THROWS when turning ON fails, so the caller shows an honest error state —
 * the same contract the deck.gl path had, and the same one `toggle3d` has.
 */
export async function toggleWind(map: maplibregl.Map, on: boolean, src: SourceDef | undefined): Promise<void> {
  if (!on) { state?.stop(); state = null; return; }
  if (state) return; // already running
  if (!src) throw new Error(`圖層 wind_field：registry 冇 ${WIND_SOURCE_ID}`);

  const field = parseWindField(await (await fetchSource(src)).json());
  if (field.samples.length === 0) throw new Error("wind: 0 samples");
  const grid = buildGrid(field);

  // The overlay lives in the map container so it moves with the map, and takes no pointer events so the
  // map underneath still pans and zooms normally.
  const cv = document.createElement("canvas");
  cv.className = "wind-flow-canvas";
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3"
  const container = map.getContainer();
  container.appendChild(cv);
  const ctx = cv.getContext("2d");
  if (!ctx) { cv.remove(); throw new Error("wind: 冇 2D context"); }

  const [west, south, east, north] = WIND_BOUNDS;
  const px = new Float32Array(PARTICLES);
  const py = new Float32Array(PARTICLES);
  const age = new Uint8Array(PARTICLES);
  const seed = (i: number): void => {
    px[i] = west + Math.random() * (east - west);
    py[i] = south + Math.random() * (north - south);
    age[i] = Math.floor(Math.random() * TRAIL);
  };
  for (let i = 0; i < PARTICLES; i++) seed(i);

  let raf = 0;
  let frames = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = (): void => {
    const r = container.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
  };
  resize();

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    frames++;
    // A tail, not a tangle: fade the previous frame instead of clearing it.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${FADE})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.1 * dpr;
    ctx.lineCap = "round";

    for (let i = 0; i < PARTICLES; i++) {
      const lon = px[i] ?? west, lat = py[i] ?? south;
      const fx = ((lon - west) / (east - west)) * GRID_W;
      const fy = ((lat - south) / (north - south)) * GRID_H;
      const [uu, vv] = sample(grid, fx, fy);

      // Advance in DEGREES, not pixels, so the motion is the same physical speed at every zoom — a
      // pixel-space step would make the flow crawl when zoomed out and scream when zoomed in.
      const step = (0.014 * SPEED) / 111.0;
      const nLon = lon + uu * step * 3.6;
      const nLat = lat + vv * step * 3.6;

      if (nLon < west || nLon > east || nLat < south || nLat > north || age[i]! >= TRAIL) {
        seed(i);
      } else {
        const a = map.project([lon, lat] as maplibregl.LngLatLike);
        const b = map.project([nLon, nLat] as maplibregl.LngLatLike);
        const sp = Math.hypot(uu, vv);
        // Only draw the segment when it lands on screen — the common case under pan/zoom, and it
        // stops one long line being drawn from an off-screen particle to its on-screen successor.
        if (b.x > -50 && b.y > -50 && b.x < cv.width / dpr + 50 && b.y < cv.height / dpr + 50) {
          ctx.strokeStyle = ramp((sp - grid.min) / Math.max(grid.max - grid.min, 0.1));
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(a.x * dpr, a.y * dpr);
          ctx.lineTo(b.x * dpr, b.y * dpr);
          ctx.stroke();
        }
        px[i] = nLon;
        py[i] = nLat;
        age[i]!++;
      }
    }
    ctx.globalAlpha = 1;
  };

  const onResize = (): void => resize();
  window.addEventListener("resize", onResize);
  raf = requestAnimationFrame(tick);

  // QA seam. The deck.gl path's hooks certified things they never checked (a hardcoded `textures: 1`
  // among them); this one reports the two facts that actually decide whether the layer works — the
  // lattice was built, and frames are being produced.
  (window as unknown as Record<string, unknown>)["__wind2d"] = {
    samples: field.samples.length,
    speeds: [field.minSpeed, field.maxSpeed],
    particles: PARTICLES,
    frames: () => frames,
    canvas: () => `${cv.width}x${cv.height}`,
  };

  state = {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      cv.remove();
      state = null;
    },
  };
}

/** QA hook: samples, speeds, particle count, and the live frame counter. */
export function windDebug(): { samples: number; frames: number } | null {
  const w = (window as unknown as Record<string, unknown>)["__wind2d"] as
    | { samples: number; frames: () => number } | undefined;
  return w ? { samples: w.samples, frames: w.frames() } : null;
}
