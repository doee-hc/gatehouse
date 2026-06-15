# IM 通道（微信 / 飞书 / QQ）

通过微信、飞书或 QQ 与团队远程对话。入站消息转发到绑定的 registry agent（默认 Lead）；OpenCode session idle 后，助手回复会自动推送到 IM。Agent 可用 `gatehouse_channels_send_file` 将项目内文件加入出站队列。

每个项目运行一次 `channels init`，然后重启 OpenCode 以加载 channels 插件与相关工具。

## 前置条件

1. 已全局安装 `@gatehouse/core`（`opencode plug @gatehouse/core --global` 或 `bunx @gatehouse/core install`）
2. 已在 Gatehouse 项目中运行 OpenCode（存在 `.gatehouse/`）
3. 各平台凭证（微信 iLink、飞书应用、QQ 机器人）

## CLI

任意目录均可执行（建议加 `-C /path/to/project`）：

```bash
bunx @gatehouse/core channels init [-C project]
bunx @gatehouse/core channels login <weixin|feishu|qq|qq-onebot>
bunx @gatehouse/core channels serve [-C project]
bunx @gatehouse/core channels status [--probe]
bunx @gatehouse/core channels stop [-C project]
bunx @gatehouse/core channels doctor [--probe]
```

Monorepo 简写（在仓库根目录）：

```bash
bun run channels init -C /path/to/project
bun run channels login weixin
bun run channels serve -C /path/to/project
```

典型流程：先在项目中启动 OpenCode（`bun run dev <project>` 或 `opencode`），再在另一终端运行 `channels serve`。

## 配置与状态目录

| 路径 | 用途 |
| --- | --- |
| `.gatehouse/channels.yaml` | 启用的通道与平台凭证 |
| `.gatehouse/channels/<platform>/` | 各平台状态（会话、去重、凭证） |
| `.gatehouse/channels/outbound/` | `gatehouse_channels_send_file` 待发送附件队列 |
| `.gatehouse/registry.db` | agent → OpenCode session 的权威映射 |

Portal 通道管理（可选）：`http://127.0.0.1:18472/admin` — 使用 `.gatehouse/config.yaml` 中的 `portal.admin_key` 解锁。

## 各平台配置

| 平台 | 文档 |
| --- | --- |
| 微信 | [packages/weixin-bridge/README.md](../../packages/weixin-bridge/README.md) |
| 飞书 | [packages/feishu-bridge/README.md](../../packages/feishu-bridge/README.md) |
| QQ 私聊（官方 Bot） | [packages/qq-bridge/README.md](../../packages/qq-bridge/README.md) |
| QQ 群聊（NapCat / OneBot） | [packages/qq-onebot-bridge/README.md](../../packages/qq-onebot-bridge/README.md) |

## Agent 与 IM 互通

- 入站消息转发到用户绑定的 registry agent（默认 `outer:lead`）；在 IM 中可用 `/agent` 切换对象。
- `/autopilot on|off` 开关项目 autopilot 模式（用户沉默 10 分钟后 Lead 收到全权负责提醒；须 direction 已确认）。OpenCode TUI 内用 `/autopilot`、`/autopilot-on`、`/autopilot-off`。
- 绑定 session idle 后，助手回复会自动推送到 IM。
- Agent 调用 `gatehouse_channels_send_file` 并传入项目内相对路径，可将图片/文件加入 IM 出站队列。

## 延伸阅读

- [快速上手 — IM 通道](../getting-started.zh.md#im-通道)
- [packages/core/README.md — IM Channels](../../packages/core/README.md#im-channels)（英文）
- [开发者指南](../dev.md)（英文）
