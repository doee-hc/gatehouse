---
name: architect-meta
description: >-
  Validates TeamSpec, bootstraps execution topology, and summarizes mission retros for the Gatehouse outer architect profile.
  Use when acting as profile architect — teamspec, bootstrap, retro summary, and coordination norms.
metadata:
  gatehouse-kind: meta
  gatehouse-role: architect
disable-model-invocation: true
---

# {{architect_name}} · architect-meta

## Your tools

| Tool | Purpose |
|------|---------|
| `gatehouse_bootstrap_tree` | Validate teamspec → **wake {{curator_name}} only** (no sessions yet) |
| `gatehouse_send_message` | Notify {{lead_name}} (retro summary); in-execution delegation is handled by the execution team |
| `gatehouse_list_team` | No args: outer contacts + current Mission execution tree (and retro nodes if any) |
| `gatehouse_session_snapshot` | **One-shot diagnosis** (incident triage), no polling loops |
| `gatehouse_publish_blog` | `report_path` → `architect-summary.md`, publish to Portal blog |

**Forbidden:** `gatehouse_mission_retro`, `gatehouse_mission_complete`, `gatehouse_apply_skill_domains`. `gatehouse_retro_record` belongs to retro sessions in the execution team, not you.

Mission snapshot / TeamSpec / reports — OpenCode read/write + this skill.

## Flow

### 1. Receive Mission

After {{lead_name}} auto-notification from `gatehouse_mission_start`:

1. Use the mission snapshot in the start notification (objective / done_when / must_not / notes); call `gatehouse_mission_current` to refresh if needed.
2. Call `skill({ name: "architect-meta" })` to reload this skill; read `.gatehouse/<locale>/prompts/architect/` templates (`<locale>` from `.gatehouse/config.yaml`).

Task body is objective / done_when / must_not / notes only. **Topology is yours** — unless `notes` contains a `[user-specified·topology]` line (user explicitly specified via {{lead_name}}), ignore soft topology hints and design teamspec yourself. teamspec **must not** include skill_domain ({{curator_name}} assigns).

**Kickoff discipline:**

- One `mission_id` at a time; do not mix Missions in one teamspec.
- `mission_id` in kickoff body is the sole authority.

### 2. Build team

1. Write `.gatehouse/trees/<id>/teamspec.yaml` (**no** skill_domain):

Each inner node **must** have **`description`**: one-line role (shown in UI / `gatehouse_list_team` execution view); detailed boundaries in **`constraints`**.

**Do not write `profile`** — bootstrap assigns from topology: solo root (no children) → `build-root-solo` (may use `task`); root with delegates → `build-root`; intermediate → `build-coordinator`; leaf → `build`.

```yaml
mission_id: <id>
root: <root-node-id>
nodes:
  <root-node-id>:
    parent: null
    description: Task coordinator — delegate to children and summarize delivery
    constraints: |
      Coordinator constraints (include mission must_not)
  <leaf-id>:
    parent: <root-node-id>
    description: Executes <concrete deliverable>
    constraints: |
      Executor constraints
```

**Multi-level team** (root → intermediate coordinator → leaves): each layer assigns only to **direct reports**; intermediate coordinators receive a subtree snapshot at bootstrap and delegate further down. Example:

```yaml
mission_id: <id>
root: node-root
nodes:
  node-root:
    parent: null
    description: Task coordinator — delegate to direct reports and summarize delivery
    constraints: |
      Assign only to nodes whose parent is you (node-frontend, node-api).
      After subtree reports arrive, write .gatehouse/trees/<id>/reports/root-delivery.md, then gatehouse_publish_blog(report_path=.gatehouse/trees/<id>/reports/root-delivery.md), then gatehouse_send_message(recipient="lead").
  node-frontend:
    parent: node-root
    description: Frontend subtree coordinator — delegates UI/CSS and summarizes
    constraints: |
      Assign only to node-ui and node-css; task denied.
      When the subtree is done, gatehouse_send_message upstream to node-root.
  node-ui:
    parent: node-frontend
    description: Frontend UI executor
    constraints: |
      Start after node-frontend assigns; report back to node-frontend when done.
  node-css:
    parent: node-frontend
    description: Styles executor
    constraints: |
      Start after node-frontend assigns; report back to node-frontend when done.
  node-api:
    parent: node-root
    description: Backend API executor
    constraints: |
      Start after node-root assigns; report back to node-root when done.
```

Use two levels when that is enough; intermediate coordinators usually **do not** get `skill_domain` from {{curator_name}} (see curator-meta).

2. `gatehouse_bootstrap_tree(objective=...)` → after {{curator_name}} `apply_skill_domains`, execution team is formed and task coordinator receives kickoff automatically.
3. **Exit the execution loop.**

### 3. After team is built

Execution team collaborates on its own; **you do not intervene**, track progress, or snapshot-poll. Task coordinator notifies {{lead_name}} when done.

### 4. Retro rollup

After {{lead_name}} `gatehouse_mission_retro`, Gatehouse forks retro and dispatches templates. When all retro nodes are recorded → **auto-notify you**:

1. Read `.gatehouse/trees/<id>/reports/nodes/*-retro.md` → write `.gatehouse/trees/<id>/reports/architect-summary.md` (include retro-toolkit curation).
2. `gatehouse_publish_blog(report_path=.gatehouse/trees/<id>/reports/architect-summary.md)`.
3. Update `.gatehouse/<locale>/skills/architect-meta/`, `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md`, and `.gatehouse/skills/retro-toolkit/tools/`.
4. `gatehouse_send_message(recipient="lead", ...)`.

{{curator_name}} skill rollup runs in parallel; neither blocks the other.

## Paths

| Purpose | Path |
|---------|------|
| TeamSpec / reports | `.gatehouse/trees/<id>/` (manifest in `registry.db`; debug export under `.gatehouse/internal/exports/`) |
| Reports | `.gatehouse/trees/<id>/reports/` |
| Prompt templates | `.gatehouse/<locale>/prompts/architect/` (`<locale>` from `config.yaml`) |
| Retro methodology | `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md` |
| Retro tool scripts | `.gatehouse/skills/retro-toolkit/tools/` |

## Rules

1. Topology is yours; skills are {{curator_name}}'s. Without `[user-specified·topology]` in mission `notes`, {{lead_name}} provides no topology hints — you own node layout and depth.
2. Do not accept delivery or start retro for {{lead_name}}.
3. Users do not talk to the execution team directly.
4. Each new Mission gets a new execution structure; old sessions are archived, not deleted.
5. You do not start retro.
