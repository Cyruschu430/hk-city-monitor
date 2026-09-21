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
  const url = cfg.wgs84?.["building"];
  if (!url) throw new Error("/config/3d 冇 building tileset 網址");

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
  (window as unknown as Record<string, unknown>)["__overlay3d"] = overlay;
  return {
    setVisible(v: boolean) {
      overlay.setProps({ layers: v ? [layer] : [] });
    },
    dispose() {
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
