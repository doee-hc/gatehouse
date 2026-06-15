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
| `gatehouse_send_message`     | Coordination messages (not for retro/skill rollup registration)                                                           |
| `gatehouse_retro_summary_record` | Register `architect-summary.md` after retro rollup; Gatehouse auto-notifies {{lead_name}} when rollup is complete |
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
| `export const team` | Execution team: each node's `node_id`, `parent` report line, one-line `description` |
| `export const meta` | Optional: progress `phases`, rework policy `rework` |
| `export default async function orchestrate(ctx)` | Orchestration: `prompt` / `setBrief` / `waitFor` |

Each inner node **must** have `description` (one-line role). Put detailed tasks and boundaries in `ctx.setBrief`.

**`setBrief` constraints:** each leaf needs concrete `your_work`, explicit `acceptance_slice` with a project `path:`, and sibling scope boundaries when needed. When done, call `gatehouse_execution_complete(summary=..., artifacts=[{path,description}], risks=?)`.

```typescript
await ctx.setBrief("researcher-a", {
  your_work: ["…"],
  not_your_job: ["… (sibling scope — do not duplicate)"],
  acceptance_slice: ["path: reports/researcher-a.md", "…"],
})
```

**Do not write `profile`** — topology assigns inner profiles automatically at execution-tree creation.

```typescript
export const team = {
  mission_id: "<id>",
  root: "<root-node-id>",
  nodes: {
    "<root-node-id>": {
      parent: null,
      description: "Task coordinator — delegate and summarize delivery",
    },
    "<leaf-id>": {
      parent: "<root-node-id>",
      description: "Executes <concrete deliverable>",
    },
  },
}

export const meta = {
  name: "<id>",
  phases: ["Phase A", "Phase B"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
}

export default async function orchestrate(ctx) {
  ctx.phase("Phase A")
  await ctx.setBrief("<leaf-id>", {
    your_work: ["…"],
    acceptance_slice: ["path: reports/<leaf-id>.md", "…"],
  })
  await ctx.prompt("<leaf-id>", {
    text: ctx.template.workOrder("<leaf-id>"),
    reply: true,
  })
  await ctx.waitFor("<leaf-id>", "complete")

  ctx.phase("Phase B")
  await ctx.setBrief("<root-node-id>", {
    your_work: ["Roll up child deliveries and verify acceptance"],
    acceptance_slice: ["path: …", "…"],
  })
  await ctx.prompt("<root-node-id>", {
    text: ctx.template.workOrder("<root-node-id>", { context: "…" }),
    reply: true,
    rollupFrom: ["<leaf-id>"],
  })
  await ctx.waitFor("<root-node-id>", "complete")
}
```

**Multi-level team** (root → intermediate → leaves): express the report tree with `team.nodes.parent`; use `waitForRollup` or sequential `waitFor` in `orchestrate`. Coordinator subtree scope goes in `setBrief`. Coordinator rollup format: `subtree-delivery-index.template.md`. Intermediate coordinators usually do not get `skill_domain`.

**Orchestration primitives (`ctx.*` only):**

| API | Purpose |
|-----|---------|
| `ctx.prompt(nodeId, { text?, system?, reply?, rollupFrom? })` | Send a work order; `reply: true` to start work; `rollupFrom` lists child node_ids to attach |
| `ctx.setBrief(nodeId, partial)` | Write the node brief (call before `prompt`) |
| `ctx.waitFor(nodeId, "complete")` | Wait until the node calls `gatehouse_execution_complete` |
| `ctx.waitForRollup` | Wait for all descendant leaves to complete (sequential `waitFor` internally) |
| `ctx.parallel(thunks)` | **Barrier parallel tracks**: run thunks concurrently; continue after all finish |
| `ctx.pipeline(items, ...stages)` | **Streaming stages**: each item flows through stages independently |
| `ctx.template.workOrder` / `rework` / `reworkResume` | Standard work-order text |
| `ctx.phase(title)` | Update mission progress display |
| `ctx.objective` | Frozen mission objective string (safe to embed in work orders) |

Do **not** simulate peer coordination in the script — drive timing only with `ctx.prompt` / `waitFor`.

**`rollupFrom` rules:**

- Use only on **parent / coordinator** nodes: `prompt(..., { rollupFrom: [...] })` lists **descendant** node_ids whose delivery summaries attach to that work order.
- **Do not** put sibling node_ids in `rollupFrom` on a leaf (`SCRIPT_INVALID_ROLLUP`). For leaves that need upstream output, pass paths via `ctx.template.workOrder(..., { context: \`…\` })`.

**Every node needs `prompt` + `waitFor`:**

- **Each** node_id in `team.nodes` (including root) must go through `setBrief` → `prompt(reply:true)` → `waitFor('complete')`, or dry-run fails with `SCRIPT_SIMULATION_INCOMPLETE`.

**Parallel orchestration:** for independent subtrees (e.g. track A: a1/a2/a3 + coordinator a, track B: b1/b2/b3 + coordinator b), use `ctx.parallel` so both tracks advance **without blocking each other**:

