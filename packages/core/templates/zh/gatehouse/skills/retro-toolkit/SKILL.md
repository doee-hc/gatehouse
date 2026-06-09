---
name: retro-toolkit
description: >-
  Shared retro analysis methodology and reusable scripts for Gatehouse build-root / build-coordinator retro sessions.
  Use during mission retro when analyzing context/ dumps and promoting reusable retro tools.
metadata:
  gatehouse-kind: toolkit
  gatehouse-role: exec
disable-model-invocation: true
---

# Retro 工具库 · retro-toolkit

你是 **retro fork session 中的协调节点**（build-root / build-root-solo / build-coordinator）。复盘时：

1. **唯一数据源** — `.gatehouse/trees/<mission_id>/context/`（`messages.json`、`timeline.md`、`metrics.json`、`subtree-metrics.json`）。
2. **不要通读全量上下文** — 先读 `subtree-metrics.json` 与 `metrics.json`，再 grep `timeline.md`、抽样 `messages.json`，定位可疑片段后深挖。
3. **鼓励自制工具** — 用 Python 等脚本从原始上下文提取特征（压缩次数、todo 段 token、send_message 模式等）。**不要**等待 Gatehouse 插件替你算这些语义指标。
4. **工具持久化** — 有效脚本 + 使用说明写入 `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/`（见下方模板），下次 retro 先读已有工具再决定是否扩展。

## 落盘 vs 自制（边界）

| 来源 | 用途 |
|------|------|
| `.gatehouse/trees/<mission_id>/context/` | 全量原始消息 + grep 友好 timeline — **特征提取的主原料** |
| `.gatehouse/trees/<mission_id>/context/<node_id>/metrics.json` | 单节点 session 级 token/耗时/工具聚合（系统预计算） |
| `.gatehouse/trees/<mission_id>/context/subtree-metrics.json` | 各 retro coord 所辖子树聚合（读 `retro_nodes[<你的 node_id>]`） |
| 自制脚本 + 本 skill | 一切可从 messages/timeline 推导的语义指标（压缩、todo、协调、热点轮次等） |

## 推荐工作流

1. 调用 `skill({ name: "retro-toolkit" })`；读 `.gatehouse/trees/<mission_id>/context/index.json` 与 `subtree-metrics.json`（`retro_nodes[<node_id>]`），列出所辖分支全部 `node_id`。
2. 读 `.gatehouse/skills/retro-toolkit/tools/*/SKILL.md`，复用已有脚本。
3. 对 1–2 个可疑节点：grep timeline → 写/跑脚本 → 记录发现。
4. 若新工具有复用价值：落盘 `.gatehouse/skills/retro-toolkit/tools/<name>/` 并写 SKILL。
5. 写 `.gatehouse/trees/<mission_id>/reports/nodes/<node_id>-retro.md`（含「工具贡献」章节）→ `gatehouse_retro_record` 登记 → `gatehouse_publish_blog(report_path=.gatehouse/trees/<mission_id>/reports/nodes/<node_id>-retro.md)` 发布到 Portal 博客。

## 新工具目录约定

```
.gatehouse/skills/retro-toolkit/tools/<verb-noun>/
  SKILL.md          # 用途、输入输出、示例命令、适用问题类
  analyze.py        # 或其它脚本（可多文件）
```

`SKILL.md` 必含：**解决哪类效率问题**、**读取哪些 context 路径**、**如何运行**、**输出字段含义**。

## 分析问题类（启发，非穷举）

- 上下文压缩频率与后续行为异常
- todo 阶段 token 消耗与产出比
- send_message / 协调链缺口
- tool 反复失败与重试
- 用户中途介入与 prompt 约束不足
- 所辖分支内节点间职责重叠
