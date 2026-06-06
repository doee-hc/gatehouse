import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { normalizeOuterProfile } from "../names.ts"
import { RegistryDatabase } from "../registry/db.ts"
import { outerChatMessageBlockReason } from "../registry/outer-chat-message.ts"

function projectDirectory(api: TuiPluginApi) {
  return api.state.path.directory || process.cwd()
}

export function installGatehouseClientGuard(api: TuiPluginApi) {
  const registry = {
    db: undefined as RegistryDatabase | undefined,
    directory: undefined as string | undefined,
  }

  const ownerForSession = (sessionID: string) => {
    const directory = projectDirectory(api)
    if (registry.directory !== directory) {
      registry.directory = directory
      registry.db = new RegistryDatabase(directory, { readonly: true })
    }
    return registry.db?.load().agents.find((agent) => agent.sessionId === sessionID)
  }

  const blockReason = (sessionID: string, agent?: string) => {
    const profile = agent ? normalizeOuterProfile(agent) : undefined
    if (!profile) return
    return outerChatMessageBlockReason(projectDirectory(api), ownerForSession(sessionID), profile)
  }

  const toastBlock = (reason: string) => {
    api.ui.toast({
      title: "Gatehouse",
      variant: "error",
      message: reason,
      duration: 8000,
    })
  }

  const guard =
    <T extends { sessionID: string; agent?: string }, R>(call: (args: T) => Promise<R>) =>
    (args: T) => {
      const reason = blockReason(args.sessionID, args.agent)
      if (!reason) return call(args)
      toastBlock(reason)
      return Promise.resolve({ error: { message: reason } } as R)
    }

  const session = api.client.session
  const prompt = session.prompt.bind(session)
  const command = session.command.bind(session)
  const shell = session.shell.bind(session)
  const promptAsync = session.promptAsync.bind(session)

  session.prompt = guard(prompt) as typeof session.prompt
  session.command = guard(command) as typeof session.command
  session.shell = guard(shell) as typeof session.shell
  session.promptAsync = guard(promptAsync) as typeof session.promptAsync
}
