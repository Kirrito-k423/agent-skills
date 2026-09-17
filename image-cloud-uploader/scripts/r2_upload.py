#!/usr/bin/env python3
"""Upload images directly to Cloudflare R2 using an existing PicGo S3 config.

The script reads PicGo's aws-s3 configuration locally, but never prints access
keys or secret keys. It is intended as a fallback when PicGo's local server or
S3 plugin hangs even though the R2 bucket is reachable.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_PICGO_CONFIG = (
    Path.home() / "Library" / "Application Support" / "picgo" / "data.json"
)
SERVICE = "s3"


class UploadError(RuntimeError):
    """Structured upload failure that is safe to print."""


def _load_picgo_s3_config(config_path: Path) -> dict[str, Any]:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    s3 = data.get("picBed", {}).get("aws-s3")
    if not isinstance(s3, dict):
        raise UploadError(f"No picBed.aws-s3 config found in {config_path}")
    required = ["bucketName", "endpoint", "accessKeyID", "secretAccessKey"]
    missing = [key for key in required if not s3.get(key)]
    if missing:
        raise UploadError(f"PicGo aws-s3 config is missing: {', '.join(missing)}")
    return s3


def _normalize_paths(paths: list[str]) -> list[Path]:
    result: list[Path] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        path = path.resolve()
        if not path.exists():
            raise FileNotFoundError(f"File does not exist: {path}")
        if not path.is_file():
            raise ValueError(f"Not a file: {path}")
        result.append(path)
    return result


def _hashes(body: bytes) -> dict[str, str]:
    md5_raw = hashlib.md5(body).digest()
    return {
        "md5": hashlib.md5(body).hexdigest(),
        "md5B64": base64.urlsafe_b64encode(md5_raw).decode("ascii").rstrip("="),
        "md5B64Short": base64.urlsafe_b64encode(md5_raw).decode("ascii").rstrip("=")[:7],
        "sha1": hashlib.sha1(body).hexdigest(),
        "sha256": hashlib.sha256(body).hexdigest(),
    }


def _format_upload_path(template: str, path: Path, body: bytes, now: dt.datetime) -> str:
    ext = path.suffix[1:]
    values = {
        "year": f"{now.year:04d}",
        "month": f"{now.month:02d}",
        "day": f"{now.day:02d}",
        "hour": f"{now.hour:02d}",
        "minute": f"{now.minute:02d}",
        "second": f"{now.second:02d}",
        "millisecond": f"{now.microsecond // 1000:03d}",
        "timestamp": str(int(now.timestamp())),
        "timestampMS": str(int(now.timestamp() * 1000)),
        "fullName": path.name,
        "fileName": path.stem,
        "extName": ext,
        **_hashes(body),
    }

    def replace(match: re.Match[str]) -> str:
        key = match.group("key")
        value = values.get(key, "")
        start = match.group("start")
        length = match.group("length")
        if start is not None and length is not None:
            start_i = int(start)
            return value[start_i : start_i + int(length)]
        if start is not None:
            return value[: int(start)]
        return value

    formatted = re.sub(
        r"\{(?P<key>[A-Za-z0-9]+)(?::(?P<start>\d+)(?:,(?P<length>\d+))?)?\}",
        replace,
        template or "{fullName}",
    )
    return formatted.lstrip("/")


def _endpoint_url(endpoint: str) -> urllib.parse.ParseResult:
    raw = endpoint if re.match(r"^https?://", endpoint) else f"https://{endpoint}"
    parsed = urllib.parse.urlparse(raw.rstrip("/"))
    if parsed.scheme != "https":
        raise UploadError("Only HTTPS R2/S3 endpoints are supported by this fallback")
    if not parsed.netloc:
        raise UploadError("Invalid endpoint in PicGo aws-s3 config")
    return parsed


def _object_url(endpoint: str, bucket: str, key: str, *, path_style: bool = True) -> str:
    parsed = _endpoint_url(endpoint)
    quoted_key = urllib.parse.quote(key, safe="/-_.~")
    quoted_bucket = urllib.parse.quote(bucket, safe="-_.~")
    if path_style:
        path = f"{parsed.path.rstrip('/')}/{quoted_bucket}/{quoted_key}"
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
    host = f"{bucket}.{parsed.netloc}"
    path = f"{parsed.path.rstrip('/')}/{quoted_key}"
    return urllib.parse.urlunparse((parsed.scheme, host, path, "", "", ""))


def _signing_key(secret_key: str, date_stamp: str, region: str) -> bytes:
    def sign(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    date_key = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    region_key = sign(date_key, region)
    service_key = sign(region_key, SERVICE)
    return sign(service_key, "aws4_request")


def _authorization_headers(
    *,
    method: str,
    url: str,
    access_key: str,
    secret_key: str,
    region: str,
    payload_hash: str,
    extra_headers: dict[str, str] | None = None,
    now: dt.datetime | None = None,
) -> dict[str, str]:
    now = now or dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    parsed = urllib.parse.urlparse(url)

    headers: dict[str, str] = {
        "host": parsed.netloc,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    for key, value in (extra_headers or {}).items():
        if value is not None:
            headers[key.lower()] = str(value).strip()

    canonical_headers = "".join(
        f"{key}:{re.sub(r'\\s+', ' ', headers[key]).strip()}\n"
        for key in sorted(headers)
    )
    signed_headers = ";".join(sorted(headers))
    canonical_request = "\n".join(
        [
            method,
            parsed.path or "/",
            parsed.query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{date_stamp}/{region}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(secret_key, date_stamp, region),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    headers["authorization"] = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )
    return headers


def _opener(proxy: str | None) -> urllib.request.OpenerDirector:
    if not proxy:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy, "http": proxy})
    )


def _request(
    method: str,
    url: str,
    headers: dict[str, str],
    *,
    body: bytes | None = None,
    timeout: float,
    proxy: str | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    req = urllib.request.Request(
        url,
        data=body,
        headers={key: value for key, value in headers.items()},
        method=method,
    )
    try:
        with _opener(proxy).open(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        data = exc.read()
        message = data.decode("utf-8", "replace")[:500]
        raise UploadError(f"HTTP {exc.code} from R2/S3 {method}: {message}") from exc
    except urllib.error.URLError as exc:
        raise UploadError(f"Network error during R2/S3 {method}: {exc.reason}") from exc


def _put_object(
    *,
    config: dict[str, Any],
    key: str,
    body: bytes,
    content_type: str,
    region: str,
    timeout: float,
    proxy: str | None,
) -> None:
    url = _object_url(config["endpoint"], config["bucketName"], key, path_style=True)
    payload_hash = hashlib.sha256(body).hexdigest()
    headers = _authorization_headers(
        method="PUT",
        url=url,
        access_key=config["accessKeyID"],
        secret_key=config["secretAccessKey"],
        region=region,
        payload_hash=payload_hash,
        extra_headers={"content-type": content_type},
    )
    _request("PUT", url, headers, body=body, timeout=timeout, proxy=proxy)


def _head_object(
    *,
    config: dict[str, Any],
    key: str,
    region: str,
    timeout: float,
    proxy: str | None,
) -> None:
    url = _object_url(config["endpoint"], config["bucketName"], key, path_style=True)
    headers = _authorization_headers(
        method="HEAD",
        url=url,
        access_key=config["accessKeyID"],
        secret_key=config["secretAccessKey"],
        region=region,
        payload_hash="UNSIGNED-PAYLOAD",
    )
    _request("HEAD", url, headers, timeout=timeout, proxy=proxy)


def _pattern_url(pattern: str, *, bucket: str, key: str) -> str:
    if "{path}" in pattern or "{bucket}" in pattern:
        return pattern.replace("{bucket}", bucket).replace("{path}", key)
    return f"{pattern.rstrip('/')}/{key}"


def _bucket_prefixed_url(url: str, bucket: str, key: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return None
    normalized_key_path = "/" + urllib.parse.quote(key, safe="/-_.~")
    if parsed.path != normalized_key_path:
        return None
    new_path = "/" + urllib.parse.quote(bucket, safe="-_.~") + normalized_key_path
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, new_path, "", parsed.query, parsed.fragment)
    )


def _public_url_candidates(
    config: dict[str, Any],
    key: str,
    explicit_pattern: str | None,
    try_bucket_prefix: bool,
) -> list[str]:
    bucket = config["bucketName"]
    patterns = [explicit_pattern] if explicit_pattern else []
    if config.get("outputURLPattern"):
        patterns.append(str(config["outputURLPattern"]))
    if config.get("urlPrefix"):
        patterns.append(str(config["urlPrefix"]).rstrip("/") + "/{path}")

    seen: set[str] = set()
    urls: list[str] = []
    for pattern in patterns:
        if not pattern:
            continue
        url = _pattern_url(pattern, bucket=bucket, key=key)
        if url not in seen:
            seen.add(url)
            urls.append(url)
        if try_bucket_prefix:
            prefixed = _bucket_prefixed_url(url, bucket, key)
            if prefixed and prefixed not in seen:
                seen.add(prefixed)
                urls.append(prefixed)
    return urls


def _verify_public_url(url: str, timeout: float, proxy: str | None) -> tuple[bool, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "curl/8.0",
            "Accept": "*/*",
        },
        method="HEAD",
    )
    try:
        with _opener(proxy).open(req, timeout=timeout) as resp:
            if 200 <= resp.status < 400:
                return True, f"HTTP {resp.status}"
            return False, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except urllib.error.URLError as exc:
        return False, f"Network error: {exc.reason}"


def _proxy_from_mode(config: dict[str, Any], mode: str) -> str | None:
    if mode == "none":
        return None
    if mode == "config":
        return config.get("proxy") or None
    if mode == "env":
        return os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    raise ValueError(f"Unknown proxy mode: {mode}")


def upload(
    paths: list[str],
    *,
    config_path: Path,
    region: str,
    proxy_mode: str,
    timeout: float,
    public_url_pattern: str | None,
    verify_public: bool,
    try_bucket_prefix: bool,
) -> dict[str, Any]:
    config = _load_picgo_s3_config(config_path)
    proxy = _proxy_from_mode(config, proxy_mode)
    normalized = _normalize_paths(paths)
    now = dt.datetime.now()
    uploads: list[dict[str, Any]] = []

    for path in normalized:
        body = path.read_bytes()
        key = _format_upload_path(str(config.get("uploadPath") or "{fullName}"), path, body, now)
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        _put_object(
            config=config,
            key=key,
            body=body,
            content_type=content_type,
            region=region,
            timeout=timeout,
            proxy=proxy,
        )
        _head_object(config=config, key=key, region=region, timeout=timeout, proxy=proxy)

        candidates = _public_url_candidates(
            config, key, public_url_pattern, try_bucket_prefix
        )
        url = candidates[0] if candidates else None
        public_verified = None
        public_check = None
        if verify_public and candidates:
            public_verified = False
            for candidate in candidates:
                ok, check = _verify_public_url(candidate, timeout, proxy)
                if ok:
                    url = candidate
                    public_verified = True
                    public_check = check
                    break
                public_check = check

        uploads.append(
            {
                "path": str(path),
                "key": key,
                "url": url,
                "public_verified": public_verified,
                "public_check": public_check,
            }
        )

    return {
        "success": True,
        "method": "r2-direct",
        "config": str(config_path),
        "region": region,
        "proxy_mode": proxy_mode,
        "uploads": uploads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="Image files to upload.")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("PICGO_CONFIG", DEFAULT_PICGO_CONFIG)),
        help=f"PicGo data.json path. Default: {DEFAULT_PICGO_CONFIG}",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("R2_REGION", "auto"),
        help="SigV4 region. Cloudflare R2 usually expects auto.",
    )
    parser.add_argument(
        "--proxy-mode",
        choices=["none", "config", "env"],
        default=os.environ.get("R2_PROXY_MODE", "none"),
        help="Proxy source for R2 API and public URL checks. Default: none.",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--public-url-pattern",
        default=os.environ.get("R2_PUBLIC_URL_PATTERN"),
        help="Optional public URL pattern, e.g. https://cdn.example/{bucket}/{path}",
    )
    parser.add_argument(
        "--no-public-check",
        action="store_true",
        help="Do not HEAD-check generated public URL candidates.",
    )
    parser.add_argument(
        "--no-try-bucket-prefix",
        action="store_true",
        help="Do not try https://host/{bucket}/{path} when https://host/{path} fails.",
    )
    args = parser.parse_args()

    try:
        result = upload(
            args.paths,
            config_path=args.config.expanduser(),
            region=args.region,
            proxy_mode=args.proxy_mode,
            timeout=args.timeout,
            public_url_pattern=args.public_url_pattern,
            verify_public=not args.no_public_check,
            try_bucket_prefix=not args.no_try_bucket_prefix,
        )
    except Exception as exc:  # noqa: BLE001 - CLI should return structured failure.
        result = {
            "success": False,
            "method": "r2-direct",
            "error": str(exc),
            "hint": (
                "For Cloudflare R2, use region=auto, path-style URLs, and avoid ACL. "
                "If public URL checks fail, verify the R2 custom domain or r2.dev setting."
            ),
        }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
