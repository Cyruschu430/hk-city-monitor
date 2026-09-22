// symbols.ts — per-layer map symbology (the "camera layer uses camera symbols"
// request). MapLibre draws icons from registered images; there is no keyless
// sprite sheet for HK government layers, so each glyph is drawn ONCE into an
// offscreen canvas at runtime and registered with map.addImage().
//
// Everything is drawn from primitives (no icon font, no emoji, no binary asset
// in the repo) and tinted with the project's signal colours, so a camera reads
// as a camera, a weather station as a station, an aircraft as a plane — instead
// of "another cyan circle".

import type maplibregl from "maplibre-gl";
import { BARB_BUCKETS } from "../lib/parsers.ts";

export type GlyphId =
  | "cam-td"
  | "cam-hko"
  | "station-wind"
  | "aqhi"
  | "plane"
  | "ferry"
  | "water";

interface GlyphSpec {
  /** draw the glyph centred in a size×size box */
  draw: (ctx: CanvasRenderingContext2D, size: number) => void;
  /** solid agency-coloured disc behind the glyph — high contrast at any zoom,
      and the colour still encodes which agency the symbol belongs to */
  disc?: string;
}

const S = 44; // icon box; map icons are drawn at 44px and scaled by icon-size

/** Ink for glyphs that sit on a coloured disc (dark reads best on cyan/violet). */
function stroke(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "rgba(6,10,18,.92)";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** CCTV camera: a body wedge on a bracket, lens pointing right. */
function drawCamera(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // bracket
  ctx.beginPath();
  ctx.moveTo(-9, 9);
  ctx.lineTo(-9, 3);
  ctx.moveTo(-13, 10.5);
  ctx.lineTo(-5, 10.5);
  ctx.stroke();
  // body
  ctx.beginPath();
  ctx.moveTo(-9, 3);
  ctx.lineTo(2, -3);
  ctx.lineTo(4, 3);
  ctx.lineTo(-9, 9);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fill();
  ctx.stroke();
  // lens
  ctx.beginPath();
  ctx.moveTo(4, 3);
  ctx.lineTo(11, -1);
  ctx.lineTo(11, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Weather station: a mast with a wind vane / cup on top. */
function drawStation(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // mast
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, -4);
  ctx.stroke();
  // cups
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(0, -8);
  ctx.lineTo(8, -4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-9, -3.5, 2.2, 0, Math.PI * 2);
  ctx.arc(9, -3.5, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fill();
  ctx.stroke();
  // base
  ctx.beginPath();
  ctx.moveTo(-6, 12);
  ctx.lineTo(6, 12);
  ctx.stroke();
  ctx.restore();
}

/** AQHI air-quality station: a stack with a puff. */
function drawAqhi(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // stack
  ctx.beginPath();
  ctx.moveTo(-3, 12);
  ctx.lineTo(-3, -2);
  ctx.lineTo(3, -2);
  ctx.lineTo(3, 12);
  ctx.stroke();
  // puff
  ctx.beginPath();
  ctx.arc(6, -7, 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Aircraft: simple top-down plane, nose up (rotated per-track by the layer).
 *
 * Drawn at full box size and in a warm off-white: aircraft are the only layer
 * that moves, and against the dark basemap a pure-white speck at 44px scaled
 * down to 0.32 is easy to lose. The warmth also separates "in the air" from
 * the cool cyan/violet used by everything on the ground. The dark outline is
 * what keeps it legible once the halo disc sits behind it. */
function drawPlane(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(0, -13); // nose
  ctx.lineTo(2.6, -3);
  ctx.lineTo(12, 2); // right wing
  ctx.lineTo(12, 4.6);
  ctx.lineTo(2.6, 2.6);
  ctx.lineTo(2.2, 8);
  ctx.lineTo(5.4, 11); // right tail
  ctx.lineTo(5.4, 12.6);
  ctx.lineTo(0.8, 11.6);
  ctx.lineTo(0, 13); // tail tip
  ctx.lineTo(-0.8, 11.6);
  ctx.lineTo(-5.4, 12.6);
  ctx.lineTo(-5.4, 11);
  ctx.lineTo(-2.2, 8);
  ctx.lineTo(-2.6, 2.6);
  ctx.lineTo(-12, 4.6);
  ctx.lineTo(-12, 2);
  ctx.lineTo(-2.6, -3);
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Ferry: a hull seen from above. */
function drawFerry(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(6, 2);
  ctx.lineTo(4.5, 11);
  ctx.lineTo(-4.5, 11);
  ctx.lineTo(-6, 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // cabin
  ctx.beginPath();
  ctx.rect(-2.6, -3, 5.2, 6);
  ctx.fillStyle = "rgba(5,7,13,.85)";
  ctx.fill();
  ctx.restore();
}

/** Water droplet for suspension notices. */
function drawWater(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.bezierCurveTo(7, -2, 9, 3, 9, 6);
  ctx.arc(0, 6, 9, 0, Math.PI);
  ctx.bezierCurveTo(-9, 3, -7, -2, 0, -12);
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

const GLYPHS: Record<GlyphId, GlyphSpec> = {
  "cam-td": { draw: drawCamera, disc: "#22d3ee" },
  "cam-hko": { draw: drawStation, disc: "#a855f7" },
  "station-wind": { draw: drawStation, disc: "#38bdf8" },
  aqhi: { draw: drawAqhi, disc: "#34d399" },
  plane: { draw: drawPlane },
  ferry: { draw: drawFerry, disc: "#38bdf8" },
  water: { draw: drawWater, disc: "#22d3ee" },
};

// --- wind barbs ------------------------------------------------------------------
// A wind barb is the standard meteorological way to show a wind vector: a shaft
// pointing INTO the wind, with tail feathers encoding speed (half feather = 5
// kt, full = 10 kt, pennant = 50 kt). It is used here instead of particles
// because it needs NO new runtime dependency — it is one more registered image
// plus a per-feature icon-rotate, exactly like the aircraft plane.
//
// Speed is quantised into buckets and one image is registered per bucket. That
// is cheap (a handful of images) and it keeps the speed readable at a glance
// without a legend lookup. The bucket table lives in parsers.ts because the
// per-feature `barbId` property is written THERE, and the data layer must stay
// importable from Node tests (this file touches `document`).

/** Draw one barb: shaft + feathers on the tail, drawn pointing NORTH (up); the
 *  map layer rotates it by the wind direction. */
function drawBarb(ctx: CanvasRenderingContext2D, size: number, full: number, half: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  // Drawn dark-on-light first, then light-on-dark over it: a plain white stroke
  // washed out against the dark basemap (caught in a screenshot review), and the
  // barbs need to read as countable feathers, not as smudges.
  const stroke = (color: string, width: number, inset: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Shaft: from the tail (bottom) to the station point (centre).
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.lineTo(0, -2);
    ctx.stroke();
    let y = 13;
    const step = 4.2;
    for (let i = 0; i < full; i++) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(-8 - inset, y - 5 - inset);
      ctx.stroke();
      y -= step;
    }
    for (let i = 0; i < half; i++) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(-4.5 - inset, y - 3 - inset * 0.6);
      ctx.stroke();
      y -= step;
    }
  };
  stroke("rgba(6,10,18,.95)", 5.2, 0.9); // dark casing
  stroke("rgba(240,248,255,.98)", 2.6, 0); // bright barb
  // Station dot at the point of observation.
  ctx.beginPath();
  ctx.arc(0, -2, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(240,248,255,.98)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(6,10,18,.95)";
  ctx.stroke();
  ctx.restore();
}

/** Register one image per speed bucket. Kept out of GLYPHS because these are
 *  not fixed glyphs — there is a family of them, one per bucket. */
export function registerBarbs(map: maplibregl.Map): void {
  for (const b of BARB_BUCKETS) {    const id = `barb-${b.id}`;
    if (map.hasImage(id)) continue;
    const scale = 2;
    const px = S * scale;
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(scale, scale);
    drawBarb(ctx, S, b.full, b.half);
    map.addImage(id, ctx.getImageData(0, 0, px, px), { pixelRatio: 2, sdf: false });
  }
}

/** Render one glyph to an ImageData at the canonical icon size. */
function renderGlyph(id: GlyphId, scale = 2): ImageData {
  const spec = GLYPHS[id];
  const px = S * scale;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable for map glyphs");
  ctx.scale(scale, scale);
  if (spec.disc) {
    // Solid agency-coloured disc + thin dark edge: the symbol stays legible on
    // both the dark topo and the bright aerial basemap, and the colour encodes
    // the agency (cyan = 運輸署, violet = 天文台).
    const c = S / 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 3, 0, Math.PI * 2);
    ctx.fillStyle = spec.disc;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(6,10,18,.9)";
    ctx.stroke();
    spec.draw(ctx, S * 0.82);
  } else {
    spec.draw(ctx, S);
  }
  return ctx.getImageData(0, 0, px, px);
}

/** Register every glyph once. Safe to call repeatedly (addImage is idempotent
    per id in MapLibre only if the id is absent — so guard on hasImage). */
export function registerGlyphs(map: maplibregl.Map): void {
  for (const id of Object.keys(GLYPHS) as GlyphId[]) {
    if (map.hasImage(id)) continue;
    map.addImage(id, renderGlyph(id), { pixelRatio: 2, sdf: false });
  }
}

export const GLYPH_SIZE = S;

/** Draw a glyph into an existing canvas (the map legend uses this so the
    legend can never drift from the symbol actually drawn on the map). */
export function drawGlyphInto(canvas: HTMLCanvasElement, id: GlyphId, size = 16): void {
  const spec = GLYPHS[id];
  if (!spec) return;
  const scale = 2;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // The glyphs are authored on a 44px grid; the legend draws them small.
  const k = (size * scale) / S;
  ctx.scale(k, k);
  if (spec.disc) {
    const c = S / 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 3, 0, Math.PI * 2);
    ctx.fillStyle = spec.disc;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(6,10,18,.9)";
    ctx.stroke();
    spec.draw(ctx, S * 0.82);
  } else {
    spec.draw(ctx, S);
  }
}
