# 分析数据契约

渲染器接收 UTF-8 JSON。所有行号均从 1 开始并包含区间端点。字段值应使用源码里的真实名称；解释文本使用读者能理解的中文。

## 顶层结构

```json
{
  "schema_version": 2,
  "title": "DeepEP MoE Dispatch 代码走读",
  "summary": "从 token 路由到远端写入与本地输出的完整执行链。",
  "language": "cpp",
  "review_summary": {
    "status": "PASS",
    "source_sha256": "源码 UTF-8 内容的 64 位 SHA-256",
    "inventory_count": 58,
    "reviewed_count": 58,
    "pending_functions": [],
    "rework_functions": []
  },
  "function_inventory": [],
  "primary_path": ["initialization", "process-entry", "remote-send", "format-output"],
  "modules": [],
  "functions": [],
  "symbols": [],
  "glossary": []
}
```

- `schema_version`：正式结果固定为 `2`；旧结构只能用草稿模式查看。
- `title`：页面标题。
- `summary`：一句话说明源码解决的问题。
- `language`：代码语言标识，仅用于页面展示。
- `review_summary`：冻结源码哈希、函数清单计数和全量复查状态。
- `function_inventory`：双重发现后冻结的完整函数定义清单，不得只列“核心函数”。
- `primary_path`：典型执行模块 ID 的有序数组，用于第一列居中主干、模块编号和侧支路排布。
- `modules`：左列 E2E DAG 节点。
- `functions`：中列函数与语义块 DAG。
- `symbols`：右列代码语义强调索引。
- `glossary`：可选的术语解释。

函数清单元素：

```json
{
  "id": "source-h-Namespace-CopyInAndOut-2052",
  "name": "CopyInAndOut",
  "signature": "Namespace::CopyInAndOut(LocalTensor<int32_t>, GM_ADDR, ...)",
  "start": 2052,
  "end": 2098,
  "unit_kind": "definition",
  "inactive": false
}
```

- `unit_kind` 取 `definition` 或 `declaration_only`。
- 所有 `definition` 必须与 `functions[]` 一一对应，ID 和范围完全一致。
- `review_summary.inventory_count`、`reviewed_count` 和 `definition` 数量必须相等。
- `source_sha256` 必须与当前源码内容一致；源码变化后所有旧复查失效。

## E2E 模块

```json
{
  "id": "remote-send",
  "name": "URMASendToken",
  "summary": "把 token 与元数据写入远端 rank 窗口。",
  "ranges": [[3519, 3889], [122, 299]],
  "color": "#1687a7",
  "position": {"x": 20, "y": 68},
  "tips": ["先写 payload，再通过 head bitmap 发布可见性。"],
  "inactive": false,
  "edges": [
    {"to": "format-output", "kind": "data", "label": "远端窗口"},
    {"to": "doorbell", "kind": "handshake", "label": "head bitmap"}
  ]
}
```

约束：

- `id` 在模块内唯一，只使用字母、数字、短横线或下划线。
- `primary_path` 至少包含两个不重复的活动模块；相邻模块必须存在同方向真实 E2E 边，不能按源码顺序臆造执行路径。
- 所有模块的 `ranges` 合并后必须覆盖源码每一行；区间可以重叠。
- `position.x/y` 是 5–95 之间的画布百分比坐标，作为没有 `primary_path` 时的兼容布局和主路径之外左右侧选择提示。
- `edges[].to` 必须指向已存在模块。
- `edges[].kind` 取 `control`、`data`、`sync` 或 `handshake`。
- 条件编译、模板备用实现或入口不可达路径用 `inactive: true` 标记。

## 函数与语义块

```json
{
  "id": "copy-in-out",
  "module_id": "format-output",
  "name": "CopyInAndOut",
  "start": 2052,
  "end": 2098,
  "summary": "读取全局 token 与索引，整理后写入输出张量。",
  "inactive": false,
  "inputs": ["dataFlagGlobal", "xOutInt32Tensor"],
  "outputs": ["expandXOutGlobal", "expandIdxGMTensor_"],
  "side_effects": ["推进 MTE3 写回顺序"],
  "review": {
    "status": "PASS",
    "reviewer": "function-review-agent-2",
    "draft_author": "function-analysis-agent",
    "revision": 2,
    "line_range": [2052, 2098],
    "gaps": [],
    "overlaps": [],
    "unresolved": [],
    "required_changes": []
  },
  "line_notes": [],
  "segments": []
}
```

