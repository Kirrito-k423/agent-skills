# 位图观测模型

使用 `schema: "packet-flow.v1"`。该契约回放接收侧观察，不表达网络包的真实在途状态。

| 字段 | 约束 |
|---|---|
| title | 中文页面标题 |
| ranks / cores / groups | 全局规模，正整数 |
| blocksPerToken | 每条 token 的可观察块数，1–24 |
| blockBytes / payloadBytes / flagBytes | 块大小、载荷区和标志区字节数 |
| expectedLaunches | 用户预期轮数；不得自动补齐数据 |
| roles | 数组，元素为 `{begin,end,name,color}`，核编号半开区间 |
| source | 附件 URL、评论编号、哈希、源码 SHA、运行二进制 SHA；未知用明确文字 |
| notes | 人类可读边界说明 |
| launches | 每次独立 kernel 调用，跨 rank 的调用编号对应关系也应说明 |

每个 launch 包含 `label`、`origins`、`coreEpoch`、`coreEnd`、`tasks`、`observations`、`dropped`。`origins[rank]` 是该接收 rank 的最小 LW epoch 原始十进制 tick 字符串；其它时间都先用整数减该 origin。`coreEpoch/coreEnd` 长度为 ranks×cores，无会话时用 null，不补零。跨核时钟未经验证时在 notes 标明。

任务固定字段顺序：

```text
[srcRank, dstRank, recvAiv, localExpert, tokenCount, inferredSendAiv, sendGroup]
```

`sendGroup=-1` 表示本机复制；推导不到发送核时用 `inferredSendAiv=-1` 并在页面使用来源 rank 级端点。零 token 任务保留。

观察固定字段顺序：

```text
[taskIndex, start, end, copiedOrZero, beginSlot, tokenMasks, recordId, sourceLine]
```

`tokenMasks` 每项是一条 token 的按块位图，低位对应 block0；范围仅覆盖这次检查的 token。`copiedOrZero=0` 表示本记录没有复制完成标记。此字段不是观测缺失标记。同一任务的观察按时间有序；不得跨 launch 复用之前的状态。

原始位图含 64 位数字时在适配器中先用任意精度整数解码，再拆成每 token 的小位图，禁止把 64 位掩码直接变成 JavaScript Number。第一次发现一个块为一，显示其首次一所在 `[start,end]`；若此前某次读到零，保守到达范围为 `(上次零的 start, 首次一的 end]`。不能把上次零的 end 当作确定下界。

模型保留所有观察，包括连续相同状态；绘制时可以只给新增块生成连线。数量统计依据全量模型，不能受连线预算影响。倒退播放通过查询截至当前时间的观察重建状态。

本次实践：PR #27 的 `18381ce…zip`，64 rank、56 AIV、16 块/token。附件实际有两次 launch，每次内有四个发送 group；用户预期四次，缺少的轮次在界面留空。AIV28–43 的映射来自固定源码，发送时间、真实 SQ 和原始 tokenId 未记录。不要把这个实践参数写死到其它任务的解析器。
