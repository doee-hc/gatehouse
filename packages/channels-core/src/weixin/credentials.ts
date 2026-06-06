import fs from "node:fs"
import path from "node:path"
import { resolveChannelStateDir } from "../paths.ts"
import { readJsonFile, writeJsonFile } from "../store/files.ts"

const CREDENTIALS_FILE = "credentials.json"

export type WeixinCredentials = {
  botToken: string
  accountId?: string
  baseUrl: string
  loggedInAt: number
}

export function weixinStateDir(projectDir: string) {
  return resolveChannelStateDir(projectDir, "weixin")
}

export function weixinCredentialsFile(projectDir: string) {
  return path.join(weixinStateDir(projectDir), CREDENTIALS_FILE)
}

export function loadWeixinCredentials(projectDir: string) {
  return readJsonFile<WeixinCredentials>(weixinCredentialsFile(projectDir))
}

export function saveWeixinCredentials(projectDir: string, credentials: WeixinCredentials) {
  writeJsonFile(weixinCredentialsFile(projectDir), credentials)
}

export function clearWeixinCredentials(projectDir: string) {
  const file = weixinCredentialsFile(projectDir)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}
