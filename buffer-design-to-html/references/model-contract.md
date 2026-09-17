# 递归空间模型与阅读器约定

用一棵空间树同时驱动计算器、树表、treemap、公式和代码解释。以下数据约定用于实现与核验，不要求把内部字段名全部展示给读者。

## 事实和计账口径

记录源码基线、设备/构建、每次独立申请的 allocator/owner/作用范围/释放点，以及指针传递、切片和真实消费者。一个 API 地址或教学放大图不是一笔新申请。

| 量 | 含义 |
| --- | --- |
| `bytes` | 当前节点预留的连续跨度，单位 B |
| `offset` | 当前节点起点相对直接父节点基址的偏移，单位 B |
| `fieldCapacity` | 预留记录全部有效时，字段最多占用的字节，不等于本轮使用量 |
| `actualUsed` | 已有依据的本轮字段字节；未知为 `null` |
| `stride` | 相邻记录同一位置的地址差，不等于一次传输长度 |
| `elementIndex` | 针对指定元素类型的数组下标；不得与字节 offset 混用 |

所有地址、容量、维度和索引用 `BigInt`，半开区间统一为 `[offset, offset + bytes)`。根表示独立 allocation 或明确不暗示物理相邻的 allocation 集合；不同 allocation 不构造虚假的共同绝对地址。

同一个物理父区的直接子节点按地址顺序连续覆盖父区间。行内 padding、区域间 padding、固定预留和未知用途分别标记；不能把未用记录说成 padding。别名和不同阶段的重叠视图通过地址引用表达，不作为第二份物理子节点计账。

## 节点与纯计算接口

目标模型的纯计算函数接收参数，返回根节点及页面需要的参数说明、预设、流程和注记。以模板实际导出接口为准；字段约定如下：

```javascript
node = {
  id: "稳定且在模型内唯一的 ID",
  label: "面向读者的中文名称",
  offset: 0n,
  bytes: 128n,
  kind: "group", // group、field、padding、reserve 或 unknown
  children: [], // 或 childrenFactory；两者二选一
  // childrenFactory: () => [下一层节点],
  formula: {
    expression: "记录数 × 记录步长",
    substitution: "4 × 32 B",
    value: 128n,
    unit: "B",
    why: "每条记录预留一个 32 B 槽，共 4 槽。"
  },
  codeNames: ["源码中确实存在的完整标识符"],
  evidence: [{
    file: "真实文件路径",
    start: 10,
    end: 14,
    fn: "真实函数名",
    code: "原始代码片段",
    role: "placement", // allocation、placement、access 或 definition
    highlights: ["该片段中应精确高亮的标识符"]
  }],
  base: {}, // 可选，基址及别名的解释数据
  address: {}, // 可选，跨基址和元素单位换算的数据
  repeat: {} // 可选，由重复组生成器补充索引范围、份数和 stride
};
```

`children` 为空或没有下一层时为叶子；`childrenFactory` 必须确定性地产生同一父区的有界下一层，不依赖当前 DOM，也不改变其他节点。每个能继续细分的实际布局应提供下一层，不能把懒加载作为省略字段解释的理由。

`formula.value` 必须等于本节点 `bytes`；子节点公式解释自身的份数和跨度，父节点公式解释本层合计。额外的无量纲份数或索引推导放在公式说明/地址项中，并写清单位。若节点是固定预留，说明常量来源和已知用途；未知用途不能用空泛“对齐需要”填补。

节点的 `label` 可以是教学名称；`codeNames` 和 `highlights` 只能包含源码中真实存在的完整标识符。局部变量、成员名和宏保留大小写及下划线。没有独立变量的 padding 使用空 `codeNames`，并解释造成它的 stride、对齐表达式或相邻字段边界。

## 可复用模块和懒生成

`assets/recursive-memory.js` 提供 `childrenOf`、`validateChildren`、`validateTree`、`treemap`、`highlightSegments` 和 `repeatNode` 等基础能力；`assets/recursive-reader.js` 与 `assets/recursive-reader.css` 负责联动阅读器。`repeatNode` 可传 `rangeLabel` 指明被分组的子元素，例如 token 内的“物理 block 范围”，避免把 block 索引误读为 token 索引；未指定时为父名称加“子项”。以模块和模板的实际函数签名为准，不复制未经核验的调用方式。`assets/buffer-design-template.html` 内嵌副本后可脱离技能目录离线使用。

大规模重复空间采用分层索引组：每组保存精确记录范围和字节跨度，选择该组再生成更细的组或具体记录。每个重复组必须能证明：

```text
组记录数 = endIndex − startIndex
组跨度 = 组记录数 × stride
本组局部第 j 条起点 = j × stride
下层各索引范围连续覆盖本组范围
```

