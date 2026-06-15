/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { existsSync } from "node:fs"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { DEFAULT_PORTAL_DISPLAY_PORT } from "../portal/defaults.ts"
import { gatehouseRoot } from "../paths.ts"
import { loadGatehouseSidebarStateSync } from "./data.ts"

function shortSessionId(sessionId: string) {
  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}…` : sessionId
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const directory = () => props.api.state.path.directory || process.cwd()
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 5000)
    onCleanup(() => clearInterval(timer))
  })

  const panel = createMemo(() => {
    tick()
    const dir = directory()
    if (!existsSync(gatehouseRoot(dir))) return { kind: "hidden" as const }
    try {
      return {
        kind: "ready" as const,
        data: loadGatehouseSidebarStateSync(dir, props.session_id),
      }
    } catch (error) {
      return {
        kind: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const state = createMemo(() => {
    const hit = panel()
    if (hit.kind !== "ready") return undefined
    return hit.data
  })

  const error = createMemo(() => {
    const hit = panel()
    if (hit.kind !== "error") return undefined
    return hit.message
  })

  return (
    <Show when={panel().kind !== "hidden"}>
      <box>
        <text fg={theme().text}>
          <b>Gatehouse</b>
        </text>
        <Show
          when={state()?.portal}
          fallback={
            <text fg={theme().textMuted}>
              Portal not running (default port {process.env.GATEHOUSE_PORTAL_PORT ?? String(DEFAULT_PORTAL_DISPLAY_PORT)})
            </text>
          }
        >
          {(portal) => (
            <text fg={theme().textMuted}>
              Portal{" "}
              <span style={{ fg: theme().text }}>{portal().url}</span>
              <span style={{ fg: theme().textMuted }}> · :{portal().port}</span>
            </text>
          )}
        </Show>
        <Show when={state()?.autopilot}>
          {(autopilot) => {
            const enabled = () => autopilot().enabled
            const directionOk = () => autopilot().directionConfirmed
            const lampColor = () => {
              if (!enabled()) return theme().textMuted
              return directionOk() ? theme().success : theme().warning
            }
            return (
              <box marginTop={1}>
                <text>
                  <span style={{ fg: lampColor() }}>{enabled() ? "●" : "○"}</span>
                  <span style={{ fg: theme().text }}>
                    {" "}
                    <b>Autopilot</b>{" "}
                  </span>
                  <span style={{ fg: enabled() ? lampColor() : theme().textMuted }}>
                    <b>{enabled() ? "ON" : "OFF"}</b>
                  </span>
                  <span style={{ fg: theme().textMuted }}>
                    {" "}
                    · direction {directionOk() ? "confirmed" : "draft"}
                  </span>
                </text>
                <text fg={theme().textMuted}>/autopilot to toggle</text>
              </box>
            )
          }}
        </Show>
        <Show when={error()}>
          {(message) => <text fg={theme().error}>Failed to load: {message()}</text>}
        </Show>
        <Show
          when={state() && (state()!.outerAgents.length || state()!.missions.length)}
          fallback={
            <text fg={theme().textMuted}>
              No team / mission data yet. Run gatehouse_init_team in the lead profile session, then refresh.
            </text>
          }
        >
          <Show when={state()?.sessionOwner}>
            {(owner) => (
              <text fg={theme().warning}>
                This session → {owner().displayName} ({owner().profile})
              </text>
            )}
          </Show>
          <Show when={state()?.outerAgents.length}>
            <box marginTop={1}>
              <text fg={theme().textMuted}>
                <b>Team</b>
              </text>
              <For each={state()?.outerAgents}>
                {(agent) => (
                  <text fg={theme().textMuted}>
                    {agent.displayName} · {agent.profile} · {shortSessionId(agent.sessionId)}
                  </text>
                )}
              </For>
            </box>
          </Show>
          <Show when={state()?.missions.length}>
            <box marginTop={1}>
              <text fg={theme().textMuted}>
                <b>Missions</b>
              </text>
              <For each={state()?.missions}>
                {(mission) => (
                  <text fg={theme().textMuted}>
                    {mission.status === "running" ? "●" : "○"} {mission.missionId} ({mission.status})
                    {mission.objective ? ` — ${mission.objective}` : ""}
                  </text>
                )}
              </For>
            </box>
          </Show>
          <For each={state()?.trees}>
            {(tree) => (
              <box marginTop={1}>
                <text fg={theme().textMuted}>
                  <b>Tree · {tree.missionId}</b> ({tree.status})
                </text>
                <For each={tree.lines}>
                  {(line) => <text fg={theme().textMuted}>{line}</text>}
                </For>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export function gatehouseSidebarSlot(api: TuiPluginApi) {
  return (_ctx: unknown, props: { session_id: string }) => <View api={api} session_id={props.session_id} />
}
