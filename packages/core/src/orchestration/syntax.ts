export function compileOrchestrateSource(orchestrateSource: string) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (ctx: unknown) => Promise<void>
  return new AsyncFunction("ctx", orchestrateSource)
}

export function validateOrchestrateSyntax(orchestrateSource: string) {
  try {
    compileOrchestrateSource(orchestrateSource)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false as const, message }
  }
  return { ok: true as const }
}
