#!/usr/bin/env python3
"""Self-check for probe_sources.py — run: python3 scripts/test_probe_sources.py

Both cases here caused a WORKING source to be published as 🔴 dead in SOURCES.md:

  1. A URL template (`.../{z}/{x}/{y}.png`) probed literally → the braces 404.
  2. A POST-only endpoint probed with GET. MTR's feeder-bus ETA answers a GET with
     404, not 405, so the existing needs-params branch never fires.

So this does not assert on strings — it stands up a real HTTP server that refuses
GET and answers POST, and checks which way the real code goes.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import probe_sources as P  # noqa: E402


class PostOnly(BaseHTTPRequestHandler):
    def do_GET(self):                                    # the exact trap: 404, not 405
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'{"error":"not found"}')

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(n) or b"{}")
        body = json.dumps({"ok": True, "echo": payload}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):                # keep the test output clean
        pass


def main() -> int:
    srv = HTTPServer(("127.0.0.1", 0), PostOnly)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/eta"

    base = {"id": "t", "group": "transport", "name": "t", "type": "json"}

    # 1) GET on a POST-only endpoint must NOT be reported as ok
    plain = P.probe({**base, "url": url})
    assert plain["status"] != "ok", f"a GET-only probe claimed success: {plain}"

    # 2) declaring the method makes the same endpoint genuinely probeable
    declared = P.probe({**base, "url": url, "method": "POST", "body": '{"routeName":"K51"}'})
    assert declared["status"] == "ok", f"declared POST still failed: {declared}"
    assert "echo" in declared["shape"] or "JSON" in declared["shape"], declared["shape"]

    # 3) a URL template is not fetchable as-is and must say so, not 404
    tmpl = P.probe({**base, "url": "https://example.invalid/tiles/{z}/{x}/{y}.png"})
    assert tmpl["status"] == "unprobeable", tmpl
    assert "template" in tmpl["detail"], tmpl["detail"]

    srv.shutdown()
    print("SELF-TEST OK — a POST-only endpoint needs method:POST to read ok, a GET on it does not, "
          "and a {z}/{x}/{y} template reports unprobeable instead of a false 404")
    return 0


if __name__ == "__main__":
    sys.exit(main())
