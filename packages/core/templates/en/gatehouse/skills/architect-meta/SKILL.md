---
name: architect-meta
description: >-
  Validate collaboration scripts, submit orchestration plans, and summarize mission retros for profile architect.
metadata:
  gatehouse-kind: meta
  gatehouse-role: architect
disable-model-invocation: true
---

# {{architect_name}} · architect-meta

## Your tools


| Tool                         | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `gatehouse_submit_orchestration`   | Validate and submit `mission.script.ts` for orchestration                                                   |
| `gatehouse_mission_info`  | Read-only refresh of mission snapshot (objective / done_when / must_not / notes / user_topology) |
| `gatehouse_send_message`     | Coordination messages (not for retro/skill summary registration)                                                           |
| `gatehouse_retro_summary_record` | Register `architect-summary.md` after retro; Gatehouse auto-notifies {{lead_name}} when retro summaries are complete |
| `gatehouse_list_team`        | No args: outer contacts + current Mission execution tree (and retro nodes if any)              |
| `gatehouse_session_snapshot` | **One-shot diagnosis** (incident triage), no polling loops                                     |

**Forbidden:** `gatehouse_mission_start`, `gatehouse_mission_retro`, `gatehouse_mission_complete`, `gatehouse_apply_skill_domains`. Do not edit mission body, start retro, or accept delivery for {{lead_name}}; do not assign skill_domain; do not track execution progress or poll `session_snapshot` in a loop.

## Flow

### 1. Receive Mission

After the Mission start notification:

1. Use the mission snapshot in the notification; call `gatehouse_mission_info` to refresh if needed.
2. Read `.gatehouse/<locale>/prompts/architect/` templates (`<locale>` from `.gatehouse/config.yaml`; **read the locale directory first**, not `en/` by default).

Task body includes objective / done_when / must_not / notes / user_topology / user_skill. **Topology and collaboration timing are yours** — unless `user_topology` is set (user explicitly specified via {{lead_name}}), ignore soft topology hints and design `export const team` yourself. `team` **must not** include skill_domain; do not embed `user_skill` in the script.

**Kickoff discipline:**

- One `mission_id` at a time; do not mix Missions in one `mission.script.ts`.
- `mission_id` in kickoff body is the sole authority.

### 2. Build team

1. Write `.gatehouse/trees/<id>/mission.script.ts` (team structure + orchestration timing in one file):

| Export | Purpose |
|--------|---------|
| `export const team` | Execution team roster: `node_id` + one-line `description`; `root` = terminal node id |
| `export const meta` | Optional: progress `phases` (optional `name`) |
| `export default async function orchestrate(ctx)` | Orchestration timing: `ctx.run` / `ctx.parallel` / `dependsOn` |

Each inner node **must** have `description` (one-line role). Put detailed tasks and boundaries in `ctx.run({ brief: … })`.

**Brief constraints:** each leaf needs concrete `your_work`, explicit `acceptance_slice` with a project `path:` (file or directory, e.g. `path: reports/foo.md` or `path: reports/template/`), and sibling scope boundaries when needed. When done, call `gatehouse_execution_complete(summary=...)` — describe work, deliverable paths, and open items in summary.

```typescript
await ctx.run("researcher-a", {
  brief: {
    your_work: ["…"],
    not_your_job: ["… (sibling scope — do not duplicate)"],
    acceptance_slice: ["path: reports/researcher-a.md", "…"],
  },
  text: ctx.template.workOrder("researcher-a"),
})
```

**Do not write `profile`** — topology assigns inner profiles automatically at execution-tree creation.

```typescript
export const team = {
  mission_id: "<id>",
  terminal: "<terminal-node-id>",
  nodes: {
    "<leaf-id>": {
      description: "Executes <concrete deliverable>",
    },
    "<terminal-node-id>": {
      description: "Produces the final mission deliverable",
    },
  },
}

export const meta = {
  name: "<id>",
  phases: ["Phase A", "Phase B"],
}

export default async function orchestrate(ctx) {
  await ctx.run("<leaf-id>", {
    brief: {
      your_work: ["…"],
      acceptance_slice: ["path: reports/<leaf-id>.md", "…"],
    },
    text: ctx.template.workOrder("<leaf-id>"),
  })

  await ctx.run("<terminal-node-id>", {
    brief: {
      your_work: ["Integrate upstream work into the final deliverable"],
      acceptance_slice: ["path: …", "…"],
    },
    text: ctx.template.workOrder("<terminal-node-id>", { context: "…" }),
    dependsOn: [{ node: "<leaf-id>", deliverable: true }],
  })
}
```

