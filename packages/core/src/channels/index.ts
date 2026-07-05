export { DEFAULT_AGENT_ID } from "./constants.ts"
export { readCurrentMissionId, parseMissionsFile } from "./missions.ts"
export type { MissionEntry, MissionsDocument } from "./missions.ts"
export {
  CORE_PACKAGE_MARKER,
  corePackageMarkerPath,
  readCorePackageRoot,
  resolveChannelStateDir,
} from "./paths.ts"
export { loadDotEnv } from "./env.ts"
export { chunkText } from "./text.ts"
export {
  downloadUrlAttachment,
  MAX_ATTACHMENT_BYTES,
  mimeFromContentType,
  mimeFromFilename,
  resolveAttachmentsDir,
  sanitizeFilename,
  saveAttachment,
} from "./attachments.ts"
export { deliverOutboundAttachments } from "./outbound-deliver.ts"
export type { OutboundDeliverHandlers } from "./outbound-deliver.ts"
export {
  consumeOutboundQueue,
  enqueueOutboundFile,
  isImageAttachment,
  outboundQueuePath,
  readOutboundQueue,
  resolveOutboundPath,
  resolveOutboundDir,
} from "./outbound.ts"
export type { OutboundAttachment } from "./outbound.ts"
export {
  gatehouseCorePackageRoot,
  channelsPluginSpec,
  CHANNELS_PLUGIN_PACKAGE,
  ensureChannelsPluginInOpencodeConfig,
  projectOpencodeConfigPath,
} from "./opencode-config.ts"
export type { ChannelBridgeConfig, UserChatState } from "./types.ts"
export { gatehouseToolMetadata, toolFail, toolOk } from "./tool-envelope.ts"

export {
  formatAgentDirectory,
  formatAgentDirectoryForProject,
  isAgentSwitchable,
  listActiveRegistryAgents,
  listSwitchableAgents,
  opencodeSessionExists,
  readRegistryAgentById,
  readRegistryLeadSessionId,
  resolveAgentTarget,
  resolveProjectLeadSession,
} from "./registry/agent-target.ts"
export { ensureLeadAgentTarget } from "./registry/lead-session.ts"
export type { RegistryAgentTarget } from "./registry/agent-target.ts"

export {
  handleAgentCommand,
  parseAgentCommand,
  resolveActiveAgentTarget,
  syncAgentDeliveryWatermark,
} from "./registry/agent-command.ts"
export type { AgentCommand, AgentCommandResult } from "./registry/agent-command.ts"

export {
  handleAutopilotCommand,
  parseAutopilotCommand,
} from "./registry/autopilot-command.ts"
export type { AutopilotCommand } from "./registry/autopilot-command.ts"

export { createOpencodeClientForBridge } from "./opencode/client.ts"
export type { OpencodeClient } from "./opencode/client.ts"
export {
  createChannelClient,
  latestAssistantText,
  promptLead,
  promptSession,
  textFromPromptResponse,
  verifyOpencode,
  waitForSessionIdle,
} from "./opencode/session.ts"
export type { ChannelPromptFile } from "./opencode/session.ts"
export {
  assistantMessageId,
  assistantMessageText,
  collectDeliverableAssistantMessages,
  isDeliverableAssistantMessage,
  latestDeliverableAssistantMessageId,
  listNewDeliverableAssistantMessages,
  listSessionMessages,
} from "./opencode/assistant-messages.ts"
export type { DeliverableAssistantMessage } from "./opencode/assistant-messages.ts"
export { drainSseMessages, readSessionStatusIdleEvent, runOpencodeEventLoop } from "./opencode/events.ts"
export { ChannelSessionRelay } from "./session-relay.ts"
export type { ChannelOutboundHandlers } from "./session-relay.ts"

export { readJsonFile, writeJsonFile } from "./store/files.ts"
export {
  getActiveAgentId,
  getLastContextToken,
  getLastDeliveredAssistantMessageId,
  isMessageKeyProcessed,
  isMessageProcessed,
  listUsersBoundToSession,
  loadSessionMap,
  loadSyncBuf,
  rememberContextToken,
  rememberLastMessage,
  rememberMessageKey,
  saveSessionMap,
  saveSyncBuf,
  setActiveAgentId,
  setLastDeliveredAssistantMessageId,
} from "./store/state.ts"
export type { SessionMap } from "./store/state.ts"

export * from "./supervisor/index.ts"
export {
  ensurePortalAdminKey,
  gatehouseConfigPath,
  generatePortalAdminKey,
  isPortalAdminConfigured,
  readPortalAdminKeyFromConfig,
  resolvePortalAdminKey,
} from "./portal/config.ts"
export {
  clearWeixinCredentials,
  loadWeixinCredentials,
  saveWeixinCredentials,
  weixinCredentialsFile,
  weixinStateDir,
} from "./weixin/credentials.ts"
export type { WeixinCredentials } from "./weixin/credentials.ts"
export { fetchWeixinQrCode, pollWeixinQrStatus } from "./weixin/ilink-api.ts"
export type { WeixinQrCodeResponse, WeixinQrStatus } from "./weixin/ilink-api.ts"
export {
  getWeixinLoginSessionManager,
  WeixinLoginSessionManager,
} from "./weixin/login-session.ts"
export type { WeixinLoginPhase, WeixinLoginSessionSnapshot } from "./weixin/login-session.ts"
