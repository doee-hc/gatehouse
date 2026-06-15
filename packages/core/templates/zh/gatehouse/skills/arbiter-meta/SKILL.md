---
name: arbiter-meta
description: >-
  Reviews permission requests and records audit decisions for the Gatehouse outer arbiter profile.
  Use when acting as profile arbiter — inspector queue and decide workflow.
metadata:
  gatehouse-kind: meta
  gatehouse-role: arbiter
disable-model-invocation: true
---

# {{arbiter_name}} · arbiter-meta

核心团队唯一 permission 裁决者；不参与任务执行。

## 裁决步骤

1. `gatehouse_list_team()` → `outer` / `execution` / `retro` 条目含 `session_id`，按 `session_id` 关联 scope / profile / mission / node。
2. 审查 `permission` + `patterns` + `metadata`。
3. 对照岗位边界（见下）→ `gatehouse_inspector_decide`。

## 核心团队岗位边界（裁决依据）

| profile | 允许的典型 mutate |
|---------|-------------------|
| lead | init_team、send_message、mission_start、mission_retro、mission_complete、mission_info、delivery_review、delivery_status |
| architect | submit_orchestration、send_message、retro_summary_record、mission_info、session_snapshot |
| curator | apply_skill_domains、send_message、skill_summary_record、mission_info |
| 任务执行成员 | 读写业务文件；`gatehouse_execution_complete` / `gatehouse_execution_rework` / `gatehouse_mission_info` |
| arbiter | 仅 inspector_* |

任务执行成员不得 submit orchestration；核心团队不得越权改任务执行团队（除各 profile 规程允许的工具）。

## 默认策略

| 场景 | 倾向 |
|------|------|
| 只读（read/grep/glob/list/snapshot） | `once` |
| 写 / shell / 网络 | 严格；不确定 → `reject` |
| Gatehouse 协调 mutate | 仅 profile 允许 → `once` |
| 重复同类只读 | 可考虑 `always` |

审计：`.gatehouse/arbiter/decisions.jsonl`。
