# {{architect_name}} retro rollup template

Write to: `.gatehouse/trees/<mission_id>/reports/architect-summary.md`

---

# {{architect_name}} retro rollup · {{mission_id}}

## Topology recap
- Root: {{root_node}}
- Node count: {{node_count}}

## Task assignment & prompt constraints (from node retro reports)
- Were assignment / done_when / constraints effective:
- Constraints to tighten or relax:
- Topology (when_pair_with, hierarchy) adjustments:

## Runtime issues (cross-node)
- Main efficiency findings per coord (cite script evidence or timeline snippets):
- Patterns: compaction, coordination, token hotspots, etc.

## Retro tools & methodology evolution (required)
Roll up "Tool contribution" from each `.gatehouse/trees/<mission_id>/reports/nodes/*-retro.md`:

| retro node | new/improved tool | path | promote? | one line |
|------------|-------------------|------|----------|----------|

**Curation (write to permanent experience):**
- [ ] Merge promoted tools into `.gatehouse/skills/retro-toolkit/tools/`
- [ ] Update `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md` (methodology, recommended greps, problem classes)
- [ ] Update `.gatehouse/<locale>/prompts/architect/retro-node-analysis.md` if coord procedure wording needs change
- [ ] Deprecate/archive duplicate or stale tools (note reason)

## architect-meta update summary
(What changed in `.gatehouse/<locale>/skills/architect-meta/SKILL.md` or `.gatehouse/<locale>/prompts/architect/` this round — **coordination & assignment**, not domain skills)

## Summary for {{lead_name}}
(3–5 bullets for report.md — Mission planning & acceptance, no business implementation detail)

## Next Mission suggestions (optional)
(Suggestions only — {{lead_name}} decides)
