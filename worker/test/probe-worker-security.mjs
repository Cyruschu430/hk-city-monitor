// probe-worker-security.mjs — test the Worker's actual defences against a running
// instance, rather than reading the code and asserting it looks right.
// AGENTS.md Pitfall 16: a successful build says nothing about behaviour.
const BASE = process.argv[2] || "http://127.0.0.1:8787";

const cases = [
  // [label, url-param, expectedStatus]
  ["allowed host (control)", "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc", 200],
  ["non-registry host", "https://example.com/", 403],
  ["evil TLD lookalike", "https://data.weather.gov.hk.evil.com/", 403],
  ["suffix trick", "https://evil-data.weather.gov.hk.attacker.net/", 403],
  // Blocked by the credentials-in-URL rule before the host check runs, so the
  // code is bad_url rather than host_not_allowed. Either is a correct refusal;
  // what matters is that it is NOT 200 and does not reach evil.com.
  ["userinfo trick", "https://data.weather.gov.hk@evil.com/", 400],
  ["plain http", "http://data.weather.gov.hk/", 400],
  ["credentials in URL", "https://user:pass@data.weather.gov.hk/", 400],
  ["file scheme", "file:///etc/passwd", 400],
  ["metadata service (AWS)", "https://169.254.169.254/latest/meta-data/", 403],
  ["localhost", "https://localhost:8787/health", 403],
  ["internal RFC1918", "https://192.168.1.1/", 403],
  ["port on allowed host", "https://data.weather.gov.hk:8080/", 403],
];

let pass = 0, fail = 0;
for (const [label, target, want] of cases) {
  const url = `${BASE}/proxy?url=${encodeURIComponent(target)}`;
  let status, note = "";
  try {
    const r = await fetch(url, { redirect: "manual" });
    status = r.status;
    if (status !== 200) {
      const body = await r.text();
      try { note = JSON.parse(body).error?.code ?? ""; } catch { note = body.slice(0, 40); }
    }
  } catch (e) {
    status = "ERR";
    note = String(e.message).slice(0, 50);
  }
  const ok = status === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(status).padEnd(4)} (want ${want})  ${label}${note ? `  [${note}]` : ""}`);
}

// Method + route surface
for (const [label, init, want] of [
  ["POST rejected", { method: "POST" }, 405],
  ["unknown route", {}, 404],
]) {
  const url = label === "unknown route" ? `${BASE}/nope` : `${BASE}/proxy?url=https://data.weather.gov.hk/`;
  const r = await fetch(url, init);
  const ok = r.status === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(r.status).padEnd(4)} (want ${want})  ${label}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
