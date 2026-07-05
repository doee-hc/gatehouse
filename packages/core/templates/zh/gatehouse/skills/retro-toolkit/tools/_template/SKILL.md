# <verb-noun> · retro 分析工具

## 解决哪类问题

（例：统计 context compaction 次数与后续 assistant 轮次 token 膨胀）

## 输入

- `.gatehouse/missions/<mission_id>/context/<node_id>/messages.json` 或 `timeline.md`
- `.gatehouse/missions/<mission_id>/context/mission-metrics.json`（context dump / `mergeSessionMetrics` 产出的 Mission 级 token/耗时/工具聚合）
- `.gatehouse/missions/<mission_id>/context/<node_id>/metrics.json`（单节点汇总）
- `.gatehouse/missions/<mission_id>/context/index.json`（节点列表与 `mission_metrics_path`）

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
