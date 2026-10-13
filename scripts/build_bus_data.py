#!/usr/bin/env python3
"""build_bus_data.py — fetch ALL bus routes + stops + coordinates, bake to JSON.

Companies: KMB, CTB, NLB, LWB, GMB (green minibus).
Output:
  data/bus_routes.json — { route_id: { co, route, orig, dest, stops: [...] } }
  data/bus_stops.json  — { stop_id: { name, lat, lng } }
"""
import json
import urllib.request
from collections import Counter

UA = {"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0; +https://hk-city-monitor.pages.dev)"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def fetch_kmb():
    """KMB + LWB (same API, co=KMB or LWB in data)"""
    print("KMB routes...")
    routes = get("https://data.etabus.gov.hk/v1/transport/kmb/route")["data"]
    out = {}
    for r in routes:
        key = f"{r['route']}_{r['service_type']}_{r['bound']}"
        out[key] = {
            "co": "KMB" if r.get("co") != "LWB" else "LWB",
            "route": r["route"],
            "orig": r["orig_tc"],
            "dest": r["dest_tc"],
            "bound": r["bound"],
            "service_type": r["service_type"],
            "stops": [],  # fill later
        }
    print(f"  {len(out)} routes")
    return out

def fetch_kmb_stops(route, service_type, bound):
    """Get stops for one route. Returns list of {seq, stop}.

    The BOUND WORD comes before the service type in this endpoint:
    /route-stop/{route}/outbound/{service_type}. The older order the first
    draft used answers `422 Invalid direction`, which is how 1,605 KMB routes
    ended up with an empty stop list while Citybus looked fine.
    seq is cast to int: the API serves it as a string here and as a number in
    the ETA feed, and estimatePositions() matches them with ===.
    """
    direction = "outbound" if bound == "O" else "inbound"
    for url in [
        f"https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{direction}/{service_type}",
        f"https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{service_type}/{bound}",
    ]:
        try:
            data = get(url)
            if data.get("data"):
                return [{"seq": int(s["seq"]), "stop": s["stop"]} for s in data["data"]]
        except Exception:
            continue
    return []

def fetch_ctb():
    """Citybus + NWFB"""
    print("CTB routes...")
    routes = get("https://rt.data.gov.hk/v2/transport/citybus/route/CTB")["data"]
    out = {}
    for r in routes:
        key = f"CTB_{r['route']}_O"
        out[key] = {
            "co": "CTB",
            "route": r["route"],
            "orig": r["orig_tc"],
            "dest": r["dest_tc"],
            "bound": "O",
            "service_type": "1",
            "stops": [],
        }
    print(f"  {len(out)} routes")
    return out

def fetch_ctb_stops(route):
    """Get stops for one CTB route. seq cast to int (see fetch_kmb_stops)."""
    try:
        data = get(f"https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/{route}/outbound")
        return [{"seq": int(s["seq"]), "stop": s["stop"]} for s in data.get("data", [])]
    except Exception:
        return []

def fetch_nlb():
    """New Lantao Bus — route.php?action=list"""
    print("NLB routes...")
    try:
        data = get("https://rt.data.gov.hk/v2/transport/nlb/route.php?action=list")
        out = {}
        for r in data["routes"]:
            key = f"NLB_{r['routeNo']}_O"
            out[key] = {
                "co": "NLB",
                "route": r["routeNo"],
                "orig": r.get("routeName_c", "").split(" > ")[0] if " > " in r.get("routeName_c", "") else r.get("routeName_c", ""),
                "dest": r.get("routeName_c", "").split(" > ")[-1] if " > " in r.get("routeName_c", "") else "",
                "bound": "O",
                "service_type": "1",
                "stops": [],
                "routeId": r["routeId"],
            }
        print(f"  {len(out)} routes")
        return out
    except Exception as e:
        print(f"  NLB failed: {e}")
        return {}

def fetch_gmb():
    """Green Minibus — data.etagmb.gov.hk"""
    print("GMB routes...")
    try:
        out = {}
        for region in ["HKI", "KLN", "NT"]:
            data = get(f"https://data.etagmb.gov.hk/route/{region}")
            for route_no in data.get("data", {}).get("routes", []):
                key = f"GMB_{region}_{route_no}"
                out[key] = {
                    "co": "GMB",
                    "route": route_no,
                    "orig": "",
                    "dest": "",
                    "bound": "O",
                    "service_type": "1",
                    "stops": [],
                    "region": region,
                }
        print(f"  {len(out)} routes")
        return out
    except Exception as e:
        print(f"  GMB failed: {e}")
        return {}

def fetch_nlb_stops(route_id):
    """NLB stops for one route. stop.php carries lat/long, so the same call
    yields the stop list AND the coordinates — NLB needs no extra lookup."""
    try:
        data = get(f"https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=list&routeId={route_id}")
    except Exception:
        return []
    out = []
    for i, s in enumerate(data.get("stops", []), 1):
        out.append({
            "seq": i,
            "stop": s["stopId"],
            "name": s.get("stopName_c", ""),
            "lat": float(s["latitude"]),
            "lng": float(s["longitude"]),
        })
    return out

def fetch_ctb_stop_coord(stop_id):
    """One CTB stop's official coordinates. The CTB route-stop feed lists ids
    only, and the KMB master list is KMB-only, so these have to be fetched."""
    try:
        s = get(f"https://rt.data.gov.hk/v2/transport/citybus/stop/{stop_id}")["data"]
        # The field is `long`, not `lon` — reading the wrong key raised KeyError
        # for every Citybus stop, which silently emptied the live-layer sample.
        return stop_id, {"name": s["name_tc"], "lat": float(s["lat"]), "lng": float(s["long"])}
    except Exception:
        return stop_id, None

def fetch_ctb_coords(stop_ids):
    """Coordinate lookup for every CTB stop, 8 requests at a time (~1,400
    stops; sequential would take longer than the whole rest of the bake)."""
    from concurrent.futures import ThreadPoolExecutor
    found = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, (sid, rec) in enumerate(pool.map(fetch_ctb_stop_coord, stop_ids)):
            if rec:
                found[sid] = rec
            if i % 200 == 0:
                print(f"    coords {i}/{len(stop_ids)}")
    return found

def fetch_gmb_stops(route_no, region):
    """Get stops for one GMB route."""
    try:
        data = get(f"https://data.etagmb.gov.hk/route-stop/{route_no}/1")
        return [{"seq": s["stop_seq"], "stop": s["stop_id"]} for s in data.get("data", {}).get("route_stops", [])]
    except Exception:
        return []

def fetch_all_stops():
    """Fetch ALL stops with coordinates from KMB API (has full list)."""
    print("All stops...")
    data = get("https://data.etabus.gov.hk/v1/transport/kmb/stop")
    stops = {}
    for s in data["data"]:
        stops[s["stop"]] = {
            "name": s["name_tc"],
            "lat": float(s["lat"]),
            "lng": float(s["long"]),
        }
    print(f"  {len(stops)} stops")
    return stops

def route_key(route):
    """ONE key format for every operator: {co}_{route}_{service_type}_{bound}.

    The first draft let each fetcher invent its own (KMB `1_1_O`, CTB
    `CTB_1_O`, GMB `GMB_HKI_1`), which is why the live layer's lookup could
    only ever match one company. A single format removes the guesswork."""
    svc = str(route.get("service_type") or "1")
    bound = route.get("bound") or "O"
    if route["co"] == "GMB":
        return f"GMB_{route.get('region', 'HKI')}_{route['route']}_{svc}_{bound}"
    return f"{route['co']}_{route['route']}_{svc}_{bound}"

def pick_live_stops(routes, all_stops, per_company):
    """Sample the stops the live layer polls.

    Busiest first (a stop counts once per route that calls at it), then thinned
    to stay ~3km apart so the sample covers the territory instead of stacking
    every bus in Central. Baked rather than hardcoded: the previous in-adapter
    list named ten stop ids by hand and several did not exist.
    """
    counts: dict[str, Counter] = {co: Counter() for co in per_company}
    route_for: dict[str, str] = {}
    for r in routes.values():
        co = r["co"]
        if co not in counts:
            continue
        for s in r.get("stops", []):
            counts[co][s["stop"]] += 1
            route_for.setdefault(s["stop"], r["route"])

    picked: dict[str, list] = {"KMB": [], "CTB": []}
    for co in ("KMB", "LWB", "CTB"):
        # LWB shares the KMB feed, so one KMB list covers both.
        want = per_company.get(co, 0)
        if not want:
            continue
        taken: list[tuple[float, float]] = []
        for sid, _n in counts[co].most_common():
            rec = all_stops.get(sid)
            if not rec:
                continue
            if any(abs(rec["lat"] - la) < 0.03 and abs(rec["lng"] - lo) < 0.03 for la, lo in taken):
                continue
            taken.append((rec["lat"], rec["lng"]))
            if co == "CTB":
                picked["CTB"].append({"stop": sid, "route": route_for[sid]})
            else:
                picked["KMB"].append(sid)
            if len(taken) >= want:
                break
    return picked

def main():
    # 1. Fetch all routes
    routes = {}
    routes.update(fetch_kmb())
    routes.update(fetch_ctb())
    routes.update(fetch_nlb())
    routes.update(fetch_gmb())
    routes = {route_key(r): r for r in routes.values()}
    print(f"  {len(routes)} routes keyed")

    # 2. Fetch all stops (KMB has the master list)
    all_stops = fetch_all_stops()

    # 3. For each route, fetch its stop sequence
    print("Fetching stop sequences...")
    for i, route in enumerate(routes.values()):
        if i % 50 == 0:
            print(f"  {i}/{len(routes)}")
        if route["co"] in ("KMB", "LWB"):
            route["stops"] = fetch_kmb_stops(route["route"], route["service_type"], route["bound"])
        elif route["co"] == "CTB":
            route["stops"] = fetch_ctb_stops(route["route"])
        elif route["co"] == "NLB":
            rows = fetch_nlb_stops(route["routeId"])
            for r in rows:
                all_stops.setdefault(r["stop"], {"name": r["name"], "lat": r["lat"], "lng": r["lng"]})
            route["stops"] = [{"seq": r["seq"], "stop": r["stop"]} for r in rows]
        elif route["co"] == "GMB":
            route["stops"] = fetch_gmb_stops(route["route"], route["region"])

    # 3b. CTB coordinates — the route-stop feed carries ids only.
    ctb_ids = sorted({s["stop"] for r in routes.values() if r["co"] == "CTB" for s in r["stops"]})
    print(f"CTB stop coordinates ({len(ctb_ids)})...")
    all_stops.update(fetch_ctb_coords(ctb_ids))

    # 3c. The live-layer sample, baked so the adapter holds no stop ids.
    live = pick_live_stops(routes, all_stops, {"KMB": 24, "CTB": 10})
    with open("data/bus_live_stops.json", "w", encoding="utf-8") as f:
        json.dump(live, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  live sample: {len(live['KMB'])} KMB stops, {len(live['CTB'])} CTB stop-route pairs")

    # 4. Save
    with open("data/bus_routes.json", "w", encoding="utf-8") as f:
        json.dump(routes, f, ensure_ascii=False, separators=(",", ":"))
    with open("data/bus_stops.json", "w", encoding="utf-8") as f:
        json.dump(all_stops, f, ensure_ascii=False, separators=(",", ":"))

    # Stats
    total_stops = sum(len(r["stops"]) for r in routes.values())
    print(f"\nDone: {len(routes)} routes, {total_stops} route-stops, {len(all_stops)} unique stops")
    print(f"  bus_routes.json: {len(json.dumps(routes)) // 1024}KB")
    print(f"  bus_stops.json: {len(json.dumps(all_stops)) // 1024}KB")

if __name__ == "__main__":
    main()
