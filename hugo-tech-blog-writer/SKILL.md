---
name: hugo-tech-blog-writer
description: Research a user's question, give a source-backed answer, and turn the result into a polished illustrated Hugo Markdown document. Use when asked to investigate a technical or conceptual topic, research related papers or source code, create or update posts under content/Work, content/Thinking, or content/OutOfWork, add explanatory illustrations and paper evidence figures, upload images to cloud hosting, preserve Hugo front matter and summary markers, or complete an explicitly requested commit-and-push publishing workflow.
---

# Hugo Tech Blog Writer

## Overview

Research the user's actual question before writing. Give a direct evidence-backed answer, then preserve the durable explanation as a self-contained Hugo post with useful illustrations, paper figures, citations, and an optional Git publish step.

Prefer improving an existing article when it already owns the topic. Create a new post only when the topic needs an independent durable home.

## First Checks

1. Read the repository's `AGENTS.md` when present and follow its Markdown writing rules.
2. Read `archetypes/default.md` before creating a new post so front matter follows the local template.
3. Inspect only the relevant part of `content/` needed for the task. Avoid broad scans unless the user asks for a cleanup or taxonomy pass.
4. If a `.codegraph/` directory exists and the task involves locating code concepts, use CodeGraph before text search. For Markdown-only placement, use targeted `rg` or `find` in `content/`.
5. Record `git status --short --branch` before editing. Treat all pre-existing changes as unrelated unless the user explicitly places them in scope.

## End-to-End Workflow

### 1. Frame the question

Restate the user's question as one concrete research objective. Identify:

- the decision, mechanism, comparison, or explanation the user actually needs;
- the expected technical depth and reader background;
- whether the output should update an existing note or create a new durable article;
- whether the request explicitly authorizes image upload, commit, and push.

Make reasonable assumptions when they do not change the article's long-term scope. Ask only when a missing choice would materially change the conclusion, document placement, privacy, or external publication.

### 2. Research before writing

Gather enough primary evidence to answer the question rather than filling a template.

Use the strongest available source for each claim:

1. **Local source code and repository documents** for implementation behavior.
2. **Official documentation, specifications, project pages, release notes, and repositories** for APIs and product behavior.
3. **Original papers and official proceedings** for research claims.
4. **High-quality secondary sources** only for context or when primary material is unavailable.

Browse the web whenever the user requests research, the fact may have changed, a paper/page is referenced but not locally available, or confidence is insufficient. For technical research, prefer primary sources. Use the machine's configured proxy when required.

Maintain a compact evidence ledger while working:

```text
claim -> source -> source date/version -> confidence -> article section
```

For every central claim:

- distinguish source facts from inference;
- record uncertainty, conflicting evidence, and unverified gaps;
- verify quoted numbers, benchmark settings, model versions, and dates against the original source;
- never invent citations, experimental results, code paths, or paper conclusions.

### 3. Answer the user

Form the conclusion before expanding the article. The final response must directly answer the original question, not merely report that a Markdown file was created.

Organize the answer around:

1. the short conclusion;
2. the mechanism or evidence that supports it;
3. important boundaries, trade-offs, or uncertainty;
4. the durable document and publication result.

Make the Markdown article self-contained so it remains useful without the chat context.

### 4. Write the document

Decide whether to update or create, place the article by its logical thesis, maintain front matter, and write from intuition to evidence. Draft the prose before generating images so each figure serves a settled argument rather than an unfinished outline.

### 5. Add visual evidence

Use the visual workflow below only after the core article is coherent. Add images where they materially reduce explanation cost; do not illustrate every section.

### 6. Validate and publish

Validate the Markdown, image URLs, source attribution, and Git diff. Commit and push only under the authorization rules in **Git Publish Workflow**.

## Decide Update Or Create

Prefer updating an existing post when:

- The user names or selects a file.
- A current article already covers the same concept, project, paper, tool, or workflow.
- The request is to add notes, examples, references, corrections, or a section.
- Creating a sibling article would split one logical argument into fragments.

Create a new post when:

- No existing article has a clear claim on the topic.
- The requested topic has a different reader intent, abstraction level, or long-term series.
- The user explicitly wants a new article.
- The new content would make the existing article unfocused or too large.

