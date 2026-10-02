# DeepEP-Ascend Dispatch 双屏教学

在此目录启动：`python3 -m http.server 8766 --bind 127.0.0.1`，同一浏览器打开 [控制页](http://127.0.0.1:8766/control.html) 和 [动画页](http://127.0.0.1:8766/visual.html)。将动画窗口移至第二显示器，分别全屏。请通过 HTTP 打开，不使用 file://。也可由交付根目录的统一 HTTP 服务打开 `animation/control.html`。

固定源码：DeepEP-Ascend main `3b25377d04b24fc6154698ded78a2bcb2c59afff`。所有源码展示从只读克隆逐行导出到 `sources.json`，页面不联网、不上传源码。

`model.mjs` 是独立纯计算模型；`app.mjs` 只负责显示；`sync.mjs` 用同源 BroadcastChannel 和 Web Locks 实现唯一权威控制页，动画与多个控制页共享墙钟时间锚点。后加入和刷新可从存活页面恢复；全部关闭后重置，不写持久化。

默认：4 rank，每 rank 4 token，M=4，8 expert，top-k=2，hidden=256 BF16，16 AIV/rank，expert_alignment=4。输入token分工ceil(M/C)=1，AIV0–3有token，4–15空范围；SIMT512线程。epilogue每核最多1条接收记录。没有把4个活跃核当作只launch4核。

合法输入假设：topk_idx有效项属于[0,E)，无路由用-1；每token有效expert互异；rank专家数均分；alignment为2的幂；host限制16≤num_vec_cores；H满足UB与padding复制对齐。本页不宣称内核保护任意非法ID。

默认数值：hidden512B；metadata64B（topk 16B占32B，weights8B，global_idx4B，再对齐）；接收token576B。每来源rank分区4槽=2304B，每目的rank通信buffer容量16槽=9216B。未定义alignment字节不画成0。Cached模式metadata32B（无topk/global_idx）；FP8模式hidden256B、8个int16 SF packs16B占32B、metadata96B、record352B。SF按原始pack位模式搬运，不实现scale解码、FP8量化或精度测量。

每个token对目的rank去重一次传hidden+metadata，epilogue再按目的rank的local expert展开。`dst_gsge_idx` 是核内SGE pair索引，local和重复rank lane为-1。固定预留SQE4×64B；本小例每peer只1pair，所以48B header+2×16B SGE占2个有效WQEBB，剩余NOP。选定的SQE/原子顺序仅是一种合法线性化，非硬件确定排序；相同教学批次不代表全局同步时刻。

expert_end[e]=Σ(q<e)align(count[q],A)+count[e]；expert_start[e]=align(expert_end[e-1],A)。每收到rank去重token的recv_src_metadata一行 `[expanded_j0,expanded_j1,src_global_idx,最后本地j]`。输出padding与有效zero token严格区分。可选“不清零padding”保留未写入；不提供weights时预留区域未定义，不高亮对应读取/输出分支。

模型验证证明教学计算一致，不代表CANN编译、NPU精度、多rankURMA可见性或性能已实测。教学包含真实计数、槽位、元数据、描述符和输出状态；不会模拟HCOMM CQ内存的具体位模式或实际地址，使用符号基址和精确字节偏移。

## 实际验收

- `node tests.mjs`：9个合法预设，完整256元素hidden、SF packs、weights、rank去重/专家展开守恒、source分区、expert mixed prefix、最后本地j、padding与有效zero/未写入、cached复用、读前值及源码活动行的独立断言。输出见 `model-test-results.txt`。
- `node browser-test.cjs`：需先启动上述HTTP；依赖本机已有Playwright/Chromium，不安装额外库。结果见 `browser-results.json`。
- 浏览器实测9预设全部帧在实际1280×720、1440×900、1920×1080；全部相关源码tab在720；后加入、两页刷新、控制权接管、会话隔离、终点停止及基本控制均通过。
- 最拥挤32槽输出截图 `visual-concentrated-final-720.png`；两目的rank所选记录与内部向量截图 `control-selected-two-dests-720.png`；完整数组和全值历史在 `object-inspector-720.png`。源码/历史长文本在明确可滚动的检查器中完整保留，主画面当前片段完整可见。

针对选中接收record曾直接展开256元素JSON造成账本溢出的缺陷，现主屏显示字段、首4元素与完整元素数，完整内部对象/值历史通过检查器展开。额外验证两目的token、SQE、metadata、接收record、16核expert prefix在720的428组合，避免只测默认x元素选择。

此前原模型与UI冻结：`model.mjs` SHA256 `567fc1e82f4c91dd09c481a05d7eee2b6ea850e6f155a541c1a3f1c95b633197`；20,544个模型/源码/显式读写及空核ready断言通过，2026个实际浏览器组合零布局失败、零脚本错误。独立源码模型审核见交付根目录 `review/animation-review.json` revision3；没有做NPU运行验证。空输入ready发布截图见 `control-empty-ready-720.png` 与 `visual-empty-ready-720.png`，空核计数0先发布arrival1，再参与prefix。

## 本次数值解释修复

原页面把数组转成一段文字，`R0.topk_idx[3]=[-1,0]` 的两个数只有对象级 title；计数 `[2,1,1,1]` 只展示写前/写后，没有逐 token 推导。原因是显示层依赖 `brief()` 拼字符串，缺少元素身份、读前快照和生产事件；这不是数据搬运动画本身能补足的信息。旧模型与源码审核保持冻结，本次只新增独立数值来源模块及明确绑定的显示层。

`provenance.mjs` 从原始 topk/config、帧的 reads 前快照与 writes before/after 生成解释，不从 DOM 数字或中文描述猜字段。`explain(model,{objectId,elementPath,step,phase})` 支持 initial、read-before、write-before、write-after、observe、history；auto 选本帧实际写后、读前或观察状态。返回 result/computed、producerStep、真实操作数（含 step/phase/scope）、具体代入、单位、初值与固定源码依据。观察和历史追原生产步骤；UNKNOWN、copy、显式清零及同值写入分别解释。UB未命中bucket和没有本机目标的 local slot -1 沿用初始化；真实GM dst哨兵、前缀覆盖和零值copy仍有生产事件。Cached继承依据上次fresh输入，禁止把本轮未执行的histogram UNKNOWN当作算术操作数。

两屏共用 `numeric-ui.mjs`：数字以点状下划线提示入口；悬浮或聚焦查看，点击/Enter固定，Esc/×关闭。点击记录其余部分仍反向选择，悬浮不改变进度或选中。浮层按完整记录避让、自动换方向；固定后详情内部可滚动。检查器中的浮层移入当前modal子树，避免modal inert导致按钮不可点击。切步/切预设/关闭检查器清理旧解释。完整检查器保留所有256元素和全值历史，各嵌套叶字段独立绑定。

稳定定位：`[data-num-id="R0.topk_idx[3]"][data-num-path="[0]"]` / path `[1]`；计数为 `R0.rank_histogram_sum_view` / path `[0]`…`[3]`，默认prefix步骤5。`data-num-step` 与 `data-num-phase` 声明时刻，`data-num-query` 保存完整显式查询；具名配置/指标使用 `@config.*` / `@metric.*`，形状、容量与类型带所属对象。浮层固定 DOM `#numericTooltip`、`role="tooltip"`，调试结果为 `window.numericExplanation`，纯接口为 `window.dispatchDemo.explain`。每SQE预留4×64B与SQE[token]列表总量分开解释。

本次针对性验收：

- `node numeric-tests.mjs`：9预设、24类对象、全部叶元素的观察/读前/写前/写后/历史；独立重算rank去重贡献、slot、expert有效数量与对齐终点，区分零与未写入、cached来源。结果与被测五个文件SHA见 `numeric-test-results.json`。
- `node numeric-browser-test.cjs`（先启动本目录HTTP）：真实悬浮 `-1`、有效expert0及四计数，逐 token贡献/公式/结果断言；三实际CSS视口1280×720、1440×900、1920×1080，9预设所有帧两屏共130224可见查询一致，2880几何及交互断言，0脚本错误。含完整第255元素、嵌套SGE、FP8位模式、cached逐token推导、empty空集合、相邻数字、focus/Enter/Esc、固定后真实点击details/×、内部wheel滚动、切步清理与刷新恢复。证据与被测文件SHA见 `numeric-browser-results.json`。
- 独立解释审核由未参与作者实现的reviewer完成，结果由交付根目录 `review/` 保存；作者上述验收不能替代独立语义结论。根代理的截图与逐数字浏览器复核另外保存在交付根目录。

本次还在真实浏览器发现并修复相邻数字被旧浮层拦截、modal之外浮层inert，以及Esc同时触发dialog关闭的问题；均有实际指针/键盘回归。原模型SHA仍为 `567fc1e82f4c91dd09c481a05d7eee2b6ea850e6f155a541c1a3f1c95b633197`。数值解释证明教学数据的来源与推导可核对，证据不包含NPU运行或性能测量。

本次数值模块最终独立审核：交付根目录 `review/numeric-review.json` revision4 为 PASS，锁定 `provenance.mjs` SHA256 `6ac9d0f9ad90d2666d7d3d2ee639c570292ba0b9429a4b337d5d23e4f55befa8`。两份作者测试结果的五文件SHA已逐项读回核对；新增真实浮层截图为 `numeric-initial-sentinel-720.png`、`numeric-count-detail-720.png` 与 `numeric-modal-element255-720.png`。最终跨页面与交付入口验收仍以根代理记录为准。

## 变量、术语与缩写解释

参数名与相邻数字是两个独立入口：悬浮 **M/T/A/SF** 先了解词义，再悬浮数字了解计算。M 是来源 Rank 的最大 token 容量，T 是本轮有效输入数；空输入预设保留 M=4、T=0。A 是 `expert_alignment`，单位为 expert 输出行，不能解释成 attention。SF 是 Scale Factor；本实现搬运 `sf_pack_t=int16_t` 的原始 pack 位模式，动画不解码 scale，BF16 的“无 SF”表示没有执行该分支。

词义入口覆盖参数、标题、阶段说明、图例、传输说明、数组/字段名称、类型、完整对象/历史、源码节选和完整源码页。名称以点状下划线标识，可悬浮、聚焦、点击或 Enter 固定；Esc/×关闭。当前选择器的完整对象名在旁边账本信息中另有可聚焦入口。记录其余位置继续反向选择，名称解释不改变进度/选择。

`terminology.mjs` 保存显式术语身份、别名及源码作用域；`terminology-source-extra.mjs` 补充完整源码中的具体变量/接口定义；`terminology-source-evidence.mjs` 保存冻结原文中的准确出现位置。`explainTerm(model,{termId,context})` 返回中文定义、可确认的全称、当前作用、单位/范围、对应值与数字查询、固定源码依据。同名词按文件/行的最窄作用域解释，例如 dispatch 的 `dst_slot_idx` 是来源分区接收槽，epilogue 同名变量是按 expert 展开的输出行；`threadIdx.x` 是线程坐标，不能套输入 hidden 数组词义。

渲染的 `data-term-id`/`data-term-query` 记录稳定身份与对象路径、步骤、预设、文件和行。源码采用词法分类与显式词表，保留每行原文字节；数字字面量和头文件路径不会被拆成伪变量。未解释项进入覆盖缺口，不能用通用“本函数变量”补齐。缩写没有源码正式展开时标明证据边界；Hcomm/Jetty等专名解释本实现功能。

变量和数字共用一个浮层。固定详情中的相关词在同一浮层内切换，新的词身份清理上个词的源码成员/字段路径，避免“点 M 却显示 dst_slot”或把 `bytes` 读成地址字符串。字段关联值可以返回原数字推导，保留页面锚点；模态范围内支持真实点击与关闭。切步后暂不自动解释鼠标下重建的新 DOM，直到用户主动移动；首次移入、晚加入窗口和键盘入口正常。

验证入口：

- `node terminology-coverage.mjs`：9文件3732原行逐字一致，源码标识符与专业注释变量、88项页面专业词清单、24对象类和完整嵌套字段的显式绑定。报告 `terminology-coverage.json` 含缺口与功能文件 SHA256；该作者检查不能替代独立词义审核。
- `DEEPEP_PREVIEW_ORIGIN=http://127.0.0.1:8766 node terminology-browser-test.cjs`：依赖已有 Playwright/Chromium；实际三 CSS 视口、九预设全部帧两屏的可见术语绑定、实际悬浮/固定/键盘、完整源码原行、模态嵌套字段及字段→数字推导。报告 `terminology-browser-results.json` 保存几何、正文、覆盖和最终文件 hash。
- `DEEPEP_PREVIEW_ORIGIN=http://127.0.0.1:8766 node numeric-browser-test.cjs`：保留旧数字推导与几何回归。两个浏览器脚本默认连接已有统一入口 `http://127.0.0.1:54686/animation`，可用上述环境变量覆盖；不会创建或关闭该服务。
- 独立审核及根代理三视口/根入口验收位于交付根 `review/` 与 `root-*-ui.json`。源模型/数字来源模块保持冻结；新增词义入口没有改变路由、计数、输出或原始源码。

本次问题复盘：原参数栏只有数字解释，名称 M/T/SF/A 缺少单独身份；因此读者可能混淆容量、有效数、对齐与 pack。修复为名称与数字并列的明确入口，并把同一契约扩展到正文、字段、历史及源码。新增验收实际读取截图中的词义，检查空输入和 FP8 分支，并独立审查同名源码变量，不能用旧数字测试的通过替代词义正确性。
