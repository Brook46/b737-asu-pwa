#!/usr/bin/env python3
"""Local dev server for the B737 Companion PWA.

Serves with no-cache headers so module edits are always picked up on reload
(plain `python -m http.server` lets the browser heuristically cache ES
modules, which serves stale code). Not used in production.

Usage: python3 dev-server.py [port] [directory]
"""

import functools
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    handler = functools.partial(NoCacheHandler, directory=directory)
    print(f'dev-server: serving {directory} on http://localhost:{port}')
    HTTPServer(('', port), handler).serve_forever()
