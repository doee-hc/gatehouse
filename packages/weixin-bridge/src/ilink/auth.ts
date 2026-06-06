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
    console.log("\n请用微信扫描以下二维码完成登录：\n")
    if (session.qrContent) console.log(session.qrContent)
    console.log("")

    while (Date.now() < deadline) {
      const current = (await manager.tickSession(session.id)) ?? manager.getSession(session.id)
      if (!current) throw new Error("登录会话已结束")
      if (current.phase === "scaned") {
        console.log("\n已扫码，请在微信中确认…")
      }
      if (current.phase === "confirmed") {
        console.log("\n✅ 微信登录成功，凭证已保存。")
        return loadCredentials(params.stateDir)
      }
      if (current.phase === "failed") {
        throw new Error(current.message ?? "登录失败")
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
    throw new Error("登录超时")
  }

  const qr = await fetchWeixinQrCode(params.ilinkBaseUrl, params.botType)
  console.log("\n请用微信扫描以下二维码完成登录：\n")
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
      console.log("\n已扫码，请在微信中确认…")
      await Bun.sleep(1000)
      continue
    }
    if (status.status === "expired") {
      refreshCount++
      if (refreshCount > 3) {
        throw new Error("二维码多次过期，请重新运行 login")
      }
      console.log("\n二维码已过期，正在刷新…")
      const next = await fetchWeixinQrCode(params.ilinkBaseUrl, params.botType)
      qrcode = next.qrcode
      console.log(next.qrcode_img_content)
      console.log("")
      continue
    }
    if (status.status === "confirmed") {
      if (!status.bot_token) throw new Error("登录成功但未返回 bot_token")
      const credentials: WeixinCredentials = {
        botToken: status.bot_token,
        accountId: status.ilink_bot_id,
        baseUrl: status.baseurl?.trim() || params.ilinkBaseUrl,
        loggedInAt: Date.now(),
      }
      saveCredentials(params.stateDir, credentials)
      console.log("\n✅ 微信登录成功，凭证已保存。")
      return credentials
    }
  }

  throw new Error("登录超时")
}
