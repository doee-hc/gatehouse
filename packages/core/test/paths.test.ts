import { expect, test } from "bun:test"
import { nodeDisplayLabel, portalNodeDisplayName, sessionTitle } from "../src/paths.ts"

test("nodeDisplayLabel strips node- prefix", () => {
  expect(nodeDisplayLabel("node-root")).toBe("root")
  expect(nodeDisplayLabel("lead")).toBe("lead")
})

test("sessionTitle omits mission id", () => {
  expect(sessionTitle("core-example-smoke-v1", "node-doc")).toBe("doc")
  expect(sessionTitle("m1", "node-root", true)).toBe("[retro] root")
})

test("portalNodeDisplayName uses display_name or node label", () => {
  expect(portalNodeDisplayName("node-doc", "doc")).toBe("doc")
  expect(portalNodeDisplayName("node-doc")).toBe("doc")
  expect(portalNodeDisplayName("node-doc", "自定义名")).toBe("自定义名")
})
