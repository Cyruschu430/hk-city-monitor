#!/usr/bin/env python3
"""build_bus_data.py — fetch ALL bus routes + stops + coordinates, bake to JSON.

Companies: KMB, CTB, NLB, LWB, GMB (green minibus).
Output:
  data/bus_routes.json — { route_id: { co, route, orig, dest, stops: [...] } }
  data/bus_stops.json  — { stop_id: { name, lat, lng } }
"""
import json
import urllib.request

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
    """Get stops for one route. Returns list of {seq, stop_id}."""
    # Try different URL patterns
    for url in [
        f"https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{service_type}/{bound}",
        f"https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{service_type}/{bound}/1",
    ]:
        try:
            data = get(url)
            if "data" in data:
                return [{"seq": s["seq"], "stop": s["stop"]} for s in data["data"]]
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
    """Get stops for one CTB route."""
    try:
        data = get(f"https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/{route}/outbound")
        return [{"seq": s["seq"], "stop": s["stop"]} for s in data.get("data", [])]
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
    """Get stops for one NLB route."""
    try:
        data = get(f"https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=list&routeId={route_id}")
        return [{"seq": s["seq"], "stop": s["stopId"]} for s in data.get("stops", [])]
    except Exception:
        return []

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

def main():
    # 1. Fetch all routes
    routes = {}
    routes.update(fetch_kmb())
    routes.update(fetch_ctb())
    routes.update(fetch_nlb())
    routes.update(fetch_gmb())

    # 2. Fetch all stops (KMB has the master list)
    all_stops = fetch_all_stops()

    # 3. For each route, fetch its stop sequence
    print("Fetching stop sequences...")
    for i, (key, route) in enumerate(routes.items()):
        if i % 50 == 0:
            print(f"  {i}/{len(routes)}")
        if route["co"] in ("KMB", "LWB"):
            route["stops"] = fetch_kmb_stops(route["route"], route["service_type"], route["bound"])
        elif route["co"] == "CTB":
            route["stops"] = fetch_ctb_stops(route["route"])
        elif route["co"] == "NLB":
            route["stops"] = fetch_nlb_stops(route["routeId"])
        elif route["co"] == "GMB":
            route["stops"] = fetch_gmb_stops(route["route"], route["region"])
        # NLB/GMB stop sequences need their own APIs — skip for now

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
