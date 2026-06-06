import type { PluginInput } from "@opencode-ai/plugin"
import { RegistryStore } from "./store.ts"

const stores = new Map<string, Promise<RegistryStore>>()

export function registryStore(input: PluginInput) {
  const key = input.directory
  const existing = stores.get(key)
  if (existing) return existing
  const created = RegistryStore.create({
    directory: input.directory,
    client: input.client as import("../session/client.ts").GatehouseClient,
    plugin: input,
  })
  stores.set(key, created)
  return created
}

export async function getRegistryStore(input: PluginInput) {
  return registryStore(input)
}
