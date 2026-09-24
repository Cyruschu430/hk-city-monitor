// probe-tile-html.mjs — check every tile/resource URL the style uses, and whether
// any returns HTML instead of an image. MapLibre's decode failure has to come
// from somewhere it fetched.
import { readFileSync } from "node:fs";

const style = JSON.parse(readFileSync("C:/hk-city-monitor/web/public/basemap/style.json", "utf8"));
console.log("sources in style:");
for (const [id, s] of Object.entries(style.sources ?? {})) {
  console.log(`  ${id}: type=${s.type}`);
  const tiles = s.tiles ?? (s.url ? [s.url] : []);
  for (const t of tiles.slice(0, 1)) console.log(`     ${String(t).slice(0, 100)}`);
  if (s.data) console.log(`     data-url: ${String(s.data).slice(0, 90)}`);
}

// Fetch one tile from each raster source and check the magic bytes.
console.log("\nfetching a sample tile per raster source:");
for (const [id, s] of Object.entries(style.sources ?? {})) {
  if (s.type !== "raster") continue;
  const tpl = (s.tiles ?? [])[0];
  if (!tpl) continue;
  const url = tpl.replace("{z}", "12").replace("{x}", "3346").replace("{y}", "1783")
                  .replace("{ratio}", "").replace("{bbox-epsg-3857}", "0");
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const b = [...buf.slice(0, 4)];
    const isPng = b[0] === 0x89 && b[1] === 0x50;
    const isJpg = b[0] === 0xff && b[1] === 0xd8;
    const head = buf.slice(0, 40).toString("utf8").replace(/\s+/g, " ");
    console.log(`  ${id.padEnd(18)} ${r.status} ${r.headers.get("content-type")} ${buf.length}b ${isPng ? "PNG" : isJpg ? "JPEG" : "NOT-IMAGE"} ${isPng || isJpg ? "" : `head="${head}"`}`);
  } catch (e) {
    console.log(`  ${id.padEnd(18)} ERR ${e.message.slice(0, 60)}`);
  }
}
