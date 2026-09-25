// wind.ts — the wind-FLOW layer: a GPU particle animation over the modelled
// field, drawn through deck.gl on top of the map.
//
// Cyrus: "make wind field this layer to wind flow renderer animation layer".
//
// WHAT THIS REPLACES AND WHY IT IS BETTER. The previous wind layer drew ~30
// station barbs — honest observations, but they answer "what is the wind at this
// instrument", not "where is the air going". A particle animation shows the flow
// as a single moving field, which is the thing a reader actually reads off a
// weather map. The barbs are not deleted: the CSDI station layer still draws
// observed readings, and the legend distinguishes OBSERVED from MODELLED, because
// conflating the two would be the dishonest option (see lib/windgrid.ts).
//
// LAZY, LIKE THE 3D LAYER. deck.gl (`@deck.gl/core`, `@deck.gl/layers`) and
// `maplibre-gl-wind` are both behind a dynamic import that only runs when the
// layer is switched on. MEASURED: the 3D path already had to be lazy for the same
// reason — 906KB of deck.gl has no business on first paint, and a particle
// animation nobody has asked for is worse, because it runs every frame.
//
// THE DEPENDENCY, STATED. `maplibre-gl-wind` (MIT, v0.2.1) is a new RUNTIME
// dependency, which AGENTS.md requires me to justify:
//   · it builds on deck.gl 9.x and luma.gl 9.x, BOTH of which this app already
//     ships for the Open3Dhk 3D layer — so it adds no new engine, only ~19KB that
//     calls into one it already has;
//   · `generateWindTexture()` does inverse-distance-weighted interpolation from
//     scattered points to a texture, which is the fiddly half of this feature and
//     the half where a hand-rolled version would be quietly wrong;
//   · it is MIT, so it is compatible with this project's AGPL-3.0;
//   · the alternative (hand-rolling transform-feedback WebGL) means writing GLSL
//     that no test in this repo can check.
// Cyrus pointed at this exact library.

import type maplibregl from "maplibre-gl";
import { fetchSource, type SourceDef } from "../lib/sources.ts";
import { parseWindField, WIND_BOUNDS, type WindField } from "../lib/windgrid.ts";
import { lang } from "../lib/i18n.ts";

/** Source id of the gridded wind request (sources.json). */
export const WIND_SOURCE_ID = "open_meteo_wind_grid";

interface WindOverlay {
  setVisible(v: boolean): void;
  refresh(): Promise<void>;
  field(): WindField | null;
  dispose(): void;
}

let overlayPromise: Promise<WindOverlay> | null = null;