**Team vs orchestration:**

- `team.terminal` **must equal the terminal node**. Use a meaningful node id — **do not** add a generic `root` node by default.
- `team.nodes` lists members and descriptions only. **Timing and dependencies** live only in `orchestrate()` via `ctx.run` / `dependsOn`; that plan defines structure.
- **Terminal node:** the plan dependency sink (last `ctx.run` target that nothing else waits on). When all nodes are done and the terminal calls `gatehouse_execution_complete`, Gatehouse auto-notifies {{lead_name}}.
- Add intermediate synthesis nodes only when the work split genuinely needs them. When a node waits on upstream deliverables, use `dependsOn` with `deliverable: true`; Curator decides `skill_domain` — do not encode it in the script.

**Rework (runtime):** a node may call `gatehouse_execution_rework` only on **upstream nodes listed in its own run `dependsOn`**; do not put rework policy in `meta`.

**Orchestration primitives (`ctx.*` only):**

| API | Purpose |
|-----|---------|
| `ctx.run(nodeId, { brief, text?, dependsOn?, completionSchema?, returnStructured?, reply? })` | Activate one node: all `dependsOn` entries must be satisfied, then dispatch once and wait for `complete`; with `returnStructured: true`, resolves upstream validated JSON |
| `ctx.parallel(tracks)` | **Parallel barrier**: run thunks concurrently; continue after **all** finish |
| `ctx.pipeline(items, stage1, stage2?, ...)` | **Streaming parallel**: each item flows through stages independently with **no barrier between stages** (item A may be in stage 2 while item B is still in stage 1); failed items resolve to `null` |
| `ctx.template.workOrder` / `rework` / `reworkResume` | Standard work-order text |
| `ctx.objective` | Frozen mission objective string (safe to embed in work orders) |

Do **not** simulate peer coordination in the script — drive timing with `ctx.run`, `ctx.parallel`, and `ctx.pipeline`.

**Structured completion (`completion_schema`):**

- Declare JSON Schema on `brief.completion_schema` or `completionSchema` in `ctx.run`; the node must pass `structured_output` on `gatehouse_execution_complete` matching the schema.
- Consume in-script: `const { structured } = await ctx.run("leaf", { completionSchema: SCHEMA, returnStructured: true })`.

**`dependsOn` rules:**

- Each entry is a **string** (wait for completion only) or **`{ node, deliverable?: boolean }`** (inject upstream completion: prose summary plus validated JSON when present).
- When the work order needs upstream deliverables, list every relevant node explicitly with `deliverable: true` (including all direct children when aggregating a subtree).
- **Cross-track ordering:** `dependsOn: ["other-node"]` (ordering only, no deliverable injection) — allowed anywhere, including top level and inside parallel tracks.
- **Cross-track with upstream delivery content:** `dependsOn: [{ node: "a1", deliverable: true }]` inside parallel tracks.

**Every node must be run:**

- **Each** node_id in `team.nodes` must be activated via `ctx.run`, or dry-run fails with `SCRIPT_SIMULATION_INCOMPLETE`.

**Parallel orchestration:** for independent subtrees or sibling leaves, use `ctx.parallel` with one `ctx.run` per node:

```typescript
await ctx.parallel([
  async () => {
    await ctx.run("a1", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("a1") })
    await ctx.run("a2", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("a2") })
    await ctx.run("a", {
      brief: { your_work: ["…"], acceptance_slice: ["…"] },
      text: ctx.template.workOrder("a"),
      dependsOn: [{ node: "a1", deliverable: true }, { node: "a2", deliverable: true }],
    })
  },
  async () => {
    await ctx.run("b1", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("b1") })
    await ctx.run("b2", { brief: { your_work: ["…"], acceptance_slice: ["…"] }, text: ctx.template.workOrder("b2") })
    await ctx.run("b", {
      brief: { your_work: ["…"], acceptance_slice: ["…"] },
      text: ctx.template.workOrder("b"),
      dependsOn: [{ node: "b1", deliverable: true }, { node: "b2", deliverable: true }],
    })
  },
])
// Cross-track final delivery only when the mission needs it; set team.terminal to this node.
await ctx.run("<terminal-node-id>", {
  brief: { your_work: ["…"], acceptance_slice: ["…"] },
  text: ctx.template.workOrder("<terminal-node-id>"),
  dependsOn: [{ node: "a", deliverable: true }, { node: "b", deliverable: true }],
})
```

When the last work node already satisfies `done_when`, make it the terminal (`team.terminal`) — no extra wrapper node.

