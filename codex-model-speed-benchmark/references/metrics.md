# 测速指标说明

## 可直接观测的指标

- `wall_seconds`：从启动 `codex exec` 子进程到进程退出的单调时钟耗时，包含客户端启动、网络、排队、输入处理、推理、输出和客户端收尾。
- `input_tokens`：Codex `turn.completed.usage` 返回的总输入 token。
- `cached_input_tokens`：总输入中命中缓存的 token。
- `uncached_input_tokens`：`input_tokens - cached_input_tokens`。
- `output_tokens`：服务端报告的总输出 token，通常包含推理 token。
- `reasoning_output_tokens`：服务端报告的推理 token。
- `usage_non_reasoning_output_tokens`：`max(0, output_tokens - reasoning_output_tokens)`。它是 usage 差值，可能包含最终消息文本之外的非 reasoning 输出，不能称为可见文本 tokens。
- `message_text_tokens`：使用本地 `o200k_base` 对 app-server 最终 `agentMessage.text` 独立计数；这是长输出流式测速的文本 token 分子。
- `success`：进程退出码为 0 且收到 `turn.completed`。
- `tool_item_count`：事件流中观察到的工具、命令或函数调用项目数。

## 客户端事件指标

- `first_model_event_seconds`：首个推理或助手消息事件抵达测速进程的时间。
- `first_visible_event_seconds`：首个助手消息事件抵达测速进程的时间。
- `active_decode_seconds`：当 JSONL 同时提供助手消息开始和完成事件时，两者的时间差。
- `usage_non_reasoning_active_tps`：`usage_non_reasoning_output_tokens / active_decode_seconds`。缺少开始或增量事件时必须为空，并且它仍是 usage 代理值。
- `stream_text_tps`：实际最终消息文本 tokens / 首个文本 delta 到最后一个文本 delta 的时间。首 delta 在计时起点前已经生成，推荐使用扣除首 delta tokens 的 `boundary_adjusted_stream_text_tps`。

Codex CLI 的 `--json` 在部分版本中只在整条助手消息完成后发送 `item.completed`。这时 `first_visible_event_seconds` 不是严格的 TTFT，不能标记为首 token 时间。

## 代理指标

### 端到端 usage 代理吞吐

```text
usage_non_reasoning_wall_tps = usage_non_reasoning_output_tokens / wall_seconds
```

该指标代表当前 Codex CLI 配置下 usage 非 reasoning 输出相对于完整任务耗时的代理吞吐。它包含固定开销和推理等待，也不保证分子全部对应最终可见文本，不能解释为模型纯解码 tokens/s。

### App-server 流式文本吞吐

对长输出使用 `item/agentMessage/delta`：

```text
boundary_adjusted_stream_text_tps =
    (message_text_tokens - first_delta_text_tokens)
    / (last_delta_time - first_delta_time)
```

该指标排除 TTFT、隐藏推理和客户端启动，并修正首个 delta 已经包含一部分生成 token 的边界效应。它仍可能受服务端调度、批处理、节流、安全检查暂停和网络抖动影响。10K 测试需至少重复两次，并同时报告每 1K tokens 分段速度。

### 输入处理代理值

对同一模型、推理档位和服务层，分别运行短输入与长输入、短固定输出测试：

```text
prefill_proxy_tps =
    (long_input_tokens - short_input_tokens)
    / (long_response_seconds - short_response_seconds)
```

优先使用 `first_model_event_seconds`；如果事件不足，则使用 `wall_seconds`。该差分抵消了一部分固定启动和短输出开销，但仍会受到排队、缓存、隐藏推理、网络波动和服务端批处理影响。因此只能称为代理值。

## 统计规则

- 预热样本不进入正式统计。
- 默认按 `model × effort × tier × workload` 分组。
- 中位数用于典型体验，P90 用于尾部等待。
- `Fast/Standard` 延迟加速比使用：

  ```text
  standard_wall_p50 / fast_wall_p50
  ```

  大于 1 表示快速模式更快。

- `Fast/Standard` 吞吐比使用：

  ```text
  fast_usage_non_reasoning_wall_tps_p50
  / standard_usage_non_reasoning_wall_tps_p50
  ```

- 每组必须同时报告样本数和成功率。

## 解释限制

1. Codex 订阅服务的负载、区域路由和排队会随时间变化。
2. 快速模式会增加用量消耗；不能只比较速度而忽略用量。
3. 推理档位会同时影响隐藏推理 token、首个可见输出时间和答案质量。
4. 输出长度过短时，固定开销会主导端到端吞吐。
5. 同一提示重复运行会产生缓存；应同时查看缓存比例。
6. 工具调用、仓库扫描和命令执行属于 Agent 工作流耗时，不属于纯文本生成。
7. 速度结论不能代替质量评测。选择模型和档位时应在同一真实任务集上同时衡量正确率与完整性。
