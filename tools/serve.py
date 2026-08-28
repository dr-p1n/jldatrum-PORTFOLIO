#!/usr/bin/env python3
"""Local preview that behaves like Cloudflare Pages.

`python3 -m http.server` does not: it 404s on /security because the file is
security.html, it ignores _redirects, and it answers a missing path with its own
plain 404 instead of the site's. Every one of those differences has already cost
a wrong conclusion during this project — extensionless URLs looked broken, and
the 301s could not be checked at all before deploying.

    python3 tools/serve.py [port]
"""
import http.server, os, re, socketserver, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3456


def load_redirects():
    rules, path = [], os.path.join(ROOT, "_redirects")
    if not os.path.exists(path):
        return rules
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"\s+", line)
            if len(parts) >= 2:
                code = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 301
                rules.append((parts[0], parts[1], code))
    return rules


REDIRECTS = load_redirects()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def resolve(self, path):
        """Cloudflare Pages' file resolution order."""
        rel = urllib.parse.unquote(path.lstrip("/"))
        for candidate in (rel,
                          os.path.join(rel, "index.html") if rel else "index.html",
                          rel + ".html" if rel and not rel.endswith("/") else None):
            if not candidate:
                continue
            full = os.path.join(ROOT, candidate)
            if os.path.isfile(full):
                return "/" + candidate.replace(os.sep, "/")
        return None

    def do_GET(self):
        p = urllib.parse.urlsplit(self.path).path
        for src, dst, code in REDIRECTS:
            if p == src or p.rstrip("/") == src.rstrip("/"):
                self.send_response(code)
                self.send_header("Location", dst)
                self.end_headers()
                return
        hit = self.resolve(p)
        if hit:
            self.path = hit
            return super().do_GET()
        self.send_error_page()

    def send_error_page(self):
        body = b"Not found"
        custom = os.path.join(ROOT, "404.html")
        if os.path.isfile(custom):
            with open(custom, "rb") as fh:
                body = fh.read()
        self.send_response(404)                      # a real 404, like production
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Send the production security headers, so a CSP that only fails in
        # production cannot pass here. Without this the preview happily runs
        # inline script the real site blocks, which is exactly the class of
        # failure that is silent in a browser and invisible in a screenshot.
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


def load_headers():
    """Read _headers and keep the wildcard block. HSTS is dropped on purpose:
    sent over http://localhost it pins the browser to https for the whole port
    and there is no server there — it breaks the preview until the pin
    expires."""
    out, path = {}, os.path.join(ROOT, "_headers")
    if not os.path.isfile(path):
        return out
    inside = False
    for line in open(path, encoding="utf-8"):
        if line.startswith("/"):
            inside = line.strip() == "/*"
            continue
        if not inside:
            continue
        if ":" in line and line.startswith((" ", "\t")):
            k, v = line.split(":", 1)
            k = k.strip()
            if k.lower() == "strict-transport-security":
                continue
            out[k] = v.strip()
    return out


SECURITY_HEADERS = load_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as srv:
        print(f"jldatrum preview on http://127.0.0.1:{PORT}  "
              f"({len(REDIRECTS)} redirects, clean URLs, real 404s, "
              f"{len(SECURITY_HEADERS)} security headers)")
        srv.serve_forever()
