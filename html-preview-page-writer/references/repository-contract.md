# 方案 B 内容契约

## 职责分界

方案 B 由三层组成：

1. **Markdown 索引载体**：保留 Blog URL、front matter、`summary`、导言和 `<!-- more -->`，参与首页、搜索、分类与标签索引。
2. **MkDocs 外层页面**：站点顶栏、作者信息、日期、分类、标签、阅读时间、下载按钮、预览地址栏和 `iframe` 沙箱；所有站内入口必须使用 MkDocs 生成的真实链接。
3. **独立 HTML 正文页**：技术报告、可视化、表格、流程图和页面内部交互，只作为外层正文资源和下载源，不作为站内主文章 URL。

内层页面不能假设外层 CSS 或 JavaScript 可用，也不能访问父页面 DOM。外层可以替换或升级，而不要求重写已有 HTML 正文。

## 源文件配对

已有 Markdown 文章默认使用同目录、同名的预览文件：

```text
content/Work/Artificial Intelligence/AIInfra/
├── Interactive-HTML-Article-Case.md
└── Interactive-HTML-Article-Case.preview.html
```

选择 `Work`、`Thinking` 或 `OutOfWork` 时继续遵守仓库根目录 `AGENTS.md`。不要另建与现有内容分类平行的新根目录。

`docs/posts/Work`、`docs/posts/Thinking` 和 `docs/posts/OutOfWork` 当前是指向 `content/` 的符号链接，因此 MkDocs 能看到同目录中的 `.preview.html` 静态文件。HTML 文件在站点中的文档根相对路径为：

```text
posts/Work/Artificial Intelligence/AIInfra/Interactive-HTML-Article-Case.preview.html
```

路径保留真实目录名。不要手写 URL 编码；由模板的 URL 过滤器和浏览器处理。

## Markdown front matter

生产外层模板采用以下字段：

```yaml
template: html-preview.html
html_preview:
  src: posts/Work/Artificial Intelligence/AIInfra/Interactive-HTML-Article-Case.preview.html
  download_name: Interactive-HTML-Article-Case.html
  reading_minutes: 10
  sandbox: allow-scripts allow-downloads
```

字段含义：

- `template`：选择方案 B 的 MkDocs 自定义页面模板。
- `html_preview.src`：相对于 MkDocs `docs/` 根目录的静态 HTML 路径。
- `html_preview.download_name`：浏览器下载时使用的文件名，只能是安全的 `.html` basename。
- `html_preview.reading_minutes`：外层显示的预计阅读分钟数；没有可靠估算时省略，不得随意填写。
- `html_preview.sandbox`：默认固定为 `allow-scripts allow-downloads`。不得加入 `allow-same-origin`，除非经过单独安全评审。

文章原有的 `title`、`categories`、`series`、`tags`、`date`、`authors`、`summary`、`comments` 等字段继续作为外层信息来源。不要在 `html_preview` 中复制这些字段。

## 新建 HTML 文章

新建 HTML 页面时生成一对文件：

1. `.md`：唯一的站内文章入口，保存 front matter、摘要、导言、列表页和搜索所需的简短正文；
2. `.preview.html`：方案 B 工作区加载并允许下载的完整正文。

Markdown 载体继续使用 `archetypes/default.md` 的字段风格。如果包含 `!!! abstract "导言"`，必须在导言块后保留 `<!-- more -->`。

## 路径校验

写入后确认：

1. `html_preview.src` 去掉开头可能存在的 `/` 后，能在 `docs/` 下解析到真实文件；
2. 解析后的文件仍位于仓库工作树内；
3. `download_name` 不含 `/`、`\` 或 `..`；
4. Markdown 与 HTML 的文件 stem 一致；
5. HTML 中的内部锚点和相对资源在直接打开时仍可工作。

## 兼容说明

生产模板位于 `overrides/html-preview.html`。它必须继承 Material for MkDocs 的站点外壳，读取 Blog 插件生成的 `page.parent`、`page.categories`、`tags`、`page.authors` 和 `page.config.readtime`，不得自行拼接首页、分类或标签 URL。

构建后的主文章 URL 仍来自 `.md`，例如 `/1-agent-workflow/2026/09/01/Interactive-HTML-Article-Case/`。`.preview.html` 的静态资源 URL 只用于 iframe、单独打开和下载。首页、分类页、标签页以及搜索结果都应指向主文章 URL。

线上经过 Cloudflare 时，平台可能在 HTML 响应的 `</body>` 前自动注入 `static.cloudflareinsights.com/beacon.min.js`。源文件仍须保持自包含；外层下载逻辑不能直接把响应 Blob 原样保存，必须先移除带 `Cloudflare Pages Analytics` 标记的注入脚本，再以 `text/html;charset=utf-8` 生成下载文件。不要宽泛删除页面自己的内联脚本。
