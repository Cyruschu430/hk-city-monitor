// context.ts — PRIMITIVES §5. Location + time scoping as PURE functions.
// `route` scope is what makes 返工模式 and 跑步模式 the same engine with two
// configs; the route buffer distance is a CONSTANT HERE, never computed in
// the UI layer (spec, verbatim).

export type Scope = "hk" | "district" | "route";

export interface Context {
  scope: Scope;
  district?: string;
  route?: [number, number][]; // [lat, lon] waypoints
  now?: string;
}

/** Items may carry a district and/or a position; anything else is treated as
    territory-wide shared data and is NEVER filtered out by a district scope
    (spec: 冇該欄位嘅源當全港共享). */
export interface Locatable {
  district?: string;
  lat?: number;
  lon?: number;
}

/** Route corridor half-width, km. 0.5 km ≈ a 6–8 minute walk — close enough
    that a water suspension or road closure on it affects your journey, wide
    enough to catch both carriageways of a route. Written as a constant per
    PRIMITIVES §5; if a vertical needs another width, that is a spec change. */
export const ROUTE_BUFFER_KM = 0.5;

const EARTH_R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance, km (haversine). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point-to-polyline distance, km: min over segments of point-to-segment,
    computed on an equirectangular projection centred on the point — accurate
    to well under a metre at Hong Kong latitudes over corridor distances. */
export function distanceToRouteKm(lat: number, lon: number, route: [number, number][]): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) {
    const [aLat, aLon] = route[0]!;
    return distanceKm(lat, lon, aLat, aLon);
  }
  const kx = 111.32 * Math.cos(toRad(lat));
  const ky = 110.95;
  const px = 0;
  const py = 0;
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [aLat, aLon] = route[i]!;
    const [bLat, bLon] = route[i + 1]!;
    const ax = (aLon - lon) * kx, ay = (aLat - lat) * ky;
    const bx = (bLon - lon) * kx, by = (bLat - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let tSeg = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    tSeg = Math.max(0, Math.min(1, tSeg));
    const cx = ax + tSeg * dx, cy = ay + tSeg * dy;
    best = Math.min(best, Math.hypot(cx - px, cy - py));
  }
  return best;
}

export function appliesTo(item: Locatable, ctx: Context): boolean {
  switch (ctx.scope) {
    case "hk":
      return true;
    case "district":
      // No district field → territory-wide shared data → always applies.
      if (item.district === undefined || item.district === null || item.district === "") return true;
      return ctx.district !== undefined && item.district === ctx.district;
    case "route": {
      if (item.lat === undefined || item.lon === undefined) return true; // shared data
      if (!ctx.route || ctx.route.length === 0) return true;
      return distanceToRouteKm(item.lat, item.lon, ctx.route) <= ROUTE_BUFFER_KM;
    }
  }
}

export function filterByScope<T extends Locatable>(items: readonly T[], ctx: Context): T[] {
  if (ctx.scope === "hk") return [...items];
  return items.filter((it) => appliesTo(it, ctx));
}
