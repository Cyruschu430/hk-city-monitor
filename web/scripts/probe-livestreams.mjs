// probe-livestreams.mjs — which curated live streams still have a thumbnail?
//
// MEASURED 2026-09-24: the browser harness failed intermittently with a 404 on
// `i.ytimg.com/vi/GxMB-EH_lJs/hqdefault_live.jpg` (RTHK 香港電台 直播). All three
// thumbnail variants 404 for that id, so the video is gone — a DEAD ENTRY in
// data/live_streams.json, not a flaky request. YouTube only serves
// `hqdefault_live.jpg` while a stream is actually live, and serves neither that
// nor `hqdefault.jpg` for a removed video, which is how the two cases are told
// apart here.
import { readFileSync } from "node:fs";

const j = JSON.parse(readFileSync("../data/live_streams.json", "utf8"));
const streams = Array.isArray(j) ? j : j.streams ?? j.items ?? [];
console.log(`${streams.length} curated streams\n`);
console.log(`${"id".padEnd(14)} ${"live".padEnd(5)} ${"std".padEnd(5)} ${"max".padEnd(5)} verdict   title`);
console.log("-".repeat(96));

const status = async (url) => {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return String(res.status);
  } catch {
    return "ERR";
  }
};

const dead = [];
const noLive = [];
for (const s of streams) {
  const id = s.id;
  const base = `https://i.ytimg.com/vi/${id}`;
  const [live, std, max] = await Promise.all([
    status(`${base}/hqdefault_live.jpg`),
    status(`${base}/hqdefault.jpg`),
    status(`${base}/maxresdefault.jpg`),
  ]);
  // A removed video 404s on EVERY variant. A stream that merely is not live right
  // now still has a standard thumbnail.
  const verdict = std === "404" && max === "404" ? "DEAD" : live === "200" ? "live" : "ok";
  if (verdict === "DEAD") dead.push({ id, title: s.title });
  else if (verdict === "ok") noLive.push({ id, title: s.title });
  console.log(`${id.padEnd(14)} ${live.padEnd(5)} ${std.padEnd(5)} ${max.padEnd(5)} ${verdict.padEnd(9)} ${(s.title ?? "").slice(0, 44)}`);
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`\nDEAD (video removed — must be removed from live_streams.json or replaced): ${dead.length}`);
for (const d of dead) console.log(`  · ${d.id}  ${d.title}`);
console.log(`\nnot currently live but valid (standard thumbnail present): ${noLive.length}`);
for (const d of noLive) console.log(`  · ${d.id}  ${d.title}`);
