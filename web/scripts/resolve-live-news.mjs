// resolve-live-news.mjs — channel handle -> current LIVE video id, from a residential IP.
//
// WHY THIS RUNS ON THE PC AND NOT THE VPS: YouTube answers a datacenter range with a
// consent/shell page that carries no canonical link, no og:url and no isLiveNow marker —
// every extraction comes back null. The same request from a home IP returns the real watch
// page. MEASURED 2026-09-27: all 12 handles probed from the VPS returned null; the first
// batch from the PC returned real ids. Same reason adsb.fi answers the PC and 403s Cloudflare.
//
// A channel's /live URL resolves to whatever is streaming RIGHT NOW, which is why the
// existing 17-entry list refuses to store one (see _removed in live_streams.json). This
// script does not store anything either — it PRINTS candidates. A 24/7 news channel's id is
// stable for months and is worth listing; an event feed's is not, and that distinction is
// the human's call, not this script's.
//
//   node scripts/resolve-live-news.mjs              # built-in candidate list
//   node scripts/resolve-live-news.mjs @CNA @dwnews # or handles you name
import { readFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const CANDIDATES = [
  // 香港
  "@phoenixtvglobal", "@RTHK", "@HOYTVofficial", "@icable", "@nowtvhk", "@HK01", "@tvbnews",
  // 大中華
  "@CCTV", "@CGTNOfficial", "@cctvchinese", "@TVBSNEWS", "@ctitv", "@setnews", "@ebcnews",
  // 亞太
  "@channelnewsasia", "@NHKWorldJapan", "@arirangtv", "@YonhapNewsTV", "@abctv", "@WION", "@thaipbsenglish",
  // 世界財經
  "@BloombergTelevision", "@business", "@CNBC", "@YahooFinance", "@Reuters", "@SkyNews",
  // 世界新聞
  "@aljazeeraenglish", "@dwnews", "@FRANCE24English", "@euronews", "@NBCNews", "@CBSNews", "@ABCNews",
];

const extract = (b) => {
  const pats = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    /<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    /"isLiveNow":true[^}]{0,400}?"videoId":"([\w-]{11})"/,
    /"videoId":"([\w-]{11})"[^}]{0,400}?"isLiveNow":true/,
    /ytInitialPlayerResponse\s*=\s*\{[^]*?"videoId":"([\w-]{11})"/,
  ];
  for (const p of pats) {
    const m = b.match(p);
    if (m) return m[1];
  }
  return null;
};

const title = (b) =>
  (b.match(/<meta property="og:title" content="([^"]{0,90})"/) ?? [])[1] ??
  (b.match(/<title>([^<]{0,90})<\/title>/) ?? [])[1] ??
  "";

// A 24/7 stream serves hqdefault_live.jpg; a removed video 404s every variant. Same test as
// probe-livestreams.mjs so the two scripts agree on what "live" means.
async function thumbnail(id) {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault_live.jpg`, { method: "HEAD" });
    return res.status;
  } catch {
    return "ERR";
  }
}

const handles = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
console.log(`${handles.length} handles, residential IP\n`);
console.log(`${"handle".padEnd(24)} ${"thumb".padEnd(6)} ${"id".padEnd(13)} title`);
console.log("-".repeat(100));

const found = [];
for (const h of handles) {
  let id = null, t = "", err = "";
  try {
    const res = await fetch(`https://www.youtube.com/${h}/live`, {
      headers: { "user-agent": UA, "accept-language": "zh-HK,zh;q=0.9,en;q=0.8" },
      redirect: "follow",
    });
    const body = await res.text();
    id = extract(body);
    t = title(body);
  } catch (e) {
    err = String(e).slice(0, 40);
  }
  const thumb = id ? await thumbnail(id) : "-";
  const verdict = id && thumb === 200 ? "LIVE" : id ? "id?" : "none";
  console.log(
    `${h.padEnd(24)} ${String(thumb).padEnd(6)} ${String(id ?? "-").padEnd(13)} ${t.slice(0, 50)}${err ? "  ERR " + err : ""}`,
  );
  if (id && thumb === 200) found.push({ handle: h, id, title: t });
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`\n${found.length}/${handles.length} resolved to a live stream:`);
for (const f of found) console.log(`  ${f.handle.padEnd(24)} ${f.id}  ${f.title.slice(0, 52)}`);
console.log(
  `\nPaste a row into data/live_streams.json ONLY if the channel streams 24/7 — an event feed's id\n` +
  `dies with the event and recreates the GxMB-EH_lJs bug. Re-check with: node scripts/probe-livestreams.mjs`,
);

// ponytail: sequential with a 200ms gap. 34 handles is not worth a concurrency limit, and
// hammering YouTube from a residential IP is how you get the residential IP blocked too.
