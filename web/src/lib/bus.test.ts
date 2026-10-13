// bus.test.ts — the bus live layer's estimate, offline and deterministic.
//
// WHY THIS EXISTS. The layer draws nothing when the ETA rows and the baked
// route index disagree, and it does so SILENTLY: every mismatch is a `continue`,
// so a wrong key format produces an empty map with no error anywhere. That is
// exactly what shipped — the bake keyed KMB routes `1_1_O` and Citybus routes
// `CTB_1_O`, while the estimator built one format and matched neither. A layer
// that renders zero features must therefore be caught here, not by looking at a
// screenshot and hoping.

import assert from "node:assert/strict";

const Bus = await import("./bus.ts");

// Two stops ~1km apart, one route, in the shape scripts/build_bus_data.py bakes.
const data = {
  routes: {
    // KMB: one key format for every operator — {co}_{route}_{service_type}_{dir}
    "KMB_1_1_O": {
      co: "KMB",
      route: "1",
      orig: "竹園邨",
      dest: "尖沙咀碼頭",
      bound: "O",
      service_type: "1",
      stops: [
        { seq: 1, stop: "K1" },
        { seq: 2, stop: "K2" },
        { seq: 3, stop: "K3" },
      ],
    },
    "CTB_5B_1_I": {
      co: "CTB",
      route: "5B",
      orig: "堅尼地城",
      dest: "銅鑼灣",
      bound: "I",
      service_type: "1",
      stops: [
        { seq: 1, stop: "C1" },
        { seq: 2, stop: "C2" },
      ],
    },
  },
  stops: {
    K1: { name: "竹園邨總站", lat: 22.3454, lng: 114.1926 },
    K2: { name: "竹園南邨", lat: 22.3451, lng: 114.1900 },
    K3: { name: "馬仔坑", lat: 22.3443, lng: 114.1878 },
    C1: { name: "堅尼地城", lat: 22.2818, lng: 114.1280 },
    C2: { name: "石塘咀", lat: 22.2850, lng: 114.1330 },
  },
};

const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

// 1. A KMB row resolves against the baked index. This is the assertion that
//    fails if the two key formats drift apart again.
{
  const pos = Bus.estimatePositions(
    [{ co: "KMB", route: "1", dir: "O", service_type: 1, seq: 2, dest_tc: "尖沙咀碼頭", eta: iso(1), rmk_tc: "", data_timestamp: "" }],
    data,
  );
  assert.equal(pos.length, 1, "a KMB ETA row must resolve to a position");
  const p = pos[0]!;
  assert.equal(p.nextStop, "竹園南邨");
  // Between the previous stop and this one, i.e. east of K2 and west of K1.
  assert.ok(p.lng > 114.1900 && p.lng < 114.1926, `interpolated lng was ${p.lng}`);
  assert.ok(p.lat > 22.3451 && p.lat < 22.3454, `interpolated lat was ${p.lat}`);
  console.log(`✓ 九巴 ETA → 位置: ${p.route} 往${p.nextStop} 約 ${p.etaMin.toFixed(1)} 分鐘`);
}

// 2. The Citybus feed omits service_type and reports its own dir. The estimator
//    must fill service_type=1 rather than build `CTB_5B_undefined_I`.
{
  const pos = Bus.estimatePositions(
    [{ co: "CTB", route: "5B", dir: "I", seq: 1, dest_tc: "銅鑼灣", eta: iso(2), rmk_tc: "", data_timestamp: "" } as never],
    data,
  );
  assert.equal(pos.length, 1, "a Citybus row without service_type must still resolve");
  console.log("✓ 城巴（無 service_type）→ 位置 OK");
}

// 3. A bus already at its stop sits AT it, not short of it.
{
  const pos = Bus.estimatePositions(
    [{ co: "KMB", route: "1", dir: "O", service_type: 1, seq: 3, dest_tc: "", eta: iso(-0.5), rmk_tc: "", data_timestamp: "" }],
    data,
  );
  assert.equal(pos.length, 1);
  assert.equal(pos[0]!.lat, data.stops.K3.lat, "an arriving bus is at the stop");
  assert.equal(pos[0]!.etaMin, 0, "a negative countdown is reported as 0, never as negative");
}

