# <verb-noun> · retro analysis tool

## Problem class

(e.g. count context compactions and token inflation on following assistant turns)

## Inputs

- `context/<node_id>/messages.json` or `timeline.md`
- `context/subtree-metrics.json` → `retro_nodes[<node_id>]` (subtree token/duration/tool totals)
- `context/<node_id>/metrics.json` (per-node totals)

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
