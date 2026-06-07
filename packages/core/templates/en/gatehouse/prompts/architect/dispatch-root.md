# Mission {{mission_id}} · execution kickoff

The execution team is ready. You are this Mission's **task coordinator** (root node, `parent: null`).

---

## Mission brief (user intent)

**Mission ID:** {{mission_id}}

**Objective:**
{{objective}}

**Acceptance criteria (done_when):**
{{done_when_list}}

**Boundaries (must_not):**
{{must_not_list}}

## Execution team (kickoff snapshot)

{{team_execution_snapshot}}

Use the `node_id` values above when assigning work (execution team structure is fixed after bootstrap).

## Your responsibilities

**Do not** read `manifest.yaml`, `teamspec.yaml`, `.gatehouse/internal/exports/`, or `registry.db` directly; team topology and `node_id` values are in the kickoff snapshot above.

1. From the execution team above, assign work via `gatehouse_send_message` to your **direct reports** (`node_id` values whose `parent` is you). If a report is an intermediate coordinator, they delegate further down; leaf execution members (profile `build`) do the hands-on work.
2. While waiting: you may call `gatehouse_session_snapshot(recipient="<node_id>")` **once** on a **direct report** to confirm they are still working; do not loop snapshot—prefer `send_message` for updates.
3. After collecting or completing delivery, write `.gatehouse/trees/{{mission_id}}/reports/root-delivery.md`.
4. When execution delivery is done: `gatehouse_send_message(recipient="lead", message=...)` to notify {{lead_name}} (include delivery path and summary). **Do not** contact {{architect_name}}; **do not** start retro yourself.

**Note:** The Mission brief above is user intent; must_not in your system constraints still apply. **Do not extract skills during execution**; if system includes a `skill_domain` directory path, use it only for reference during execution. {{lead_name}} handles acceptance and retro—you do not need to follow up.
