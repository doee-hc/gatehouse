# 复盘任务 · 节点 {{node_id}}

你当前在 **retro session**（空上下文启动）中复盘执行期所辖分支。以落盘的 `context/` 为唯一数据源，不要依赖执行期 session 的对话记忆。

请自主发现问题。

{{retro_context_snapshot}}

### 数据来源（唯一真相源）

```
.gatehouse/trees/{{mission_id}}/context/
  index.json                 # 所辖分支全部 node_id、subtree-metrics 路径
  subtree-metrics.json       # 各 retro coord 所辖子树的 token/耗时/工具聚合（读 retro_nodes["{{node_id}}"]）
  <node_id>/
    messages.json            # 全量原始消息（含 tool input/output、parent）
    timeline.md              # grep 友好时间线（含 kind、tokens=）
    metrics.json             # 单节点 session 级 token/耗时/工具聚合

skill({ name: "retro-toolkit" })     # 方法论（或读 .gatehouse/<locale>/skills/retro-toolkit/SKILL.md）
.gatehouse/skills/retro-toolkit/tools/<verb-noun>/SKILL.md + 脚本
```

### 推荐步骤（抽样 → 工具 → 结论）

1. 使用上方启动快照定位所辖分支；读 **`retro-toolkit/SKILL.md`**，列出节点并复用已有 `tools/` 脚本。
2. **不要通读**全部 `messages.json`。先用 `timeline.md` grep 定位异常片段（见下表）。
3. 对可疑模式：**自制或扩展 Python 脚本**提取特征（压缩次数、todo 段 token、complete/rework 序列等）。
4. 若新工具有复用价值：写入 `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/`（含 `SKILL.md`）。
5. 用 `subtree-metrics.json` 与脚本输出交叉验证 token/耗时/工具调用统计。
6. 写 `.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md`（含「工具贡献」章节）→ `gatehouse_retro_record()`。

**grep 指引（timeline.md）：**

| 目标 | 命令 |
|------|------|
| 用户真实输入 | `grep 'kind=user'` |
| Gatehouse 系统投递 | `grep 'kind=gatehouse'` |
| 上下文压缩 | `grep 'kind=compaction_marker'` |
| 压缩摘要 | `grep 'kind=summary'` |
| 节点完成 / 返工 | `grep 'tool=gatehouse_execution_'` |
| Todo 变更 | `grep 'tool=todowrite'` |
| 高 token 轮次 | `grep 'tokens='` |

**messages.json 脚本提示：** 顶层 `messages` 数组；assistant 的 token 在 `info.tokens`；tool 在 `parts[]` 且 `type=tool`。

### 输出

写文件：`.gatehouse/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md`

**报告聚焦任务分配与 prompt 约束，不要写领域 skill 或业务实现细节。**

建议结构：

```markdown
# 运行时复盘 · {{node_id}}

## 分析方法
- 抽样路径（grep / 看了哪些 node 的哪些片段）：
- 复用的 retro-toolkit 工具：
- 本次新做工具：（无则写「无」；有则写路径与一行用途）

## 工作效率发现（附脚本/证据）
- （你的发现 + 如何测得；引用 timeline 行号或脚本输出）

## 任务分配与 prompt 约束
- 任务分配是否清晰（who / what / done_when）：
- 各节点 `gatehouse_mission_info` 是否有效、过松/过紧：
- 子节点 prompt 是否导致重复劳动或职责重叠：

## 协调与拓扑建议
- 编排等待 / rework / 拓扑建议：

## 可执行建议（3–5 条）
（仅任务分配、拓扑、prompt 模板、约束措辞）

## 工具贡献（必须填写）
| 项 | 内容 |
|----|------|
| 是否新增/改进 retro 工具 | 是 / 否 |
| 工具路径 | `.gatehouse/skills/retro-toolkit/tools/...` 或「无」 |
| 是否建议纳入 retro-toolkit | 是 / 否 / 不适用 |
| 简要说明 | |
```

### 登记完成（必须）

```
gatehouse_retro_record()
```
