# Agent Skills

独立维护的中文优先 Skill 集合，源自 `Kirrito-k423/hugoMinos` 的 `skills/` 目录。每个一级目录是一个 Skill，使用说明和触发条件见其 `SKILL.md`。

## 创建与安装

遵循 [本地 Skill 创建器](skill-creator/SKILL.md)，在本仓库根目录下创建 `<skill-name>/`，通过绝对路径符号链接安装到全局 Skill 目录。默认创建位置不再依赖当前业务项目。

```bash
git clone https://github.com/Kirrito-k423/agent-skills.git
cd agent-skills
python3 skill-creator/scripts/link_skill.py "$PWD/skill-creator"
```

如果已有链接指向其他位置，先核对目标，再按创建器规则迁移；安装脚本拒绝替换真实文件或目录。已有全局 Skill 可能需要新建 Codex 任务或重新加载应用后才被发现。

## 原仓库引用

`hugoMinos/skills` 是本仓库的 Git submodule，固定到具体提交：

```bash
git clone --recurse-submodules git@github.com:Kirrito-k423/hugoMinos.git
# 已有检出在获取包含 submodule 的提交后执行：
git submodule update --init --recursive
```

更新 Skill 时先在本仓库提交并推送；需要同步原仓库时，在 `hugoMinos` 中更新 submodule，再提交 `skills` 的引用变化。独立仓库的新提交不会自动改变原仓库固定的版本。

此次迁移以 Skill 当前文件快照建立独立历史，没有导入原仓库的其他文件或提交历史。已有 Skill 的语言和实现沿用迁移前版本，后续修改遵循本仓库约定。
