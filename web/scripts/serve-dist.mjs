// serve-dist.mjs — the smallest static server the gates can point at when the deploy is blocked.
//
// It exists so a gate can run against a build ON DISK: the agent ports are unreachable without
// Cloudflare credentials, and "the code is committed but unverified" is not a state to leave a
// change in.
//
// Usage: node scripts/serve-dist.mjs [dir=../dist] [port=8787]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".geojson": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".txt": "text/plain", ".xml": "application/xml", ".csv": "text/csv", ".wasm": "application/wasm",
};

const root = normalize(process.argv[2] ?? "../dist");
const port = Number(process.argv[3] ?? 8787);

createServer(async (req, res) => {
  let body;
  let type = "application/octet-stream";
  try {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(root, path);
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = join(file, "index.html");
    // Read FIRST: writing headers then failing to read them is how a 500 became a crash loop.
    body = await readFile(file);
    type = MIME[extname(file).toLowerCase()] ?? type;
  } catch {
    try {
      body = await readFile(join(root, "index.html")); // SPA fallback, like Pages does
      type = MIME[".html"];
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
  }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
