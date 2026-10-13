// glyph-sheet.mjs — every icon the map registers, at the size the map draws it, in one PNG.
//
// WHY THIS EXISTS. The glyphs are canvas drawings built from primitives, so the only honest way
// to review one is to look at it — and at the size a reader actually sees, not the 44px box it
// is drawn in. This pulls the images the map itself registered (`map.getImage`) rather than
// re-drawing them from source: a copy of a draw function drifts, and worse, a copy missing one
// helper fails silently into a blank page.
//
// Usage:
//   node scripts/glyph-sheet.mjs https://hk-city-monitor.pages.dev out.png    # live app
//   node scripts/glyph-sheet.mjs ../dist out.png                             # a build on disk
//
// Needs CHROME_PATH and playwright-core (both already used by the other gates).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const [target, out = "glyph-sheet.png"] = process.argv.slice(2);
if (!target) {
  console.error("usage: node scripts/glyph-sheet.mjs <url|dir> [out.png]");
  process.exit(2);
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".geojson": "application/json",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain",
};

/** Serve a directory on an ephemeral port, so a build on disk can be opened like the live site. */
async function serve(dir) {
  const root = normalize(dir);
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let file = join(root, path);
      const s = await stat(file).catch(() => null);
      if (!s || s.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

const isUrl = /^https?:\/\//.test(target);
const served = isUrl ? null : await serve(target);
const url = isUrl ? target : `http://127.0.0.1:${served.port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(url, { waitUntil: "load" });
// Glyphs are registered when the first point layer is added; the map is on the window for the
// other gates, which is the same handle this uses.
await page.waitForFunction(() => !!window.__map && window.__map.hasImage("bus"), null, { timeout: 90_000 });

const built = await page.evaluate(async () => {
  const ids = window.__map.listImages();
  const canvas = document.createElement("canvas");
  canvas.width = 1180;
  canvas.height = 760;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0f17";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "600 15px system-ui, sans-serif";

  // Two passes: a big one to judge the drawing, and one at 168/44 of the box — the scale the map
  // uses for a 20px marker — to judge whether it survives being small.
  const rows = [
    { y: 40, scale: 168 / 44, label: "as drawn (44px box)" },
    { y: 240, scale: 1, label: "44px box, 1:1" },
    { y: 330, scale: 20 / 44, label: "20px on the map" },
  ];
  const drawn = [];
  for (const row of rows) {
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(row.label, 20, row.y - 14);
    let x = 20;
    for (const id of ids) {
      const img = window.__map.getImage(id);
      if (!img) continue;
      const size = Math.round(44 * row.scale);
      const off = document.createElement("canvas");
      off.width = img.width;
      off.height = img.height;
      off.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      ctx.drawImage(off, x, row.y, size, size);
      if (row.scale > 1) {
        ctx.fillStyle = "#64748b";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(id, x, row.y + size + 14);
      }
      x += size + 16;
      if (row.scale > 1 && x > canvas.width - 200) break;
    }
    drawn.push({ row: row.label, count: ids.length });
  }
  window.__sheet = canvas.toDataURL("image/png");
  return { ids, drawn, w: canvas.width, h: canvas.height };
});

const dataUrl = await page.evaluate(() => window.__sheet);
const png = Buffer.from(String(dataUrl).split(",")[1], "base64");
const { writeFile } = await import("node:fs/promises");
await writeFile(out, png);
await browser.close();
served?.server.close();
console.log(`glyphs registered: ${built.ids.length} — ${built.ids.join(", ")}`);
console.log(`sheet written: ${out} (${(png.length / 1024).toFixed(1)} KB)`);
