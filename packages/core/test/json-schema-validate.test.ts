import { describe, expect, test } from "bun:test"
import {
  mockStructuredFromSchema,
  validateJsonSchema,
} from "../src/orchestration/json-schema-validate.ts"

describe("validateJsonSchema", () => {
  test("accepts object matching required properties", () => {
    validateJsonSchema(
      { files: ["a.ts"] },
      {
        type: "object",
        required: ["files"],
        properties: { files: { type: "array", items: { type: "string" } } },
      },
    )
  })

  test("rejects missing required property", () => {
    expect(() =>
      validateJsonSchema(
        {},
        {
          type: "object",
          required: ["files"],
          properties: { files: { type: "array" } },
        },
      ),
    ).toThrow(/required property missing/)
  })

  test("rejects additional properties when disabled", () => {
    expect(() =>
      validateJsonSchema(
        { files: [], extra: true },
        {
          type: "object",
          additionalProperties: false,
          required: ["files"],
          properties: { files: { type: "array" } },
        },
      ),
    ).toThrow(/additional property not allowed/)
  })
})

describe("mockStructuredFromSchema", () => {
  test("builds nested object from schema", () => {
    const mock = mockStructuredFromSchema({
      type: "object",
      required: ["routes"],
      properties: {
        routes: {
          type: "array",
          items: {
            type: "object",
            required: ["path"],
            properties: { path: { type: "string" } },
          },
        },
      },
    })
    expect(mock).toEqual({ routes: [] })
  })
})
