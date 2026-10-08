# 改写示例

英文内容是待改写文本与结果；其余说明使用中文。这些示例演示保持语义的改写，不代表已通过正式词典核验。

## 保留不确定性

原文：

> An error may have occurred while processing your request due to a possible mismatch in the expected data format, which could be caused by an outdated client version.

改写：

> An error may have occurred during request processing. The cause may be a mismatch with the expected data format. An outdated client version could cause this mismatch.

拆开错误、格式和客户端版本三项信息，保留两层可能性。不能改成确定失败，不能新增“最常见原因”，也不添加原文没有的检查命令。

## 保留条件与建议强度

原文：

> Once the upstream job has completed and assuming no errors were raised, the downstream agent should proceed to consume the output artifact, though it is worth noting that partial artifacts are sometimes produced under timeout conditions.

改写：

> If the upstream job has completed with no errors, the downstream agent should read the output artifact. A timeout sometimes produces a partial artifact.

保留作业已完成的状态、无错误条件、`should` 和 `sometimes`。不要把建议升级为强制步骤，也不要把“检查产物完整性”新增进改写结果；用户要求操作建议时才另行提出。

## 不补写机制

原文：

> This cache compares prompts by semantic similarity. It works with the existing stack and does not require a specific vendor.

原文已经清晰，可以保持原样。不能新增“精确匹配缓存更容易未命中”“不向外部存储数据”或量化性能收益；这些信息并不由原文推出。

## 区分近义词与不同动作

原文：

> Check the configuration. Confirm receipt of the report.

脚本可能提示 `check` 与 `confirm` 混用，但两句表达不同动作。保留两词，不为了消除脚本提示把“检查配置”和“确认收件”合并成一个动作。

## 展示规则表

用户要求说明改动时，使用中文列名，保留英文例句：

| 规则 | 原文 | 改写 |
|---|---|---|
| 动作用动词表达 | `Perform an analysis of the log.` | `Analyze the log.` |
| 一句一项指令 | `Open the file and read line 3.` | `Open the file. Read line 3.` |
| 保留限定条件 | `The request may have failed.` | 保持原样；去掉 `may have` 会改变确信程度 |

不要把“读起来更流畅”当作语义相同的依据。交付前逐项比较主体、条件、范围、数字和要求强度。
