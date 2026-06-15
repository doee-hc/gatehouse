import { clearAutopilotWatchState } from "./autopilot-watch.ts"

export async function onLeadSessionUserMessage(projectDirectory: string) {
  await clearAutopilotWatchState(projectDirectory)
}