When uncertain, briefly state the inferred choice and proceed with the safer path. Ask only when placement would materially affect the long-term organization.

## Place By Logical Thesis

Treat directories as an argument map, not just storage:

- `content/Work/`: technical, programming, AI, engineering, papers, work methods, business learning, research notes.
- `content/Thinking/`: cognition, planning, methodology, value judgments, long-term thinking.
- `content/OutOfWork/`: life, health, devices, entertainment, travel, personal matters.

Use deeper folders to express the main conceptual axis. For example:

- `content/Work/Artificial Intelligence/` for AI concepts, model behavior, training, inference, agents, and papers.
- `content/Work/Programming/` for language, tooling, debugging, and software practice.
- `content/Work/HPC/` for performance, systems, accelerators, kernels, and parallel computing.

Respect existing folder names and series conventions. Do not create a new directory level unless it clarifies the article's durable topic.

## Research And Citation Rules

Use citations close to the claims they support.

- Link to official documentation, repositories, project pages, paper abstracts, or proceedings pages.
- For critical paper claims, identify the paper and the relevant Figure, Table, section, or experiment when possible.
- For code claims, identify the repository revision, file, symbol, PR, or commit when available.
- Put detailed source lists in a final `参考资料` section, but do not rely on that section alone for critical attribution.
- Paraphrase sources. Keep direct quotes short and necessary.
- Do not cite search result pages when a direct source exists.
- Label generated diagrams as `自绘示意图`; never present them as original experimental evidence.
- State when a conclusion is an inference across multiple sources.

When several sources disagree, explain the disagreement and prefer conclusions supported by the closest primary evidence.

### Paper research

When the topic has a research literature:

1. Search by the exact method, task, dataset, and mechanism rather than relying on one known title.
2. Build a small relevant set that covers the foundational work, the strongest directly relevant recent work, and meaningful contradictory or limiting evidence when available.
3. Prefer the published version over an older preprint; record the arXiv or proceedings URL, year, and version used.
4. Read beyond the abstract. Inspect the method, experiment setup, main results, ablations, and limitations needed for the article's claims.
5. Separate what the paper authors demonstrate from what the article infers or recommends.
6. Include a paper only when it changes the explanation, evidence, boundary conditions, or practical conclusion.

Choose visual-treatment papers only after this research pass.

## Front Matter

Follow `archetypes/default.md` for field names and style. Maintain these fields carefully:

- `title`: use concise English keyword-style wording, not a full sentence.
- `categories`: use a small number of stable broad classes.
- `series`: use a consistent topic line when the article belongs to a continuing thread.
- `tags`: use searchable keywords; keep proper nouns uppercase when appropriate.
- `summary`: keep concise and aligned with the introduction.
- Existing fields such as `toc`, `date`, `hidden`, `comments`, and `authors`: preserve unless the user asks otherwise.

When editing existing articles, preserve front matter shape and update only fields affected by the content change.

## Article Structure

Use a clear technical essay shape:

1. Start with `!!! abstract "导言"` when the article uses an introduction block.
2. Keep `<!-- more -->` immediately after the introduction block.
3. Explain the intuitive motivation first, then give stricter definitions, derivations, examples, or implementation notes.
4. For Chinese articles, use concise and clear Chinese phrases for Markdown section headings.
5. Keep heading hierarchy reasonable, usually around three levels; avoid both overly flat structure and excessive deep nesting.
6. Use ordered lists for sequences, workflows, priorities, or procedures.
7. Use unordered lists for parallel ideas, caveats, trade-offs, and design dimensions.
8. Indent nested ordered and unordered list items with exactly four spaces.
9. Use **bold** for key judgments, core terms, risks, conclusions, and action items.

For technical posts, prefer sections such as:

- Background
- Core Concept
- Method Or Analysis
- Practical Notes
- Common Pitfalls
- Summary
- References

Adapt the headings to the article; do not force every section if it adds noise.

## Writing Style

Write in Chinese unless the user asks otherwise. Keep English technical terms stable and spaced naturally in Chinese prose.

Use a technical and mildly academic tone:

- Explain complex ideas from intuition to rigor.
- Prefer concrete examples, boundary cases, comparisons, and failure modes.
- Avoid slogans, emoji, filler, and decorative writing.
- Avoid over-layered outlines; preserve linear readability.
- Mark unverified claims, generated notes, or source limitations when relevant.

