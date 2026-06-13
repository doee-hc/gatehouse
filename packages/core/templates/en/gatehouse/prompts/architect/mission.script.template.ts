// Copy to .gatehouse/trees/<mission_id>/mission.script.ts
// See architect-meta skill

export const team = {
  mission_id: "<mission_id>",
  root: "<root-node-id>",
  nodes: {
    "<root-node-id>": {
      parent: null,
      description: "Mission coordinator",
    },
    "<leaf-id>": {
      parent: "<root-node-id>",
      description: "Executes <concrete deliverable>",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["Phase one"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
}

export default async function orchestrate(ctx) {
  // Recommended: setBrief (path + hard word band + not_your_job) → prompt(reply:true) → waitFor / waitForAll
  await ctx.setBrief("<leaf-id>", {
    your_work: ["…"],
    not_your_job: ["Out of scope for this node (avoid sibling overlap)"],
    acceptance_slice: [
      "path: reports/<leaf-id>.md",
      "1500–1800 words markdown, one-shot within ±10%",
    ],
  })
  await ctx.prompt("<leaf-id>", {
    text: ctx.template.workOrder("<leaf-id>"),
    reply: true,
  })
  await ctx.waitFor("<leaf-id>", "complete")
}
