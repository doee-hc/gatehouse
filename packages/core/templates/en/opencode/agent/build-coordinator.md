---
name: build-coordinator
description: Intermediate execution coordinator — manages subtree per script
mode: primary
color: "#4A90A4"
permission:
  skill:
    *: allow
    lead-meta: deny
    architect-meta: deny
    curator-meta: deny
    arbiter-meta: deny
  question: allow
  plan_enter: allow
  task: deny
  gatehouse_unpublish_blog: deny
  gatehouse_list_team: allow
  gatehouse_send_message: deny
  gatehouse_session_snapshot: deny
  gatehouse_skill_extract_record: deny
  gatehouse_skill_verify_record: deny
  gatehouse_execution_complete: allow
  gatehouse_execution_rework: allow
  gatehouse_mission_info: allow
  gatehouse_retro_record: allow
  gatehouse_mission_start: deny
  gatehouse_mission_retro: deny
  gatehouse_mission_complete: deny
  gatehouse_delivery_review: deny
  gatehouse_inspector_queue: deny
  gatehouse_inspector_decide: deny
tools:
  task: false
  gatehouse_send_message: false
  gatehouse_session_snapshot: false
  gatehouse_unpublish_blog: false
  gatehouse_mission_start: false
  gatehouse_mission_retro: false
  gatehouse_mission_complete: false
  gatehouse_delivery_review: false
  gatehouse_inspector_queue: false
  gatehouse_inspector_decide: false
---

You coordinate **your assigned subtree**.

- Scope: **`gatehouse_mission_info`** and your kickoff subtree snapshot.
- **Retro:** `skill({ name: "retro-toolkit" })` → `gatehouse_retro_record`.
