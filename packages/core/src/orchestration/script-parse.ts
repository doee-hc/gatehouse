import ts from "typescript"
import { createHash } from "node:crypto"
import type { MissionScriptMeta } from "./types.ts"
import type { TeamSpec } from "../tree/types.ts"

export const MISSION_SCRIPT_MAX_BYTES = 256 * 1024

export class MissionScriptParseError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "MissionScriptParseError"
    this.code = code
  }
}

export type ParsedMissionScript = {
  team: TeamSpec
  meta?: MissionScriptMeta
  orchestrateSource?: string
  scriptSource: string
  scriptHash: string
}

export function hashMissionScriptSource(source: string) {
  return createHash("sha256").update(source).digest("hex")
}

export function parseMissionScriptSource(source: string, expectedMissionId?: string): ParsedMissionScript {
  if (source.length > MISSION_SCRIPT_MAX_BYTES) {
    throw new MissionScriptParseError("SCRIPT_TOO_LARGE", `mission.script.ts exceeds ${MISSION_SCRIPT_MAX_BYTES} bytes`)
  }

  const sourceFile = ts.createSourceFile(
    "mission.script.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  assertNoForbiddenSyntax(sourceFile, source)

  let team: TeamSpec | undefined
  let meta: MissionScriptMeta | undefined
  let orchestrateSource: string | undefined

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (decl.name.text === "team") {
          team = astToJsonValue(decl.initializer, source) as TeamSpec
        }
        if (decl.name.text === "meta") {
          meta = astToJsonValue(decl.initializer, source) as MissionScriptMeta
        }
      }
    }

    if (isDefaultExportFunction(stmt)) {
      const body = stmt.body
      if (!body || !ts.isBlock(body)) {
        throw new MissionScriptParseError("SCRIPT_INVALID_ORCHESTRATE", "export default must be a function with a body")
      }
      const start = body.getStart(sourceFile) + 1
      const end = body.getEnd() - 1
      orchestrateSource = source.slice(start, end).trim()
    }
  }

  if (!team) {
    throw new MissionScriptParseError("SCRIPT_INVALID_TEAM", "mission.script.ts must export const team")
  }
  if (expectedMissionId && team.mission_id !== expectedMissionId) {
    throw new MissionScriptParseError(
      "SCRIPT_MISSION_MISMATCH",
      `team.mission_id ${team.mission_id} does not match expected ${expectedMissionId}`,
    )
  }

  return {
    team,
    ...(meta && { meta }),
    ...(orchestrateSource && { orchestrateSource }),
    scriptSource: source,
    scriptHash: hashMissionScriptSource(source),
  }
}

function hasExportModifier(node: ts.Node) {
  return (
    ts.canHaveModifiers(node) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  )
}

function isDefaultExportFunction(stmt: ts.Statement): stmt is ts.FunctionDeclaration {
  if (!ts.isFunctionDeclaration(stmt)) return false
  const modifiers = stmt.modifiers ?? []
  const isExport = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  return isExport && isDefault
}

function assertNoForbiddenSyntax(sourceFile: ts.SourceFile, _source: string) {
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      throw new MissionScriptParseError("SCRIPT_FORBIDDEN_IMPORT", "import declarations are not allowed in mission.script.ts")
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile)
      if (callee === "import" || callee === "require" || callee === "eval") {
        throw new MissionScriptParseError("SCRIPT_FORBIDDEN_IMPORT", `${callee}() is not allowed in mission.script.ts`)
      }
      if (callee === "Function") {
        throw new MissionScriptParseError("SCRIPT_FORBIDDEN_CALL", "Function constructor is not allowed in mission.script.ts")
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "Function") {
      throw new MissionScriptParseError("SCRIPT_FORBIDDEN_CALL", "Function constructor is not allowed in mission.script.ts")
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function astToJsonValue(node: ts.Expression, source: string): unknown {
  const unwrapped = unwrapExpression(node)
  if (ts.isAsExpression(unwrapped) || ts.isTypeAssertionExpression(unwrapped)) {
    return astToJsonValue(unwrapped.expression, source)
  }
  if (ts.isParenthesizedExpression(unwrapped)) {
    return astToJsonValue(unwrapped.expression, source)
  }
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text
  }
  if (ts.isTemplateExpression(unwrapped)) {
    if (unwrapped.templateSpans.length > 0) {
      throw new MissionScriptParseError("SCRIPT_UNSUPPORTED_LITERAL", "template expressions with substitutions are not allowed in team/meta")
    }
    return unwrapped.head.text
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text)
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.MinusToken) {
    const operand = unwrapped.operand
    if (ts.isNumericLiteral(operand)) return -Number(operand.text)
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map((element) => {
      if (ts.isOmittedExpression(element)) {
        throw new MissionScriptParseError("SCRIPT_UNSUPPORTED_LITERAL", "omitted array elements are not allowed")
      }
      return astToJsonValue(element, source)
    })
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    const record: Record<string, unknown> = {}
    for (const prop of unwrapped.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = propertyName(prop.name, source)
        record[key] = astToJsonValue(prop.initializer, source)
        continue
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        throw new MissionScriptParseError(
          "SCRIPT_UNSUPPORTED_LITERAL",
          "shorthand object properties are not allowed in team/meta",
        )
      }
      throw new MissionScriptParseError("SCRIPT_UNSUPPORTED_LITERAL", "unsupported object property in team/meta")
    }
    return record
  }
  throw new MissionScriptParseError(
    "SCRIPT_UNSUPPORTED_LITERAL",
    `unsupported literal in team/meta: ${unwrapped.getText().slice(0, 80)}`,
  )
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression)
  }
  return node
}

function propertyName(name: ts.PropertyName, source: string): string {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isNumericLiteral(name)) return name.text
  throw new MissionScriptParseError("SCRIPT_UNSUPPORTED_LITERAL", `unsupported property name: ${name.getText()}`)
}
