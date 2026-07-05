# <verb-noun> · retro analysis tool

## Problem class

(e.g. count context compaction events and post-compaction assistant token spikes)

## Inputs

- `.gatehouse/missions/<mission_id>/context/<node_id>/messages.json` or `timeline.md`
- `.gatehouse/missions/<mission_id>/context/mission-metrics.json` (mission-level token/duration/tool aggregates from context dump / `mergeSessionMetrics`)
- `.gatehouse/missions/<mission_id>/context/<node_id>/metrics.json` (per-node totals)
- `.gatehouse/missions/<mission_id>/context/index.json` (node list and `mission_metrics_path`)

## Run

```bash
python analyze.py --mission <mission_id> --node <node_id>
```

## Output fields

| Field | Meaning |
|-------|---------|
| | |

## Example finding

(sample output and interpretation from a real retro)
