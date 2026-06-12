// 复制到 .gatehouse/trees/<mission_id>/mission.script.ts
// 详见 architect-meta skill

export const team = {
  mission_id: "<mission_id>",
  root: "<root-node-id>",
  nodes: {
    "<root-node-id>": {
      parent: null,
      description: "任务协调者",
    },
  },
}

export const meta = {
  name: "<mission_id>",
  phases: ["阶段一"],
  rework: {
    peer_allowed: true,
    escalate_to: "root" as const,
    allow_coordinator_rework: true,
  },
}

export default async function orchestrate(ctx) {
  // setBrief → prompt(reply:true) → waitFor
}
