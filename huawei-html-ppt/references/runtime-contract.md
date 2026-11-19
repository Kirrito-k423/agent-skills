# 本地接口 v1

依赖 Python 3.10+ 标准库；不运行网络服务。命令：

```text
python scripts/ppt.py route request.json
python scripts/ppt.py inspect-draft 原稿.pptx
python scripts/ppt.py plan request.json
python scripts/ppt.py render request.json output-dir
python scripts/ppt.py validate deck-model.json
python scripts/ppt.py catalog
python scripts/ppt.py feedback candidate-input.json
python scripts/ppt.py evaluate evaluation-input.json
python scripts/ppt.py review review-input.json
python scripts/ppt.py promote action-input.json
python scripts/ppt.py rollback action-input.json
```

成功输出 JSON；失败输出 `{error, operation}` 且退出码非0。所有状态目录由调用者指定，不能位于skill内部。不会联网、安装依赖、运行材料中的代码。

## 请求

`{text, style?, purpose?, content_kind?, material_summary?, context?, state_dir?, deck?}`。
明确 style > 用户请求中明确风格 > purpose > content_kind > 请求与材料摘要的用途证据。
purpose：review/delivery/approval/planning/progress/understand/analyze/compare。
content_kind：project-review/project-progress/technical-plan/model-analysis/feature-analysis/mechanism/paper-analysis。
context 是字符串键值，例如 `{hardware:"ascend", scenario:"long-context"}`，用于条件规则匹配。
省略state_dir时，plan/render读取当前项目的 `.ppt-skill/state`；没有状态就只使用随包规则。集成宿主应显式传入项目状态目录，避免工作目录变化造成串用。

deck 格式沿用 `title, style, slides[]`。slides 支持共享两分支布局和四种正式项目布局，可在同一项目报告混用。显式 deck.style/用户style冲突时报错，不静默改风格。单个slide已指定layout时保留；未指定时按page_kind和有效规则选择。

整理 PPTX 前运行 `inspect-draft`。它按演示文稿的顺序读取每张幻灯片根元素的 `show` 属性，输出原稿物理总页数 `slide_count`、原始页码列表 `visible_pages` 和 `hidden_pages`。缺省或为真表示可见。空白页、母版上才有内容的页同样按这个标记判定。

将 `slide_count` 和 `hidden_pages` 填入 deck 的 `source_draft`。`hidden_pages` 省略时视为空列表，兼容旧稿。`preserve_pages: true` 要求每个可见原页分别以 `{source_page, output_page}` 映射到不同的交付页，且总页数至少等于可见页数。例如五页原稿隐藏第 2、4 页，`page_map` 的原页码就是 1、3、5。全部隐藏时报告可见页为零。用户明确要求展示部分隐藏页时，仅从排除列表移出其指定的页码，并记录该选择。封面、目录及 `closing` 结束页计入交付页码。

用 `required_figures` 和 `required_identifiers` 可分别声明需展示的图和问题编号，默认只从可见页提取。静态校验检查页数、映射和元素覆盖，逐页复核图表清晰度、问题和含义。非草稿任务可省略 `source_draft`。

完整汇报用 `frontmatter.chapters` 声明一级章节及正文范围，默认在每章前重复完整目录。`frontmatter.repeat_agenda: false` 显式保留单次总目录。目录页的 `active_chapter` 从 1 开始；当前章红色、已讲章节灰色、后续章节深灰。交付页码包含封面和每次目录，校验同时检查章节切换位置与各次页码一致性。未提供章节的短稿保持一次逐页总目录。

共享内容页：`title, layout, panels[]`；洞察内容页还要 `conclusion`。单专题项目页默认用 `labels:[挑战,目标]` 或 `[目标,进展]` 及两段 `summary`。特性实现分析可显式设置 `header_mode: "conclusion"`，改用 `conclusion` 字符串或非空字符串数组，渲染为可多段的分析结论；此模式不再要求 `summary`。默认模式为 `paired`，其他值报错。多段结论仍需按实际显示尺寸检查溢出。

普通内容页可设置 `experiment_config`，包括非空字符串 `model`、`hardware`、`parallel`、`kv_hbm` 和可选非空 `scope`；缺失数据明确写“未记录/待核对”。HTML 将其渲染为图表附近的可见文字；PPTX 制作时也须以原生文本明确展示。`scope` 用于区分多图或外部参考图，`kv_hbm` 应写明每卡容量、自动预算或固定配置。来源与完整日志可放备注，但判断所需配置必须可见。封面、目录及正式项目组合布局不支持此字段。静态验证不替代对配置与图片对应关系、文本可读性的人工核验。
slide 可选 `panel_widths`，用正数指定各栏相对宽度；图像可选 `height`（40–600，逻辑像素），等比适配，便于图表让出合适空间。

