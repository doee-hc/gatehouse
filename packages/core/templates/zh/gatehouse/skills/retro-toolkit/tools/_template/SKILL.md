# <verb-noun> · retro 分析工具

## 解决哪类问题

（例：统计 context compaction 次数与后续 assistant 轮次 token 膨胀）

## 输入

- `context/<node_id>/messages.json` 或 `timeline.md`
- `context/subtree-metrics.json` → `retro_nodes[<node_id>]`（子树 token/耗时/工具汇总）
- `context/<node_id>/metrics.json`（单节点汇总）

## 运行

```bash
python analyze.py --mission <mission_id> --node <node_id>
```

## 输出字段

| 字段 | 含义 |
|------|------|
| | |

## 示例发现

（一次真实 retro 中的样例输出与解读）
