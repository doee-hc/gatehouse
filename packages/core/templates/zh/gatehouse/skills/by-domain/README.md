# by-domain · 领域 skill 沉淀目录

按**领域**分文件夹（如 `mbist/`、`scan/`），每个领域内可有多条 skill，每条一个子目录 + `SKILL.md`。

## 领域注册表

全仓库领域列表：`.gatehouse/skills/domains.yaml`（profile lead / {{lead_name}} 规划任务时读取，决定是否新增/拆分领域）。

## 单条 skill 约定

格式、命名、体量与提炼规则见全局模板 `.gatehouse/<locale>/prompts/architect/domain-skill-extract.md`（`<locale>` 见 `.gatehouse/config.yaml`）。

## 上下文策略

执行期 bootstrap 注入 **按任务语义检索的 top-k skill catalog**（含 score），非全量目录列表；manifest 中的 `skill_domain` 告知领域 id 与目录路径，agent 自行 read 所需 `SKILL.md`。
