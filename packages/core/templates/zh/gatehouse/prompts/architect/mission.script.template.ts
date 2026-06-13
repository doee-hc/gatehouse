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
    "<leaf-id>": {
      parent: "<root-node-id>",
      description: "负责 <具体产出> 的执行成员",
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
  // 推荐：setBrief（含 path + 字数硬区间 + not_your_job）→ prompt(reply:true) → waitFor / waitForAll
  await ctx.setBrief("<leaf-id>", {
    your_work: ["…"],
    not_your_job: ["非本节点职责（避免与 sibling 重叠）"],
    acceptance_slice: [
      "path: reports/<leaf-id>.md",
      "1500–1800 字 markdown，±10% 内一次性交付",
    ],
  })
  await ctx.prompt("<leaf-id>", {
    text: ctx.template.workOrder("<leaf-id>"),
    reply: true,
  })
  await ctx.waitFor("<leaf-id>", "complete")
}
