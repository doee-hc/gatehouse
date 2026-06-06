import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tryServePortalUi } from "../src/portal/static-ui.ts"
import { gatehousePackageRoot } from "../src/setup/package.ts"

describe("portal static ui", () => {
  test("serves index when dist/portal exists", async () => {
    const packageRoot = gatehousePackageRoot()
    const portalIndex = path.join(packageRoot, "dist", "portal", "index.html")
    if (!(await Bun.file(portalIndex).exists())) return

    const response = tryServePortalUi(packageRoot, new URL("http://127.0.0.1/"), "GET")
    expect(response?.status).toBe(200)
    expect(response?.headers.get("Content-Type")).toContain("text/html")
  })
})
