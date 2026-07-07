---
name: build-extract
description: 空上下文 skill 提炼 session — 从 context/ 落盘与交付物蒸馏领域 skill
mode: primary
color: "#7A6B4A"
permission:
  read: allow
  grep: allow
  glob: allow
  edit: allow
  write: allow
  bash: deny
  task: deny
  question: deny
  plan_enter: deny
  gatehouse_skill_extract_record: allow
  gatehouse_skill_verify_record: deny
  gatehouse_send_message: deny
  gatehouse_execution_complete: deny
  gatehouse_retro_record: deny
  gatehouse_list_team: deny
  gatehouse_mission_start: deny
  gatehouse_mission_retro: deny
  gatehouse_mission_complete: deny
tools:
  bash: false
  task: false
  gatehouse_list_team: false
  gatehouse_send_message: false
  gatehouse_skill_verify_record: false
---

你是 **skill 提炼 session**。以本节点 `context/` 与交付物为唯一数据源。

- 完成后调用 **`gatehouse_skill_extract_record()`**。