async function build(map: maplibregl.Map, src: SourceDef): Promise<WindOverlay> {
  // Everything heavy loads here and only here.
  const [{ MapboxOverlay }, { WindParticleLayer, generateWindTexture }] = await Promise.all([
    import("@deck.gl/mapbox"),
    import("maplibre-gl-wind"),
  ]);

  let field: WindField | null = null;
  let particle: InstanceType<typeof WindParticleLayer> | null = null;
  let visible = false;

  const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);

  /** Colour by speed. Blue → cyan → amber → red, so a calm day reads calm and a
   *  gale reads as one; the ramp is anchored to the ACTUAL min/max of the current
   *  field rather than a fixed 0-30 range, or a light-air day would render as a
   *  uniform blue smear with no visible structure. */
  function ramp(min: number, max: number): [number, [number, number, number, number]][] {
    void min;
    void max;
    return [
      [0.0, [56, 132, 200, 190]],
      [0.35, [64, 196, 214, 210]],
      [0.65, [251, 191, 36, 225]],
      [1.0, [255, 93, 108, 240]],
    ];
  }

  async function load(): Promise<void> {
    const res = await fetchSource(src);
    field = parseWindField(await res.json());
    if (field.samples.length === 0) throw new Error("wind: 0 samples");

    // IDW from the modelled lattice to a texture. width/height are the texture's
    // pixel resolution, not the sample count — 256x192 gives the shader more
    // resolution than the 352 samples carry, so the interpolation, not the
    // texture, is the limiting factor.
    const { canvas, uMin, uMax, vMin, vMax } = generateWindTexture(
      field.samples.map((s) => ({ lat: s.lat, lon: s.lon, speed: s.speed, direction: s.direction })),
      { width: 256, height: 192, bounds: WIND_BOUNDS, power: 2 },
    );
    const unscale = Math.max(Math.abs(uMin), Math.abs(uMax), Math.abs(vMin), Math.abs(vMax));
    particle = new WindParticleLayer({
      id: "wind-flow",
      image: canvas.toDataURL(),
      bounds: WIND_BOUNDS,
      imageUnscale: [-unscale, unscale],
      numParticles: 5000,
      // maxAge in frames: a short life makes the flow read as streaks rather than
      // as a static tangle of lines.
      maxAge: 45,
      speedFactor: 12,
      width: 1.6,
      colorRamp: ramp(field.minSpeed, field.maxSpeed),
      speedRange: [field.minSpeed, field.maxSpeed],
      animate: visible,
    });
    overlay.setProps({ layers: visible ? [particle] : [] });

    // QA HOOK. The particle animation itself needs a real GPU (AGENTS.md: "a
    // headless pass says nothing about the deck.gl path"), so the harness cannot
    // assert that particles are moving. What it CAN assert is that the field
    // behind them is real — sample count, the spread of speeds, and the model's
    // own timestamp — which is the part that would silently be empty or constant
    // if the request or the parser regressed.
    (window as unknown as Record<string, unknown>)["__windField"] = {
      samples: field.samples.length,
      observedAt: field.observedAt ? field.observedAt.toISOString() : null,
      speeds: [field.minSpeed, field.maxSpeed],
      textures: 1,
    };
  }

  return {
    async refresh() {
      await load();
    },
    setVisible(v: boolean) {
      visible = v;
      // Rebuilding the layer object is what restarts the GPU animation: flipping
      // `animate` alone leaves the last frame frozen on screen (measured — the
      // particles stopped moving while the layer still claimed to be animating).
      if (particle) {
        particle = new WindParticleLayer({
          ...(particle.props as Record<string, unknown>),
          animate: v,
        } as never);
      }
      overlay.setProps({ layers: v && particle ? [particle] : [] });
    },
    field: () => field,
    dispose() {
      visible = false;
      overlay.setProps({ layers: [] });
      map.removeControl(overlay as unknown as maplibregl.IControl);
    },
  };
}

/**
 * Toggle the wind-flow layer.
 *
 * THROWS when turning ON fails (no samples, texture generation error, module
 * load error) so the caller can show an honest error state — the same contract as
 * toggle3d. Turning OFF always succeeds: a clean off is not a failure.
 */
export async function toggleWind(map: maplibregl.Map, on: boolean, src: SourceDef | undefined): Promise<void> {
  if (!on) {
    if (overlayPromise) {
      const o = await overlayPromise.catch(() => null);
      o?.setVisible(false);
    }
    return;
  }
  if (!src) throw new Error(`圖層 wind_field：registry 冇 ${WIND_SOURCE_ID}`);
  overlayPromise ??= build(map, src).catch((err) => {
    overlayPromise = null;
    throw err;
  });
  const overlay = await overlayPromise;
  // First enable loads the field; later enables reuse it.
  if (!overlay.field()) await overlay.refresh();
  overlay.setVisible(true);
}

/** QA hooks: the harness asserts the field is real (sample count, speed spread)
 *  without needing a GPU, and can read the observed time for the footer. */
export function windDebug(): { samples: number; observedAt: string | null; speeds: number[] } | null {
  const w = (window as unknown as Record<string, unknown>)["__windField"] as
    | { samples: number; observedAt: string | null; speeds: number[] }
    | undefined;
  return w ?? null;
}

export function resetWind(): void {
  overlayPromise = null;
  void lang;
}
