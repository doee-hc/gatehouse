/** Barrier-style parallel execution for orchestration tracks (inspired by Claude Code workflows). */
export async function orchestrationParallel<T>(
  thunks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (thunks.length === 0) return []
  return Promise.all(thunks.map((thunk) => thunk()))
}

/** Stream each item through stages independently without cross-item barriers. */
export async function orchestrationPipeline<T>(
  items: readonly T[],
  ...stages: ReadonlyArray<(value: unknown, index: number) => Promise<unknown>>
): Promise<unknown[]> {
  if (stages.length === 0) return [...items]
  return Promise.all(
    items.map(async (item, index) => {
      let current: unknown = item
      for (const stage of stages) {
        current = await stage(current, index)
      }
      return current
    }),
  )
}
