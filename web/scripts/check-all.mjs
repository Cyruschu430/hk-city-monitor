// check-all.mjs — run every gate, in ONE runner, and report each one.
//
// WHY NOT `npm run a && npm run b && ...`. MEASURED 2026-09-27: the same six browser checks, run
// back to back as an npm `&&` chain, intermittently failed on the last one with
// `readiness timeout on both attempts: the app never booted` — on a build where every check passes
// standalone, the preview server is still answering 200, and no Chromium is left behind (0
// processes, 8.4GB free measured after the heaviest check). Run as plain `node scripts/x.mjs` in
// sequence, all six return exit 0. Nesting npm inside npm on Windows costs a process tree per check
// and buys nothing: the `&&` chain is not isolation and it is not a gate.
//
// TWO THINGS THIS DOES THAT `&&` CANNOT:
//
//   1. It runs EVERY check even after one fails. A chain stops at the first red, so the remaining
//      checks are simply unknown — and "unknown" is how a second defect hides behind a first.
//   2. Per-check output. A chain's failure is a wall of interleaved stdout from six processes; the
//      failing check's own message is somewhere in it, and grepping that wall for the word FAIL is
//      how you end up reading a stale mutant's log as the current result.
//
// The exit code is the WORST result, so this is still a gate: 0 means every check passed.
//
//   node scripts/check-all.mjs            # everything
//   node scripts/check-all.mjs --no-slow  # skip check:quota (35s settle) and check:layers

import { spawnSync } from "node:child_process";

const STEPS = [
  { name: "static    (CSS tokens · encoding · basemap)", cmd: "npm", args: ["run", "check:static"] },
  { name: "tests     (6 assert suites)", cmd: "npm", args: ["test"] },
  { name: "layout", cmd: "node", args: ["scripts/check-layout.mjs"] },
  { name: "contrast", cmd: "node", args: ["scripts/check-contrast.mjs"] },
  { name: "analysis  (10 Tier 2 scenarios)", cmd: "node", args: ["scripts/verify-analysis.mjs"] },
  { name: "carpark", cmd: "node", args: ["scripts/verify-carpark.mjs"] },
  { name: "layers", cmd: "node", args: ["scripts/check-layers.mjs"] },
  { name: "livewall  (inline player)", cmd: "node", args: ["scripts/check-livewall.mjs"] },
  { name: "shell     (header, footer, placard, key)", cmd: "node", args: ["scripts/check-shell.mjs"] },
  { name: "quota", cmd: "node", args: ["scripts/check-quota.mjs"] },
];

const noSlow = process.argv.includes("--no-slow");
const skip = noSlow ? new Set(["layers", "quota"]) : new Set();

const results = [];
const t0 = Date.now();
for (const step of STEPS) {
  const short = step.name.split(" ")[0];
  if (skip.has(short)) {
    results.push({ name: step.name, code: 0, skipped: true, secs: 0 });
    console.log(`SKIP  ${step.name}   (--no-slow)`);
    continue;
  }
  const start = Date.now();
  // `shell: true` so `npm` resolves to npm.cmd on Windows; without it spawnSync cannot find npm.
  const res = spawnSync(step.cmd, step.args, { encoding: "utf8", shell: true });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const secs = (Date.now() - start) / 1000;
  const code = res.status ?? 1;
  // The check's own last non-empty line is its verdict. Printing the whole log here would bury the
  // verdict in the middle of six logs, which is the problem this runner exists to remove.
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const verdict = lines.length ? lines[lines.length - 1].slice(0, 96) : "(no output)";
  console.log(`${code === 0 ? "OK  " : "FAIL"}  ${step.name.padEnd(42)} ${secs.toFixed(1).padStart(5)}s  ${verdict}`);
  if (code !== 0) {
    // Only the failing check gets its log shown, and only the lines that say what broke.
    for (const l of lines.filter((l) => /FAIL|Error|MISSING|timeout|expected|BACKWARDS|EXCEEDED/i.test(l)).slice(0, 8)) {
      console.log(`        ${l.slice(0, 150)}`);
    }
  }
  results.push({ name: step.name, code, secs, verdict });
}

const failed = results.filter((r) => r.code !== 0);
const ran = results.filter((r) => !r.skipped).length;
console.log(
  `\n${failed.length === 0 ? `ALL ${ran} CHECKS OK` : `${failed.length} of ${ran} FAILED`}` +
  `  (${((Date.now() - t0) / 1000).toFixed(0)}s total)`,
);
for (const f of failed) console.log(`  FAILED: ${f.name}`);
process.exit(failed.length ? 1 : 0);
