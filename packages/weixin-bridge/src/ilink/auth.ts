import path from "node:path"
import {
  fetchWeixinQrCode,
  getWeixinLoginSessionManager,
  pollWeixinQrStatus,
  readJsonFile,
  writeJsonFile,
  type WeixinCredentials,
} from "@gatehouse/channels-core"

const CREDENTIALS_FILE = "credentials.json"

export function credentialsPath(stateDir: string) {
  return path.join(stateDir, CREDENTIALS_FILE)
}

export function loadCredentials(stateDir: string) {
  return readJsonFile<WeixinCredentials>(credentialsPath(stateDir))
}

export function saveCredentials(stateDir: string, credentials: WeixinCredentials) {
  writeJsonFile(credentialsPath(stateDir), credentials)
}

export async function loginWithQr(params: {
  ilinkBaseUrl: string
  botType: string
  stateDir: string
  projectDir?: string
  timeoutMs?: number
}) {
  if (params.projectDir) {
    const manager = getWeixinLoginSessionManager(params.projectDir)
    const session = await manager.startSession()
    const deadline = Date.now() + (params.timeoutMs ?? 480_000)
    console.log("\nScan the QR code below with WeChat to log in:\n")
    if (session.qrContent) console.log(session.qrContent)
    console.log("")

    while (Date.now() < deadline) {
      const current = (await manager.tickSession(session.id)) ?? manager.getSession(session.id)
      if (!current) throw new Error("Login session ended")
      if (current.phase === "scaned") {
        console.log("\nQR scanned — confirm in WeChat…")
      }
      if (current.phase === "confirmed") {
        console.log("\n✅ WeChat login succeeded — credentials saved.")
        return loadCredentials(params.stateDir)
      }
      if (current.phase === "failed") {
        throw new Error(current.message ?? "Login failed")
      }
      if (current.phase === "expired" && current.message) {
        console.log(`\n${current.message}`)
        if (current.qrContent) {
          console.log(current.qrContent)
          console.log("")
        }
      }
      process.stdout.write(".")
      await Bun.sleep(1000)
    }
    manager.cancelSession(session.id)
    throw new Error("Login timed out")
  }

  const qr = await fetchWeixinQrCode(params.ilinkBaseUrl, params.botType)
  console.log("\nScan the QR code below with WeChat to log in:\n")
  console.log(qr.qrcode_img_content)
  console.log("")

  const deadline = Date.now() + (params.timeoutMs ?? 480_000)
  let qrcode = qr.qrcode
  let refreshCount = 0

  while (Date.now() < deadline) {
    const status = await pollWeixinQrStatus(params.ilinkBaseUrl, qrcode)
    if (status.status === "wait") {
      process.stdout.write(".")
      await Bun.sleep(1000)
      continue
    }
    if (status.status === "scaned") {
      console.log("\nQR scanned — confirm in WeChat…")
      await Bun.sleep(1000)
      continue
    }
    if (status.status === "expired") {
      refreshCount++
      if (refreshCount > 3) {
        throw new Error("QR code expired too many times — re-run login")
      }
      console.log("\nQR code expired — refreshing…")
      const next = await fetchWeixinQrCode(params.ilinkBaseUrl, params.botType)
      qrcode = next.qrcode
      console.log(next.qrcode_img_content)
      console.log("")
      continue
    }
    if (status.status === "confirmed") {
      if (!status.bot_token) throw new Error("Login succeeded but bot_token was not returned")
      const credentials: WeixinCredentials = {
        botToken: status.bot_token,
        accountId: status.ilink_bot_id,
        baseUrl: status.baseurl?.trim() || params.ilinkBaseUrl,
        loggedInAt: Date.now(),
      }
      saveCredentials(params.stateDir, credentials)
      console.log("\n✅ WeChat login succeeded — credentials saved.")
      return credentials
    }
  }

  throw new Error("Login timed out")
}
