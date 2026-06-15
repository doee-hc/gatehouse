/** Compile a single orchestration plan step the same way sandbox-worker replays it. */
export function wrapPlanStepStatement(statement: string) {
  return `return (async () => { ${statement.trimEnd()}\n })()`
}

export function compilePlanStepStatement(statement: string) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (ctx: unknown) => Promise<unknown>
  return new AsyncFunction("ctx", wrapPlanStepStatement(statement))
}

export function validatePlanStepStatement(statement: string) {
  try {
    compilePlanStepStatement(statement)
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false as const, message }
  }
}
