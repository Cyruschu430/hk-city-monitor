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
  /** halo ring drawn behind so the icon survives a busy basemap */
  ring?: { color: string; width: number };
}

const S = 44; // icon box; map icons are drawn at 44px and scaled by icon-size

function stroke(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#e9f2ff";
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

/** Aircraft: simple top-down plane, nose up (rotated per-track later). */
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
  "cam-td": { draw: drawCamera, ring: { color: "#22d3ee", width: 2 } },
  "cam-hko": { draw: drawStation, ring: { color: "#a855f7", width: 2 } },
  "station-wind": { draw: drawStation, ring: { color: "#38bdf8", width: 2 } },
  aqhi: { draw: drawAqhi, ring: { color: "#34d399", width: 2 } },
  plane: { draw: drawPlane, ring: { color: "#fbbf24", width: 2 } },
  ferry: { draw: drawFerry, ring: { color: "#38bdf8", width: 2 } },
  water: { draw: drawWater, ring: { color: "#22d3ee", width: 2 } },
};

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
  if (spec.ring) {
    // halo: a filled dark disc + coloured ring so the icon stays legible on
    // both the dark topo and the bright aerial basemap
    const c = S / 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5,7,13,.78)";
    ctx.fill();
    ctx.lineWidth = spec.ring.width;
    ctx.strokeStyle = spec.ring.color;
    ctx.stroke();
  }
  spec.draw(ctx, S);
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
