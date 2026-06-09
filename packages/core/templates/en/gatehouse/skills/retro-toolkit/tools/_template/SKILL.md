# <verb-noun> · retro analysis tool

## Problem class

(e.g. count context compaction events and post-compaction assistant token spikes)

## Inputs

- `.gatehouse/trees/<mission_id>/context/<node_id>/messages.json` or `timeline.md`
- `.gatehouse/trees/<mission_id>/context/subtree-metrics.json` → `retro_nodes[<node_id>]` (subtree token/duration/tool totals)
- `.gatehouse/trees/<mission_id>/context/<node_id>/metrics.json` (per-node totals)

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
