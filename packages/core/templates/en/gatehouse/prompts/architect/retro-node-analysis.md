# Retro task · node {{node_id}}

You are in a **retro session** (empty context) analyzing your execution branch. Use dumped `context/` as the sole source of truth — do not rely on execution-session conversation memory.

Discover issues yourself.

{{retro_context_snapshot}}

### Data sources (source of truth)

```
.gatehouse/trees/{{mission_id}}/context/
  index.json                 # all node_ids in your branch, subtree-metrics paths
  subtree-metrics.json       # token/duration/tool aggregates per retro coord subtree (read retro_nodes["{{node_id}}"])
  <node_id>/
    messages.json            # full raw messages (tool I/O, parent)
    timeline.md              # grep-friendly timeline (kind, tokens=)
    metrics.json             # per-node session token/duration/tool aggregates

skill({ name: "retro-toolkit" })     # methodology (or read .gatehouse/<locale>/skills/retro-toolkit/SKILL.md)
.gatehouse/skills/retro-toolkit/tools/<verb-noun>/SKILL.md + scripts
```

### Recommended steps (sample → tools → conclusions)

1. Use the kickoff snapshot above to scope your branch; read **`retro-toolkit/SKILL.md`**, list nodes, reuse `tools/` scripts.
2. **Do not read** all of `messages.json`. Grep `timeline.md` first (table below).
3. For suspicious patterns: **write or extend Python scripts** for features (compaction, todo tokens, complete/rework sequences, etc.).
4. If a new tool is reusable: add `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/` with `SKILL.md`.
5. Cross-check `subtree-metrics.json` with script output.
6. Write `.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md` (include "Tool contribution" section) → `gatehouse_retro_record()`.

**Grep guide (timeline.md):**

| Target | Command |
|--------|---------|
| Real user input | `grep 'kind=user'` |
| Gatehouse system delivery | `grep 'kind=gatehouse'` |
| Context compaction | `grep 'kind=compaction_marker'` |
| Compaction summary | `grep 'kind=summary'` |
| Node completion / rework | `grep 'tool=gatehouse_execution_'` |
| Todo changes | `grep 'tool=todowrite'` |
| High-token turns | `grep 'tokens='` |

**messages.json script tips:** top-level `messages` array; assistant tokens in `info.tokens`; tools in `parts[]` with `type=tool`.

### Output

Write: `.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md`

**Focus on assignment and prompt constraints — not domain skills or business implementation detail.**

Suggested structure:

```markdown
# Runtime retro · {{node_id}}

## Analysis method
- Sampling path (grep / which nodes and slices):
- Reused retro-toolkit tools:
- New tools this round: (or "none"; path + one-line purpose if any)

## Efficiency findings (with script/evidence)
- (your findings + how measured; cite timeline lines or script output)

## Task assignment & prompt constraints
- Was assignment clear (who / what / done_when):
- Node `gatehouse_mission_info` effective, too loose/tight:
- Child prompts causing duplicate work or overlap:

## Coordination & topology suggestions
- Orchestration wait / rework / topology suggestions:

## Actionable recommendations (3–5)
(assignment, topology, prompt templates, constraint wording only)

## Tool contribution (required)
| Item | Content |
|------|---------|
| New/improved retro tool | yes / no |
| Tool path | `.gatehouse/skills/retro-toolkit/tools/...` or "none" |
| Add to retro-toolkit? | yes / no / n/a |
| Brief note | |
```

### Record completion (required)

```
gatehouse_retro_record()
```
