export type JsonSchema = Record<string, unknown>

export class JsonSchemaValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = "JsonSchemaValidationError"
  }
}

function schemaType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function assertType(path: string, value: unknown, expected: string) {
  const actual = schemaType(value)
  if (expected === "integer") {
    if (actual !== "number" || !Number.isInteger(value as number)) {
      throw new JsonSchemaValidationError(path, `expected integer, got ${actual}`)
    }
    return
  }
  if (actual !== expected) {
    throw new JsonSchemaValidationError(path, `expected ${expected}, got ${actual}`)
  }
}

function validateAt(path: string, value: unknown, schema: JsonSchema) {
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.some((item) => Object.is(item, value))) {
      throw new JsonSchemaValidationError(path, "value not in enum")
    }
    return
  }

  const type = typeof schema.type === "string" ? schema.type : undefined
  if (type) assertType(path, value, type)

  if (type === "object" || (type === undefined && value && typeof value === "object" && !Array.isArray(value))) {
    if (schemaType(value) !== "object") {
      throw new JsonSchemaValidationError(path, "expected object")
    }
    const record = value as Record<string, unknown>
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, JsonSchema>)
        : undefined
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
    for (const key of required) {
      if (!(key in record)) {
        throw new JsonSchemaValidationError(path ? `${path}.${key}` : key, "required property missing")
      }
    }
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in record) {
          validateAt(path ? `${path}.${key}` : key, record[key], propSchema)
        }
      }
    }
    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          throw new JsonSchemaValidationError(path ? `${path}.${key}` : key, "additional property not allowed")
        }
      }
    }
    return
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      throw new JsonSchemaValidationError(path, "expected array")
    }
    const items = schema.items as JsonSchema | undefined
    if (items) {
      value.forEach((item, index) => {
        validateAt(`${path}[${index}]`, item, items)
      })
    }
  }
}

export function validateJsonSchema(value: unknown, schema: JsonSchema) {
  validateAt("", value, schema)
}

/** Minimal mock for orchestration simulation when completion_schema is set. */
export function mockStructuredFromSchema(schema: JsonSchema): unknown {
  const type = typeof schema.type === "string" ? schema.type : undefined
  if (type === "array") {
    return []
  }
  if (type === "string") {
    return "mock"
  }
  if (type === "number" || type === "integer") {
    return 0
  }
  if (type === "boolean") {
    return false
  }
  if (type === "object" || schema.properties) {
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, JsonSchema>)
        : {}
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(properties)
    const out: Record<string, unknown> = {}
    for (const key of required) {
      const propSchema = properties[key]
      out[key] = propSchema ? mockStructuredFromSchema(propSchema) : null
    }
    return out
  }
  return {}
}
