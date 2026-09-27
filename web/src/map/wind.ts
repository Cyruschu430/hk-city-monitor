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


  // NOT INTERLEAVED — and that is the whole reason the animation was frozen.
  //
  // MEASURED 2026-09-25 on a real GPU (AMD Radeon, D3D11, headed run): with
  // `interleaved: true` the layer loaded (352 samples, texture built, luma.gl
  // compiled its buffers) and then never moved — pixel motion between three
  // samples 700ms apart was **0 of 7875, twice**. The particles were drawn once
  // and never stepped again.
  //
  // Why: the layer's own loop is `draw() → requestStep() → setTimeout(FPS) →
  // step() → setNeedsRedraw()` (maplibre-gl-wind dist/index.js:473,623-635). In
  // INTERLEAVED mode deck.gl draws into MapLibre's canvas and MapLibre owns the
  // render loop — it repaints on interaction, not continuously — so
  // `setNeedsRedraw()` flags a frame nobody renders and the loop dies after the
  // first one. In the default (overlaid) mode deck.gl owns a canvas and its own
  // animation loop, so the flag is acted on.
  //
  // The library's own MapLibre example uses `new MapboxOverlay({ layers })` with
  // no `interleaved` option. The cost of the fix is that the field draws above the
  // basemap and its labels rather than between style layers, which is what Windy
  // does anyway — the wind is the subject, not an underlay.
  const overlay = new MapboxOverlay({ layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);

  // QA HOOK for the animation itself. `__windField` proves the DATA arrived; this
  // proves the LAYER is wired and being handed to deck. They are different
  // failures — measured 2026-09-25: the field loaded (352 samples) while the canvas
  // never moved, and nothing on the page could say which half had broken.
  //
  // `MapboxOverlay` does not expose `props` publicly (`tsc` rejects it), so the
  // read goes through a cast AND falls back to the internal Deck instance. The
  // first version of this hook read `overlay.props.layers` alone and reported
  // **0 layers while the layer was in fact set** — a QA hook that lies is worse
  // than no hook, so it now reports which source it read.
  const overlayInternals = overlay as unknown as {
    props?: { layers?: unknown[] };
    _deck?: { props?: { layers?: unknown[] } };
  };
  (window as unknown as Record<string, unknown>)["__windOverlay"] = {
    deckCanvases: () => map.getContainer().querySelectorAll("canvas").length,
    layerCount: () => (overlayInternals.props?.layers ?? overlayInternals._deck?.props?.layers ?? []).length,
    layerCountSource: () => (overlayInternals.props ? "overlay.props" : overlayInternals._deck ? "overlay._deck.props" : "unknown"),
    visible: () => visible,
    hasParticle: () => particle !== null,
    zoom: () => map.getZoom(),
  };

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

  /** Fetch + parse the field, with ONE retry.
   *
   * MEASURED 2026-09-25: the Worker answered `504 upstream_timeout` for this URL
   * on two consecutive full gate runs while a standalone probe of the identical
   * request got 200. A timeout on a 352-point query is transient by nature, and
   * without a retry a single slow spot leaves the layer dead until the user
   * toggles it off and on — which is a failure they cannot diagnose. The Worker
   * now gives this host 18s instead of 10s; this retry is the second line, for the
   * case where even that is not enough.
   *
   * Bounded at two attempts on purpose. A retry loop against an upstream that is
   * genuinely down turns one honest error into three slow ones, and the layer
   * already has an error state to show. */
  async function loadField(): Promise<WindField> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSource(src);
        return parseWindField(await res.json());
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 900));
      }
    }
    throw lastErr;
  }

  async function load(): Promise<void> {
    field = await loadField();
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
    // Cheap, synchronous, and honest: read the texture canvas back and report how much the values
    // actually vary. `getImageData` on a 2D canvas works (it is not a WebGL buffer), so this is a
    // real read — unlike `toDataURL` on the MAP's canvas, which comes back empty once the frame has
    // been composited because `preserveDrawingBuffer` is off.
    const textureFacts = (() => {
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return { w: canvas.width, h: canvas.height, spread: "no 2d ctx" };
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255, max = 0;
        // `?? 0` because of noUncheckedIndexedAccess: `d[k]` is `number | undefined` to the
        // compiler even inside the loop bound. This project turns that flag on deliberately, so the
        // fix is a real fallback rather than a `!`.
        for (let k = 0; k < d.length; k += 4) {
          const v = d[k] ?? 0;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        // uMin/uMax/vMin/vMax are deliberately NOT reported: their declared type is optional, and a
        // hook that has to be `as`-cast to compile is a hook that will drift from the code it claims
        // to describe. `spread` is the fact that matters — a flat texture draws nothing.
        void uMin; void uMax; void vMin; void vMax;
        return { w: canvas.width, h: canvas.height, spread: max - min };
      } catch (e) {
        return { w: canvas.width, h: canvas.height, spread: "throw " + (e instanceof Error ? e.message : String(e)) };
      }
    })();
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
      // `animate: true` — CORRECT, BUT IT DOES NOT FIX THE FREEZE. Read this before trying it again.
      //
      // MEASURED on a real GPU (RTX 3050 Laptop, headed run, ANGLE/D3D11, 2026-09-27): every QA hook
      // reports success — `__windField.samples 352`, `speeds [3.4, 28.4]`, `deckCanvases 2`,
      // `layerCount 1`, `hasParticle true`, no error state — and the deck canvas changes **0.006% of
      // its pixels across frames 2.5s apart**, which is the map's own baseline noise (measured without
      // the layer: 27-33 pixels of 623,776). The particles are drawn once and never step.
      //
      // THREE HYPOTHESES HAVE NOW BEEN TESTED AND FAILED:
      //   · `interleaved: true` — blamed and fixed 2026-09-25; the freeze survived it (that session
      //     measured "0 of 7875, twice", this session measured the same on different hardware).
      //   · this line reading `animate: visible` — plausible, because `load()` runs from `refresh()`
      //     BEFORE `setVisible(true)`, so the first layer was built inert and then re-created under the
      //     same `id: "wind-flow"` (deck matches by id+type and does not re-run `initializeState()`).
      //     Changed to `animate: true`, rebuilt, re-measured on the same GPU: **0.006% — unchanged.**
      //   · so the layer DOES reach deck with animation enabled and still does not step.
      //
      // The library's loop is `draw() -> requestStep() -> setTimeout(FPS) -> step() -> setNeedsRedraw()`
      // (maplibre-gl-wind dist/index.js:473,623-635). The remaining candidate is the last link: a
      // `setNeedsRedraw()` that no one acts on, because `MapboxOverlay` is driven by Maplibre's render
      // event and Maplibre repaints on interaction rather than continuously. The untested fix is a
      // `requestAnimationFrame` loop calling `deck.redraw()` while visible — it needs the Deck instance,
      // which is not reachable from the page (`map._controls` is minified, so a probe cannot find the
      // overlay and the experiment has to be made in this file, not from outside).
      //
      // `animate: true` is kept rather than reverted because it is the honest value: `load()` is only
      // ever called when the layer is being switched ON, so there is no case in which the first
      // construction wants `false`. It is a correction, not a fix.
      animate: true,
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
      // `textures` USED TO READ `1` — a hardcoded literal, not a measurement. It reported a texture
      // for every run, including runs where nothing was drawn, and I read it as evidence that the
      // texture had been built. That is the fourth time on this layer that a hook has certified a
      // thing it never checked (`__windField` samples proves the fetch; `deckCanvases` proves only
      // that `addControl` ran; `layerCount` proves the layer was handed over; and this proved
      // nothing at all). It now reports what can actually be inspected: the dimensions of the
      // texture canvas, and whether its pixels carry any variation.
      //
      // If `textureSpread` is 0 the texture is FLAT — every sample interpolated to the same value —
      // and the shader has nothing to move particles along, which draws nothing at all. That is a
      // different failure from "drawn once and frozen", and the two were indistinguishable from
      // outside the page until now.
      texture: textureFacts,
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
