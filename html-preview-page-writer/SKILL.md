---
name: html-preview-page-writer
description: 为 hugoMinos 创建或更新参与首页、分类、标签和搜索索引的 HTML 正文文章；维护 Markdown 索引载体、同名 `.preview.html` 与方案 B 详情页接入。用户要求把文章、技术分析、数据报告、交互解释或 AI 生成内容制作成站内 HTML 文章时使用；独立落地页或普通 Markdown 写作不使用。 默认 Dev，写完后必须由独立子代理使用 article-readability-check 审核最终正文；通过不自动转为 Public。
---

# HTML 预览页写作器

## 目标

生成一个由方案 B 外层模板承载的**站内 HTML 正文文章**。它不是孤立落地页：Markdown 载体负责首页、笔记列表、搜索、分类和标签反向索引；外层模板负责可点击的站点导航、标题、作者、日期、分类、标签、阅读时间、下载按钮和 `iframe` 沙箱；内层 HTML 负责主题内容、视觉结构和必要交互。

生成结果必须同时满足：

- 在方案 B 的右侧工作区内正常显示；
- 沿用 MkDocs Blog 生成的文章 URL，并能从首页、分类页和标签页进入；
- “笔记”、分类和标签均使用站点生成的真实链接，不使用 `#` 占位；
- 下载为单个 `.html` 文件后可直接打开；
- 不依赖父页面的 CSS、JavaScript、字体或 DOM；
- 桌面和移动尺寸均可阅读；
- 不越过 `iframe` 沙箱访问父页面。

## 开始前

必须阅读并执行 [独立审核与 Dev 发布约定](../hugo-tech-blog-writer/references/dev-review-contract.md)。Markdown 载体默认设置 `review_status: pending`，保留已有 `private` / `withdrawn`；写完后由独立子代理使用 `$article-readability-check` 同时检查载体与实际 HTML 正文。通过也不自动转为 Public。

1. 阅读仓库根目录的 `AGENTS.md`，遵守内容分类、命名和 Git 改动边界。
2. 记录 `git status --short --branch`，保留用户已有改动。
3. 如果页面对应现有 Markdown 文章，只读取该文章和直接相关资源，不扫描整个 `content/`。
4. 阅读 [references/repository-contract.md](references/repository-contract.md)，确定 Markdown 索引载体、外层详情页和 `html_preview` 元数据之间的对应关系。
5. 仅在用户同时要求研究主题时补充研究；优先使用现有文章和用户提供的材料，不得为填充页面而编造事实、数字或引用。

## 写作流程

### 1. 确定页面任务

先用一句话明确页面帮助读者完成什么，例如：理解一条执行路径、比较两种方案、检查一组指标或浏览一个交互报告。

根据内容选择结构，不要把所有页面都写成仪表盘：

- **技术简报**：结论指标、流程、架构图、对比矩阵、最终判断；
- **交互解释**：分步控制、状态变化、输入输出和边界条件；
- **数据报告**：指标概览、趋势、分组比较、口径和数据来源；
- **视觉长文**：导语、连续章节、关键图表、总结和参考资料。

技术简报可复制 [assets/standalone-technical-brief.html](assets/standalone-technical-brief.html) 作为起点。其他类型可以重组，但必须保留独立文档和响应式约束。

### 2. 建立内容层级

先确定结论和证据，再写页面：

1. 用可检索的英文关键字标题作为文档 `<title>`，可见主标题按文章原题呈现。
2. 首屏只放主题、简短说明和最重要的阅读入口。
3. 每个可视区块回答一个明确问题；图表、流程图和表格附近说明读者应注意什么。
4. 将关键判断、失败路径、限制和验证方法写进页面，不用装饰性指标填空。
5. 不在内层页面重复作者、日期、分类、标签、阅读时间和下载按钮；这些属于方案 B 外层，并必须由 MkDocs 生成可回溯链接。

### 3. 写成独立单文件

