// check-encoding.mjs — the project is Traditional Chinese; a file that has been
// round-tripped through a non-UTF-8 encoder contains double-encoded sequences:
// the two-byte UTF-8 of "é" (C3 A9) re-encoded as latin-1 and decoded as UTF-8
// yields a two-character sequence starting with A-tilde. No legitimate CJK text
// produces that, so the signature is unambiguous. (The literals live in
// SIGNATURES below rather than in prose, because writing them here made this
// file flag ITSELF — a self-referencing detector is worse than none.)
//
// Written 2026-09-24 after a `Get-Content | Set-Content` round-trip in PowerShell
// silently corrupted web/src/main.ts (412 non-ASCII characters) and
// web/src/map/overlays.ts. The UI rendered "ç‹€æ…‹" where "狀態" belonged.
// This script exists so that cannot happen again unnoticed.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// A-tilde + a latin-1 letter, and the E-circumflex sequences produced by an
// em dash / section sign / middle dot. Built from code points so the source file
// cannot accidentally contain a matching literal.
const A_TILDE = String.fromCharCode(0xc3);
const E_CIRC = String.fromCharCode(0xe2);
const SIGNATURES = [
  A_TILDE + String.fromCharCode(0xa9),
  A_TILDE + String.fromCharCode(0xa8),
  A_TILDE + String.fromCharCode(0xa4),
  A_TILDE + String.fromCharCode(0xa5),
  A_TILDE + String.fromCharCode(0xa6),
  A_TILDE + String.fromCharCode(0xa7),
  A_TILDE + String.fromCharCode(0xa2),
  E_CIRC + String.fromCharCode(0x20ac),
  E_CIRC + String.fromCharCode(0x2122),
  String.fromCharCode(0xc2) + String.fromCharCode(0xa7),
  String.fromCharCode(0xc2) + String.fromCharCode(0xb7),
];

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node check-encoding.mjs <dir-or-file>...");
  process.exit(2);
}

function walk(p, out = []) {
  let entries;
  try {
    entries = readdirSync(p, { withFileTypes: true });
  } catch {
    return out; // a file, not a directory
  }
  for (const e of entries) {
    const full = join(p, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|css|json|py|mjs|md)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = roots.flatMap((r) => {
  const asDir = walk(r);
  return asDir.length > 0 ? asDir : [r];
});

let bad = 0;
for (const f of files) {
  let s;
  try {
    s = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const hits = SIGNATURES.filter((sig) => s.includes(sig));
  if (hits.length === 0) continue;
  bad++;
  // Point at the first offending line so the fix is obvious.
  const lines = s.split(/\r?\n/);
  const idx = lines.findIndex((l) => hits.some((h) => l.includes(h)));
  console.error(`${f}:${idx + 1}  double-encoded text (${hits.length} kind(s))`);
  console.error(`    ${lines[idx]?.trim().slice(0, 100)}`);
}

if (bad > 0) {
  console.error(`\nENCODING FAILED: ${bad} file(s) contain double-encoded text.`);
  console.error("Almost certainly a PowerShell Get-Content/Set-Content round-trip.");
  console.error("Restore from git and redo the edit with the file tools.");
  process.exit(1);
}
console.log(`encoding OK: ${files.length} files checked, no double-encoded text`);
