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
  | "vessel"
  | "mtr-train"
  | "water"
  // Border control points, one per crossing KIND. The glyph is identical and the
  // DISC carries the kind (land violet / sea cyan / air blue), which is the same
  // split the previous plain circles used — so a reader who learnt the colours
  // keeps them, and now gets a symbol that says "crossing" as well.
  | "cp-land"
  | "cp-sea"
  | "cp-air"
  // Water suspension, split by the thing that actually matters: 食水 (drinking
  // water, the life-safety case, alert red) vs 鹹水 (flushing water, a nuisance,
  // amber). Same drawing, different disc, so the two are never confused at a
  // glance — the rule `drawWaterPoints` already applied with two-tone circles.
  | "no-water"
  | "no-water-salt"
  // Wind flow (modelled particle field).
  | "wind-flow"
  // Rail toggles that are not map layers at all (deck.gl 3D, the raster basemap).
  | "blocks"
  | "aerial"
  // Public defibrillators. A life-safety layer: the ONE thing a passer-by needs is to know a
  // unit is HERE, so the disc is the red of the emergency services rather than the cyan/violet
  // the agency-symbol family uses for "this is a datapoint".
  | "aed"
  // 貯油裝置 (oil storage installations). A tank rather than a generic pin: on this map the
  // difference between an oil installation and every other point layer IS the layer.
  | "oil-tank";

/** AED: the universal defibrillator mark — a heart with a bolt through it. */
function drawAed(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  const k = size / 44;
  ctx.scale(k, k);
  // Heart, as two arcs plus a V — a path rather than an emoji, because the glyph is drawn into a
  // canvas at 44px and a text glyph would depend on the renderer's font.
  ctx.beginPath();
  ctx.moveTo(0, 13);
  ctx.bezierCurveTo(-15, 2, -11, -11, 0, -5);
  ctx.bezierCurveTo(11, -11, 15, 2, 0, 13);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.96)";
  ctx.fill();
  // The bolt, in the disc's own red so it reads as a cut-out rather than an overlay.
  ctx.beginPath();
  ctx.moveTo(2.5, -8);
  ctx.lineTo(-4, 1.5);
  ctx.lineTo(-0.5, 1.5);
  ctx.lineTo(-2.5, 8);
  ctx.lineTo(4.5, -1.5);
  ctx.lineTo(0.8, -1.5);
  ctx.closePath();
  ctx.fillStyle = "#c81e3c";
  ctx.fill();
  ctx.restore();
}

/** 貯油裝置: a vertical storage tank — domed roof, two bands. A path rather than a font glyph
 *  for the same reason as the AED heart: the box is 44px and a text glyph would depend on the
 *  renderer's font. */
function drawOilTank(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.scale(size / 44, size / 44);
  // Body in white, so it holds at 44px on any basemap.
  ctx.beginPath();
  ctx.moveTo(-8, -5);
  ctx.lineTo(-8, 9);
  ctx.quadraticCurveTo(0, 14, 8, 9);
  ctx.lineTo(8, -5);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.96)";
  ctx.fill();
  // Dome and bands in the disc's own colour, so they read as cut-outs rather than overlays.
  ctx.fillStyle = "#c87619";
  ctx.beginPath();
  ctx.moveTo(-10, -5);
  ctx.quadraticCurveTo(0, -18, 10, -5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#c87619";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.moveTo(-8, 5);
  ctx.lineTo(8, 5);
  ctx.stroke();
  ctx.restore();
}

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
  ctx.strokeStyle = "rgba(6,10,18,.9)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

// --- colour helpers (hex → rgb / rgba / lighten) -------------------------------
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** A luminous, top-lit disc behind an agency glyph. The "old school" look was a flat
    circle with a hard dark border; this reads as a glowing orb (the app's glow/glass
    aesthetic) while the glyph's dark ink stays as a cut-out on top. Used by both the
    map (`renderGlyph`) and the legend (`drawGlyphInto`) so the two can never drift. */
function drawDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  // soft outer glow
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.9);
  glow.addColorStop(0, rgba(color, 0.32));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
  ctx.fill();
  // disc: light falls from the top-left, base colour at the rim
  const disc = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.12, x, y, r);
  disc.addColorStop(0, lighten(color, 0.5));
  disc.addColorStop(1, color);
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // thin light rim, replacing the hard dark outline
  ctx.strokeStyle = rgba("#ffffff", 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();
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

/** Weather station: a mast with a proper anemometer — a cross-arm carrying three
 *  cups — so it reads as a WIND instrument, not a lollipop. */
function drawStation(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // mast
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, -3);
  ctx.stroke();
  // anemometer cross-arm
  ctx.beginPath();
  ctx.moveTo(-9, -6);
  ctx.lineTo(9, -6);
  ctx.stroke();
  // three cups (two on the arm ends, one on top) — the classic anemometer read
  ctx.beginPath();
  ctx.arc(-9, -6, 2.6, 0, Math.PI * 2);
  ctx.arc(9, -6, 2.6, 0, Math.PI * 2);
  ctx.arc(0, -9.5, 2.6, 0, Math.PI * 2);
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

/** AQHI air-quality station: a stack emitting a plume that shrinks as it
 *  disperses (large puff then small) — reads as "air quality" at 44px and
 *  survives the 14px legend. */
function drawAqhi(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // stack, slightly tapered toward the top
  ctx.beginPath();
  ctx.moveTo(-2.5, 12);
  ctx.lineTo(-2.5, -3);
  ctx.lineTo(2.5, -3);
  ctx.lineTo(2.5, 12);
  ctx.stroke();
  // plume: large puff, then a smaller one drifting up-right
  ctx.beginPath();
  ctx.arc(6, -7, 4, 0, Math.PI * 2);
  ctx.arc(11, -11, 2.6, 0, Math.PI * 2);
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

/** Vessel: top-down hull silhouette, nose up — pointed bow, straight transom,
 *  and a superstructure block aft. Rotates by COG the same way `plane` rotates
 *  by track, so a ship points where it is sailing. Filled marine cyan so it
 *  reads as "on water" against the dark basemap; the dark outline keeps it
 *  legible once the halo disc sits behind it (the aircraft lesson). */
function drawVessel(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(0, -13); // bow tip
  ctx.lineTo(5, -4);
  ctx.lineTo(5, 8); // starboard side to transom
  ctx.lineTo(-5, 8); // flat stern
  ctx.lineTo(-5, -4);
  ctx.closePath();
  ctx.fillStyle = "rgba(56,189,248,.95)"; // #38bdf8 marine cyan
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // superstructure block aft
  ctx.beginPath();
  ctx.moveTo(-1.5, -3);
  ctx.lineTo(1.5, -3);
  ctx.lineTo(1.5, 5);
  ctx.lineTo(-1.5, 5);
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.9)";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** MTR train: top-down carriage, rounded nose up (rotated per-bearing by the layer,
 *  exactly like `plane` and `vessel`). A rectangle with a rounded front and two window
 *  bars reads as a rail vehicle at 44px and keeps reading when the moving-layer halo
 *  disc sits behind it; a heavier side-view train would turn to mush below ~20px. */
function drawTrain(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(-4.5, -13); // front-left
  ctx.quadraticCurveTo(0, -16, 4.5, -13); // rounded nose
  ctx.lineTo(4.5, 12);
  ctx.quadraticCurveTo(0, 14, -4.5, 12); // rounded tail
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Windows, as two short vertical bars — enough to say "carriage", not a face.
  ctx.strokeStyle = "rgba(5,7,13,.55)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (const seg of [
    { y0: -9, y1: -1 },
    { y0: 3, y1: 10 },
  ]) {
    ctx.beginPath();
    ctx.moveTo(-2, seg.y0);
    ctx.lineTo(-2, seg.y1);
    ctx.moveTo(2, seg.y0);
    ctx.lineTo(2, seg.y1);
    ctx.stroke();
  }
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