**Pipeline orchestration (`ctx.pipeline`):** run multiple stages per list item with no barrier between stages — suited for per-file/per-item discover→process→verify:

```typescript
const ROUTES = { type: "object", required: ["routes"], properties: { routes: { type: "array" } } }

const discovered = await ctx.run("discover", {
  brief: {
    your_work: ["List paths to process"],
    completion_schema: ROUTES,
  },
  completionSchema: ROUTES,
  returnStructured: true,
  text: ctx.template.workOrder("discover"),
})

const audited = await ctx.pipeline(
  discovered.structured?.routes ?? [],
  async (route) =>
    ctx.run(`audit-${route}`, {
      brief: { your_work: [`Audit ${route}`], acceptance_slice: ["…"] },
      text: ctx.template.workOrder(`audit-${route}`),
    }),
  async (_prev, route) =>
    ctx.run(`verify-${route}`, {
      brief: { your_work: [`Verify ${route}`], acceptance_slice: ["…"] },
      dependsOn: [{ node: `audit-${route}`, deliverable: true }],
      text: ctx.template.workOrder(`verify-${route}`),
    }),
)
const results = audited.filter(Boolean)
```

**Script writing limits:**

1. **No** `import` / `require` — no file I/O, shell, or network.
2. Drive the mission **only** through `ctx.*`; no top-level code that runs on load.
3. `team` / `meta` must be object literals.
4. Prefer string literals for `nodeId` so node names stay correct.
5. Do not paste the full contract into the script — put boundaries in `run` brief or work-order text.
6. Recommended flow: `ctx.run(nodeId, { brief, text })`; parallel siblings use `ctx.parallel` with one run per node; **multi-stage per-item work** (e.g. migrate→verify per file) use `ctx.pipeline`.
7. Use documented `ctx.*` only (`ctx.objective` is available).
8. **Strings:** in `orchestrate`, prefer template literals or single quotes for `context` / `note`. **`SCRIPT_RISKY_STRING_LITERAL` applies only** when `context:` / `note:` use double quotes **and** the value contains `gatehouse_` (`run` brief and `team`/`meta` literals are exempt). Fix only the line the error cites — do not bulk-convert quote styles.
9. **Validation & recovery:** save the script, then call `gatehouse_submit_orchestration` — the system validates and starts or resumes automatically. **Dry-run failures return errors in the tool response only**; no separate Gatehouse system message (runtime sandbox failures still notify you). Dry-run checks cross-track false serialization (`SCRIPT_SERIAL_TRACK_BLOCK`), `dependsOn` subtree validity, brief coverage, unreferenced nodes, `ctx.parallel` hints, and more; warnings are returned in `warnings`. After rewriting mid-mission: **`gatehouse_submit_orchestration(mode=continue)`**. Do not edit `mission.script.ts` during active orchestration.

The script drives timing and work orders via `dependsOn` when upstream deliverables are needed. The **terminal node** auto-notifies {{lead_name}} via `gatehouse_execution_complete` when all nodes are done. **Portal publish happens on Lead `mission_complete(done)`** — never put “publish to Portal” or any publish tool name in `setBrief` or work orders.

1. `gatehouse_submit_orchestration(objective=...)` → wait for execution to start after skill domains are resolved.
2. **Exit the execution loop** — do not offer `gatehouse_execution_status` tracking or progress polling.

### 3. After team is built

Execution team collaborates on its own; **you do not intervene**, track progress, or snapshot-poll during normal runs. **Exception:** on orchestration stall alerts, use `gatehouse_execution_status` once for diagnosis.

### 4. Retro review

When you receive the “Retro review ready” notification:

1. Read `.gatehouse/trees/<id>/reports/retro-summary.md` (retro-analyst output).
2. Review conclusions and iterate **architect-meta**.
3. Write `.gatehouse/trees/<id>/reports/architect-summary.md` per `architect-summary.template.md`.
4. Call **`gatehouse_retro_summary_record`** (do not `send_message` {{lead_name}} for summary registration).

## Paths


| Purpose                  | Path                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission script / reports | `.gatehouse/trees/<id>/mission.script.ts`                                                                                                                |
| Node reports | Each node `gatehouse_execution_complete(summary=...)` |
| Upstream deliverables in work order | `dependsOn: [{ node: "…", deliverable: true }, …]` on `ctx.run` |
| Prompt templates         | `.gatehouse/<locale>/prompts/architect/` (`<locale>` from `config.yaml`)                                                                                 |
| Retro methodology        | `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md`                                                                                                      |
| Retro tool scripts       | `.gatehouse/skills/retro-toolkit/tools/`                                                                                                                 |
