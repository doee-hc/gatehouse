# 编排器停滞

Mission **{{mission_id}}** 编排已停滞 {{stale_minutes}} 分钟未推进（当前 phase：**{{phase}}**）。

## 请立即处理

1. 阅读 `.gatehouse/trees/{{mission_id}}/mission.script.ts`，确认 **无** 双引号字符串内嵌未转义 `"`；并行轨道用 `ctx.fork`，依赖与等待用 `ctx.run` 的 `dependsOn`。
2. 修复后调用 **gatehouse_submit_orchestration**。
3. 若提交失败且脚本已大改，修复脚本或联系 {{lead_name}} 后再重启。
4. 用 **gatehouse_execution_status** 核对节点状态。

**勿**跳过未完成编排 — 先完成脚本修复并重新提交。
