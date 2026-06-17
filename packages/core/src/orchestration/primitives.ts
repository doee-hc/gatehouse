/** Barrier-style parallel execution for orchestration tracks (inspired by Claude Code workflows). */
export async function orchestrationParallel<T>(
  thunks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (thunks.length === 0) return []
  return Promise.all(thunks.map((thunk) => thunk()))
}
