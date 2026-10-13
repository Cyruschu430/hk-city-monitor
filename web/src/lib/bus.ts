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
// KMB and LWB share one feed: stop-eta at a stop returns every route calling
// there, so one request covers a whole stop.
export async function fetchStopETA(stopId: string): Promise<BusETA[]> {
  try {
    const res = await fetch(
      `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? []) as BusETA[];
  } catch {
    return [];
  }
}

// Citybus has no stop-level feed — ETA is per (stop, route), which is why the
// baked sample carries a route alongside each CTB stop. Rows have no
// service_type field, so it is filled in here.
export async function fetchCtbETA(stopId: string, route: string): Promise<BusETA[]> {
  try {
    const res = await fetch(
      `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${stopId}/${route}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
      co: "CTB",
      route: String(e.route ?? route),
      dir: String(e.dir ?? "O"),
      service_type: 1,
      seq: Number(e.seq ?? 0),
      dest_tc: String(e.dest_tc ?? ""),
      eta: typeof e.eta === "string" ? e.eta : null,
      rmk_tc: String(e.rmk_tc ?? ""),
      data_timestamp: String(e.data_timestamp ?? ""),
    }));
  } catch {
    return [];
  }
}

/** The baked live-layer sample: which stops the layer polls per operator.
 *  Baked by scripts/build_bus_data.py — the baked form replaced a hand-written
 *  list in the adapter whose Citybus ids used the wrong namespace and whose
 *  NLB ids did not exist. */
export interface LiveStops {
  KMB: string[];
  CTB: Array<{ stop: string; route: string }>;
}

export async function loadLiveStops(): Promise<LiveStops> {
  const res = await fetch("data/bus_live_stops.json");
  if (!res.ok) throw new Error(`bus_live_stops.json HTTP ${res.status}`);
  return (await res.json()) as LiveStops;
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
 *
 * Honesty note the UI repeats: these are INTERPOLATED from the operator's own
 * next-bus times, not GPS fixes. A bus at a terminus with two minutes on the
 * clock is drawn two minutes up the road.
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
    if (!Number.isFinite(etaMs)) continue;
    const etaMin = (etaMs - now) / 60000;
    if (etaMin < -2 || etaMin > 60) continue; // stale or too far

    // ONE key format across operators — see route_key() in
    // scripts/build_bus_data.py. service_type defaults to 1 because the
    // Citybus feed omits it where the KMB feed numbers it.
    const routeKey = `${eta.co}_${eta.route}_${eta.service_type ?? 1}_${eta.dir}`;
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