- `id` 在函数内唯一；`module_id` 必须指向已存在模块。
- `start/end` 必须是函数定义的完整范围，不能只截取核心行。
- `inputs/outputs` 使用源码精确标识符，并收录对理解数据流关键的别名。
- `side_effects` 记录成员、GM、窗口、队列、原子和同步状态变化；没有显式输出的函数不能用空数组掩盖副作用。
- `inactive` 的含义与模块一致。
- `review.status` 只允许 `PASS` 或 `REWORK`；正式渲染只接受独立 reviewer 给出的 `PASS`。
- `reviewer` 不能等于 `draft_author`，所有问题数组在 `PASS` 时必须为空。

### 逐行理解记录

`line_notes` 必须从函数 `start` 到 `end` 每行恰好一条：

```json
{
  "line": 2073,
  "kind": "call",
  "explanation": "调用 DataCopyPad，把 xTmpTensor_ 中已去除通信 flag 的 token payload 写入 expandXOutGlobal。",
  "reads": ["xTmpTensor_"],
  "writes": ["expandXOutGlobal"]
}
```

`kind` 取 `signature`、`statement`、`declaration`、`branch`、`loop`、`call`、`sync`、`comment`、`preprocessor`、`brace` 或 `blank`。

- 每个 `reads/writes` 标识符必须真实出现在本行；没有则使用空数组。
- `explanation` 必须说明本行在当前函数中的具体作用，不能只复述语法。
- 同一函数中不能批量重复同一句解释。

每个 `segments` 元素描述函数中的连续语义块：

```json
{
  "id": "copy-in-out-writeback",
  "start": 2087,
  "end": 2098,
  "title": "批量写回输出",
  "detail": "根据有效 token 数把整理后的数据、索引和 scale 写入全局输出。",
  "kind": "output",
  "input_state": ["xTmpTensor_：已搬入并去除通信 flag 的 token 数据", "dstPosition：连续输出起点"],
  "mechanism": "先写 scale 和 expandXOutGlobal，再等待标量修正完成后写 expandIdxGMTensor_。",
  "output_state": ["expandXOutGlobal：新增 arriveCount 个 token", "expandIdxGMTensor_：写入修正后的三元组"],
  "why": "数据、scale 和反向索引必须使用同一个 dstPosition，才能保持输出行与路由元数据一一对应。",
  "calls": [
    {"name": "DataCopyPad", "line": 2091, "type": "external"},
    {"name": "CopyScalesToOut", "line": 2096, "type": "internal", "target": "copy-scales-to-out"}
  ]
}
```

约束：

- 所有语义块按行号排序后必须从函数 `start` 连续覆盖到 `end`，无空洞、无重叠。
- 每块 1–60 行，以一个完整语义动作为边界；单行关键公式可以独立成块，短函数可以只有一块。不要按固定小窗口机械切片，也不要为了减少块数合并彼此无关的循环、公式或条件编译段。
- `kind` 取 `input`、`compute`、`guard`、`loop`、`sync`、`output` 或 `debug`。
- `input_state`、`mechanism`、`output_state` 和 `why` 必填；解释至少引用一个本段真实源码标识符。
- `calls[].line` 必须落在当前语义块内。
- `type: internal` 时 `target` 必须指向已声明函数；外部调用不要伪造 `target`。
- `calls[].name` 必须以调用形式真实出现在 `calls[].line`；SIMT kernel 允许作为 `VF_CALL<kernel>(...)` 的模板参数出现，此时 `kernel` 仍作为被调用的内部函数记录。
- 中列上半区从 `segments[].calls[type=internal]` 自动构造模块函数调用 DAG；模块内目标使用实线节点，跨模块目标使用虚线节点，不要另建一份容易失真的调用图数据。
- 禁止“语义块 04”“条件守卫 / 路径选择”“继续执行当前函数的数据变换”“循环处理一批任务”“同步与可见性”等占位解释及同义模板。

