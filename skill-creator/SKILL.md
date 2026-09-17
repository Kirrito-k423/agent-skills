---
name: skill-creator
description: 创建或更新 Codex Skill，默认将规范源目录保存在独立的 agent-skills Git 仓库根目录下，仅通过符号链接安装到全局 Skill 目录。用户要求创建、初始化、迁移、安装、覆盖或更新 Skill 时使用，包括通常会触发系统内置 skill-creator 的请求。保留原有质量检查，不得把规范源目录直接存入全局 Skill 目录，也不得原地修改系统内置的 .system Skill。所有 Skill 的人类可读内容必须使用中文。
---

# 本地 Skill 创建器

在独立仓库 `https://github.com/Kirrito-k423/agent-skills` 中创建和维护 Skill，只通过符号链接将其暴露为全局 Skill。

## 不可违背的规则

1. 将 Skill 的规范源目录保存在 Git 工作树内。
2. 不得直接在 `${CODEX_HOME:-$HOME/.codex}/skills` 下创建规范源目录。
3. 使用绝对路径符号链接在全局安装 Skill：

   ```text
   ${CODEX_HOME:-$HOME/.codex}/skills/<skill-name>
     -> <git-worktree>/<chosen-path>/<skill-name>
   ```

4. 不得原地修改 `${CODEX_HOME:-$HOME/.codex}/skills/.system`。
5. 覆盖系统内置 Skill 时，创建具有相同技术 `name` 和全局链接名的用户级 Skill。保持系统内置副本不变，以便删除用户级链接后恢复使用内置版本。
6. 不得自动删除或替换全局目录中的真实文件或目录；迁移前必须停止并询问用户。
7. 保留无关文件和工作树中已有的改动。
8. **所有 Skill 的人类可读内容必须使用中文**，包括 frontmatter 的 `description`、`SKILL.md` 正文、`references/` 文档、`agents/openai.yaml` 界面文案，以及脚本面向用户的帮助、提示和报错。技术名称、代码标识符、固定字段名、命令、路径、协议原文和无法翻译的专有名词保留原样。

## 创建或更新 Skill

### 1. 确定源目录

将技术名称规范化为小写连字符格式。

如果用户明确提供的位置属于 Git 工作树，则使用该位置。否则：

1. 解析当前 `skill-creator/SKILL.md` 的真实路径；通过全局符号链接调用时，先解析链接目标。
2. 在解析后的 `skill-creator` 目录运行 `git rev-parse --show-toplevel`，并用 `git remote -v` 确认所属仓库为 `Kirrito-k423/agent-skills`，接受 SSH 和 HTTPS 地址。
3. 默认使用 `<agent-skills-root>/<skill-name>`，**不要再添加一层 `skills/`，也不要按当前业务项目的工作目录选择源仓库**。本机的规范仓库为 `/Users/Zhuanz/work/github/agent-skills`；其他机器以实际检出的仓库根目录为准。
4. 如果当前创建器不属于该独立仓库，优先检查上述本机路径；该路径不可用时，再查找用户提供的 `agent-skills` 检出目录。仍找不到时，要求用户选择检出位置或授权克隆仓库。不得退回到全局 Skill 目录。

原 `hugoMinos/skills` 是该仓库的 Git submodule 引用。独立仓库中的 Skill 直接排列在根目录；在 submodule 检出中操作时，也把 submodule 自身作为 Git 根目录，不把父仓库作为源仓库。

更新现有 Skill 时，先解析当前全局入口。如果它是符号链接，只有在确认其目标位于 Git 工作树内后，才能编辑解析后的目标目录。对已存在于其他仓库或工作树的 Skill，不因默认位置变化而自动覆盖或搬迁。

### 2. 检查路径冲突

写入前检查以下两个路径：

- 规范源目录：`<git-worktree>/.../<skill-name>`
- 全局入口：`${CODEX_HOME:-$HOME/.codex}/skills/<skill-name>`

