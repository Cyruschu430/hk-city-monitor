// overlays3d.ts — the Open3Dhk buildings tileset as a LAZY LAYER on top of the
// map, never the map engine (PRIMITIVES §0.00). 12.2M triangles / 218,927
// features must never be on first paint: deck.gl and the tileset URL are both
// behind this dynamic import, which only runs when the user turns 3D on.
//
// The tileset URL comes from the Worker (/config/3d), never from this bundle —
// the HomeCheck pattern. Keyless works today; when LandsD enforces a key the
// deployed Worker gets it as a secret and no front-end code changes.

import type maplibregl from "maplibre-gl";
import { WORKER_BASE, hasWorker } from "../config.ts";

interface Overlay3d {
  setVisible(v: boolean): void;
  dispose(): void;
}

let overlayPromise: Promise<Overlay3d> | null = null;

async function build(map: maplibregl.Map): Promise<Overlay3d> {
  if (!hasWorker()) {
    throw new Error("未設定 VITE_WORKER_BASE — 3D 圖層網址一定要由 Worker 注入");
  }
  const res = await fetch(`${WORKER_BASE}/config/3d`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`/config/3d HTTP ${res.status}`);
  const cfg = (await res.json()) as { wgs84?: Record<string, string | undefined> };
  // Prefer the tilemodel tileset: measured 2026-09-21 — the building tileset
  // (3dsd, 12.2M-triangle b3dm) throws inside deck's ScenegraphLayer init in
  // this browser, while the official 3dtiles/f2 '可視化三維地圖' renders clean.
  // Building stays available through /config/3d.wgs84.building when/if it ever
  // renders; the choice of which tileset satisfies the monitor is data, so it
  // belongs in the Worker config, not hardcoded here.
  const url = cfg.wgs84?.["tilemodel"] ?? cfg.wgs84?.["building"] ?? cfg.wgs84?.["infrastructure"];
  if (!url) throw new Error("/config/3d 冇任何 3D tileset 網址");

  // Everything heavy loads here and only here.
  const [{ MapboxOverlay }, { Tile3DLayer }, { Tiles3DLoader }] = await Promise.all([
    import("@deck.gl/mapbox"),
    import("@deck.gl/geo-layers"),
    import("@loaders.gl/3d-tiles"),
  ]);

  const layer = new Tile3DLayer({
    id: "open3dhk-buildings",
    data: url,
    // Explicit loader — deck.gl v9 does not auto-register the tiles loader,
    // and initialising the layer without it dies with a bare "assertion
    // failed" and no hint (measured).
    loaders: [Tiles3DLoader],
    pickable: false,
  });

  const overlay = new MapboxOverlay({ interleaved: true, layers: [layer] });
  map.addControl(overlay as unknown as maplibregl.IControl);
  // QA/debug hooks: the harness asserts the overlay is present, empty when
  // "off", and repopulated when "on" again — i.e. the 3D really is an
  // on-the-fly layer rather than a one-shot add.
  (window as unknown as Record<string, unknown>)["__overlay3d"] = overlay;
  let visible = true;
  (window as unknown as Record<string, unknown>)["__overlay3dState"] = () => visible;
  return {
    setVisible(v: boolean) {
      visible = v;
      overlay.setProps({ layers: v ? [layer] : [] });
    },
    dispose() {
      visible = false;
      overlay.setProps({ layers: [] });
      map.removeControl(overlay as unknown as maplibregl.IControl);
    },
  };
}

/**
 * Toggle the 3D layer. Resolves when the requested state is reached; THROWS
 * when turning ON fails (config unreachable, overlay cannot build). Turning
 * OFF always succeeds — the caller must not mistake a clean off for a failure.
 */
export async function toggle3d(map: maplibregl.Map, on: boolean): Promise<void> {
  if (!on) {
    if (overlayPromise) {
      const overlay = await overlayPromise.catch(() => null);
      overlay?.setVisible(false);
    }
    return;
  }
  // A failed build must not poison the toggle for the rest of the session:
  // reset the cache so the next attempt actually retries.
  overlayPromise ??= build(map).catch((err) => {
    overlayPromise = null;
    reset3d();
    throw err;
  });
  const overlay = await overlayPromise;
  overlay.setVisible(true);
}

export function reset3d(): void {
  overlayPromise = null;
}
