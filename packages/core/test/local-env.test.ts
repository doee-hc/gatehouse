import { afterEach, describe, expect, test } from "bun:test"
import { localDevEnv } from "../src/dev/local-env.ts"

const saved = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  no_proxy: process.env.no_proxy,
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("localDevEnv", () => {
  test("keeps HTTP(S)_PROXY and merges local NO_PROXY entries", () => {
    const savedProxy = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    }
    try {
      process.env.HTTP_PROXY = "http://127.0.0.1:7890"
      process.env.HTTPS_PROXY = "http://127.0.0.1:7890"
      process.env.NO_PROXY = "example.com"

      const env = localDevEnv({ GATEHOUSE_DEV: "1" })

      expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890")
      expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890")
      expect(env.NO_PROXY).toContain("example.com")
      expect(env.NO_PROXY).toContain("127.0.0.1")
      expect(env.NO_PROXY).toContain("localhost")
      expect(env.no_proxy).toBe(env.NO_PROXY)
      expect(env.GATEHOUSE_DEV).toBe("1")
    } finally {
      for (const [key, value] of Object.entries(savedProxy)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
