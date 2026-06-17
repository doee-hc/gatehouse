export const team = {
  mission_id: "<mission_id>",
  root: "<root-node-id>",
  nodes: {
    "<root-node-id>": {
      parent: null,
      description: "任务协调者，汇总子节点交付并验收",
    },
    "<leaf-a>": {
      parent: "<root-node-id>",
      description: "负责 <产出 A> 的执行成员",
    },
    "<leaf-b>": {
      parent: "<root-node-id>",
      description: "负责 <产出 B> 的执行成员",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["并行阶段", "汇总阶段"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
}

export default async function orchestrate(ctx) {
  await ctx.fork([
    async () => {
      await ctx.run("<leaf-a>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["非本节点职责（避免与 sibling 重叠）"],
          acceptance_slice: ["path: reports/<leaf-a>.md", "…"],
        },
        text: ctx.template.workOrder("<leaf-a>"),
      })
    },
    async () => {
      await ctx.run("<leaf-b>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["非本节点职责（避免与 sibling 重叠）"],
          acceptance_slice: ["path: reports/<leaf-b>.md", "…"],
        },
        text: ctx.template.workOrder("<leaf-b>"),
      })
    },
  ])

  await ctx.run("<root-node-id>", {
    brief: {
      your_work: ["汇总子节点交付并验收"],
      acceptance_slice: ["path: …", "…"],
    },
    text: ctx.template.workOrder("<root-node-id>", {
      context: `子节点已完成，请阅读 reports/<leaf-a>.md 与 reports/<leaf-b>.md 并验收。`,
    }),
    rollupFrom: ["<leaf-a>", "<leaf-b>"],
  })
}
