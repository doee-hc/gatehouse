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
  ctx.phase("Parallel phase")

  await ctx.setBrief("<leaf-a>", {
    your_work: ["…"],
    not_your_job: ["Out of scope for this node (avoid sibling overlap)"],
    acceptance_slice: ["path: reports/<leaf-a>.md", "…"],
  })
  await ctx.setBrief("<leaf-b>", {
    your_work: ["…"],
    not_your_job: ["Out of scope for this node (avoid sibling overlap)"],
    acceptance_slice: ["path: reports/<leaf-b>.md", "…"],
  })

  await ctx.parallel([
    async () => {
      await ctx.prompt("<leaf-a>", { text: ctx.template.workOrder("<leaf-a>"), reply: true })
      await ctx.waitFor("<leaf-a>", "complete")
    },
    async () => {
      await ctx.prompt("<leaf-b>", { text: ctx.template.workOrder("<leaf-b>"), reply: true })
      await ctx.waitFor("<leaf-b>", "complete")
    },
  ])

  ctx.phase("Rollup phase")
  await ctx.setBrief("<root-node-id>", {
    your_work: ["Roll up child deliveries and verify acceptance"],
    acceptance_slice: ["path: …", "…"],
  })
  await ctx.prompt("<root-node-id>", {
    text: ctx.template.workOrder("<root-node-id>", {
      context: `Child nodes are done. Read reports/<leaf-a>.md and reports/<leaf-b>.md, then verify acceptance.`,
    }),
    reply: true,
    rollupFrom: ["<leaf-a>", "<leaf-b>"],
  })
  await ctx.waitFor("<root-node-id>", "complete")
}
