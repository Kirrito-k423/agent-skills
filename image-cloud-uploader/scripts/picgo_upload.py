#!/usr/bin/env python3
"""Upload local images through PicGo/PicList local server.

This script does not read PicGo config or cloud credentials. It sends absolute
file paths to PicGo's local upload server and normalizes the returned URLs.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_SERVER = "http://127.0.0.1:36677/upload"


def _post_json(url: str, payload: dict[str, Any], timeout: float) -> tuple[int, str]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        return exc.code, body


def _launch_picgo() -> None:
    subprocess.run(
        ["open", "-gj", "-a", "PicGo"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def _extract_urls(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str):
        if value.startswith("http://") or value.startswith("https://"):
            urls.append(value)
        return urls
    if isinstance(value, list):
        for item in value:
            urls.extend(_extract_urls(item))
        return urls
    if isinstance(value, dict):
        for key in ("url", "imgUrl", "src"):
            urls.extend(_extract_urls(value.get(key)))
        for key in ("result", "urls", "data", "files", "output"):
            urls.extend(_extract_urls(value.get(key)))
    return urls


def _normalize_paths(paths: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        path = path.resolve()
        if not path.exists():
            raise FileNotFoundError(f"File does not exist: {path}")
        if not path.is_file():
            raise ValueError(f"Not a file: {path}")
        normalized.append(str(path))
    return normalized


def upload(paths: list[str], server: str, timeout: float, launch_picgo: bool) -> dict[str, Any]:
    abs_paths = _normalize_paths(paths)
    attempts = 1
    if launch_picgo:
        _launch_picgo()
        attempts = 8

    last_status: int | None = None
    last_body = ""
    last_error: str | None = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(1.5)
        try:
            status, body = _post_json(server, {"list": abs_paths}, timeout)
            last_status, last_body = status, body
            if 200 <= status < 300:
                parsed = json.loads(body)
                urls = _extract_urls(parsed)
                if len(urls) < len(abs_paths):
                    raise RuntimeError(
                        f"PicGo returned {len(urls)} URL(s) for {len(abs_paths)} file(s): {body[:500]}"
                    )
                return {
                    "success": True,
                    "method": "picgo-server",
                    "server": server,
                    "uploads": [
                        {"path": path, "url": url}
                        for path, url in zip(abs_paths, urls)
                    ],
                    "raw_success": parsed.get("success") if isinstance(parsed, dict) else None,
                }
            last_error = f"HTTP {status}: {body[:500]}"
        except (OSError, RuntimeError, json.JSONDecodeError) as exc:
            last_error = str(exc)

    return {
        "success": False,
        "method": "picgo-server",
        "server": server,
        "paths": abs_paths,
        "status": last_status,
        "body": last_body[:1000],
        "error": last_error,
        "hint": "Open PicGo/PicList, enable its server on port 36677, then retry. A GET /upload 404 is normal; POST is required.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="Image files to upload.")
    parser.add_argument(
        "--server",
        default=os.environ.get("PICGO_SERVER", DEFAULT_SERVER),
        help=f"PicGo/PicList upload endpoint. Default: {DEFAULT_SERVER}",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--launch-picgo",
        action="store_true",
        help="Launch PicGo.app and wait briefly before uploading.",
    )
    args = parser.parse_args()

    try:
        result = upload(args.paths, args.server, args.timeout, args.launch_picgo)
    except Exception as exc:  # noqa: BLE001 - CLI should return structured failure.
        result = {"success": False, "error": str(exc)}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