索引范围和字节范围都必须完整，不得只验证首末两条就假定中间正确。通用重复生成器可通过构造不变量和边界测试证明大组覆盖；任意自定义 `childrenFactory` 的验证范围、采样或展开预算必须如实报告，不能把“已验证可见节点”说成整棵树已验证。

treemap 对当前父节点的直接子节点按 `bytes` 分配面积。绘图坐标可使用有界浮点，容量与偏移仍保留 `BigInt`。不得设置非零最小面积；小节点使用树表进入后放大。零字节节点不占面积，但可以保留解释条目。

treemap 排列次序不等于内存地址次序。树表按地址排列并显示局部区间，地址图负责表达相邻和偏移关系。

## 三类证据与字段高亮

申请证据来自真正的 malloc/Tensor/运行时分配；子节点可以继承父 owner 的申请证据。位置证据来自本子区的基址、offset、stride 或大小计算。访问证据来自实际写入、读取、同步或清零。宏与类型大小可另列定义证据。

同一循环处理多条记录时可以复用原始代码，但每个记录详情显示自己的索引和地址代入。不同字段不能因为同属一个 record 就只返回相同的父区代码；必须聚焦字段地址、类型、长度或生成它的对齐规则。确无独立访问代码的填充应明确说明，代码数量不是合格证据的替代品。

高亮器按完整标识符边界拆分源码，返回普通文本与高亮片段，使用文本节点创建 DOM。不得用模糊子串让 `state` 同时误标到 `stateBankBase`，也不能将解释别名写入原始代码。检查缺失高亮目标、同前缀变量、下划线成员名以及源码含 HTML 字符的情况。

## 基址链与递归偏移

`base` 和 `address` 是语义约定，可按阅读器接口组织。至少保存以下事实：

- 当前指针/视图的真实源码名；教学别名另有标记。
- 它引用的父基址以及相对父级的字节 offset。
- 当前节点局部偏移、相对所属 allocation 的累计偏移与半开区间。
- 元素类型和 `sizeof`；源码使用下标时同时保存下标值与等价字节偏移。
- 组成偏移的具名项：当前表达式、代入值、单位、所跳过的前置子空间或重复维度，以及关联节点 ID。

推荐将地址项递归组织，而不维护另一棵重复计账的空间树：

```javascript
address = {
  baseId: "可解析到真实基址说明的 ID",
  byteOffset: 160n,
  elementBytes: 4n,
  elementIndex: 40n,
  terms: [
    {label: "跳过前置状态记录", value: 128n, unit: "B", nodeId: "status"},
    {label: "跳过前一行", value: 32n, unit: "B",
     expression: "行号 × 每行跨度", terms: [/* 因子及其来源 */]}
  ]
};
```

这是字段设计建议，不要求为了符合示例而改造已验证的接口。必须验证逐级累计偏移、`sum(terms)=byteOffset`（适用时）和 `elementIndex × elementBytes = byteOffset`。展示根 allocation → bank → Tensor/指针视图 → 行/记录 → 字段的实际坐标链，用连接线和局部零点说明转换。没有中间指针变量的层级显示源码表达式或“讲解别名”。

例如 `(rscvStatusNum_ * STATE_OFFSET + newAivId * aivUsedCumSum_ * UB_ALIGN) / sizeof(float)`，应解释前项跳过多少状态记录、后项跳过多少行、每行由多少个对齐块构成，最后为什么除以元素大小。只解释最终加法结果不够；读者应能点击前置空间、行和单块继续下钻。

两个真实指针只在特定 Rank、分支或参数下相等时，写出相等条件；不能把局部场景中的别名关系推广为所有执行路径。

## 空间详细解释接口

模型可实现 `Case.explainSpace(node, values)`，在选择空间时按当前参数生成说明；不依赖浏览器DOM。说明与数值树分离，避免重复组把整个父节点的容量公式或生命周期当成自己的语义。建议结构：

```javascript
{
  purpose: ["上下游问题，以及该buffer具体保存什么"],
  formulaSteps: [{label, expression, substitution, reason}],
  necessity: ["现有协议为何需要它；可替代设计与推论边界"],
  lifecycle: [{
    phase, actor, action, condition,
    evidence: [真实源码证据]
  }],
  example: ["由当前参数和当前索引生成的实例"],
  boundaries: ["未证实的消费者/清理点/设备行为"],
  related: [{id, label}]
}
```

将正文放在右侧，以“必要性→公式及因子→具体实例→使用时序”为主线，相关源码可以就近展开；保留原有变量高亮和地址下钻。必要时增加右栏内的段落导航，不能在定位正文时滚动左栏。主公式仍是节点本身的 `formula`，详细因子不是另一份数值账本。

