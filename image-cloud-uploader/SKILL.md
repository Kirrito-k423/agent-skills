---
name: image-cloud-uploader
description: Upload local, generated, or repository image files to cloud image hosting through the user's existing PicGo/PicList setup, S3-backed PicGo plugins, or compatible local upload server. Use when the user asks to upload images, move generated illustrations to cloud storage, replace local Markdown image paths with remote URLs, or preserve images outside the git repository.
---

# Image Cloud Uploader

## Overview

Use this skill to turn local image files into stable cloud URLs without exposing cloud credentials. Prefer the user's existing PicGo/PicList local server. When PicGo's S3/R2 plugin hangs or fails after accepting the request, fall back to the bundled Cloudflare R2 direct uploader, which reads the existing PicGo config locally and prints only non-secret upload results.

## Default Workflow

1. **Identify image files**
   - Use absolute paths for generated images, screenshots, or repository assets.
   - Preserve originals; never delete generated files after upload.
   - If replacing a Markdown image, record the exact local link before uploading.

2. **Upload through PicGo/PicList first**
   - Prefer `scripts/picgo_upload.py`.
   - The script posts file paths to `http://127.0.0.1:36677/upload` by default.
   - If the server is not reachable, run with `--launch-picgo` or ask the user to open PicGo and enable the server.

3. **Fallback to direct R2 upload when PicGo S3 hangs**
   - Use `scripts/r2_upload.py` when PicGo receives the upload but fails in the S3/R2 phase, especially with `socket hang up`, TLS disconnects, or long waits.
   - The direct uploader reads PicGo's `picBed.aws-s3` config, signs R2 requests itself, and does not print access keys.
   - It uses Cloudflare R2-safe defaults: `region=auto`, path-style S3 URLs, no ACL header, and public URL verification.
   - On this Mac, the public image URL may need the bucket prefix even when PicGo's `outputURLPattern` omits it; the script tries both `{path}` and `{bucket}/{path}` candidates.

4. **Verify the returned URL**
   - Confirm the script reports `success: true` and returns one URL per input file.
   - Do not print or inspect PicGo config secrets.
   - For Markdown updates, replace only the intended local image path with the returned URL.

5. **Report clearly**
   - List uploaded local path -> cloud URL mappings.
   - Mention any Markdown files updated.
   - Mention failures with the PicGo server status or HTTP error.

## Quick Commands

Upload one image:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/picgo_upload.py \
  /absolute/path/to/image.png
```

Launch PicGo first, then upload:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/picgo_upload.py \
  --launch-picgo \
  /absolute/path/to/image.png
```

Upload several images:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/picgo_upload.py \
  /absolute/path/01.png \
  /absolute/path/02.png
```

Fallback upload directly to Cloudflare R2 using PicGo's S3 config:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/r2_upload.py \
  /absolute/path/to/image.png
```

If the R2 API endpoint needs the user's local proxy:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/r2_upload.py \
  --proxy-mode config \
  /absolute/path/to/image.png
```

If the public URL pattern is known, provide it explicitly:

```bash
python3 /Users/Zhuanz/.codex/skills/image-cloud-uploader/scripts/r2_upload.py \
  --public-url-pattern 'https://cdn.example.com/{bucket}/{path}' \
  /absolute/path/to/image.png
```

The script outputs JSON:

```json
{
  "success": true,
  "method": "picgo-server",
  "server": "http://127.0.0.1:36677/upload",
  "uploads": [
    {
      "path": "/absolute/path/to/image.png",
      "url": "https://example-cdn/path/image.png"
    }
  ]
}
```

## Markdown Replacement Rules

When updating Markdown:

- Replace local repository links such as `/image/foo.png` or `static/image/foo.png` with the returned URL.
- Keep alt text unchanged.
- Do not replace unrelated images.
- If the user wants both local fallback and cloud URL, add the cloud URL as a new image line and leave the local image in place.

## Safety

- Do not read, display, or commit PicGo config secrets.
- Do not upload images unless the user has asked for cloud persistence.
- Do not delete local images after upload.
- If a file may contain private or sensitive content, confirm before uploading.
- If editing PicGo config is necessary, change only non-secret fields and state the exact fields changed. Do not rewrite or print access keys.

## References

Read `references/picgo.md` only when troubleshooting PicGo/PicList behavior, local server settings, or MCP alternatives.
