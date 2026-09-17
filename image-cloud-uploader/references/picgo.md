# PicGo / PicList Notes

## Local Server

PicGo and PicList commonly expose a local upload API:

```text
POST http://127.0.0.1:36677/upload
Content-Type: application/json

{"list":["/absolute/path/to/image.png"]}
```

Expected response shapes vary slightly by app/version. Common successful forms include:

```json
{"success":true,"result":["https://cdn.example/image.png"]}
```

or a JSON object containing a `result`, `url`, `urls`, or `data` field. The bundled script accepts the common shapes and returns normalized mappings.

If `GET /upload` returns `404`, the server may still be running; use `POST`.

## Current Machine Clues

On this Mac, PicGo is installed at:

```text
/Applications/PicGo.app
```

PicGo's user data is commonly under:

```text
/Users/Zhuanz/Library/Application Support/picgo
```

Do not read or print secret-bearing config values. This path is useful only for logs, plugins, and confirming that PicGo exists.

## MCP Alternatives

As of 2026-06, community MCP servers exist for PicGo/PicList-style uploading. They usually wrap the same local server API rather than implementing S3 themselves. If the user wants direct MCP integration, prefer installing a narrowly scoped PicGo MCP server and keep S3 credentials in PicGo.

Useful search terms:

- `PicGo MCP server`
- `PicList MCP server`
- `PicGoMCP GitHub`
- `PicGo local server upload 36677`

## Cloudflare R2 Debug Notes

When PicGo's S3 plugin hangs or reports errors like `socket hang up` or `Client network socket disconnected before secure TLS connection was established`, separate the problem into three layers:

1. **R2 API reachability**
   - DNS/TCP/TLS to the account endpoint can be healthy even when PicGo upload fails.
   - For Cloudflare R2, prefer path-style API requests to the account endpoint.

2. **S3 request compatibility**
   - Use `region=auto` for R2.
   - Do not send `ACL: public-read`; R2 does not implement S3 ACL headers for `PutObject`.
   - If using AWS SDK v3, keep request checksum behavior compatible with S3-compatible services, for example `requestChecksumCalculation=WHEN_REQUIRED`.

3. **Public URL mapping**
   - Upload success does not prove the public URL is correct.
   - A custom domain may expose objects as `https://domain/{bucket}/{path}` even when PicGo's configured output pattern says `https://domain/{path}`.
   - Always verify the returned URL with `HEAD` or `curl -I` before replacing Markdown links.

Direct fallback command:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/r2_upload.py \
  /absolute/path/to/image.png
```

If the generated public URL fails but the object exists in R2, retry with an explicit pattern:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/r2_upload.py \
  --public-url-pattern 'https://pic.shaojiemike.top/{bucket}/{path}' \
  /absolute/path/to/image.png
```