## Technical Density Rules

For engineering posts, prefer dense technical notes over broad essay framing. Every paragraph should contain at least one of:

- a concrete source fact, code path, API, config field, command, metric, constraint, or failure mode;
- a mechanism that explains how data, control flow, memory, communication, or computation moves;
- an explicit validation method or rollback condition.

Remove text that only says a topic is important, promising, worth studying, or part of a larger plan. Do not add generic "background / motivation / summary" sections unless they carry specific technical information. For PR or codebase analysis, lead with the commit/PR status, changed files, execution path, migration checklist, verification table, and known risks. Use "待测" only in measurement templates, not as a substitute for claims.

## Source Code Evidence Rules

When a technical claim depends on source code, PR diffs, operator wrappers, model patches, or runtime branches, include the smallest useful code excerpt instead of only describing it in prose.

- Show the **key code path**: file/function, branch condition, tensor shape or config field, and the final API/operator call.
- Prefer exact source excerpts for critical logic; use pseudocode only for adaptation sketches or cross-framework normalization.
- Keep excerpts narrow: usually 5-25 lines, omitting imports, comments, and unrelated control flow unless they change behavior.
- Immediately explain what the reader should notice in the snippet: which tensor is constructed, which branch is selected, which operator is called, and what is not handled there.
- For operator migration posts, include at least one real call-site snippet when available. A diagram, formula, or prose paragraph is not a substitute for the call site.
- If the implementation is a two-stage path, show both stages. Example: first construct MRoPE `cos/sin` from `position_ids`, then call `torch_npu.npu_rotary_mul` on q/k.
- Attach a footnote or inline source reference to each critical snippet. Do not leave important code hidden only in references.

## Formula And Diagram Rules

For technical blog posts, avoid leading with dense formulas when the reader's first problem is understanding the mechanism or usage path.

- Prefer **plain mechanism first**: describe what moves from where to where, which code path consumes it, and which tensor/control field decides the behavior.
- Use formulas only when they remove ambiguity. Keep them short, name every symbol nearby, and pair them with one of: a concrete shape example, a small pseudo-code equivalent, a `!!! tip` explanation, or a figure/diagram.
- For operator or kernel posts, always explain the operator at three levels before or alongside formulas:
    - **model position**: which module/layer/subpath is replaced and which parts are not touched;
    - **runtime path**: input tensors, control tensors, grouping/order assumptions, forward/backward behavior;
    - **parallel context**: how the operator behaves under DP/TP/EP/CP when relevant, and where communication happens.
- If a figure or code block is used to explain an operator, the nearby text must answer what the reader should notice in it. Do not rely on a diagram or shape block to explain itself.
- If a formula spans multiple indexed symbols such as `T_e`, `offset_e`, or `W_e`, add a small numeric example. For example, show how tokens are permuted into expert buckets and how `group_list` maps rows to weights.
- Prefer `!!! tip`, `!!! example`, and compact tables for intuition, edge cases, and usage constraints. Use complex equations only after the intuitive explanation is already in place.

Use Material for MkDocs admonitions intentionally:

- `abstract`: overview or core thesis.
- `note`: background or supplemental context.
- `tip`: practical advice.
- `question`: framing question.
- `warning`: risk, trap, or common misunderstanding.
- `example`: concrete example, pseudo-code, or derivation.
- `failure`: failed attempt, anti-pattern, or negative case.

Do not stack many admonitions in a row. Each admonition must have a clear purpose.

## Visual Evidence Workflow

### General article illustrations

Use `$ian-xiaohei-illustrations` for non-paper cognitive anchors such as:

- a central mechanism that is hard to hold in working memory;
- a before/after contrast or failure mode;
- a data/control flow, feedback loop, bottleneck, or state transition;
- a conceptual relationship that benefits from a memorable metaphor.

Follow its shot-list and generation workflow. Default to a small set of high-value figures rather than illustrating every heading. Save final images under:

```text
assets/<article-slug>-illustrations/
```

Keep the original generated PNG and repository copy identical. Verify with `shasum -a 256` before upload. Do not redraw the image with another tool when the original generated artifact cannot be located.

### Related papers

Identify papers that materially support the article's central argument. Do not add two figures for every passing citation.

