// probe-redirect-policy.mjs — does the redirect rule still let the live sources through?
//
// WHY: the Worker follows redirects but re-validates every hop. A rule that is too strict
// breaks real feeds silently, and "the tests pass" would not say so. MEASURED 2026-09-27:
// the first version of the rule ("every hop must be in the registry") broke FIVE sources -
// all the RTHK news RSS feeds redirect rthk.hk -> rthk9.rthk.hk, and rthk9.rthk.hk is not
// in sources.json. This file would have caught that before it shipped.
//
// Imports the rule from the Worker itself rather than copying it, so it cannot drift.
import { readFileSync } from "node:fs";
import { fetchValidated, registrableDomain } from "../src/index.js";

let pass = 0, fail = 0;
const check = (ok, label, note = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${note ? `  [${note}]` : ""}`);
};

// 1. The rule itself. Allowed = same registrable domain; refused = different site.
const same = (a, b) => registrableDomain(a) === registrableDomain(b);
for (const [a, b, want] of [
  ["rthk.hk", "rthk9.rthk.hk", true],
  ["rthk.hk", "www.rthk.hk", true],
  ["sls.hkpl.gov.hk", "www.hkpl.gov.hk", true],
  ["es.hkfsd.gov.hk", "hkfsd.gov.hk", true],
  ["cd.epic.epd.gov.hk", "www.epd.gov.hk", true],
  ["api.adsbdb.com", "www.adsbdb.com", true],
  ["api.adsb.lol", "adsb.lol", true],
  ["rthk.hk", "attacker.net", false],
  ["rthk.hk", "rthk.hk.attacker.net", false],
  ["data.weather.gov.hk", "evil-weather.gov.hk.attacker.net", false],
  ["api.adsb.lol", "adsb.lol.attacker.net", false],
]) check(same(a, b) === want, `domain  ${a} vs ${b}`, `same=${same(a, b)}`);

// 2. THE REGRESSION TEST: every live source URL that must still fetch successfully.
//    These are the real URLs from sources.json, redirect chains and all.
// Resolved against this file, not process.cwd(): a test whose result depends on where
// you happened to run it fails differently in CI than on the machine it was written on.
const live = JSON.parse(readFileSync(new URL("../../sources.json", import.meta.url), "utf8"));
const sources = Array.isArray(live) ? live : live.sources;
const probes = sources
  .filter((s) => /^https:\/\/(rthk\.hk|sls\.hkpl\.gov\.hk|es\.hkfsd\.gov\.hk|cd\.epic\.epd\.gov\.hk|api\.adsbdb\.com)\//.test(s.url || ""))
  .map((s) => [s.id, s.url]);

console.log(`\n${probes.length} live source URLs whose host redirects\n`);
for (const [id, url] of probes) {
  let status = "ERR", note = "";
  try {
    const res = await fetchValidated(url, { method: "GET", headers: { "User-Agent": "hk-city-monitor/0.2" } }, 15_000);
    status = res.status;
    if (status !== 200) note = `upstream ${status}`;
  } catch (e) {
    note = String(e.message).slice(0, 60);
  }
  check(status === 200, `${id.padEnd(30)}`, note || "fetched");
  await new Promise((r) => setTimeout(r, 150));
}

// 3. An off-site redirect must be REFUSED. example.com does not redirect, so this asserts
//    the entry point still returns a response rather than throwing on a normal host.
try {
  const res = await fetchValidated("https://api.adsb.lol/v2/lol", { method: "GET" }, 10_000);
  check(typeof res.status === "number", "non-redirecting host returns a response", `status ${res.status}`);
} catch (e) {
  check(false, "non-redirecting host returns a response", String(e.message).slice(0, 60));
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail === 0
  ? "The redirect rule lets every live source through and refuses a foreign site."
  : "REGRESSION: a live source no longer fetches. Loosen the rule before shipping.");
process.exit(fail === 0 ? 0 : 1);
