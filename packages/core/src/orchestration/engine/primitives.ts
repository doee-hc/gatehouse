/** Barrier-style parallel execution for orchestration tracks (inspired by Claude Code workflows). */
export async function orchestrationParallel<T>(
  thunks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (thunks.length === 0) return []
  return Promise.all(thunks.map((thunk) => thunk()))
}

type PipelineStage<T, R> = (prev: R, item: T, index: number) => Promise<R>

/**
 * Stream items through stages with no barrier between stages (inspired by Claude Code pipeline).
 * Each item runs all stages independently; item A may be in stage 2 while item B is still in stage 1.
 * A failing stage resolves that item to null (other items continue).
 */
export async function orchestrationPipeline<T, R>(
  items: readonly T[],
  firstStage: (item: T, index: number) => Promise<R>,
  ...restStages: ReadonlyArray<PipelineStage<T, R>>
): Promise<(R | null)[]> {
  if (items.length === 0) return []
  if (restStages.length === 0) {
    return Promise.all(
      items.map(async (item, index) => {
        try {
          return await firstStage(item, index)
        } catch {
          return null
        }
      }),
    )
  }

  return Promise.all(
    items.map(async (item, index) => {
      try {
        let prev = await firstStage(item, index)
        for (const stage of restStages) {
          prev = await stage(prev, item, index)
        }
        return prev
      } catch {
        return null
      }
    }),
  )
}