## 代码语义符号

```json
{
  "name": "expandXOutGlobal",
  "type": "output",
  "description": "最终扩展 token 输出的全局内存视图。"
}
```

`type` 取：

- `input`：关键入口或只读数据对象，琥珀色；
- `output`：关键写回对象，蓝色；
- `api`：核心外部 API，紫色胶囊；
- `call`：内部函数调用，紫色下划线；
- `sync`：同步、通知或可见性边界，青色。

同一标识符如果在不同阶段承担不同角色，优先按最终数据流作用分类，并在 `description` 解释别名关系。不要写子串或正则表达式；渲染器按完整标识符匹配。

## 内存层级与搬运模型

通信、算子融合或数据编排代码应提供 `memory_model`，把控制流补充为空间、分配与传输视角。只记录源码能够证明的空间；不能因为变量名含 `local` 或 `shmem` 就推断为 L1、UB 或片上 Local Memory。目标函数只接收 workspace 指针时，必须继续追踪到上游 allocator/owner，不能把传入指针误写成“函数内申请”。

```json
{
  "review": {
    "status": "PASS",
    "reviewer": "memory-review-agent",
    "draft_author": "memory-analysis-agent",
    "revision": 2,
    "source_revisions": ["main-repo@commit", "shmem-submodule@commit"],
    "unresolved": [],
    "required_changes": []
  },
  "summary": "token 从当前 Rank 输入 GM 搬入 AIV UB，打包后进入本 Rank staging GM，再由 URMA 写入目标 Rank 接收窗口。",
  "facts": [
    "LocalTensor/TBuf/TQue 与 __ubuf__ 在本文件中表示 AIV UB。",
    "GlobalTensor 与 __gm__ 表示 GM；aclshmem_ptr(rank) 返回目标 Rank 可寻址窗口。"
  ],
  "canvas": {"width": 1280, "height": 560},
  "spaces": [
    {"id": "local-gm", "name": "当前 Rank GM", "kind": "gm", "scope": "rank-local", "color": "#2457d6", "description": "输入、输出和本地通信窗口。"},
    {"id": "aiv-ub", "name": "AIV UB", "kind": "ub", "scope": "aiv-local", "color": "#b66516", "description": "TPipe 管理的 LocalTensor 工作区。"}
  ],
  "regions": [
    {
      "id": "input-gm",
      "space_id": "local-gm",
      "name": "输入 token",
      "owner": "当前 Rank",
      "address": "x + srcTokenIndex * axisH_ * sizeof(XInType)",
      "size": "copyInAxisH_ * sizeof(XInType)",
      "purpose": "原始 token 行",
      "position": {"x": 100, "y": 90},
      "evidence_lines": [979, 1080]
    }
  ],
  "transfers": [
    {
      "id": "load-token",
      "kind": "data",
      "from": "input-gm",
      "to": "token-ub",
      "module_ids": ["stage-pack"],
      "function_id": "token-to-expert-id",
      "line": 1080,
      "evidence_lines": [1080],
      "api": "DataCopyPad",
      "engine": "MTE2",
      "size": "copyInAxisH_ * sizeof(XInType)",
      "source_address": "xGMTensor_[srcTokenIndex * axisH_]",
      "target_address": "inQueue.AllocTensor<XInType>()",
      "sync": "EnQue/DeQue 后由向量流水消费",
      "description": "把一行 token 从当前 Rank GM 搬到执行该 stage 的 AIV UB。",
      "curve": 0
    }
  ],
  "paths": [
    {"id": "remote-token", "name": "远端 MoE token", "color": "#2457d6", "description": "本地 staging → URMA → 目标窗口 → 输出。", "transfer_ids": ["load-token"]}
  ],
  "allocations": [
    {
      "id": "symmetric-workspace",
      "space_id": "local-gm",
      "name": "每 Rank symmetric workspace",
      "kind": "aclshmem_malloc",
      "scope": "每个 Rank；所有 PE 同序同大小",
      "capacity": "B；必须满足 layout.end_offset <= B",
      "base": "workspace_ptr / symmetric_buffer",
      "alignment": "allocator 16B；内部 payload 32B、signal 512B",
      "lifetime": "BufferRuntime 构造到销毁",
      "reuse": "每次 dispatch 只按 offset 切片，不重复申请",
      "purpose": "容纳最坏接收行、metadata 与 signal",
      "evidence": ["csrc/buffer_runtime.cpp:L513-L524", "csrc/ops/dispatch.cpp:L579"],
      "region_ids": ["input-gm"]
    }
  ],
  "resource_budget": {
    "summary": "分别估算每 Rank 用户 workspace、底层物理 symmetric heap 和每 AIV UB。",
    "assumptions": ["W=world_size；B=每 Rank 用户 workspace 字节数。"],
    "cards": [
      {
        "id": "physical-per-rank",
        "label": "每 Rank 物理 heap",
        "value": "align_up(B+2MiB,2MiB)+runtime_extra",
        "detail": "不能把远端 virtual mapping 再次计入物理容量。",
        "level": "verified",
        "evidence": ["shmem_init.cpp:L966"]
      }
    ]
  }
}
```