按以下方式处理：

- **源目录不存在、全局入口不存在：** 正常创建并链接。
- **源目录已存在：** 将请求视为更新，并保留已有资源。
- **全局符号链接指向源目录：** 保持不变。
- **全局符号链接指向其他位置：** 说明当前目标；只有请求明确授权切换时才替换。
- **全局路径是真实文件或目录：** 不得自动删除或替换。
- **Skill 仅存在于 `.system`：** 创建同名用户级链接，安全覆盖系统内置版本。

### 3. 初始化新 Skill

创建新 Skill 时，使用系统内置初始化器：

```bash
SYSTEM_CREATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator"
python3 "$SYSTEM_CREATOR/scripts/init_skill.py" <skill-name> \
  --path <agent-skills-root> \
  --interface "display_name=<面向用户的名称>" \
  --interface "short_description=<25 至 64 个字符的中文说明>" \
  --interface 'default_prompt=使用 $<skill-name> 完成<示例任务>。'
```

仅在确实需要资源目录时添加 `--resources`。除非会在同一任务中替换或删除示例，否则不要添加示例。

生成 `agents/openai.yaml` 前，先阅读 [references/openai_yaml.md](references/openai_yaml.md)。

初始化后，立即把模板中的英文占位内容改成中文，不得把英文模板原样留在最终 Skill 中。

### 4. 简洁实现

遵循系统内置 skill-creator 的质量原则：

- 将所有触发条件写入 frontmatter 的 `description`。
- frontmatter 只保留 `name` 和 `description`。
- 使用祈使句编写正文指令。
- 保持 `SKILL.md` 聚焦，且不超过 500 行。
- 只添加必要的 `scripts/`、`references/` 和 `assets/`。
- 不要创建 `README.md`、变更日志或安装指南等辅助文件。
- 测试每个新增脚本。
- 检查所有人类可读内容并将其写成中文；不得只翻译 `SKILL.md` 而遗漏元数据、参考文档或脚本提示。

手动编辑文件时使用 `apply_patch`。更新 Skill 时保留已有内容。

### 5. 验证源目录

对规范源目录运行系统内置验证器：

```bash
SYSTEM_CREATOR="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator"
python3 "$SYSTEM_CREATOR/scripts/quick_validate.py" <canonical-skill-directory>
```

安装全局链接前，修复所有验证失败。

### 6. 安装全局链接

使用本 Skill 自带的辅助脚本：

```bash
LOCAL_CREATOR="${CODEX_HOME:-$HOME/.codex}/skills/skill-creator"
python3 "$LOCAL_CREATOR/scripts/link_skill.py" <canonical-skill-directory>
```

当期望的全局入口名与源目录 basename 不同时，传入 `--name <skill-name>`。只有检查现有符号链接并决定替换它之后，才能传入 `--replace-symlink`。辅助脚本不得替换真实文件或目录。

### 7. 完成检查

验证以下所有事项：

1. 规范源目录位于预期的 Git 工作树内。
2. `git status --short -- <canonical-skill-directory>` 只显示预期改动。
3. 全局入口是符号链接。
4. 符号链接准确解析到规范源目录。
5. 通过规范路径和全局符号链接运行验证均成功。
6. `agents/openai.yaml` 仍与 `SKILL.md` 一致。
7. Skill 中所有人类可读内容均为中文，允许保留的仅是技术名称、代码、命令、路径、固定字段和必要原文。

告知用户：可能需要新建 Codex 任务或重新加载应用，Skill 发现结果才会反映新增或覆盖的 Skill。

## 安全覆盖当前 Skill

按照相同规则维护本地替代版本：

```text
<agent-skills-root>/skill-creator
  -> 规范源目录

${CODEX_HOME:-$HOME/.codex}/skills/skill-creator
  -> 全局用户级覆盖

${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator
  -> 保持不变的系统内置后备版本
```

只删除用户级符号链接即可恢复系统内置后备版本。
