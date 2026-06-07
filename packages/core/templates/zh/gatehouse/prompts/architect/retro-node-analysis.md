# 复盘任务 · 节点 {{node_id}}

你当前在 **retro fork session**，分析的是执行期所辖分支，**不要**把分析对话混入原执行 session。

无需等待 {{architect_name}} 逐条 `send_message`。请**自主发现问题**，而非依赖 Gatehouse 预计算语义特征。

{{retro_context_snapshot}}

### 数据来源（唯一真相源）

```
.gatehouse/architect/trees/{{mission_id}}/context/
  index.json                 # 所辖分支全部 node_id、subtree-metrics 路径
  subtree-metrics.json       # 各 retro coord 所辖子树的 token/耗时/工具聚合（读 retro_nodes["{{node_id}}"]）
  <node_id>/
    messages.json            # 全量原始消息（含 tool input/output、parent）
    timeline.md              # grep 友好时间线（含 kind、tokens=）
    metrics.json             # 单节点 session 级 token/耗时/工具聚合

.gatehouse/skills/retro-toolkit/     # 历史 retro 工具与方法论（先读再分析）
  SKILL.md
  tools/<verb-noun>/SKILL.md + 脚本
```

**系统已预计算的 API 级指标**（直接读文件，无需调用工具）：

- 所辖子树汇总：`context/subtree-metrics.json` → `retro_nodes["{{node_id}}"]`
- 单节点明细：`context/<node_id>/metrics.json`

这些指标**不能**替代你从 messages/timeline 自制的语义特征提取（压缩次数、todo 段 token、send_message 模式等）。

### 推荐步骤（抽样 → 工具 → 结论）

1. 使用上方启动快照定位所辖分支；读 **`retro-toolkit/SKILL.md`**，列出节点并复用已有 `tools/` 脚本。
2. **不要通读**全部 `messages.json`。先用 `timeline.md` grep 定位异常片段（见下表）。
3. 对可疑模式：**自制或扩展 Python 脚本**提取特征（压缩次数、todo 段 token、send_message 序列等）。
4. 若新工具有复用价值：写入 `.gatehouse/skills/retro-toolkit/tools/<verb-noun>/`（含 `SKILL.md`）。
5. 用 `subtree-metrics.json` 与脚本输出交叉验证 token/耗时/工具调用统计。
6. 写 retro 报告（含工具贡献说明）→ `gatehouse_retro_record` 登记 → `gatehouse_publish_blog(report_path=...)` 发布到 Portal 博客。

**grep 指引（timeline.md）：**

| 目标 | 命令 |
|------|------|
| 用户真实输入 | `grep 'kind=user'` |
| Gatehouse 系统投递 | `grep 'kind=gatehouse'` |
| 上下文压缩 | `grep 'kind=compaction_marker'` |
| 压缩摘要 | `grep 'kind=summary'` |
| 向上级/队友汇报 | `grep 'tool=gatehouse_send_message'` |
| Todo 变更 | `grep 'tool=todowrite'` |
| 高 token 轮次 | `grep 'tokens='` |

**messages.json 脚本提示：** 顶层 `messages` 数组；assistant 的 token 在 `info.tokens`；tool 在 `parts[]` 且 `type=tool`。

### 输出

写文件：`.gatehouse/architect/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md`

**报告面向{{architect_name}}（任务分配与 prompt 约束），不要写领域 skill 或业务实现细节。**

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
- teamspec constraints 是否被遵守、过松/过紧：
- 子节点 prompt 是否导致重复劳动或职责重叠：

## 协调与拓扑（给 {{architect_name}} architect-meta）
- send_message / 等待 / 拓扑建议：

## 给{{architect_name}}的可执行建议（3–5 条）
（仅任务分配、拓扑、prompt 模板、约束措辞）

## 工具贡献（必须填写）
| 项 | 内容 |
|----|------|
| 是否新增/改进 retro 工具 | 是 / 否 |
| 工具路径 | `.gatehouse/skills/retro-toolkit/tools/...` 或「无」 |
| 建议{{architect_name}}是否 promote 进 toolkit | 是 / 否 / 不适用 |
| 简要说明 | |
```

### 登记完成（必须）

```
gatehouse_retro_record()
gatehouse_publish_blog(report_path=".gatehouse/architect/trees/{{mission_id}}/reports/nodes/{{node_id}}-retro.md")
```

**不要** `gatehouse_send_message` 联系{{architect_name}} — 全部节点登记后 Gatehouse 会自动通知{{architect_name}}汇总（含各 retro 报告与 retro-toolkit 整理任务）。