在完整小例上验证所有节点，在大规模上按空间族与索引边界抽样，包括懒分组、单行、单元、字段和padding；既检查返回结构和当前参数代入，也由独立审查核对角色、触发条件和清理时序。不能靠把一段父简介重复到所有节点、填固定字数或只断言标题存在满足详细解释要求。

## bank 与生命周期

每个实际 bank 是物理树中的一份空间。逻辑选择保存为当前视图/注记，不能删掉未选 bank 或把 selector 当作新一次申请。状态 bank 和 token bank 分别提供 stride、基址、选择表达式与 selector 所在位置。

区分“已申请几份”“这一轮选择哪份”和“何时允许复用”。只有完整源码证明更新顺序时才提供状态机模拟；初始化或更新函数缺失时，在页面中明确未知。若提供 `0/1` 切换，只称地址选择演示，不宣称多轮必然 `0→1→0` 或使用某个下一轮 epoch。

## 页面联动与验收

左栏只保留申请流程、计算器和递归阅读器的主阅读路径；当前节点的公式、原因、坐标链和代码集中到右栏。桌面端两个独立滚动区域各占可用宽度 50%。树表选择与 treemap 选择共用状态，进入下一层有面包屑返回；右侧空间链接能选择对应节点。禁止选择节点时自动滚动左栏或整个页面。

参数改变时重算模型并同步所有视图，尽可能保持仍有效的节点路径。每项输入都有明确“?”按钮；输入聚焦更新右栏帮助，后续输入保留同一参数解释与右栏位置。窄屏聚焦输入不切走输入页，显式“?”才可切到解释页。单独滚动右栏不影响左栏。

右栏新增参数帮助与容量诊断入口。非法输入隐藏旧树/treemap及旧空间推导，同时清除旧模型、节点选择和注册表引用；右栏必须继续可用，并从当前原始参数生成新诊断。恢复输入后可以使用保存的节点 ID 恢复阅读位置，不能继续使用旧节点对象。

## 参数解释与当前容量诊断接口

模型可提供以下纯接口；参数都来自本次输入，不读取上一次有效模型：

```javascript
Case.explainParameter(id, rawParams, bank) => ({
  title, meaning, unit, category, codeNames,
  limits: ["限制及其来源"],
  effects: ["影响哪些空间及原因"],
  notes: ["建模范围与未知项"],
  evidence: [源码证据],
  links: [{label, url}]
});

Case.diagnose(rawParams, bank) => ({
  ok, title, summary,
  calculations: [{label, expression, substitution, result}],
  issues: [{title, detail, parameters: [参数ID]}],
  notes: ["诊断适用范围"],
  evidence: [源码证据],
  actions: [{label, values: {参数ID: "新的模拟输入"}}]
});
```

`category` 和 `limits` 区分源码硬约束、当前 allocation 容量、建模假设及页面输入护栏。说明每一层限制能否调整、调整影响以及一手证据；没有依据的输入上限不得包装为算法或硬件极限。假设性 allocation 调整必须注明“仅模拟”，不能暗示 Host/Device 源码或真实内存已经改变。

参数详情之后附当前诊断；即便容量不合法，也显示能够确定的当前计算、失败不等式与相关输入。解析失败或诊断函数抛错时容错显示本次错误。缺少扩展接口的合成模板降级到参数元数据和当前构建错误。

建议动作只允许写已定义参数的字符串值，并触发本页重算；不把代码证据或公式字符串当作可执行命令。来源链接只接受 HTTP(S)。可给预设加 `expectInvalid: true`，并可用 `expectedError` 指定应包含的报错文字；检查器应验证它确实构建失败且诊断 `ok: false`，不能为让所有预设通过而删掉真实失败案例。

修改公共模块后运行 `python3 scripts/sync_template.py` 和 `python3 scripts/sync_template.py --check`。运行 `node scripts/test_recursive.cjs`、`node scripts/test_template.cjs`；适配产物再运行 `node scripts/test_template.cjs <HTML路径>`，补目标算子数值预期及源码核对。`assets/visual-contract.js` 属于旧版页面兼容模块，不作为新递归页面的主接口；旧版单位格、epoch 或逐字节契约不得约束新产物。

验证范围至少覆盖节点计账、递归和懒生成、真实面积、精确标识符高亮、坐标换算、bank 物理总量及参数联动。构造子节点缺漏/重叠、错误公式、错误高亮、分组不守恒等反例。浏览器验收进入至少三层，查看两个不同字段和一个 padding，截取递归树/treemap及右侧详情；脚本通过不能代替真实浏览器可读性，也不能证明设备行为或网络性能。