约束：

- `spaces.kind` 取 `gm`、`ub` 或 `control`；`scope` 必须明确是当前 Rank、目标 Rank、AIV 私有还是设备控制面。
- `regions` 必须写出 owner、地址公式、容量/步长公式、用途和证据行；画布坐标用于稳定复现空间拓扑。
- `transfers` 的 `from/to` 指向区域，主 `line` 位于声明的 `function_id` 范围内，`evidence_lines` 可补充 caller 中的地址绑定或 callee 中的实际搬运。
- `review` 是内存模型自己的独立复核记录；reviewer 不能与 draft_author 相同，必须冻结主仓与 allocator/submodule 的版本，且 `unresolved/required_changes` 为空后才能正式渲染。
- `allocations` 记录真正的 allocator/heap 申请或 kernel launch 资源预算。`capacity` 使用源码可证的精确公式；`lifetime/reuse` 说明何时申请、何时释放、是否跨调用复用；若底层 runtime 使用全局引用计数，生命周期必须写到最后一次 finalize；`region_ids` 指向该大块承载的逻辑区域，并覆盖零容量 fallback 等条件化复用。
- `resource_budget.cards` 至少区分：每 Rank 用户申请容量、layout 的 `base_offset`、`total_bytes/span` 与 `end_offset`、底层物理 symmetric heap、全通信域物理估算和每 AIV UB。无法代入运行时形状时保留符号公式，并在 `assumptions` 定义每个变量。
- workspace `regions[].size` 必须同时区分最坏 reserved capacity 与本次 visible/used extent；不能用返回 tensor 的有效行数冒充 allocator 预留容量。
- 容量 hint 的风险描述要区分“公式没有显式计入的结构字节”和“经过最终大页对齐后的净缺口”，并列出 hint 固定采用、但运行时未必强制的 experts、dtype、scale 或 Top-K 上限假设。
- 容量提示函数与真实 layout 公式不一致时用 `level: warning/critical` 明示；不能因为 helper 名称含 `size_hint` 就假设它严格充分。
- “远端窗口”通常是其他 Rank 对称 heap 的地址映射，不是本 Rank 的第二次物理 malloc；物理总量按 Rank 数乘每 Rank heap，不按传输边数累加。
- 每条搬运都要区分 API/引擎：MTE2、MTE3、向量 `Copy`、SIMT store、URMA WRITE、原子发布或 MMIO doorbell 不能合并成同一种箭头。
- 源地址、目标地址、长度公式和同步条件必须同时存在；“从 GM 到 UB”而没有具体偏移和长度的记录不合格。
- `paths` 描述远端、本地 self-copy、shared expert 和控制面等真实关键路径；每条 transfer 至少属于一个路径。
- 对没有源码证据的 L1/Local Memory 明确写“未见显式使用”，不要补画虚构缓存层级。

## 术语表

```json
[
  {"term": "head bitmap", "description": "发布给接收端的到达标记，用于建立 payload 可见性。"}
]
```

术语表只解释领域概念和协议，不重复逐行代码说明。
