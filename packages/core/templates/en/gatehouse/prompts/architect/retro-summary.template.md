# Retro summary template · {{mission_id}}

Save to: `.gatehouse/trees/<mission_id>/reports/retro-summary.md`

---

# Retro summary · {{mission_id}}

## Topology recap
- Terminal: {{terminal_node}}
- Node count: {{node_count}}

## Orchestration order findings
(Per `ctx.run` / `ctx.parallel` step — efficiency issues, evidence from timeline/metrics/scripts)

## Cross-node runtime patterns
- Context compaction / coordination / token hotspots
- Tool retries, idle gaps, user mid-flight interventions

## Tool contribution

| Tool | Problem class | Path | One-line |
|------|---------------|------|----------|

## Prompt / brief observations
(Which node briefs or constraints were unclear — for architect meta-skill)

## Suggested architect actions
(Topology, orchestration timing, prompt wording — draft only; architect decides)
