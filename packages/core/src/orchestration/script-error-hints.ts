/** Short fix hints returned to architect on mission.script.ts dry-run failures. */
export function missionScriptErrorHint(code: string): string | undefined {
  switch (code) {
    case "SCRIPT_SERIAL_TRACK_BLOCK":
      return (
        "Wrap each independent root-child track in ctx.fork([async () => { ... }, ...]); " +
        "do not await one track's completion before dispatching the next track at top level."
      )
    case "SCRIPT_SIMULATION_INCOMPLETE":
      return (
        "Every node in team.nodes (including root) must be activated and completed via ctx.run " +
        "(or ctx.run(..., { wait: false }) followed by ctx.join)."
      )
    case "SCRIPT_MISSING_BRIEF":
      return "Add brief: { your_work: [...], acceptance_slice: [...] } to each ctx.run dispatch."
    case "SCRIPT_INVALID_ROLLUP":
      return (
        "rollupFrom must list descendant node_ids of the coordinator only; " +
        "use ctx.run(coordinator, { rollupFrom: [...] }) on a single node after children complete."
      )
    case "SCRIPT_ROLLUP_ON_FANOUT":
      return "rollupFrom is ignored on ctx.run([...]); rollup on a single coordinator run after the fan-out finishes."
    case "SCRIPT_PLAN_DYNAMIC_TOP_LEVEL":
      return "Use explicit top-level await ctx.run/join steps or ctx.fork tracks instead of for/while loops."
    case "SCRIPT_FORBIDDEN_CTX_READ":
      return "Inline static context in run brief or work-order text; do not call ctx.readMissionContext or ctx.readContract."
    case "SCRIPT_RISKY_STRING_LITERAL":
      return "Use template literals or single quotes for context/note when the value contains gatehouse_."
    case "SCRIPT_LEGACY_API":
      return "Use ctx.run / ctx.join / ctx.fork only; legacy setBrief/prompt/waitFor APIs were removed."
    case "SCRIPT_FORBIDDEN_IMPORT":
      return "mission.script.ts must not import modules; orchestrate via ctx.* only."
    case "SCRIPT_INVALID_ORCHESTRATE_SYNTAX":
      return "Fix JavaScript syntax in orchestrate(); avoid // comments between top-level await ctx.* steps."
    default:
      return undefined
  }
}
