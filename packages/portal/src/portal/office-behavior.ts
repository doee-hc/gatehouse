/** Office agent behavior — values come from portal.office in .gatehouse/config.yaml via /portal/api/display-config. */

export type OfficePlayReleaseMode = "seat" | "wander"

export type PortalOfficeConfig = {
  idle_wander: boolean
  play_release: OfficePlayReleaseMode
}

const DEFAULT_OFFICE: PortalOfficeConfig = {
  idle_wander: true,
  play_release: "seat",
}

let officeConfig: PortalOfficeConfig = { ...DEFAULT_OFFICE }

export function applyPortalOfficeConfig(config?: Partial<PortalOfficeConfig>) {
  if (!config) return
  officeConfig = {
    idle_wander: typeof config.idle_wander === "boolean" ? config.idle_wander : officeConfig.idle_wander,
    play_release:
      config.play_release === "seat" || config.play_release === "wander"
        ? config.play_release
        : officeConfig.play_release,
  }
}

export function isIdleWanderEnabled() {
  return officeConfig.idle_wander
}

export function officePlayReleaseMode() {
  return officeConfig.play_release
}

export function resetPortalOfficeConfigForTests() {
  officeConfig = { ...DEFAULT_OFFICE }
}
