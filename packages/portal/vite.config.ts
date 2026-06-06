import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"
import { DEFAULT_PORTAL_ADMIN_PORT, DEFAULT_PORTAL_DISPLAY_PORT } from "../core/src/portal/defaults.ts"
import { portalAdminRuntimeUrl, portalRuntimeUrl } from "../core/src/portal/runtime-info.ts"

const portalRoot = path.dirname(fileURLToPath(import.meta.url))

function portalApiFromEnv(env: Record<string, string>) {
  const displayPort = env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)
  return (env.GATEHOUSE_PORTAL_API ?? portalRuntimeUrl(Number(displayPort))).replace(/\/$/, "")
}

function portalAdminApiFromEnv(env: Record<string, string>) {
  const adminPort = env.GATEHOUSE_PORTAL_ADMIN_PORT ?? String(DEFAULT_PORTAL_ADMIN_PORT)
  return (
    env.GATEHOUSE_PORTAL_ADMIN_API ?? portalAdminRuntimeUrl(Number(adminPort)).replace(/\/admin$/, "")
  )
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "")
  const middlewareMode = process.env.GATEHOUSE_PORTAL_VITE_MIDDLEWARE === "1"
  const projectDir = env.VITE_GATEHOUSE_PROJECT_DIR ?? env.GATEHOUSE_PROJECT_DIR ?? ""
  const portalApi = portalApiFromEnv(env)
  const portalAdminApi = portalAdminApiFromEnv(env)

  return {
    root: ".",
    publicDir: "public",
    envPrefix: ["VITE_", "GATEHOUSE_"],
    server: middlewareMode
      ? {
          middlewareMode: true,
        }
      : {
          port: Number(env.GATEHOUSE_PORTAL_UI_PORT ?? 5174),
          strictPort: false,
          open: false,
          proxy: {
            "/portal/api/admin": {
              target: portalAdminApi,
              changeOrigin: true,
              timeout: 5000,
              proxyTimeout: 5000,
            },
            "/portal/api/channels": {
              target: portalAdminApi,
              changeOrigin: true,
              timeout: 5000,
              proxyTimeout: 5000,
            },
            "/portal/api": {
              target: portalApi,
              changeOrigin: true,
              timeout: 5000,
              proxyTimeout: 5000,
            },
            "/portal/events": {
              target: portalApi,
              changeOrigin: true,
              timeout: 0,
              proxyTimeout: 0,
            },
          },
        },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(portalRoot, "index.html"),
          admin: path.resolve(portalRoot, "admin.html"),
        },
      },
    },
    plugins: [
      {
        name: "gatehouse/portal-admin-route",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const url = req.url ?? ""
            if (url === "/admin" || url.startsWith("/admin?")) {
              req.url = "/admin.html"
            }
            next()
          })
        },
      },
      {
        name: "gatehouse/portal-url",
        configureServer(server) {
          if (middlewareMode) return
          server.httpServer?.once("listening", () => {
            const addr = server.httpServer?.address()
            const port = typeof addr === "object" && addr ? addr.port : 5174
            console.log(`\n  Gatehouse Portal UI → http://localhost:${port}/`)
            if (projectDir) {
              console.log(`  Project directory → ${projectDir}`)
            }
            console.log(`  Gatehouse Portal API → ${portalApi}/portal/api/snapshot`)
            console.log(`  Gatehouse Portal Admin → ${portalAdminApi}/admin`)
            console.log("")
          })
        },
      },
    ],
  }
})
