/**
 * Gatehouse smoke 示例：root 协调 + node-doc 叶子。
 * 复制到 `.gatehouse/trees/core-example-smoke-v1/mission.script.ts` 后走 bootstrap 流程。
 */

export const team = {
  mission_id: "core-example-smoke-v1",
  root: "node-root",
  nodes: {
    "node-root": {
      parent: null,
      description: "Mission 任务协调者，分派 node-doc 并汇总交付",
    },
    "node-doc": {
      parent: "node-root",
      description: "文档执行成员，负责 README 示例章节",
    },
  },
}

export const meta = {
  name: "core-example-smoke-v1",
  phases: ["派发文档", "汇总交付"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
}

/** 顺序编排：先 leaf 后 root 汇总 */
export default async function orchestrate(ctx: {
  phase(title: string): void
  setBrief(
    nodeId: string,
    partial: {
      your_work?: string[]
      not_your_job?: string[]
      acceptance_slice?: string[]
      role?: string
    },
  ): Promise<void>
  prompt(
    nodeId: string,
    input: { text?: string; reply?: boolean; rollupFrom?: string[] },
  ): Promise<void>
  waitFor(nodeId: string, event: "complete"): Promise<void>
  template: {
    workOrder(nodeId: string, opts?: { context?: string; note?: string }): string
  }
}) {
  ctx.phase("派发文档")
  await ctx.setBrief("node-doc", {
    role: "文档执行成员",
    not_your_job: ["不新增 plugin tool", "不修改 gatehouse-plugin"],
    your_work: ["撰写 packages/core/README.md「示例 Mission」章节"],
    acceptance_slice: ["README 含示例 Mission 章节且可被解析"],
  })
  await ctx.prompt("node-doc", {
    text: ctx.template.workOrder("node-doc", {
      note: "完成 README 示例章节后 gatehouse_execution_complete",
    }),
    reply: true,
  })
  await ctx.waitFor("node-doc", "complete")

  ctx.phase("汇总交付")
  await ctx.setBrief("node-root", {
    role: "Mission 任务协调者",
    not_your_job: ["不新增 plugin tool", "不修改 packages/gatehouse-plugin"],
    your_work: [
      "按协作脚本工单执行",
      "核对 node-doc completion 后 gatehouse_execution_complete（全树 done 时自动通知 lead）",
    ],
    acceptance_slice: ["delivery 已提交且 lead 可验收"],
  })
  await ctx.prompt("node-root", {
    text: ctx.template.workOrder("node-root"),
    reply: true,
    rollupFrom: ["node-doc"],
  })
  await ctx.waitFor("node-root", "complete")
}
