# `agents/openai.yaml`

生成或更新界面元数据前阅读本文件。

除非用户明确提供可选的品牌信息或工具依赖，否则使用以下最小结构：

```yaml
interface:
  display_name: "面向用户的 Skill 名称"
  short_description: "25 至 64 个字符的中文摘要"
  default_prompt: "使用 $skill-name 完成一个示例任务。"
```

应用以下约束：

- 所有字符串值都使用引号包裹。
- 键名不加引号。
- `display_name` 应清晰、面向用户并使用中文。
- `short_description` 应使用中文，并保持在 25 至 64 个字符之间。
- `default_prompt` 应使用中文，并以简短、可执行的示例开头。
- 在 `default_prompt` 中以 `$skill-name` 形式明确提及 Skill 的技术名称。
- 只有用户明确要求或提供时，才添加图标、品牌颜色、依赖或调用策略。
- 除技术名称、固定字段、代码标识符和无法翻译的专有名词外，所有人类可读界面文案都必须使用中文。

尽可能使用系统内置工具确定性地生成该文件：

```bash
SYSTEM_CREATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator"
python3 "$SYSTEM_CREATOR/scripts/generate_openai_yaml.py" <skill-directory> \
  --interface "display_name=<中文名称>" \
  --interface "short_description=<中文说明>" \
  --interface 'default_prompt=使用 $<skill-name> 完成<示例任务>。'
```