默认把 CSS、JavaScript、SVG 和小型数据直接内嵌在 HTML 中：

- 必须包含 `<!doctype html>`、`<html lang="zh-CN">`、UTF-8、viewport、非空 `<title>` 和 `<main>`；
- 使用系统字体和 CSS 自定义属性，不从 CDN 加载字体或框架；
- 使用内联 SVG 绘制流程和简单图表，给 SVG 提供 `role="img"` 和可理解的 `aria-label`；
- 表格在窄屏下允许横向滚动，布局在窄屏下改为单列；
- 交互使用原生 JavaScript，支持键盘和可见焦点；
- 不使用 `window.parent`、`window.top`、`opener`、`target="_top"` 或父页面选择器；
- 不注册 Service Worker，不把正常显示依赖于 `localStorage`；
- 不使用绝对站点路径。只有用户明确接受联网依赖时，才允许远程资源，并在交付中说明下载后离线不可用。

避免为一个静态报告引入构建工具。只有用户明确需要复杂应用状态或现有框架集成时，才改变单文件方案。

### 4. 接入方案 B

按照仓库契约命名 `.preview.html`，并让 Markdown 载体的 `template` 与 `html_preview` 字段指向它。

- 更新已有文章时，保留原有 front matter 的结构，添加或更新 HTML 预览字段，并按独立审核约定设置 Dev 状态；不沿用旧版本公开资格。
- 创建新页面时，使用 `archetypes/default.md` 建立 Markdown 载体；必须保留 `summary`，并建议使用 `!!! abstract "导言"` 与紧随其后的 `<!-- more -->`，让首页和分类页生成可读摘要。导言不确定时，写一段简短的“问题—核心判断—页面用途”，不要编造背景。
- `.md` 和 `.preview.html` 必须同名、同目录。详情页仍使用 `.md` 的 Blog URL，不把 `.preview.html` 当作对外主入口。
- `overrides/html-preview.html` 是生产详情模板；不得用 `docs/prototypes/` 页面代替生产接入。
- 不主动修改全站主题、构建配置、部署脚本或现有 Markdown 正文，除非用户明确要求实现接入。

### 5. 验证

先运行确定性检查：

```bash
python3 skills/html-preview-page-writer/scripts/validate_html_preview.py <页面.preview.html>
```

然后启动仓库已有预览命令或一个临时静态服务器，至少检查：

- 桌面宽度约 `1440px`；
- 移动宽度约 `390px`；
- 页面不存在横向撑宽，允许滚动的表格除外；
- 导航、折叠、筛选等交互可以使用；
- 在带 `sandbox="allow-scripts allow-downloads"` 的 `iframe` 中仍可显示；
- 下载后的单文件直接打开时主要内容和交互仍然可用。
- 若线上经过 Cloudflare，确认下载文件已经移除平台自动注入的 Analytics beacon，并再次通过单文件校验器；不要把线上响应未经处理地直接保存为 Blob。
- 在 Dev 构建中确认首页、目标分类页和每个目标标签页都链接到 `.md` 文章 URL；文章页的“笔记”、分类和标签链接能反向返回对应索引。同时检查 Public 的首页、搜索、标签、分类、归档、sitemap 与直接 URL 不暴露文章及 `.preview.html` 附件。

正文、图表与交互完成后，必须按独立审核约定派发只读子代理并等待可读性结论；不能用单文件校验器通过代替阅读实际 HTML。修改后复审最终版本，默认仍保留 Dev。最后运行 `git diff --check`，并只报告实际验证过的项目。

## 交付边界

- 交付独立可读性结论、受审版本及 Dev 默认状态；缺失审核或未通过时如实标注，不自动写入 Public 发布清单。
- 不自动上传、部署、提交或推送。
- 不把原型切换器、A/C 方案或测试占位文案带入生产页面。
- 不为了视觉丰富而生成无来源数字、模拟基准结果或伪造引用。
- 若外部资源不可避免，明确列出资源、用途、失败降级和离线影响。
