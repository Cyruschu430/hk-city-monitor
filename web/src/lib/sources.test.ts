// sources.test.ts — single-flight + 30s memo in fetchSource.
//
// The layer engine and the panel engine fetch the SAME source URL together on
// mode activation. Without single-flight both miss the memo at once and the
// upstream gets two hits; without the memo a refresh tick double-fetches too.
// This test counts real hits on a local HTTP server, not mocked fetches.
import { createServer } from "node:http";
import { fetchSource, clearDataCache, type SourceDef } from "./sources.ts";

let hits = 0;
let port = 0;
const server = createServer((_req, res) => {
  hits += 1;
  setTimeout(() => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  }, 120);
});

const src: SourceDef = {
  id: "test_local",
  name: "test",
  name_en: "test",
  type: "dataset",
  url: "",
  auth: "none",
  cadence: "live",
  fetch: "browser",
};

function makeSrc(): SourceDef {
  return { ...src, url: `http://127.0.0.1:${port}/feed.json` };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

server.listen(0, "127.0.0.1", async () => {
  port = (server.address() as { port: number }).port;

  try {
    // 1. two CONCURRENT callers of the same URL → one upstream hit
    hits = 0;
    const [a, b] = await Promise.all([fetchSource(makeSrc()), fetchSource(makeSrc())]);
    assert((await a.json()).ok && (await b.json()).ok, "both callers get data");
    assert(hits === 1, `single-flight: concurrent pair must fetch once, got ${hits}`);
    console.log("✓ single-flight: 層+panel 同時打同 URL → 1 次上游");

    // 2. sequential within the 30s memo → the second call does NOT refetch
    clearDataCache();
    hits = 0;
    const c = await fetchSource(makeSrc()); // 1 server hit
    const d = await fetchSource(makeSrc()); // memo serves this, no hit
    assert((await c.json()).ok && (await d.json()).ok, "memo returns data");
    assert(hits === 1, `memo: second call within TTL must not refetch, got ${hits}`);
    console.log("✓ memo: 30s TTL 內第二次 call → 唔再打上游");

    // 3. cleared cache → refetch
    hits = 0;
    clearDataCache();
    await fetchSource(makeSrc());
    assert(hits === 1, "cleared memo refetches");
    console.log("✓ clearDataCache: 清咗就重新打");

    console.log("sources.test.ts: ALL PASS");
    server.close();
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", (err as Error).message);
    server.close();
    process.exit(1);
  }
});