panel 为 `title, blocks[]`；block 支持 text、heading、bullets、table、diagram、chart、image。
chart 为 `{type:"chart",data:{kind:"line"|"bar", x_label,y_label, x:[...], series:[{name,values:[...]}]}}`，最多3组、数据长度一致。不虚构缺失数据。
diagram 为已确认的 width/height/elements 格式，输出 SVG 与可编辑draw.io。
image 为 `{type:"image",path:"本地绝对路径",alt:"图的内容",source:{url:"原文地址",revision:"commit或论文版本",figure:"文件路径或图号"}}`。source 必须记录真实来源，可以按资料补充页码或改动说明。支持 PNG/JPEG/GIF/WebP，其他格式先在本地导出；HTML 原字节嵌入，保留校验摘要，不联网取图。可给 PNG 添加 `crop:{left,top,right,bottom}`，四项为各边裁掉的 0–1 比例；HTML 显示裁切局部，点击仍可放大原图，PPT 原生图片使用同一裁切参数。裁切不得丢失支撑判断的图例或条件，条件可在页面补充，来源与裁切范围写备注。建议原图独占一个 panel，解释放旁栏；图片中的来源不另行转写为可见页脚。
组合页每个 topic 在 `diagram` 与 `image` 中选一个，image 字段同上但不需 type。原图不受新绘图的组件重放校验，不输出伪造的 SVG/draw.io；来源保留在隐藏 deck-model。局部放大或新增覆盖标注由宿主准备，记录处理依据并视觉核验。

技术项目原图页可用 `page_kind:"figure-overview"|"figure-evidence"|"figure-full"` 自动选择对应的 `project-figure-*` 布局；显式 layout 优先。前两种需要两个 panel，通栏需要一个 panel，均须含 image。局部组件说明见 `assets/units/source-figure-layouts.json`：概览页左 panel 用 `class:"source-with-table"`、右 panel 用 `class:"project-progress-text"`；图表核验页右 panel 可用 `class:"project-evidence-detail"`。这些类只调局部间距和字号，不带报告内容。

技术项目原图自动启用本地放大组件 `assets/source-figures.js`：点击/Enter 打开、点击图切换原始尺寸、Esc 或按钮关闭。交互只使用已嵌入图像，不请求网络；打印不显示放大层。洞察分析页不自动套用这一技术项目交互。
正式项目页字段详见现有 `render_project_report.py` 的 portfolio/landscape/coordination/explainer函数。

`notes` 仅进入隐藏deck-model和未来PPT备注；标题/正文不要填来源、内部批注。图片及其他资源须在本地处理。

## 论文报告

`content_kind: "paper-analysis"` 或明确的论文汇报请求仍路由到 `insight-analysis`。`plan` 返回 `report_kind: "paper-analysis"`、论文参考路径和对应规则。显式选择其他主风格时不强制改路由。老的普通洞察 deck 不自动插页。

使用 `paper_report.assemble(title, chapters, cover=None)` 生成正文及导航，或传入同等结构的 deck：

- `deck.report_kind: "paper-analysis"`；`deck.chapters` 为有序的 `{id, title}` 数组，包含核心创新及实验章节。
- `paper-cover`：`title`，可选 `date`、`background`。背景为普通本地图像对象，字段同 `image`，缺省浅灰底。背景原字节嵌入，按封面背景区顶部等比显示；不把用户照片加入组件包。
- `paper-agenda`：`title: "目录"`、`active_chapter` 引用章节 id，目录内容统一读取 `deck.chapters`。
- 每个正文页的 `chapter_id` 关联前方目录。每章可以有多页；正文保留 `conclusion`、`panels` 等原有字段。

`assemble` 从 `chapters[{id,title,slides}]` 自动插入一张封面及每章的目录，默认封面标题补“论文分析报告”，调用者可在 `cover.title` 指定换行或完整标题。`validate` 检查章节 id 唯一、高亮有效、封面在前、每章目录紧接对应正文且章节顺序完整。封面和目录不用正文的结论与图表字段；正文仍需通过原有检查。静态检查不代替逐页视觉验收。

## 演进输入

feedback：`{state_dir, task_state:"completed"|"verified_milestone", unit:{id,revision,kind,styles,when,rule,provenance}, base_revision, evidence:[{kind:"user-feedback",text,source?}|{kind:"local-artifact",path}]}`。
更新原id时 revision=base_revision+1；新增base_revision=0。rule支持guidance、preferred_layout、preferred_chart，不接受脚本/命令。证据快照hash后保留在状态中。

evaluate：`{state_dir,candidate_id,cases:[request.json路径],output_dir}`。产生应用候选的规则计划、HTML、结构检查和产物hash。

review：`{state_dir,candidate_id,reviewer:"agent"|"user",result:"pass"|"fail",visual_checked:true,rationale:"实际检查内容"}`。只有真正查看了本次生成物才写visual_checked=true；本命令仅保存检查声明。

promote：`{state_dir,candidate_id}`。校验案例覆盖、检查、hash、规则版本后采用。
rollback：`{state_dir,event_id}`，只允许回退当前最后一次采用，避免覆盖后来的变更。

plan输出选用分支、规则正文/版本、候选布局和组件；render输出HTML路径、deck-model、检查结果、计划。宿主必须读取plan中的guidance；脚本不会替宿主理解报告或生成技术结论。