/** Border control point: a gateway with a traveller passing through it.
 *
 * Cyrus: "Border control point layer — use relevant symbology for them, don't use
 * simple point symbols." The layer used to draw a bare `circle`, which said only
 * "something is here" — the same thing every other point layer on this map says.
 * A portal with an arrow through it reads as a CROSSING at 44px and still reads
 * at the 14px the legend draws, which a passport or a barrier boom does not: both
 * turn to mush below ~20px.
 *
 * The arrow points right on purpose. Direction is not information here (the
 * crossing is bidirectional), so an asymmetric mark would imply something the
 * data does not say; a rightward arrow is the neutral reading direction. */
function drawControlPoint(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  stroke(ctx);
  // Portal: two posts and a lintel.
  ctx.beginPath();
  ctx.moveTo(-9, 11);
  ctx.lineTo(-9, -7);
  ctx.lineTo(9, -7);
  ctx.lineTo(9, 11);
  ctx.stroke();
  // Feet, so the posts read as standing on the ground rather than floating.
  ctx.beginPath();
  ctx.moveTo(-12.5, 11);
  ctx.lineTo(-5.5, 11);
  ctx.moveTo(5.5, 11);
  ctx.lineTo(12.5, 11);
  ctx.stroke();
  // The traveller: arrow through the gateway.
  ctx.beginPath();
  ctx.moveTo(-5, 2);
  ctx.lineTo(5, 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1.5, -3.2);
  ctx.lineTo(6.4, 2);
  ctx.lineTo(1.5, 7.2);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Water suspension: the `water` droplet struck through.
 *
 * Cyrus: "Suspension Location layer — use relevant symbology, don't use simple
 * point symbols." The pins were two-tone CIRCLES; the colour carried the whole
 * message and the shape carried none.
 *
 * Built as the family negation of `drawWater` rather than a new invention: this
 * map already uses the droplet for water supply, so "droplet + slash" is read
 * without a legend, and the two symbols cannot drift apart because they are drawn
 * from the same outline source below.
 *
 * The slash is drawn as TWO strokes with a gap over the droplet, not one line
 * across it. A single line makes the droplet unreadable at legend size and the
 * symbol then reads as "crossed out circle", i.e. exactly the plain point symbol
 * this replaces. */
function dropletPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.bezierCurveTo(7, -2, 9, 3, 9, 6);
  ctx.arc(0, 6, 9, 0, Math.PI);
  ctx.bezierCurveTo(-9, 3, -7, -2, 0, -12);
  ctx.closePath();
}

function drawNoWater(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  dropletPath(ctx);
  ctx.fillStyle = "rgba(233,242,255,.42)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // The slash: outline pass first so it stays legible over the droplet's fill,
  // then the dark ink on top.
  for (const pass of [
    { w: 4.4, col: "rgba(5,7,13,.9)" },
    { w: 2.4, col: "rgba(255,255,255,.97)" },
  ]) {
    ctx.strokeStyle = pass.col;
    ctx.lineWidth = pass.w;
    ctx.lineCap = "round";
    for (const seg of [
      { x1: -13, y1: -11, x2: -3, y2: -1 },
      { x1: 3, y1: 1, x2: 13, y2: 11 },
    ]) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Wind flow: three streamlines with a curl, matching the rail button's own wind
 *  icon so the legend row and the button that drives it read as the same thing. */
function drawWindFlow(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = "rgba(233,242,255,.95)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of [
    { y: -9, len: 6, hook: 4 },
    { y: 0, len: 3, hook: 5 },
    { y: 9, len: 7, hook: 3.5 },
  ]) {
    ctx.beginPath();
    ctx.moveTo(-12, s.y);
    ctx.lineTo(s.len, s.y);
    ctx.arc(s.len, s.y - s.hook / 2, s.hook / 2, Math.PI / 2, -Math.PI / 2, true);
    ctx.stroke();
  }
  ctx.restore();
}

