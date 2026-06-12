# Retro task · node {{node_id}}

You are in a **retro fork session** analyzing your execution branch — **do not** mix analysis into the original execution session.

Do not wait for {{architect_name}} to `send_message` each step. **Discover issues yourself** — do not rely on Gatehouse precomputed semantic features.

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

**Precomputed API-level metrics** (read files directly, no tool calls):

- Subtree rollup: `.gatehouse/trees/{{mission_id}}/context/subtree-metrics.json` → `retro_nodes["{{node_id}}"]`
- Per-node detail: `.gatehouse/trees/{{mission_id}}/context/<node_id>/metrics.json`

These **do not** replace semantic features you derive from messages/timeline (compaction count, todo-phase tokens, send_message patterns, etc.).

### Recommended steps (sample → tools → conclusions)

1. Use the kickoff snapshot above to scope your branch; read **`retro-toolkit/SKILL.md`**, list nodes, reuse `tools/` scripts.
2. **Do not read** all of `messages.json`. Grep `timeline.md` first (table below).
3. For suspicious patterns: **write or extend Python scripts** for features (compaction, todo tokens, send_message sequences, etc.).
4. If a new tool is reusable: add `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/` with `SKILL.md`.
5. Cross-check `.gatehouse/trees/{{mission_id}}/context/subtree-metrics.json` with script output.
6. Write `.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md` (include "Tool contribution" section) → `gatehouse_retro_record` (internal — do not publish).

**Grep guide (timeline.md):**

| Target | Command |
|--------|---------|
| Real user input | `grep 'kind=user'` |
| Gatehouse system delivery | `grep 'kind=gatehouse'` |
| Context compaction | `grep 'kind=compaction_marker'` |
| Compaction summary | `grep 'kind=summary'` |
| Reports upstream/peers | `grep 'tool=gatehouse_send_message'` |
| Todo changes | `grep 'tool=todowrite'` |
| High-token turns | `grep 'tokens='` |

**messages.json script tips:** top-level `messages` array; assistant tokens in `info.tokens`; tools in `parts[]` with `type=tool`.

### Output

Write: `.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md`

**Report is for {{architect_name}} (assignment & prompt constraints), not domain skills or business implementation detail.**

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
- Node `gatehouse_node_brief` effective, too loose/tight:
- Child prompts causing duplicate work or overlap:

## Coordination & topology (for {{architect_name}} architect-meta)
- send_message / wait / topology suggestions:

## Actionable recommendations for {{architect_name}} (3–5)
(assignment, topology, prompt templates, constraint wording only)

## Tool contribution (required)
| Item | Content |
|------|---------|
| New/improved retro tool | yes / no |
| Tool path | `.gatehouse/skills/retro-toolkit/tools/...` or "none" |
| Promote to toolkit? | yes / no / n/a |
| Brief note | |
```

### Record completion (required)

```
gatehouse_retro_record()
# do not gatehouse_publish_blog retro reports
```

**Do not** `gatehouse_send_message` {{architect_name}} — Gatehouse auto-notifies {{architect_name}} after all nodes record (with retro reports and retro-toolkit curation tasks).
