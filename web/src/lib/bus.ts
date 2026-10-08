// bus.ts — bus ETA panel + live tracking layer for HK buses
// Companies: KMB, LWB, CTB (NLB/GMB skipped — different API, low coverage)

export interface BusRoute {
  co: string;
  route: string;
  orig: string;
  dest: string;
  bound: string;
  service_type: string;
  stops: Array<{ seq: number; stop: string }>;
}

export interface BusStop {
  name: string;
  lat: number;
  lng: number;
}

export interface BusETA {
  co: string;
  route: string;
  dir: string;
  service_type: number;
  seq: number;
  dest_tc: string;
  eta: string | null;
  rmk_tc: string;
  data_timestamp: string;
}

export interface BusData {
  routes: Record<string, BusRoute>;
  stops: Record<string, BusStop>;
}

// ---------- company metadata ----------
export const COMPANIES = [
  { id: "KMB", name: "九巴", color: "#e60012" },
  { id: "LWB", name: "龍運", color: "#ff6600" },
  { id: "CTB", name: "城巴", color: "#0066cc" },
  { id: "NLB", name: "嶼巴", color: "#00aa44" },
  { id: "GMB", name: "專線小巴", color: "#8844aa" },
] as const;

export type CompanyId = (typeof COMPANIES)[number]["id"];

// ---------- data loading ----------
let _data: BusData | null = null;

export async function loadBusData(): Promise<BusData> {
  if (_data) return _data;
  const [routes, stops] = await Promise.all([
    fetch("data/bus_routes.json").then((r) => r.json()),
    fetch("data/bus_stops.json").then((r) => r.json()),
  ]);
  _data = { routes, stops };
  return _data;
}

// ---------- ETA fetching ----------
export async function fetchStopETA(stopId: string): Promise<BusETA[]> {
  // KMB/LWB/CTB share the same ETA endpoint structure
  const res = await fetch(
    `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}`
  );
  if (!res.ok) throw new Error(`ETA fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data ?? [];
}

// ---------- live tracking (ETA → estimated position) ----------
export interface BusPosition {
  routeKey: string;
  co: string;
  route: string;
  seq: number;
  stopId: string;
  lat: number;
  lng: number;
  etaMin: number;
  nextStop: string;
  bearing: number; // degrees
}

/**
 * Estimate bus positions from ETA data.
 * A bus with ETA=3min to stop N is somewhere between stop N-1 and stop N.
 * We linearly interpolate based on typical segment time (2min per stop).
 */
export function estimatePositions(
  etas: BusETA[],
  data: BusData
): BusPosition[] {
  const positions: BusPosition[] = [];
  const now = Date.now();

  for (const eta of etas) {
    if (!eta.eta) continue; // no ETA = not running
    const etaMs = new Date(eta.eta).getTime();
    const etaMin = (etaMs - now) / 60000;
    if (etaMin < -2 || etaMin > 60) continue; // stale or too far

    const routeKey = `${eta.route}_${eta.service_type}_${eta.dir}`;
    const route = data.routes[routeKey];
    if (!route || route.stops.length === 0) continue;

    // Find the stop this ETA is for
    const stopIdx = route.stops.findIndex((s) => s.seq === eta.seq);
    if (stopIdx < 0) continue;

    const stopEntry = route.stops[stopIdx];
    const stopId = stopEntry?.stop;
    if (!stopId) continue;
    const stop = data.stops[stopId];
    if (!stop) continue;

    // Estimate position: if etaMin <= 0, bus is AT this stop
    // Otherwise, interpolate from previous stop
    let lat = stop.lat;
    let lng = stop.lng;
    let bearing = 0;

    if (etaMin > 0 && stopIdx > 0) {
      const prevEntry = route.stops[stopIdx - 1];
      const prevStopId = prevEntry?.stop;
      const prevStop = prevStopId ? data.stops[prevStopId] : undefined;
      if (prevStop) {
        // Assume 2 minutes per segment
        const segmentTime = 2;
        const progress = Math.max(0, Math.min(1, 1 - etaMin / segmentTime));
        lat = prevStop.lat + (stop.lat - prevStop.lat) * progress;
        lng = prevStop.lng + (stop.lng - prevStop.lng) * progress;
        bearing = Math.atan2(stop.lat - prevStop.lat, stop.lng - prevStop.lng) * (180 / Math.PI);
      }
    }

    positions.push({
      routeKey,
      co: eta.co,
      route: eta.route,
      seq: eta.seq,
      stopId,
      lat,
      lng,
      etaMin: Math.max(0, etaMin),
      nextStop: stop.name,
      bearing: (bearing + 360) % 360,
    });
  }

  return positions;
}

// ---------- search helpers ----------
export function searchRoutes(
  data: BusData,
  query: string,
  company?: CompanyId
): BusRoute[] {
  const q = query.toLowerCase();
  return Object.values(data.routes).filter((r) => {
    if (company && r.co !== company) return false;
    return (
      r.route.toLowerCase().includes(q) ||
      r.orig.toLowerCase().includes(q) ||
      r.dest.toLowerCase().includes(q)
    );
  });
}

export function getCompanyRoutes(data: BusData, co: CompanyId): BusRoute[] {
  return Object.values(data.routes).filter((r) => r.co === co);
}