/** 3D buildings: an isometric block with a second block behind it, so the legend
 *  row says "extruded mass", not "another point". */
function drawBlocks(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  const box = (x: number, y: number, w: number, h: number, top: number) => {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x - w, y - h);
    ctx.lineTo(x, y - h - top);
    ctx.lineTo(x + w, y - h);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x, y + top);
    ctx.closePath();
    ctx.fillStyle = "rgba(233,242,255,.9)";
    ctx.fill();
    ctx.stroke();
  };
  box(-2, 8, 7, 6, 4);
  box(6, 3, 6, 9, 3.5);
  ctx.restore();
}

/** Aerial basemap: a tilted map sheet with a horizon fold — a photograph of the
 *  ground, not a flat tile. */
function drawAerial(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.moveTo(-12, 4);
  ctx.lineTo(12, 4);
  ctx.lineTo(9, 12);
  ctx.lineTo(-9, 12);
  ctx.closePath();
  ctx.fillStyle = "rgba(233,242,255,.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5,7,13,.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // The sky above the fold, as an outline only: a filled shape would make the two
  // halves read as one flat block at legend size.
  ctx.beginPath();
  ctx.moveTo(-12, 4);
  ctx.lineTo(-4, -12);
  ctx.lineTo(4, -12);
  ctx.lineTo(12, 4);
  ctx.stroke();
  ctx.restore();
}

/** Water droplet for suspension notices. Shares `dropletPath` with the struck-
 *  through `no-water` mark above, so "water supply" and "water suspended" stay the
 *  same silhouette and only the slash distinguishes them. */
function drawWater(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  ctx.save();
  ctx.translate(c, c);
  dropletPath(ctx);
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
  vessel: { draw: drawVessel, disc: "#38bdf8" },
  "mtr-train": { draw: drawTrain },
  water: { draw: drawWater, disc: "#22d3ee" },
  "cp-land": { draw: drawControlPoint, disc: "#a855f7" },
  "cp-sea": { draw: drawControlPoint, disc: "#22d3ee" },
  "cp-air": { draw: drawControlPoint, disc: "#38bdf8" },
  "no-water": { draw: drawNoWater, disc: "#ff5d6c" },
  "aed": { draw: drawAed, disc: "#ef3d5b" },
  // Amber, not the cyan/violet agency family: an oil installation is infrastructure, and this is
  // the only layer whose glyph colour also matches its rail accent.
  "oil-tank": { draw: drawOilTank, disc: "#c87619" },
  "no-water-salt": { draw: drawNoWater, disc: "#fbbf24" },
  "wind-flow": { draw: drawWindFlow },
  blocks: { draw: drawBlocks },
  aerial: { draw: drawAerial },
};

/** Is this string a glyph this build can actually draw?
 *
 * Exists because a `symbol` that is NOT in `GLYPHS` fails completely silently:
 * `drawGlyphInto` returns early, the canvas stays transparent, and the legend row
 * shows an empty 14x14 box with no error anywhere. MEASURED 2026-09-25 —
 * `layers.json` declared `"symbol": "poi"` for the control-point layer and no such
 * glyph has ever existed, so that row had a blank symbol for as long as it has
 * been a POI layer. `GlyphId` is a compile-time union, but these strings come from
 * JSON, so nothing checks them at build time; this is the runtime check. */
export function hasGlyph(id: string): id is GlyphId {
  return Object.prototype.hasOwnProperty.call(GLYPHS, id);
}

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
    drawDisc(ctx, S / 2, S / 2, S / 2 - 3, spec.disc);
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
    drawDisc(ctx, S / 2, S / 2, S / 2 - 3, spec.disc);
    spec.draw(ctx, S * 0.82);
  } else {
    spec.draw(ctx, S);
  }
}
