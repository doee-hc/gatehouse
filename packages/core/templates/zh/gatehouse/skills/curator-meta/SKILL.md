---
name: curator-meta
description: >-
  Assigns skill domains, bootstraps execution teams, and rolls up domain skills for the Gatehouse outer curator profile.
  Use when acting as profile curator — apply_skill_domains and post-retro skill curation.
metadata:
  gatehouse-kind: meta
  gatehouse-role: curator
disable-model-invocation: true
---

# {{curator_name}} · curator-meta

## 你的 tool

| Tool | 用途 |
|------|------|
| `gatehouse_apply_skill_domains` | 写入 skill_domain；**尚无 manifest 时自动组建执行团队** |
| `gatehouse_send_message` | 可选通知{{lead_name}} skill 摘要 |
| `gatehouse_list_team` | 无参数：外层 contacts + 执行树；配合 `session_snapshot` |

**禁止** `gatehouse_bootstrap_tree`、`gatehouse_mission_retro`、`gatehouse_mission_complete`。

`domains.yaml` 登记与 `by-domain/` 落盘分工见下文；分配阶段**只调工具**，勿手写目录或 `SKILL.md`。

## 流程

### 1. skill_domain 分配（bootstrap 后自动唤醒）

此时 **只有**任务快照 + teamspec，**尚无 manifest**。

1. `gatehouse_mission_current`；读 `teamspec.yaml`、`domains.yaml`（可选查阅已有 `by-domain/<id>/` 以复用 id）。
2. 仅为需沉淀的执行节点选定 `skill_domain`；**未分配节点不要写入 `assignments`**（中间协调、无总结价值的节点通常省略）。
3. 可选：新 domain-id 先更新 `domains.yaml`（仅元数据）。
4. **仅** `gatehouse_apply_skill_domains(assignments='{"node-id":"domain-id"}')` — 工具自动创建缺失的 `by-domain/<domain-id>/`（空目录，无 `SKILL.md`），并组建执行团队 → **结束本轮**（勿 `gatehouse_bootstrap_tree`，勿私信 {{architect_name}}/{{lead_name}}）。

### 2. skill 汇总（registry 自动唤醒）

{{lead_name}} `gatehouse_mission_retro` 后，Gatehouse **仅**向 manifest 中已有 `skill_domain` 的执行 session 下发 `domain-skill-extract`；未分配者保持静默。各节点 `gatehouse_skill_extract_record` 登记。

全部登记后 → **自动通知你**：

1. 读 `reports/skills/<node_id>-extract.md` 与 `by-domain/` 变更。
2. 去重合并 → 更新 `domains.yaml`；可选 `curator-summary.md`。
3. 可选 `gatehouse_send_message(recipient="lead", ...)`。

## 路径

| 用途 | 路径 |
|------|------|
| 领域注册表 | `.gatehouse/skills/domains.yaml` |
| 领域 skill | `.gatehouse/skills/by-domain/<id>/` |
| 任务树 | `.gatehouse/architect/trees/<id>/` |
| 提炼摘要 | `reports/skills/<node_id>-extract.md` |

## 铁律

1. skill 领域归你 — 任务正文 / teamspec 不含 skill_domain。
2. 执行期不提炼 — 复盘后 Gatehouse 下发。
3. 执行 agent 用 `skill_extract_record` 登记，勿私信你。
