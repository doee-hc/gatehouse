import { loadGatehouseConfig, type PortalOfficeConfig } from "../gatehouse-config.ts"

export type PortalOfficeSettings = {
  idleWander: boolean
  playRelease: "seat" | "wander"
}

const DEFAULT_IDLE_WANDER = true
const DEFAULT_PLAY_RELEASE = "seat" as const

let activeSettings: PortalOfficeSettings | undefined

function resolveFromConfig(config?: PortalOfficeConfig): PortalOfficeSettings {
  return {
    idleWander: config?.idle_wander ?? DEFAULT_IDLE_WANDER,
    playRelease: config?.play_release === "wander" ? "wander" : DEFAULT_PLAY_RELEASE,
  }
}

export function resolvePortalOfficeSettings(projectDirectory: string): PortalOfficeSettings {
  return resolveFromConfig(loadGatehouseConfig(projectDirectory).portal.office)
}

export function initPortalOfficeSettings(projectDirectory: string) {
  activeSettings = resolvePortalOfficeSettings(projectDirectory)
  return activeSettings
}

export function getPortalOfficeSettings() {
  if (activeSettings) return activeSettings
  const projectDirectory = process.env.GATEHOUSE_PROJECT_DIR?.trim()
  if (projectDirectory) return resolvePortalOfficeSettings(projectDirectory)
  return resolvePortalOfficeSettings(process.cwd())
}

export function resetPortalOfficeSettingsForTests() {
  activeSettings = undefined
}

export function toBrowserOfficeConfig(settings: PortalOfficeSettings) {
  return {
    idle_wander: settings.idleWander,
    play_release: settings.playRelease,
  }
}
