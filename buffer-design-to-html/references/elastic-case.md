# 方法样例：Elastic Dispatch 的空间账

本样例提炼自 `ascend_deepep@2c6c59d1b8de1fa9f0c0f8b2f522455df94b9fa1`，对比基线为 `cb54e44`。它不是适用于所有算子的规范，也不保证其他版本仍然相同。

## 统一故事，而不是换一组公式

令 R=2 张卡，每卡最多 T=2 个 token；每 token H=4 个 BF16 数，选 K=2 个 expert；全局 E=4 个 expert；编号 8 B，权重 4 B。

| 源记录 | expert 路由 | 目标 Rank |
| --- | --- | --- |
| Rank 0 的 a | [0,1] | 0 一份 |
| Rank 0 的 b | [0,2] | 0、1 各一份 |
| Rank 1 的 c | [1,2] | 0、1 各一份 |
| Rank 1 的 d | [2,3] | 1 一份 |

每张目标卡实际收到三份不同 token，但最坏情况必须容纳四份。相同 token 命中同卡多个 expert 时不重复发送向量，所以每目标容量为 R×T，而不是 R×T×K。

当前窗口按来源 Rank 固定分区，每个来源保留 T 槽；不是把本轮有效 token 简单放在全部窗口的前 M 槽。Rank 0 收到 `[a,b | c,空]`，Rank 1 收到 `[b,空 | c,d]`。

## notify：先说明六个数为什么存在

每源 Rank 发布 R 个目标卡 token 计数、E 个 expert 路由计数；每个 int32 为 4 B。

- Rank 0 发布 `[2,1 | 2,1,1,0 | 0,0]`。
- Rank 1 发布 `[1,2 | 0,1,2,1 | 0,0]`。
- 前六个数是 24 B 有效计数，后两个数是 8 B 补零，共覆盖 32 B。
- Rank 0 汇总得到三份 token、四条本地 expert 路由；计数不同来自 a 命中两个本地 expert。

实际控制数据跨度是 `align32(4×(R+E))`；实现固定保留 2 MiB，不能说算法必须使用这 2 MiB。

## dispatch：从记录字段到字节坐标

坐标相对于 payload 基址 P；各行按预留四槽计算。

| ID | 字段/留空 | 区间 | 字段容量 | padding | 跨度 |
| --- | --- | --- | ---: | ---: | ---: |
| A | 全部 x，4×BF16/槽，stride=32 | [0,128) | 32 | 96 | 128 |
| B | 每槽一个 int32 源身份 | [128,144) | 16 | 0 | 16 |
| C | 将 idx 起点凑到 32 B 倍数 | [144,160) | 0 | 16 | 16 |
| D | 每槽两个 int64 top-k 编号，stride=32 | [160,288) | 64 | 64 | 128 |
| E | 每槽两个 float32 权重，stride=32 | [288,416) | 32 | 96 | 128 |
| 合计 | | [0,416) | 144 | 272 | 416 |

三槽有效时，向每目标 payload 写入字段的长度合计为 `3×(8+4+16+8)=108 B`。这不是 dispatch 与 epilogue 的累计全部读写量，也不是网络实际传输量。未提供权重时区域仍预留，但没有对应写入。

AoS/SoA 图使用同一组 x/src/idx/weight 标识。父提交的 Kernel 已经采用 SoA；本次是修改 Python hint 与指针 placement，不是把 Device 从 AoS 改成 SoA。

## 在递归阅读器中呈现这个例子

以一次 workspace 申请为根，先分为控制前缀、payload 和尾部取整余量；payload 再分为表中的 A/B/C/D/E。进入 A 时看到四个 32 B 记录槽，进入某槽后继续拆为 8 B BF16 字段与 24 B 行内 padding。进入 D、E 时同样能看到各自字段和行内留空，不能把三个区域的子块都链接到共同 payload 指针后结束解释。

树表按物理地址排列并显示每层局部 offset；treemap 按当前层真实字节占比分配面积。宏观层的 416 B payload 很小，可以从树表进入，再以 payload 为全图展开；不能为了看清把它在 4 MiB 根图中人为放大，也无需另做 1 B 格子。

右侧的坐标链从 workspace 基址进入 2 MiB 控制前缀后的 payload 基址 P，再进入 A/B/C/D/E、某条记录、某个字段。P 只是本样例的讲解名称；正式页面重新核对源码中的真实指针变量并精确高亮。区域 C 引用对齐产生的空隙证据，记录内 padding 引用 stride 与字段长度证据，不为没有独立变量的空白虚构代码对象。

所有层的容量和右侧公式从同一计算结果派生；“控制前缀 + payload + 尾部余量”只计一次 workspace，放大 payload 或展开槽内字段不会增加总申请量。

## 为什么 416 B 最后变成 6 MiB

Host 保留的 combine hint 为 `T×min(R,K)×(x_stride+w_stride)+T×x_stride=320 B`。该版本 combine Device 尚未实现，不能把预算公式当实测布局。

```text
payload 预算 = max(416,320) = 416 B
workspace 原始需求 = 固定控制前缀 2 MiB + 416 B
workspace hint = 向上凑到 2 MiB 倍数 = 4 MiB
Runtime 用户配额 = workspace 4 MiB + 独立 comm_meta 2 MiB = 6 MiB / Rank
```

最后大页取整的尾部余量为 2,096,736 B；它与 body 内的 272 B padding 是两笔账。

独立 `comm_meta_ptr_` 在正常 Elastic 路径未使用，但仍申请；V1 零 workspace 路径还有 fallback，Python 仍暴露地址。不能称为 Elastic 必需，也不能据此直接删掉 API。总配额不含 Torch Tensor、UB 和 SHMEM 内部额外区域。

## 大规模预设与反例

R=8、T=4096、H=7168、K=8、编号 8 B 时：dispatch=473,038,848 B；combine hint=529,530,880 B（505 MiB）；当前 workspace hint=508 MiB，外加独立 2 MiB 后配额=510 MiB/Rank。E 影响 notify，并不直接改变这四个 payload region。

不要把 R×配额称作集群全部显存占用；这里只能累计上述每 Rank 独有配额。

旧 Elastic hint 包含 V1 形状的四项 notify 预算，但修改前的 Elastic notify 也已经用 R+E 计数。追历史源码与实际消费者后才发现这个差异；因此“解释公式为何合理”之前必须先确认公式有没有在描述真实对象。

## 源码对照线索

- `ascend_deepep/elastic.py:214–321`：hint 与参数检查。
- `include/ascend_deepep/elastic_dispatch_layout.h:17–38`：控制前缀和 payload 切片，不 malloc。
- `csrc/buffer_runtime.cpp:520–545,573–596`：两次独立申请、fallback、借用视图。
- `kernels/elastic_dispatch.cpp:68–94`：真实 SoA offset 与 stride。
- `kernels/elastic_dispatch.cpp:255–258,296–404`：metadata 布局与读写。
- `kernels/elastic_dispatch.cpp:535–625`：字段写入长度。
- `kernels/elastic_combine.cpp:9–47`：该版本尚未实现的 Device。

模板只预置容量模型与上述证据线索，未内嵌整个仓库源码。生成正式案例文档时重新读取目标版本，补入真实代码片段及读者需要的逐行说明。