// 4. Silence, not a crash, for everything that cannot be placed: an unknown
//    route, an unknown stop, a stop with no coordinate, an ETA an hour away and
//    a stale one. A layer that throws on any of these dies on the first refresh.
{
  const now = iso(0);
  assert.deepEqual(
    Bus.estimatePositions(
      [
        { co: "KMB", route: "999", dir: "O", service_type: 1, seq: 1, dest_tc: "", eta: now, rmk_tc: "", data_timestamp: "" },
        { co: "KMB", route: "1", dir: "O", service_type: 1, seq: 99, dest_tc: "", eta: now, rmk_tc: "", data_timestamp: "" },
        { co: "KMB", route: "1", dir: "O", service_type: 1, seq: 1, dest_tc: "", eta: iso(180), rmk_tc: "", data_timestamp: "" },
        { co: "KMB", route: "1", dir: "O", service_type: 1, seq: 1, dest_tc: "", eta: null, rmk_tc: "", data_timestamp: "" },
      ],
      data,
    ),
    [],
    "unplaceable rows must be dropped in silence",
  );
  const noCoord = { routes: data.routes, stops: { ...data.stops, C1: undefined as never } };
  assert.equal(
    Bus.estimatePositions(
      [{ co: "CTB", route: "5B", dir: "I", seq: 1, dest_tc: "", eta: iso(3), rmk_tc: "", data_timestamp: "" } as never],
      noCoord as never,
    ).length,
    0,
    "a stop with no coordinates is skipped rather than drawn at 0,0",
  );
  console.log("✓ 無法定位嘅班次一律靜靜略過（無 crash、無 0,0 假點）");
}

// --- heading: MapLibre rotates clockwise from NORTH --------------------------------
// The first formula was atan2(dLat, dLng), which is the maths angle from EAST. Every
// bus was drawn 90° out and mirrored, and a bus sitting AT a stop was drawn pointing
// north. Both are asserted here, because "the buses look wrong" is the report this has
// to prevent.
{
  const mk = (a: [number, number], b: [number, number]) => ({
    routes: {
      "KMB_1_1_O": {
        co: "KMB",
        route: "1",
        service_type: 1,
        bound: "O",
        orig_tc: "甲",
        dest_tc: "乙",
        stops: [{ seq: 1, stop: "A" }, { seq: 2, stop: "B" }],
      },
    },
    stops: {
      A: { name: "A", lat: a[0], lng: a[1] },
      B: { name: "B", lat: b[0], lng: b[1] },
    },
  });
  const eta = (seq: number, minutes: number) => [{
    co: "KMB", route: "1", service_type: 1, dir: "O", seq,
    dest_tc: "", rmk_tc: "", data_timestamp: "",
    eta: new Date(Date.now() + minutes * 60_000).toISOString(),
  }] as never;

  // North: one degree of latitude apart, same longitude.
  const north = Bus.estimatePositions(eta(2, 1), mk([22.0, 114.0], [22.1, 114.0]) as never);
  assert.ok(Math.abs(north[0]!.bearing) < 1, `northbound bearing ~0°, got ${north[0]!.bearing.toFixed(1)}`);

  // East: same latitude, one degree of longitude apart.
  const east = Bus.estimatePositions(eta(2, 1), mk([22.0, 114.0], [22.0, 114.1]) as never);
  assert.ok(Math.abs(east[0]!.bearing - 90) < 1, `eastbound bearing ~90°, got ${east[0]!.bearing.toFixed(1)}`);

  // A bus already AT its stop still has a heading — it must not fall back to north.
  const arrived = Bus.estimatePositions(eta(2, -0.5), mk([22.0, 114.0], [22.0, 114.1]) as never);
  assert.ok(Math.abs(arrived[0]!.bearing - 90) < 1, `arrived bus keeps its 90° heading, got ${arrived[0]!.bearing.toFixed(1)}`);
  console.log("✓ 巴士 heading: 0°=北、90°=東、到站都保留方向");
}

console.log("bus: 5 組斷言全部通過");
