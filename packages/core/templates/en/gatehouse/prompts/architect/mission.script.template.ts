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
  // setBrief → prompt(reply:true) → waitFor
}
