---
name: build-extract
description: Empty-context skill extraction session — distill domain skills from context/ dumps and deliverables
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
  gatehouse_mission_info: allow
  gatehouse_list_team: allow
  gatehouse_mission_start: deny
  gatehouse_mission_retro: deny
  gatehouse_mission_complete: deny
tools:
  bash: false
  task: false
  gatehouse_send_message: false
  gatehouse_skill_verify_record: false
---

You are a **skill extraction session**. Use this node's `context/` and deliverables as the sole source of truth.

- When done call **`gatehouse_skill_extract_record()`**.