```typescript
ctx.phase("Parallel tracks A & B")
await ctx.parallel([
  async () => {
    for (const id of ["a1", "a2", "a3"]) {
      await ctx.setBrief(id, { your_work: ["…"], acceptance_slice: ["…"] })
      await ctx.prompt(id, { text: ctx.template.workOrder(id), reply: true })
    }
    for (const id of ["a1", "a2", "a3"]) {
      await ctx.waitFor(id, "complete")
    }
    await ctx.setBrief("a", { your_work: ["rollup A"], acceptance_slice: ["…"] })
    await ctx.prompt("a", {
      text: ctx.template.workOrder("a"),
      reply: true,
      rollupFrom: ["a1", "a2", "a3"],
    })
    await ctx.waitFor("a", "complete")
  },
  async () => {
    for (const id of ["b1", "b2", "b3"]) {
      await ctx.setBrief(id, { your_work: ["…"], acceptance_slice: ["…"] })
      await ctx.prompt(id, { text: ctx.template.workOrder(id), reply: true })
    }
    for (const id of ["b1", "b2", "b3"]) {
      await ctx.waitFor(id, "complete")
    }
    await ctx.setBrief("b", { your_work: ["rollup B"], acceptance_slice: ["…"] })
    await ctx.prompt("b", {
      text: ctx.template.workOrder("b"),
      reply: true,
      rollupFrom: ["b1", "b2", "b3"],
    })
    await ctx.waitFor("b", "complete")
  },
])
```

For sibling leaves only (no separate subtrees), `prompt` all siblings then `waitFor` each is still fine.

**Script writing limits:**

1. **No** `import` / `require` — no file I/O, shell, or network.
2. Drive the mission **only** through `ctx.*`; no top-level code that runs on load.
3. `team` / `meta` must be object literals.
4. Prefer string literals for `nodeId` so node names stay correct.
5. Do not paste the full contract into the script — put boundaries in `setBrief` or `prompt.text`.
6. Recommended flow: `setBrief` → `prompt(reply:true)` → `waitFor`; use `meta.phases` + `ctx.phase` for multi-stage missions (**call `ctx.phase` for each `meta.phases` entry**).
7. Use documented `ctx.*` only (`ctx.objective` is available).
8. **Strings:** in `orchestrate`, prefer template literals or single quotes for `context` / `note`. **`SCRIPT_RISKY_STRING_LITERAL` applies only** when `context:` / `note:` use double quotes **and** the value contains `gatehouse_` (`setBrief` text and `team`/`meta` literals are exempt). Fix only the line the error cites — do not bulk-convert quote styles.
9. **Validation & recovery:** save the script, then call `gatehouse_submit_orchestration` — the system validates and starts or resumes automatically. **Dry-run failures return errors in the tool response only**; no separate Gatehouse system message (runtime sandbox failures still notify you). Dry-run checks cross-track false serialization (`SCRIPT_SERIAL_TRACK_BLOCK`), `rollupFrom` subtree validity, `setBrief` coverage, unreferenced nodes, `ctx.parallel` hints, and more; warnings are returned in `warnings`. After rewriting mid-mission: **`gatehouse_submit_orchestration(mode=continue)`**. Do not edit `mission.script.ts` during active orchestration.

The script drives timing and work orders. When waking a parent/coordinator, use `prompt(..., { rollupFrom: [...] })` to **list** child node_ids whose reports belong in that order. Structural root auto-notifies {{lead_name}} via `gatehouse_execution_complete` when all nodes are done. **Portal publish happens on Lead `mission_complete(done)`** — never put “publish to Portal” or any publish tool name in `setBrief` or work orders.

1. `gatehouse_submit_orchestration(objective=...)` → wait for execution to start after skill domains are resolved.
2. **Exit the execution loop** — do not offer `gatehouse_execution_status` tracking or progress polling.

### 3. After team is built

Execution team collaborates on its own; **you do not intervene**, track progress, or snapshot-poll during normal runs. **Exception:** on orchestration stall alerts, use `gatehouse_execution_status` once for diagnosis.

### 4. Retro rollup

When you receive the “Retro ready” notification, write `.gatehouse/trees/<id>/reports/architect-summary.md` per `architect-summary.template.md`, then **`gatehouse_retro_summary_record`** (do not `send_message` {{lead_name}} for rollup).

## Paths


| Purpose                  | Path                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission script / reports | `.gatehouse/trees/<id>/mission.script.ts`                                                                                                                |
| Node reports | Each node `gatehouse_execution_complete(summary, artifacts?)` |
| Rollup work order | Parent `prompt` with `rollupFrom: [node_id, ...]` |
| Writing guides | `prompts/architect/subtree-delivery-index.template.md` (coordinators) |
| Prompt templates         | `.gatehouse/<locale>/prompts/architect/` (`<locale>` from `config.yaml`)                                                                                 |
| Retro methodology        | `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md`                                                                                                      |
| Retro tool scripts       | `.gatehouse/skills/retro-toolkit/tools/`                                                                                                                 |