For each paper or paper concept selected for visual treatment, use `$paper-figure-supplement` to add:

1. **one logic figure** explaining the method, architecture, pipeline, or proposal;
2. **one evidence figure or table** showing the strongest benchmark, ablation, scaling result, efficiency result, or qualitative evidence.

Prefer figures cropped from the original paper. Use a generated 小黑 logic diagram only when the paper lacks a clear usable logic figure or the article needs a simpler Chinese explanation. Never replace real experimental evidence with a generated chart. Read the paper around the selected Figure or Table and explain:

- what was measured;
- the compared baselines and controlled conditions;
- what the figure actually supports;
- what it does not prove.

Use concise `<figure markdown>` captions that identify the paper Figure/Table number or mark the image as self-drawn.

### Upload and link replacement

Use `$image-cloud-uploader` for all final generated or cropped images that the document will reference remotely.

1. Upload repository image files by absolute path.
2. Prefer PicGo/PicList; use its R2 fallback only when the normal path fails.
3. Verify `success: true`, one returned URL per file, and public URL accessibility.
4. Replace only the intended Markdown paths while preserving alt text and captions.
5. Keep local images after upload.
6. Never display, edit, or commit image-hosting credentials.

If `$paper-figure-supplement` has already uploaded its two images, do not upload them again. Batch-upload only the remaining general article illustrations.

After replacement, verify every remote image used by the changed document. Do not commit a Markdown link that points to a failed or private upload.

## Editing Existing Posts

When supplementing an article:

1. Preserve the user's existing voice and structure where possible.
2. Add content at the narrowest useful location instead of appending everything to the end.
3. Update title, tags, series, or summary only when the new content changes the article's scope.
4. Keep the introduction and `<!-- more -->` marker valid.
5. Avoid large rewrites unless the article's logic is broken or the user requests polishing.

If the article has obsolete, uncertain, or conflicting material, prefer adding a short correction or `warning`/`note` over silently deleting useful history.

## Git Publish Workflow

Treat Git publication as a separate external action.

Commit and push only when the user explicitly asks to push, publish, ship, or run the complete end-to-end workflow. A request for research, an answer, a draft, or a document edit alone does not authorize pushing.

Before committing:

1. Re-read the initial `git status`.
2. Inspect `git diff -- <target-markdown> <intended-assets>`.
3. Run `git diff --check` on intended files.
4. Run the repository's available Hugo or Markdown validation when practical.
5. Verify the article contains no local temporary paths, broken cloud URLs, secrets, or uncited critical paper figures.
6. Stage only the target Markdown and its intended image assets. Never stage unrelated dirty files.

Use a concise commit message such as:

```text
docs: add <topic>
docs: update <topic>
```

Push the current branch to its configured upstream without force. If there is no upstream, authentication fails, the remote rejects the update, or the branch has diverged, stop and report the exact state; do not rewrite history or broaden the change.

After pushing, verify the pushed commit hash and branch. Report:

- target document path;
- generated and paper-derived image count;
- cloud image URLs or an upload summary;
- validation performed;
- commit hash and pushed branch;
- any unresolved evidence or rendering limitations.

## Final Check

Before finishing, verify:

- The article directly answers the user's original question.
- Central claims are traceable to primary sources or clearly labeled inference.
- The file is under an appropriate `content/` subdirectory.
- Front matter follows the local archetype style.
- `title`, `categories`, `series`, and `tags` are semantically useful.
- Any `!!! abstract "导言"` block is followed by `<!-- more -->`.
- Chinese article section headings use concise Chinese phrases.
- The heading hierarchy is reasonable, usually around three levels.
- The article uses headings, lists, bold emphasis, and admonitions with restraint.
- Nested ordered and unordered list items are indented with exactly four spaces.
- No emoji or accidental decorative construction markers were introduced.
- New or changed Markdown renders as valid Hugo/MkDocs-compatible Markdown.
- General illustrations follow `$ian-xiaohei-illustrations` and are not decorative filler.
- Each visually treated paper has one useful logic figure and one real evidence figure/table.
- Every final image link comes from a verified `$image-cloud-uploader` result.
- Generated diagrams and paper-original evidence are labeled accurately.
- Git staging and push, when authorized, include only intended document and asset changes.
