# DeepEP-Ascend Dispatch 实现逻辑

统一入口是 `index.html`。本目录可独立运行，包含双屏动画、源码走读、冻结源码和验收记录；Git 示例目录为 `agent-skills/data-flow-animation/examples/deepep-dispatch`。

## 启动

```bash
python3 serve.py
```

脚本只监听 `127.0.0.1`，默认使用 8765 端口；已占用则选择可用端口，并自动打开入口页。Ctrl+C 停止服务。单文件源码走读可直接打开；双屏动画通过同源 HTTP 联动，在同一浏览器配置中分别打开控制页与动画页。

## 固定版本与分析范围

- 仓库：[deepseek-ai/DeepEP-Ascend](https://github.com/deepseek-ai/DeepEP-Ascend/tree/3b25377d04b24fc6154698ded78a2bcb2c59afff)
- main 快照：`3b25377d04b24fc6154698ded78a2bcb2c59afff`，2026-09-30 获取。
- DeepJIT gitlink：`65f513952b8771408a19202f65e36398522db6db`。已记录依赖版本，本次未编译该子模块或 NPU 内核。
- 完整源码走读：`deep_ep/include/deep_ep/impls/ep/dispatch.hpp`（867 行）、`dispatch_copy_epilogue.hpp`（623 行）。14 个定义包括 2 个 lambda。
- 上游上下文核对：Python `EPBuffer.dispatch`、C++ Host dispatch、JIT launch、TokenLayout/BufferLayout、EPSignals、SymmetricMemory/Context/HCCLContext、HcommJetty/barrier/reduction。上游文件用于调用与内存证据，没有声明逐行走读覆盖它们。
- 语法解析采用 tree-sitter 0.25.2 / tree-sitter-cpp 0.23.4，保留位置地屏蔽 Ascend C 标注，并与独立文本/花括号扫描比对。dispatch 的解析残余仅位于函数外第 62 行 constexpr 临时对象表达式；14 个定义的边界在两种方法及独立审阅中一致。

## 阅读路线

1. 打开动画控制页，用四 Rank 示例观察一个 token 对目标 Rank 去重，最后为本地专家展开。
2. 打开 Dispatch 走读页，沿路由统计、接收槽、元数据、本机复制、SQE 和 doorbell 阅读。
3. 打开 Copy epilogue 走读页，检查 drain/barrier、按源 Rank 遍历、专家前缀、展开与可选补零。
4. 在走读页切换“内存与通信”，对照输入 GM、AIV UB、远端窗口和队列控制面，向上查看申请点及容量口径。

## 数字说明

控制页和动画页中的数据数字带虚线。悬浮或键盘聚焦可查看语义、单位、初始来源、生产步骤及代入实际值的计算过程。点击数字或按 Enter 固定说明，再展开“实际操作数 / 身份”查看对象、元素位置、来源调用与步骤；长说明可在浮层内滚动。Esc 或 × 关闭说明。点击记录中数字之外的区域仍可反向选择 token。

- `[-1,0]` 是两个 top-k 数组元素。`-1` 表示该 lane 未选择专家，统计时过滤；`0` 是有效 expert 0，映射到 Rank `floor(0÷2)=0`。
- 默认输入的 R0 计数 `[2,1,1,1]` 按目的 Rank 0～3 排列。token 0、1、2、3 的去重目标分别为 `{R0}`、`{R1}`、`{R2,R3}`、`{R0}`，所以四项为 `1+0+0+1=2`、`0+1+0+0=1`、`0+0+1+0=1`、`0+0+1+0=1`。同一 token 的两个专家命中同一 Rank 时只贡献一次。
- 初始输入、源码清零、上一轮 Cached handle 与尚未写入的空间分别说明来源。写前、写后、读取与历史值保留各自的生产时刻；复制、保持与写 0 按实际操作解释。
- “展开完整对象”提供全部 hidden 元素、嵌套 SQE 字段及完整历史的逐元素说明。FP8 的 SF pack 显示原始位模式及复制来源。

生成规范已更新并推送到 `agent-skills` main：[045c6678](https://github.com/Kirrito-k423/agent-skills/commit/045c6678b5332b8399b63232b8536f17386da687)。本机全局 Skill 使用规范目录的绝对符号链接。

## 变量与术语说明

名称本身也支持悬浮和键盘聚焦。参数栏、阶段说明、图例、对象名、嵌套字段、变量选择器旁的当前对象、源码节选和完整源码页都提供中文含义、可信全称、当前作用、单位或约束及依据。点击或 Enter 固定说明，点击相关术语在同一浮层中切换，Esc 或 × 关闭；关联数值仍可进入原有的逐元素计算说明。

- `T` 是当前每 Rank 的有效输入 token 数；`M` 是每个来源 Rank 接收分区的最大容量，满足 `T≤M`。空输入预设中 `T=0`，容量仍为 `M=4`。
- `A` 对应 `expert_alignment`，单位为输出行，控制每个专家输出段的对齐容量。
- `SF` 是 Scale Factor；本实现用 `sf_pack_t=int16_t` 搬运原始位模式。动画展示 pack 的来源和搬运，没有解码为浮点 scale。
- 同名变量按实际位置说明：Dispatch 的 `dst_slot_idx` 是来源 Rank 分区接收槽，epilogue 的同名变量是展开后的专家输出行；UB 直方图复用为前缀时也使用该阶段的含义。

规范对应提交 [eb274049](https://github.com/Kirrito-k423/agent-skills/commit/eb2740498eafa9dc92115f1ba4d39e154e92fa89)，详细要求见 Skill 的 `references/terminology-provenance.md`。复现记录位于 `terminology-before/browser-reproduction.json`；最终独立术语审核和根浏览器记录分别位于 `review/terminology-review.json`、`root-terminology-ui.json`。这次迭代保持原模型与数字推导模块的 SHA-256，重新验证修改后的页面交互。

## 证据边界

动画是源码语义模型，示例参数由教学需要选择。原子分配的顺序仅代表一种合法线性化；教学步骤不是各 Rank 的硬件全局同步时刻。Fresh、Cached、FP8 和可选补零等路径按源码条件解释。CPU 模型与浏览器验收不代表 CANN 编译、多 Rank NPU 精度或硬件性能测量。

函数清单、源码哈希保存在 `source-manifest.json`；独立审阅位于 `review/`，作品各自的检查证据位于 `walkthrough/` 与 `animation/`。最终汇总验收记录另存 `validation-summary.json`。

## 分工记录

- 根代理：固定源码、双方法函数清单、统一入口、独立浏览器与交付核对。
- `walkthrough-agent`：走读分析、逐行说明和渲染；复杂通信/内存函数派发配置为 `gpt-6.1-sol`、high。
- `animation`：独立数据模型、双屏动画和模型/浏览器检查；派发配置为 `gpt-6.1-sol`、high。
- `independent-review`：逐函数及内存模型独立复查；派发配置为 `gpt-6-astra`、high。
- Token 输入、缓存输入及输出统计不可得，未据此宣称额度或费用节省。

## 最终验收

| 作品 | 完整源码 | 模块 / 定义 / 解释段 | 独立审核 |
|---|---:|---:|---|
| Dispatch | 867 行 | 3 / 3 / 42 | 3 个定义及内存模型 PASS |
| Copy epilogue | 623 行 | 4 / 11 / 33 | 11 个定义及内存模型 PASS |
| 四 Rank 双屏动画 | 九种输入与配置预设 | 20,544 个模型断言 | 九预设独立 oracle PASS |

- **走读交互**：根代理独立在 Chromium 检查全部 7 模块、14 定义、75 解释段、26 个内部调用下钻/返回，以及搜索、反向定位、逐行 Tips、列宽调整、8 条内存路径的源码联动。完整源文件和独立审核冻结内容逐字段一致。
- **动画交互**：2,026 个浏览器组合通过，覆盖 1280×720、1440×900、1920×1080，播放、暂停、回退、重置、预设切换、反选 token、hidden 第 255 个元素、后加入、刷新、控制页接管、对象检查器与空核就绪发布。无脚本错误或几何验收失败。
- **本轮数字来源审核**：九预设、24 类账本对象的 629,468 个分阶段元素查询及 2,135,248 个全阶段 auto 查询由独立代理复核；两类查询存在重叠，不相加当作独立用例总数。从初始输入与配置独立重建路由、计数、前缀、槽位、SQE 字节和复制来源，并核对操作数的调用与时刻。14,201 个配置／shape／bytes／dtype／metric 查询、1,120 个错误显示值探针和 20 项具名语义回归均通过。最终独立记录为 `review/numeric-review.json` revision 4。
- **本轮数字 UI 验收**：根代理真实执行 14 次针对截图的悬浮，以及 12 个完整对象／条件分支样本，覆盖三个视口、写前写后、历史来源、第 255 元素、嵌套 SQE、SF pack、缓存、空输入、可选字段、红色发布与普通色保留字段。固定浮层内的操作数展开、滚动、关闭、Esc 和源码链接均实际操作通过；历史行中未命中的 UB 零桶保持普通色。两份根记录保存最终页面文件哈希；作者全阶段浏览器检查涵盖 130,224 个可见数据绑定和 2,880 项针对性／几何／交互断言，见 `animation/numeric-browser-results.json`。
- **内存解释**：两份视图共 25 个区域、28 条搬运/同步边；各文件空间视图重叠，不能直接相加当作不同物理存储数量。申请、容量、切片、生命周期、GM/UB 与控制面均有独立复核。
- **返工记录**：函数正文经过四轮审核；最后一轮格式门禁修复仅为空格、连续读取返回值说明和输入区域标签，另经独立复审。内存模型最终 revision 4，动画独立审核最终 revision 3。
- **检查记录**：`validation-summary.json` 汇总最终 SHA-256 与证据范围；`validate_handoff.py` 验证交付与独立冻结内容一致。`root-walkthrough-ui.json`、`root-animation-ui.json` 和 `animation/browser-results.json` 保存实际浏览器证据。
- **数字返工记录**：前版通过 `numeric-before/browser-reproduction.json` 复现：截图两处都没有数字级解释目标。改为模型生成元素身份与推导记录后，又修正了邻近数字被浮层遮挡、模态检查器外浮层不可点击、缓存引用本轮未生成计数、可选字段误判缓存、未命中桶误称原子写等问题。相应用例分别由根浏览器和独立数值审核复验；原 `model.mjs` 哈希保持不变。
- **术语覆盖**：9 个源码入口共 3,732 行保留原文，11,871 个源码词法绑定没有未解析项。24 类对象、28 类嵌套字段及 88 项说明文字清单均有显式解释。72 个参数查询、4,398 个对象实例查询、6,452 个字段查询核对身份与当前角色；这属于覆盖检查，词义正确性由独立审核另行判断，不能仅凭绑定数量证明。
- **术语语义与交互**：独立复查 59 项高风险同名变量／作用域用例及 13 项实际 UI 检查；根代理另执行 10 项检查与 12 次悬浮，核对三个实际 CSS 视口、9 个完整源码页的逐行原文、空输入上下文、相关术语切换、地址推导入口、通用来源与 SGE 地址的区别、键盘、后加入与刷新。作者三个视口全部预设／阶段的两屏回归检查 183,864 个术语绑定及 6,933 项断言。三份根数字／术语报告和作者全阶段报告均记录被测功能文件 SHA；验收门禁拒绝过期证据。
- **术语返工记录**：前版参数名没有独立入口。改为带作用域词表和显式绑定后，修正了接收槽／输出行、UB count／prefix、packed reduction／CQE status 等同名含义，相关术语继承原字段身份、地址关联值递归打开词义、重绘后浮层重开及首次悬浮被抑制的问题；各项有语义或实际浏览器回归。原模型与 `provenance.mjs` 均未改变。

实际运行模型无法由工具独立读回；以上模型名为派发配置。所有 token 统计不可得，不表示零用量。页面运行不需要原 Skill 或联网；重新生成走读 HTML 需要原 Skill 的渲染器及最终 `*.analysis.json`。

另提供 `dispatch-analysis.zip`：包含可运行页面、冻结源码、最终分析与验收证据。解压到任意目录后，在包内执行 `python3 serve.py` 即可。

## 发布副本验证

`export-browser-results.json` 记录从本目录实际启动临时 HTTP 服务后的 Chromium 检查：入口、M/T/A/SF、双屏进度、数字推导与完整源码的空输入上下文均通过。临时服务已停止；页面运行仅需 Python 标准库和浏览器。`export-receipt.json` 记录导出范围；本机运行时、Git 元数据、依赖缓存和原型诊断文件均未打包。
