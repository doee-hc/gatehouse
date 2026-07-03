/**
 * Gatehouse smoke 示例：terminal 汇总 node-root + node-doc 叶子。
 * 复制到 `.gatehouse/trees/core-example-smoke-v1/mission.script.ts` 后走 submit_orchestration 流程。
 */

export const team = {
  mission_id: "core-example-smoke-v1",
  terminal: "node-root",
  nodes: {
    "node-root": {
      description: "Mission 汇总节点，汇总验收 node-doc 交付并向上汇报",
    },
    "node-doc": {
      description: "文档执行成员，负责 README 示例章节",
    },
  },
}

export const meta = {
  name: "core-example-smoke-v1",
}

/** 顺序编排：先 leaf 后 root 汇总 */
export default async function orchestrate(ctx: {
  run(
    nodeId: string,
    input: {
      brief?: {
        your_work?: string[]
        not_your_job?: string[]
        acceptance_slice?: string[]
        role?: string
      }
      text?: string
      dependsOn?: Array<string | { node: string; summary?: boolean }>
    },
  ): Promise<void>
  template: {
    workOrder(nodeId: string, opts?: { context?: string; note?: string }): string
  }
}) {
  await ctx.run("node-doc", {
    brief: {
      role: "文档执行成员",
      not_your_job: ["不新增 plugin tool", "不修改 gatehouse-plugin"],
      your_work: ["撰写 packages/core/README.md「示例 Mission」章节"],
      acceptance_slice: ["path: packages/core/README.md", "README 含示例 Mission 章节且可被解析"],
    },
    text: ctx.template.workOrder("node-doc", {
      note: `完成 README 示例章节后 gatehouse_execution_complete`,
    }),
  })

  await ctx.run("node-root", {
    brief: {
      role: "Mission 汇总节点",
      not_your_job: ["不新增 plugin tool", "不修改 packages/gatehouse-plugin"],
      your_work: [
        "汇总验收 node-doc 交付",
        "核对 node-doc completion 后 gatehouse_execution_complete（全树 done 时自动通知 lead）",
      ],
      acceptance_slice: ["delivery 已提交且 lead 可验收"],
    },
    text: ctx.template.workOrder("node-root"),
    dependsOn: [{ node: "node-doc", summary: true }],
  })
}
