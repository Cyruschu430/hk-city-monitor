// raster.ts — canvas rasterisation for the two data-shaped "images":
// the gridded rainfall nowcast and the tropical-cyclone track. Both are real
// renders of real numbers; neither pretends to be a photographed product.
//
// This is the browser-only half of those two adapters (adapters.ts takes it as
// an injected dependency so parser tests can run in Node with no canvas).

import type { NowcastGrid, TcPoint } from "../lib/parsers.ts";
import type { Rasterizer } from "../lib/adapters.ts";

/** mm per half hour → colour. Deliberately the standard radar-ish ramp:
    nothing → transparent, then blue → green → yellow → red as it gets worse. */
function rainColor(mm: number): [number, number, number, number] {
  if (mm <= 0.1) return [0, 0, 0, 0];
  if (mm < 1) return [56, 132, 255, 90];
  if (mm < 3) return [46, 204, 113, 120];
  if (mm < 8) return [241, 196, 15, 150];
  if (mm < 20) return [230, 126, 34, 175];
  return [231, 76, 60, 200];
}

export const browserRasterizer: Rasterizer = {
  async nowcast(grid: NowcastGrid, _bbox: [number, number, number, number], _opacity: number): Promise<string> {
    const w = grid.lons.length;
    const h = grid.lats.length;
    // Draw at grid resolution, then scale with image-rendering:pixelated — this
    // is a 2 km model grid and smoothing it would invent detail.
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = rainColor(grid.vals[y]?.[x] ?? 0);
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  },

  async tcTrack(track: { name: string; points: TcPoint[] }): Promise<string> {
    const W = 640;
    const H = 480;
    const pad = 34;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.fillStyle = "#0a1220";
    ctx.fillRect(0, 0, W, H);

    const pts = track.points;
    if (pts.length === 0) return canvas.toDataURL("image/png");
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const minLat = Math.min(...lats) - 1.5;
    const maxLat = Math.max(...lats) + 1.5;
    const minLon = Math.min(...lons) - 1.5;
    const maxLon = Math.max(...lons) + 1.5;
    const X = (lon: number) => pad + ((lon - minLon) / (maxLon - minLon)) * (W - pad * 2);
    const Y = (lat: number) => H - pad - ((lat - minLat) / (maxLat - minLat)) * (H - pad * 2);

    // grid
    ctx.strokeStyle = "rgba(140,190,255,.14)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "#5d7a9b";
    for (let lat = Math.ceil(minLat); lat <= maxLat; lat++) {
      ctx.beginPath();
      ctx.moveTo(pad, Y(lat));
      ctx.lineTo(W - pad, Y(lat));
      ctx.stroke();
      ctx.fillText(`${lat}°N`, 4, Y(lat) + 3);
    }
    for (let lon = Math.ceil(minLon); lon <= maxLon; lon++) {
      ctx.beginPath();
      ctx.moveTo(X(lon), pad);
      ctx.lineTo(X(lon), H - pad);
      ctx.stroke();
      ctx.fillText(`${lon}°E`, X(lon) - 12, H - 8);
    }

    // past track (solid) then forecast (dashed), the HKO convention
    const past = pts.filter((p) => !p.forecast);
    const future = pts.filter((p) => p.forecast);
    const line = (list: TcPoint[], dash: number[]) => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      list.forEach((p, i) => (i ? ctx.lineTo(X(p.lon), Y(p.lat)) : ctx.moveTo(X(p.lon), Y(p.lat))));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (past.length > 1) line(past, []);
    if (future.length > 1) line([past[past.length - 1]!, ...future].filter(Boolean), [5, 4]);

    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(X(p.lon), Y(p.lat), p.forecast ? 3 : 4, 0, Math.PI * 2);
      ctx.fillStyle = p.forecast ? "#0a1220" : "#e9f2ff";
      ctx.fill();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    const last = pts[pts.length - 1]!;
    ctx.fillStyle = "#e9f2ff";
    ctx.font = "600 13px ui-monospace, monospace";
    ctx.fillText(track.name, X(last.lon) + 8, Y(last.lat) - 8);
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "#8ea6c4";
    ctx.fillText(`${last.wind} · ${last.intensity}`, X(last.lon) + 8, Y(last.lat) + 6);
    ctx.fillText("虛線 = 預測路徑", pad, 16);
    return canvas.toDataURL("image/png");
  },
};
