import { parseAeWaiting } from "../src/lib/parsers.ts";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const j = await (await fetch("https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json", { headers: { "User-Agent": UA } })).json();
const { cells, observedAt } = parseAeWaiting(j);
console.log("A&E cells        :", cells.length);
console.log("raw updateTime   :", JSON.stringify(j.updateTime));
console.log("parsed observedAt:", observedAt ? observedAt.toISOString() : "NULL  <-- the bug");
const ageMin = observedAt ? Math.round((Date.now() - observedAt.getTime()) / 60000) : null;
console.log("age (minutes)    :", ageMin);
// 12-hour edge cases
for (const s of ["2026年1月1日 上午12時5分", "2026年1月1日 下午12時30分", "2026年12月31日 下午11時59分"]) {
  const p = (await import("../src/lib/parsers.ts")).parseHkChineseDate(s);
  console.log(`  ${s} -> ${p ? p.toISOString() : "null"}`);
}

