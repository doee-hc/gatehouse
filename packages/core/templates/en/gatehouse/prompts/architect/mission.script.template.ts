export const team = {
  mission_id: "<mission_id>",
  terminal: "<terminal-node-id>",
  nodes: {
    "<leaf-a>": {
      description: "Executes <deliverable A>",
    },
    "<leaf-b>": {
      description: "Executes <deliverable B>",
    },
    "<terminal-node-id>": {
      description: "Integrates upstream work into the final mission deliverable",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["Parallel execution", "Final delivery"],
}

export default async function orchestrate(ctx) {
  await ctx.parallel([
    async () => {
      await ctx.run("<leaf-a>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["Not this node's job (avoid sibling overlap)"],
          acceptance_slice: ["path: <leaf-a>/", "path: reports/<leaf-a>.json", "…"],
        },
      })
    },
    async () => {
      await ctx.run("<leaf-b>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["Not this node's job (avoid sibling overlap)"],
          acceptance_slice: ["path: <leaf-b>/", "path: reports/<leaf-b>.json", "…"],
        },
      })
    },
  ])

  await ctx.run("<terminal-node-id>", {
    brief: {
      your_work: ["Read upstream reports and produce the final mission deliverable"],
      acceptance_slice: ["path: reports/<mission_id>.html", "…"],
    },
    text: `Upstream nodes are done; work order lists each node's acceptance_slice paths — read those paths and deliver the final artifact.`,
    dependsOn: [{ node: "<leaf-a>", deliverable: true }, { node: "<leaf-b>", deliverable: true }],
  })
}
