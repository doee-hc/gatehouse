# 复盘摘要模板 · {{mission_id}}

落盘：`.gatehouse/missions/<mission_id>/reports/retro-summary.md`

---

# 复盘摘要 · {{mission_id}}

## 拓扑回顾
- Terminal：{{terminal_node}}
- 节点数：{{node_count}}

## 编排顺序发现
（按 `ctx.run` / `ctx.parallel` 逐步 — 效率问题，附 timeline/metrics/脚本证据）

## 跨节点运行时模式
- 上下文压缩 / 协调 / token 热点
- tool 重试、空闲间隔、用户中途介入

## 工具贡献

| 工具 | 问题类 | 路径 | 一句话 |
|------|--------|------|--------|

## Prompt / brief 观察
（哪些节点 brief 或约束不清晰 — 供 architect meta-skill 参考）

## 建议 architect 行动
（拓扑、编排时序、prompt 措辞 — 仅为草案；由 architect 定夺）
