#!/usr/bin/env python3
"""
Liberty Cut — zero-dependency app server.

Serves the static studio UI and proxies the ComfyUI API so the browser
never has to deal with CORS:

  /                 -> app/index.html (and other static files from repo root)
  /comfy/<path>     -> http://$COMFY_HOST:$COMFY_PORT/<path>   (default 127.0.0.1:8188)
  /assemble  (POST) -> downloads finished shot MP4s from ComfyUI output,
                       concatenates them with ffmpeg into app/output/scene.mp4,
                       returns {"file": "output/scene.mp4"}.
                       Requires ffmpeg on PATH; returns HTTP 501 JSON if absent.

Usage:
  python3 app/server.py            # http://127.0.0.1:8190
  COMFY_PORT=8188 PORT=8190 python3 app/server.py
"""

import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1")
COMFY_PORT = int(os.environ.get("COMFY_PORT", "8188"))
PORT = int(os.environ.get("PORT", "8190"))
OUTPUT_DIR = os.path.join(REPO_ROOT, "app", "output")

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
    # A same-origin proxy must not forward the browser's Origin/Referer:
    # current ComfyUI rejects POSTs whose Origin host differs from the
    # Host it serves (403, empty body) — found live 2026-10-17.
    "origin", "referer",
}


def comfy_request(method, path, body=None, headers=None, timeout=120):
    """One raw request to the local ComfyUI server. Returns (status, ctype, bytes)."""
    conn = http.client.HTTPConnection(COMFY_HOST, COMFY_PORT, timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, resp.getheader("Content-Type") or "application/octet-stream", data
    finally:
        conn.close()


class Handler(SimpleHTTPRequestHandler):
    server_version = "LibertyCut/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    # -- helpers ---------------------------------------------------------
    def _send_json(self, status, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # keep the console readable
        sys.stderr.write("[libertycut] %s\n" % (fmt % args))

    # -- routing ---------------------------------------------------------
    def do_GET(self):
        if self.path == "/":
            self.path = "/app/index.html"
            return super().do_GET()
        if self.path.startswith("/comfy/"):
            return self._proxy()
        if self.path == "/api/health":
            return self._health()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/comfy/"):
            return self._proxy()
        if self.path == "/assemble":
            return self._assemble()
        self._send_json(404, {"error": "not found"})

    # -- ComfyUI proxy ---------------------------------------------------
    def _proxy(self):
        target = self.path[len("/comfy"):]  # keep leading slash + query string
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP
        }
        try:
            status, ctype, data = comfy_request(
                self.command, target, body=body, headers=headers
            )
        except OSError as exc:
            return self._send_json(
                502, {"error": f"ComfyUI unreachable at {COMFY_HOST}:{COMFY_PORT}: {exc}"}
            )
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _health(self):
        try:
            status, _, data = comfy_request("GET", "/system_stats", timeout=5)
            stats = json.loads(data.decode("utf-8", "replace"))
            devices = stats.get("devices", [])
            vram = devices[0].get("vram_total") if devices else None
            return self._send_json(200, {
                "comfy": "ok",
                "comfy_version": stats.get("system", {}).get("comfyui_version"),
                "device": devices[0].get("name") if devices else None,
                "vram_total": vram,
                "ffmpeg": bool(shutil.which("ffmpeg")),
            })
        except Exception as exc:  # ComfyUI down is a state, not a server error
            return self._send_json(200, {
                "comfy": "unreachable",
                "detail": str(exc),
                "ffmpeg": bool(shutil.which("ffmpeg")),
            })

    # -- Shot assembly (ffmpeg concat) ------------------------------------
    def _assemble(self):
        if not shutil.which("ffmpeg"):
            return self._send_json(501, {
                "error": "ffmpeg not found on PATH — shots are still available "
                         "individually in the gallery."
            })
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            files = payload["files"]  # [{"filename": ..., "subfolder": ..., "type": "output"}]
            if not files:
                raise ValueError("no files supplied")
        except Exception as exc:
            return self._send_json(400, {"error": f"bad /assemble payload: {exc}"})

        os.makedirs(OUTPUT_DIR, exist_ok=True)
        tmp = tempfile.mkdtemp(prefix="libertycut-")
        try:
            local_parts = []
            for i, f in enumerate(files):
                query = urllib.parse.urlencode({
                    "filename": f.get("filename", ""),
                    "subfolder": f.get("subfolder", ""),
                    "type": f.get("type", "output"),
                })
                status, _, data = comfy_request("GET", "/view?" + query, timeout=300)
                if status != 200:
                    return self._send_json(502, {
                        "error": f"could not fetch shot {f.get('filename')} from ComfyUI (HTTP {status})"
                    })
                part = os.path.join(tmp, f"shot_{i:02d}.mp4")
                with open(part, "wb") as fh:
                    fh.write(data)
                local_parts.append(part)

            listfile = os.path.join(tmp, "concat.txt")
            with open(listfile, "w", encoding="utf-8") as fh:
                for part in local_parts:
                    fh.write("file '%s'\n" % part.replace("'", "'\\''"))

            out_name = "scene.mp4"
            out_path = os.path.join(OUTPUT_DIR, out_name)
            # Re-encode (not stream-copy) so clips from separate runs always join cleanly.
            cmd = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-movflags", "+faststart", out_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
            if proc.returncode != 0:
                return self._send_json(500, {
                    "error": "ffmpeg assembly failed",
                    "detail": proc.stderr[-2000:],
                })
            return self._send_json(200, {"file": f"app/output/{out_name}", "shots": len(local_parts)})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Liberty Cut UI:  http://127.0.0.1:{PORT}")
    print(f"ComfyUI target:  http://{COMFY_HOST}:{COMFY_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
