---
name: codex-model-speed-benchmark
description: 对 Codex 桌面版或 CLI 可用模型进行可复现的实际速度测试，比较 GPT-5.6 Luna、Terra、Sol 等模型、low/medium/high/xhigh 等推理档位以及标准与快速服务层。用户询问 Codex 模型测速、首响应延迟、输入 token 处理速度、输出 token 吞吐、Fast 加速比、模型速度矩阵、性能回归或要求生成 CSV/JSON/Markdown 测速报告时使用。仅在用户确认会消耗 Codex 用量后运行真实请求；查环境、生成计划、试运行和解析已有结果不消耗模型用量。
---

# Codex 模型测速

使用 `scripts/codex_benchmark.py` 规划、执行和汇总 Codex 专用测速。保持提示词、工作目录、客户端配置和执行顺序可审计，不把端到端等待时间伪装成服务端纯推理速度。

## 执行流程

1. 运行环境检查：

   ```bash
   python3 scripts/codex_benchmark.py check
   ```

2. 先生成计划并向用户报告请求数量、矩阵范围和用量风险：

   ```bash
   python3 scripts/codex_benchmark.py plan --preset quick
   ```

3. 根据目标选择测试规模：

   - `smoke`：只验证标准与快速模式能否正常调用，共 2 次请求。
   - `quick`：覆盖 3 个模型、4 个推理档位、2 个服务层及延迟/输出工作负载，共 48 次请求。
   - `full`：在完整矩阵上加入预热、5 次重复和长短输入差分，共 576 次请求。
   - `custom`：用命令行参数明确指定模型、档位、服务层、工作负载和重复次数。

4. 在用户明确确认消耗 Codex 用量后运行。必须保留脚本要求的 `--confirm-usage`：

   ```bash
   python3 scripts/codex_benchmark.py run \
     --preset quick \
     --confirm-usage \
     --output-dir /absolute/path/to/codex-benchmark-result
   ```

5. 中断后使用同一目录续跑：

   ```bash
   python3 scripts/codex_benchmark.py run \
     --preset quick \
     --confirm-usage \
     --resume \
     --output-dir /absolute/path/to/codex-benchmark-result
   ```

6. 对已有结果重新生成报告：

   ```bash
   python3 scripts/codex_benchmark.py summarize /absolute/path/to/codex-benchmark-result
   ```

7. 测量长文本的纯流式输出吞吐时，使用 app-server delta 脚本。该脚本要求隔离安装 `tiktoken`，并以实际最终消息文本独立计数：

   ```bash
   PYTHONPATH=/absolute/path/to/isolated-deps python3 scripts/codex_stream_benchmark.py \
     --model gpt-5.6-terra \
     --effort medium \
     --tier fast \
     --min-text-tokens 10000 \
     --rows 910 \
     --words-per-row 10 \
     --confirm-usage \
     --output-dir /absolute/path/to/codex-stream-10k
   ```

## 指标纪律

- 将 `wall_seconds` 作为 Codex CLI 端到端耗时。
- 将 `input_tokens`、`cached_input_tokens`、`output_tokens` 和 `reasoning_output_tokens` 直接取自 `turn.completed.usage`。
- 将 `usage_non_reasoning_output_tokens` 计算为 `output_tokens - reasoning_output_tokens`，同时保留原始字段。**不得把它称为可见文本 tokens**，因为 usage 可能还包含最终消息以外的非 reasoning 输出。
- 仅在事件流含消息开始或增量事件时填写 `usage_non_reasoning_active_tps`；否则保持为空。
- 将 `usage_non_reasoning_wall_tps` 视为端到端 usage 代理吞吐，不称为纯解码速度。
- 测纯流式输出速度时使用 `codex_stream_benchmark.py`：以 app-server `item/agentMessage/delta` 的首末时间为区间，以 `o200k_base` 对最终消息文本独立计数。优先报告扣除首 delta tokens 的边界修正吞吐。
- 10K 测试必须检查 `target_reached=true`，否则不能把提前停止的短输出用于 10K 平均吞吐。
- 通过 `prefill-short` 与 `prefill-long` 的输入 token 差和响应时间差估算 `prefill_proxy_tps`。必须称为输入处理代理值，不能称为服务端真实 prefill 吞吐。
- 优先比较中位数和 P90；不要用单次最快结果排名。
- 报告成功率、缓存比例、失败信息和 Fast/Standard 实测加速比，避免只展示有利样本。

详细定义和解释边界见 [references/metrics.md](references/metrics.md)。

## 公平性规则

- 使用相同 Codex CLI 二进制、账号、网络、主机和时间窗口。
- 默认顺序随机化但串行执行，避免并发请求互相争抢速率额度。
- 使用隔离临时工作目录、`--ephemeral`、`--ignore-user-config` 和只读沙箱，减少仓库上下文及个人配置干扰。
- 标准模式不设置 `service_tier`；快速模式显式设置 `service_tier="priority"`。
- 每次提示加入等长运行标识，降低用户提示被完整缓存的概率；仍需报告系统前缀带来的缓存 token。
- 不自动清理失败记录或异常值。需要排除时，在报告中写明规则并保留原始 JSONL。
- 不在不同时间、网络或 Codex 客户端版本之间直接归因模型差异；跨时段结果只用于趋势观察。

## 常用定制

完整指定矩阵：

```bash
python3 scripts/codex_benchmark.py plan \
  --preset custom \
  --models gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol \
  --efforts low,medium,high,xhigh \
  --tiers standard,fast \
  --workloads latency,decode,prefill-short,prefill-long \
  --repeats 5 \
  --warmups 1
```

测试真实任务时提供 UTF-8 提示文件：

```bash
python3 scripts/codex_benchmark.py run \
  --preset custom \
  --models gpt-5.6-terra \
  --efforts medium \
  --tiers standard,fast \
  --workloads custom \
  --prompt-file /absolute/path/to/prompt.txt \
  --repeats 5 \
  --warmups 1 \
  --confirm-usage
```

真实任务可能触发工具调用。此时端到端耗时仍有效，但不能解释为纯模型速度；结合报告中的 `tool_item_count` 判断。

## 完成标准

1. `check` 未发现缺失模型、档位或快速服务层。
2. 所有计划请求均成功，或失败原因已在 `samples.csv` 和原始 JSONL 中保留。
3. `report.md`、`samples.csv`、`summary.csv`、`summary.json` 和 `results.jsonl` 均存在。
4. 报告明确区分精确指标、客户端事件指标和代理指标。
5. 向用户给出结果目录、主要中位数/P90、Fast 加速比、缓存情况及不可观测边界。
