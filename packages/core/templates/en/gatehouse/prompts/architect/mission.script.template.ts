export const team = {
  mission_id: "<mission_id>",
  root: "<root-node-id>",
  nodes: {
    "<root-node-id>": {
      parent: null,
      description: "Mission coordinator — roll up child deliveries and verify acceptance",
    },
    "<leaf-a>": {
      parent: "<root-node-id>",
      description: "Executes <deliverable A>",
    },
    "<leaf-b>": {
      parent: "<root-node-id>",
      description: "Executes <deliverable B>",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["Parallel phase", "Rollup phase"],
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
          not_your_job: ["Out of scope for this node (avoid sibling overlap)"],
          acceptance_slice: ["path: reports/<leaf-a>.md", "…"],
        },
        text: ctx.template.workOrder("<leaf-a>"),
      })
    },
    async () => {
      await ctx.run("<leaf-b>", {
        brief: {
          your_work: ["…"],
          not_your_job: ["Out of scope for this node (avoid sibling overlap)"],
          acceptance_slice: ["path: reports/<leaf-b>.md", "…"],
        },
        text: ctx.template.workOrder("<leaf-b>"),
      })
    },
  ])

  await ctx.run("<root-node-id>", {
    brief: {
      your_work: ["Roll up child deliveries and verify acceptance"],
      acceptance_slice: ["path: …", "…"],
    },
    text: ctx.template.workOrder("<root-node-id>", {
      context: `Child nodes are done. Read reports/<leaf-a>.md and reports/<leaf-b>.md, then verify acceptance.`,
    }),
    rollupFrom: ["<leaf-a>", "<leaf-b>"],
  })
}
