export const team = {
  mission_id: "<mission_id>",
  terminal: "<terminal-node-id>",
  nodes: {
    "<leaf-a>": {
      description: "负责 <产出 A> 的执行成员",
    },
    "<leaf-b>": {
      description: "负责 <产出 B> 的执行成员",
    },
    "<terminal-node-id>": {
      description: "整合上游成果，产出 Mission 最终交付物",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["并行执行", "最终交付"],
}

export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("<leaf-a>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["非本节点职责（避免与 sibling 重叠）"],
          acceptance_slice: ["path: reports/<leaf-a>.md", "…"],
        },
      })
    },
    async () => {
      await ctx.run("<leaf-b>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["非本节点职责（避免与 sibling 重叠）"],
          acceptance_slice: ["path: reports/<leaf-b>.md", "…"],
        },
      })
    },
  ])

  await ctx.run("<terminal-node-id>", {
    brief: {
      your_work: ["阅读上游报告，产出 Mission 最终交付物"],
      acceptance_slice: ["path: reports/<mission_id>.html", "…"],
    },
    text: `上游节点已完成，请阅读 reports/<leaf-a>.md 与 reports/<leaf-b>.md 并交付最终产出。`,
    dependsOn: [{ node: "<leaf-a>", deliverable: true }, { node: "<leaf-b>", deliverable: true }],
  })
}
