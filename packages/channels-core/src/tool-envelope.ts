export function toolOk<T>(tool: string, data: T) {
  return JSON.stringify(
    {
      ok: true,
      tool,
      data,
      error: null,
      meta: { generated_at: new Date().toISOString(), schema_version: 1 },
    },
    null,
    2,
  )
}

export function toolFail(tool: string, code: string, message: string, details?: Record<string, unknown>) {
  return JSON.stringify(
    {
      ok: false,
      tool,
      data: null,
      error: { code, message, details: details ?? {} },
      meta: { generated_at: new Date().toISOString(), schema_version: 1 },
    },
    null,
    2,
  )
}

export function gatehouseToolMetadata(tool: string, plugin: string, status: "ok" | "error") {
  return {
    metadata: {
      gatehouse: {
        plugin,
        tool,
        status,
      },
    },
  }
}
