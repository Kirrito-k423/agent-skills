# DeepEP Dispatch Walkthrough

两份无需联网的单文件 HTML，可直接用浏览器打开：

- `dispatch.walkthrough.html`：867 / 867 行源码，3 个模块，3 个函数定义（含 `preload_metadata` lambda），42 个语义块，854 条逐行说明。
- `dispatch_copy_epilogue.walkthrough.html`：623 / 623 行源码，4 个模块，11 个函数定义（含 `issue_load` lambda），33 个语义块，607 条逐行说明。

冻结 revision：`main@3b25377d04b24fc6154698ded78a2bcb2c59afff`；DeepJIT gitlink 为 `65f513952b8771408a19202f65e36398522db6db`。源码完整嵌入 HTML，没有改源文件、提交 Git 或发布博客。

14 / 14 函数已由 `independent-review` 逐函数独立 PASS；两份 memory model 也已独立 PASS。命名定义和 lambda 清单经 tree-sitter 与文本/花括号边界两种方法核对。外层 kernel 与嵌套 lambda 的说明范围有意重叠，逐行说明总数因此不能直接当源码行数。

`dispatch` 内存视图有 5 个空间、13 个区域、13 条搬运/同步边、4 条路径及 4 个申请/预算对象；`epilogue` 有 3 个空间、12 个区域、15 条边、4 条路径及 3 个申请/预算对象。模型追到 `aclrtMalloc` / `SymmetricMemory` / `Context` / `EPBuffer` / PyTorch tensor owner，区分请求容量、设备分配、信号区、最大接收保留跨度、有效 token extent 与每 AIV UB 预算。**这份实现没有专门 shared expert 路由**，相应页面如实标注未实现；不虚构共享专家内存区。源码给出显式 L2 hints，未见显式 L1 或另一片上 Local Memory 资源区。

主路径为 `EPBuffer.dispatch` → host launch → issue/Scalar 与 SIMT worker 并行 → URMA 完成边界 → expert epilogue 输出。fresh/cached、SF、weight、padding、trace 与 barrier 位置由模板或运行时条件控制，不能视作所有分支同时执行。默认 issue 尾部退出不等于网络完成；host 选择 issue 尾或 epilogue 首执行 drain，并在此期间保活发送 tensor。

这些页面展示源码机制和容量公式，**不是 NPU 实测 trace**；源码中历史耗时备注没有被当作本次硬件性能证据。未执行 NPU 编译或多 Rank 硬件实验。

生成使用用户指定 Skill 的 `scripts/render_walkthrough.py` 与原始 assets。`render_adapter.py` 仅补充跨行模板（含 VF_CALL）及已声明 struct/class 命名 constructor 的调用定位证据；原有覆盖、逐行说明、独立 PASS、内存与容量 gate 全部保留。两份页均经过正式严格渲染，无草稿状态。28 处英文源码标识符周围增加空格以满足 Unicode 词边界检查，两个短文案扩写后另行独立复核，不借此削弱审核。

证据文件：

- `mechanical-report.json`：源码/HTML SHA-256、覆盖与清单/PASS集合一致性。
- `smoke-browser.json` 与两张 `*.smoke.png`：Chromium 离线加载、完整源码、模式切换、module、搜索与搬运点击；控制台 0 错误，0 网络依赖。
- `../review/functions-final-ledger.json`、`../review/functions-review-r5.json` 与 `../review/memory-review-r4.json`：独立审核记录。
- `dispatch-ledger.json`：作者请求配置 `gpt-6.1-sol/high`，reviewer 请求配置 `gpt-6-astra/high`，复杂通信/异步/内存直接使用强能力档；实际运行模型无法独立读回，输入/缓存输入/输出 token 不可得，不声明额度或 token 节省比例。普通 helper 没有单独低价路由。

最终 `*.analysis.json` 只合并独立 `*.reviewed.json`。不要用旧 `build_analysis.py` 覆盖冻结结果；复现渲染以最终 analysis 为输入。
