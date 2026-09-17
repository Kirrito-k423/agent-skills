---
name: paper-figure-supplement
description: "Supplement Chinese Hugo paper notes or technical Markdown articles with two source-backed images for a paper, paper section, or concept: (1) a logic/scheme figure explaining the concept or method, and (2) the strongest experimental evidence figure/table. Use when asked to add paper figures, crop figures from a paper PDF, illustrate a paper concept, update Markdown image links, upload paper-note images to cloud storage, or push the document update."
---

# Paper Figure Supplement

## Overview

Use this skill to add exactly two useful images to a paper note:

1. **Logic figure**: explains the concept logic, method pipeline, architecture, or paper proposal.
2. **Evidence figure/table**: the most convincing experiment, ablation, benchmark table, or qualitative result supporting the paper's claim.

Prefer screenshots or crops from the original paper. Use `ian-xiaohei-illustrations` only when the paper has no suitable logic figure, the original figure is unavailable/unclear, or a concise generated explanatory figure is more useful for the note. Upload final images with `image-cloud-uploader`, update the Markdown links, then commit and push the intended document changes when the user asks for the full workflow.

## Core Workflow

### 1. Read The Target Note

- Read the specified Markdown file and nearby sections only.
- Identify the target paper, concept, or subsection.
- Locate existing local/remote images so the update does not duplicate a figure already present.
- Preserve front matter, `!!! abstract "导言"`, and `<!-- more -->` markers.

### 2. Locate The Paper Source

- Prefer the paper PDF linked in the note, arXiv, official project pages, conference pages, or author repository assets.
- If the note does not include a source link, search for the paper title or exact method name.
- Save any downloaded PDFs or extracted crops under:

```text
assets/<article-slug>-paper-figures/
```

Use names such as:

```text
01-logic-<paper-or-method>.png
02-evidence-<paper-or-method>.png
```

### 3. Select Two Images

Read `references/selection.md` when deciding between multiple candidate figures/tables.

Choose:

- **Logic image**: overview, architecture, pipeline, algorithm diagram, method comparison, or a generated 小黑 diagram if the paper lacks a clear one.
- **Evidence image**: the single table/plot most directly proving the article's claim, usually main benchmark, core ablation, scaling trend, or qualitative before/after comparison.

Do not add more than two images for one requested paper/concept unless the user explicitly asks.

### 4. Crop Or Generate

For paper-original images:

- Crop only the necessary figure/table region, including its label when helpful.
- Avoid full-page screenshots unless the page itself is a compact table/figure.
- Keep source provenance in the figure caption or nearby sentence.

For generated fallback images:

- Use `ian-xiaohei-illustrations`.
- Generate one standalone 16:9 horizontal article illustration per image.
- Use generated images for the logic image by default; only generate the evidence image when no usable paper experiment figure/table is available.

### 5. Upload And Replace Links

- Use `image-cloud-uploader` to upload final local images.
- Replace only the intended local Markdown image links with returned cloud URLs.
- Keep alt text and useful captions.
- If adding new figures, prefer:

```markdown
<figure markdown>
  ![Short alt text](https://cloud-url/image.png){ width=90% }
  <figcaption>简短说明，注明来自论文 Figure/Table X 或说明为自绘。</figcaption>
</figure>
```

### 6. Verify, Commit, Push

- Check the document has exactly the requested image additions or replacements.
- Run `git diff --check` on modified Markdown.
- If available, run the repository's Markdown/Hugo validation; otherwise state that it was unavailable.
- Stage only intended files: target Markdown, newly added local image assets if they should remain in repo, and any skill files when creating/updating this skill.
- Commit with a concise message and push the current branch when the user requested push.

## Safety And Quality Rules

- Do not expose PicGo, R2, S3, or paper-site credentials.
- Do not delete local generated/cropped images after upload.
- Do not silently rewrite unrelated document content.
- Do not reproduce large portions of a copyrighted paper; crop only the figure/table needed for commentary and cite the source.
- If a paper figure is low resolution but still readable, prefer it over a generated replacement for evidence.
- If the evidence figure is generated rather than paper-original, label it clearly as a schematic and do not present it as experimental evidence.
