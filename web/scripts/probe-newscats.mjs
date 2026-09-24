// probe-newscats.mjs — the news ticker should classify headlines by type
// (Cyrus). Before inventing a classifier, check the publishers' OWN category
// feeds: RTHK publishes one RSS per section and news.gov.hk one per category, so
// the taxonomy can come from the source rather than from keyword guessing.
//
// This prints, per feed: HTTP status, item count, and the newest headline, so a
// feed that returns 200-with-an-empty-shell (Pitfall 10) is visible as such.
import { readFileSync } from "node:fs";

const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";
const sources = JSON.parse(readFileSync("../sources.json", "utf8"));
const list = Array.isArray(sources) ? sources : sources.sources;

const WANT = [
  "rthk_local", "rthk_world", "rthk_finance", "rthk_sport", "rthk_china",
  "gov_news_law_order", "gov_news_admin", "gov_news_finance",
  "gov_news_environment", "gov_news_health", "gov_news_infrastructure",
  "gov_news_school_work", "td_specialtrafficnews",
];

const items = (xml) => (xml.match(/<item[\s>]/g) ?? []).length;
const firstTitle = (xml) => {
  const m = /<item[\s>][\s\S]*?<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(xml);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 48) : "";
};
const firstDate = (xml) => {
  const m = /<pubDate>([^<]+)<\/pubDate>/.exec(xml);
  return m ? m[1].trim() : "";
};

console.log(`${"source".padEnd(34)} ${"HTTP".padEnd(5)} ${"items".padStart(5)}  newest`);
console.log("-".repeat(112));
const ok = [];
for (const id of WANT) {
  const src = list.find((s) => s.id === id);
  if (!src) {
    console.log(`${id.padEnd(34)} (not in sources.json)`);
    continue;
  }
  const url = `${WORKER}/proxy?url=${encodeURIComponent(src.url)}`;
  let status = "ERR", xml = "";
  try {
    const res = await fetch(url);
    status = String(res.status);
    xml = await res.text();
  } catch (e) {
    status = "THROW";
  }
  const n = items(xml);
  console.log(`${id.padEnd(34)} ${status.padEnd(5)} ${String(n).padStart(5)}  ${firstTitle(xml)}  ${firstDate(xml).slice(0, 22)}`);
  if (status === "200" && n > 0) ok.push(id);
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\nusable feeds with items: ${ok.length}/${WANT.length}`);
console.log(ok.join(", "));
