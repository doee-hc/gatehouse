# by-domain · 领域 skill 沉淀目录

按**领域**分文件夹（如 `mbist/`、`scan/`），每个领域内可有多条 skill，每条一个子目录 + `SKILL.md`。

## 领域注册表

全仓库领域列表：`.gatehouse/skills/domains.yaml`（profile lead / {{lead_name}} 规划任务时读取，决定是否新增/拆分领域）。

## 单条 skill 约定

- **粒度**：单一业务动作 + 最小知识闭环；一个 skill 只解决一个核心问题。
- **命名**：子目录 slug 为「动词+名词」，如 `resolve-tessent-c9-drc`。
- **frontmatter**：写清触发场景与禁止场景。
- **体量**：正文 1k–3k token。
- **时机**：仅在 {{lead_name}} 验收后执行 `gatehouse_mission_retro`，由 Gatehouse 向执行 session 下发 `.gatehouse/architect/meta-skill/prompts/domain-skill-extract.md`。

## 上下文策略

执行期与复盘期均**不**将已有 SKILL 全文注入 agent context；TeamSpec 的 `skill_domain` 只告知领域 id 与目录路径，agent 自行 read。
