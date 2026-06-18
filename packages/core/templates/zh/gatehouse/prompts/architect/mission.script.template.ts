export const team = {
  mission_id: "<mission_id>",
  root: "<terminal-node-id>",
  nodes: {
    "<leaf-a>": {
      parent: "<terminal-node-id>",
      description: "负责 <产出 A> 的执行成员",
    },
    "<leaf-b>": {
      parent: "<terminal-node-id>",
      description: "负责 <产出 B> 的执行成员",
    },
    "<terminal-node-id>": {
      parent: null,
      description: "整合上游成果，产出 Mission 最终交付物",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["并行执行", "最终交付"],
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

  await ctx.run("<terminal-node-id>", {
    brief: {
      your_work: ["阅读上游报告，产出 Mission 最终交付物"],
      acceptance_slice: ["path: reports/<mission_id>.html", "…"],
    },
    text: ctx.template.workOrder("<terminal-node-id>", {
      context: `上游节点已完成，请阅读 reports/<leaf-a>.md 与 reports/<leaf-b>.md 并交付最终产出。`,
    }),
    dependsOn: [{ node: "<leaf-a>", summary: true }, { node: "<leaf-b>", summary: true }],
  })
}
