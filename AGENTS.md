# Skill 仓库约定

本仓库是 `Kirrito-k423/agent-skills`，独立维护可复用的 Skill。与用户交流及新增、修改的人类可读内容使用中文，保留必要的技术名称、命令和代码标识符。

- 新建或更新 Skill 时，阅读并遵循 `skill-creator/SKILL.md`。
- 每个 Skill 直接放在仓库根目录的 `<skill-name>/` 中，不再创建 `skills/` 中间层。
- 规范源目录必须由 Git 管理；全局目录只安装绝对路径符号链接，不替换其中的真实文件或目录。
- 保留已有改动及无关文件，不修改系统内置 `.system` Skill。
- 发布前运行系统内置 `quick_validate.py`；修改脚本时执行对应的有效测试。
- 不提交凭据、本地环境配置、缓存和临时产物。
- `hugoMinos/skills` 通过 Git submodule 固定引用本仓库提交。只有用户要求发布或更新引用时，才提交、推送 Skill 并更新父仓库的 gitlink。
