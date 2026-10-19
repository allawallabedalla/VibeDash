"""HTTP service of the VibeDash modules (stdlib only). Only the VibeDash server talks to it.

  GET  /gesund                        {ok, modules, errors}
  GET  /board/<module>                board JSON (src/model/board.ts)
  POST /board/<module>/action         {board, item, action, text?, date?}; header X-VibeDash-Action: 1
  GET  /feed/<module>/<name>          e.g. /feed/wartung/kalender.ics (passed on by the server at /feed/…)

Binds to 127.0.0.1 by default (MODULES_HOST, MODULES_PORT=8091). Configs are read again on every request, so a
changed config needs no restart.
"""

from __future__ import annotations

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import load_modules, modules_dir

NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
FEED = re.compile(r"^[a-z0-9_-]{1,40}\.[a-z]{2,4}$")
MAX_BODY = 8192


class Handler(BaseHTTPRequestHandler):
    server_version = "vibedash-modules"
    base: str = ""

    def log_message(self, fmt, *args):  # quiet: one line per error only
        pass

    def _send(self, status: int, body, ctype: str = "application/json; charset=utf-8") -> None:
        data = (
            body
            if isinstance(body, bytes)
            else (
                body.encode("utf-8")
                if isinstance(body, str)
                else json.dumps(body, ensure_ascii=False, default=str).encode()
            )
        )
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _mods(self):
        return load_modules(self.base)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        try:
            if path == "/gesund":
                m = self._mods()
                return self._send(200, {"ok": True, "modules": sorted(m["modules"]), "errors": m["errors"]})
            parts = path.strip("/").split("/")
            if len(parts) == 2 and parts[0] == "board" and NAME.match(parts[1]):
                mod = self._mods()["modules"].get(parts[1])
                if not mod:
                    return self._send(404, {"error": "unknown_module"})
                return self._send(200, mod.board())
            if len(parts) == 3 and parts[0] == "feed" and NAME.match(parts[1]) and FEED.match(parts[2]):
                mod = self._mods()["modules"].get(parts[1])
                ctype = getattr(mod, "feeds", {}).get(parts[2]) if mod else None
                body = mod.feed(parts[2]) if ctype else None
                if body is None:
                    return self._send(404, {"error": "unknown_feed"})
                return self._send(200, body, ctype)
            return self._send(404, {"error": "not_found"})
        except Exception as e:  # noqa: BLE001
            print(f"GET {path}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            return self._send(500, {"error": "module_failed"})

    def do_POST(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        parts = path.strip("/").split("/")
        if not (len(parts) == 3 and parts[0] == "board" and parts[2] == "action" and NAME.match(parts[1])):
            return self._send(404, {"error": "not_found"})
        if self.headers.get("X-VibeDash-Action") != "1":
            return self._send(403, {"ok": False, "error": "only from the VibeDash server"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._send(413, {"ok": False, "error": "too_large"})
            d = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(d, dict):
                raise ValueError
        except ValueError:
            return self._send(400, {"ok": False, "error": "bad_json"})
        try:
            mod = self._mods()["modules"].get(parts[1])
            if not mod or not hasattr(mod, "action"):
                return self._send(404, {"ok": False, "error": "no_actions"})
            status, body = mod.action(d)
            return self._send(status, body)
        except Exception as e:  # noqa: BLE001
            print(f"POST {path}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            return self._send(500, {"ok": False, "error": "module_failed"})


def serve(host: str | None = None, port: int | None = None, base: str | None = None) -> ThreadingHTTPServer:
    Handler.base = base or modules_dir()
    srv = ThreadingHTTPServer(
        (
            host if host is not None else os.environ.get("MODULES_HOST", "127.0.0.1"),
            port if port is not None else int(os.environ.get("MODULES_PORT", "8091")),
        ),
        Handler,
    )
    return srv
