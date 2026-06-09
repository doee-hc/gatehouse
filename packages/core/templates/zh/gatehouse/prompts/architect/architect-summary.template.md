# {{architect_name}}复盘汇总模板

落盘：`.gatehouse/trees/<mission_id>/reports/architect-summary.md`

---

# {{architect_name}}复盘汇总 · {{mission_id}}

## 拓扑回顾
- 根：{{root_node}}
- 节点数：{{node_count}}

## 任务分配与 prompt 约束（来自各节点 retro 报告）
- 任务分配 / done_when / constraints 是否有效：
- 哪些约束措辞需收紧或放宽：
- 拓扑（when_pair_with、层级）调整建议：

## 运行时问题汇总（跨节点）
- 各 coord 自主发现的主要效率问题（引用其脚本证据或 timeline 片段）：
- 上下文压缩 / 协调 / token 热点等模式：

## retro 工具与方法论演进（必做）
汇总各 `.gatehouse/trees/<mission_id>/reports/nodes/*-retro.md` 的「工具贡献」章节：

| retro 节点 | 新工具/改进 | 路径 | promote? | 一句话 |
|------------|------------|------|----------|--------|

**整理动作（写入永久经验）：**
- [ ] 合并 promote 的工具到 `.gatehouse/skills/retro-toolkit/tools/`
- [ ] 更新 `.gatehouse/<locale>/skills/retro-toolkit/SKILL.md`（方法论、推荐 grep、常见问题类）
- [ ] 更新 `.gatehouse/<locale>/prompts/architect/retro-node-analysis.md`（若需调整 coord 规程措辞）
- [ ] 弃用/归档重复或失效工具（注明原因）

## architect-meta 更新摘要
（本次写入 `.gatehouse/<locale>/skills/architect-meta/SKILL.md` 或 `.gatehouse/<locale>/prompts/architect/` 的变更要点 — **协调与分配层面**，非领域 skill）

## 给{{lead_name}}的摘要
（3–5 条 bullet，供 report.md 引用 — 聚焦任务规划与验收，不含业务细节）

## 下一项任务建议（可选）
（仅建议，由{{lead_name}}决定）
