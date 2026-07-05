export type NodeBrief = {
  node_id: string
  role?: string
  your_work: string[]
  not_your_job: string[]
  acceptance_slice: string[]
  activation?: { mode?: string }
  /** JSON Schema for structured_output on gatehouse_execution_complete. */
  completion_schema?: Record<string, unknown>
}
