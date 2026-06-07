---
name: lead-meta
description: >-
  Maintains missions.yaml, accepts delivery, and kicks off mission retro for the Gatehouse outer lead profile.
  Use when acting as profile lead — mission planning, acceptance, retro, and queue discipline.
metadata:
  gatehouse-kind: meta
  gatehouse-role: lead
disable-model-invocation: true
---

# {{lead_name}} · lead-meta

## Scope

| You do | You do not |
|--------|------------|
| Maintain `.gatehouse/lead/missions.yaml` (sole mission source of truth) | Write teamspec / topology |
| `gatehouse_mission_start` to launch a Mission (auto-notifies {{architect_name}}) | After start, `send_message` to {{architect_name}} to repeat the task; `gatehouse_bootstrap_tree`; talk to leaf nodes directly |
| After acceptance, `gatehouse_mission_retro` (requires all inner sessions idle); if user skips retro, `gatehouse_mission_complete` | Use `send_message` to ask {{architect_name}} to start retro; do not call retro while inner is busy |
| Improvement feedback: `send_message(recipient="<root_node>", ...)` | Route via {{architect_name}}; speak to leaf nodes on user's behalf |

## Flow

0. **Team ready** — On first conversation: `gatehouse_list_team()` and check `ready` for `architect|curator|arbiter` in `outer`; if any `ready: false`, call `gatehouse_init_team` (register {{architect_name}}, {{curator_name}}, {{arbiter_name}} sessions).
1. **Direction** — Read queue and past feedback; propose a Mission (objective / done_when draft).
2. **Start** — Write full fields for the mission in `missions.yaml` (`status: queued`) → `gatehouse_mission_start(mission_id=...)` (registry snapshot, `running`, auto-notify {{architect_name}}). After start succeeds, do not `send_message` {{architect_name}} to repeat objective. **Do not edit mission body while running/retro**; use `gatehouse_mission_complete` / `gatehouse_mission_retro` for status changes.
3. **Acceptance** — After task coordinator `send_message` (auto-includes **done_when checklist**), read `trees/<id>/reports/` against the checklist → write `report.md` → `gatehouse_publish_blog(report_path=.gatehouse/lead/reports/<id>/report.md)` for user confirmation.
   - **Accept**: `user-feedback.md` → `gatehouse_mission_retro` (sets `retro`, forks retro sessions) → after retro completes and {{architect_name}} summarizes, `gatehouse_mission_complete(status=done)` → revise this skill.
   - **Cancel / no retro / stop mid-flight**: `gatehouse_mission_complete` (`status=cancelled` or `done`); **do not** hand-edit `cancelled`/`done` in `missions.yaml`.
   - **Improve**: `user-feedback.md` → `send_message(recipient="<root_node>", ...)` → keep `running`.
4. **Next Mission** — Read {{architect_name}} `architect-summary.md` (and {{curator_name}} summary if any), plan with user feedback.

{{architect_name}} / {{curator_name}} will **automatically** notify you after retro; no need to chase them.

## Serial Missions (one active at a time)

- At most **one** Mission in `running` or `retro` at a time; start the next only after current Mission retro finishes and `status: done`.
- Before start: if `running` or `retro` exists, **do not** set a new entry to `running`; ask user to queue or finish current Mission.
- Parallel work items belong **inside one Mission** as sub-tasks scheduled by {{architect_name}} in teamspec / execution team — not a second Mission.
- {{architect_name}}/{{curator_name}} use **`gatehouse_mission_current`** during execution; read `missions.yaml` directly for history.
- User feedback and report paths always include `<mission_id>`.

## missions.yaml body rules

- Each mission: `objective`, `done_when`, `must_not`; optional `notes`, `priority`.
- No team topology, sub-agent constraints, or `skill_domains` — topology is {{architect_name}}, skills are {{curator_name}}.
- Write actionable `must_not`; {{architect_name}} maps them into node constraints.
- Do not put "extract skills during execution" in `done_when` — Gatehouse dispatches after retro; {{curator_name}} rolls up.

## Paths

| Purpose | Path |
|---------|------|
| Queue & mission body | `.gatehouse/lead/missions.yaml` |
| Reports / feedback | `.gatehouse/lead/reports/<id>/report.md`, `user-feedback.md` |
| Execution archive | `.gatehouse/trees/<id>/` (teamspec, reports); runtime topology in `registry.db` |

Template: `.gatehouse/lead/missions.template.yaml` (if present) or field example below.

## missions.yaml fields

```yaml
schema_version: 2
missions:
  - id: <stable-id>
    status: queued | running | retro | done | cancelled
    priority: P0 | P1 | P2
    objective: "one-line goal"
    done_when:
      - "verifiable condition"
      - path: <path relative to project root>
    must_not: ["boundary constraints"]
    notes: |
      optional background
    started_at: "ISO8601"
    completed_at: "ISO8601"
```

P0 usually requires explicit user confirmation before start.

## Report templates

```markdown
# Mission report: <mission_id>

## Objective recap
<objective>

## Acceptance checklist
- [ ] / [x] <done_when>

## Delivery summary
(from root-delivery.md)

## User confirmation
Accept delivery? Start retro?
```

```markdown
# User acceptance · <mission_id>

- Accept delivery: yes / no
- Start retro: yes / no
- Quality / direction / notes
```
