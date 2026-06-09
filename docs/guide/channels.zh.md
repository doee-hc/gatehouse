# IM 通道（微信 / 飞书 / QQ）

IM 通道能力内置于 **`@gatehouse/core`**，没有单独的 channels npm 包。

| 入口 | 值 |
| --- | --- |
| npm 包 | `@gatehouse/core` |
| 库 import | `@gatehouse/core/channels` |
| OpenCode 插件（项目级） | `@gatehouse/core/channels/plugin` |
| 源码（monorepo） | [`packages/core/src/channels/`](../../packages/core/src/channels/) |
| Agent 工具 | `gatehouse_channels_send_file` |

`channels init` / `channels serve` 会在**项目**根目录 `opencode.jsonc` 中写入 `@gatehouse/core/channels/plugin`（与 `@gatehouse/core` 并列）。首次写入后请重启 OpenCode 以加载该工具。

## 前置条件

1. 已全局安装 `@gatehouse/core`（`opencode plug @gatehouse/core --global` 或 `bunx @gatehouse/core install`）
2. 已在 Gatehouse 项目中运行 OpenCode（存在 `.gatehouse/`）
3. 各平台凭证（微信 iLink、飞书应用、QQ 机器人）

## CLI

任意目录均可执行（建议加 `-C /path/to/project`）：

```bash
bunx @gatehouse/core channels init [-C project]
bunx @gatehouse/core channels login <weixin|feishu|qq>
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

## 平台 Bridge

终端用户**不需要**单独安装 bridge npm 包；`@gatehouse/core` 在 build 时会 bundle bridge 入口。Monorepo 开发者可直接运行各平台包：

| 平台 | 文档 |
| --- | --- |
| 微信 | [packages/weixin-bridge/README.md](../../packages/weixin-bridge/README.md) |
| 飞书 | [packages/feishu-bridge/README.md](../../packages/feishu-bridge/README.md) |
| QQ | [packages/qq-bridge/README.md](../../packages/qq-bridge/README.md) |

Bridge 包依赖 `@gatehouse/core`，共享逻辑从 `@gatehouse/core/channels` import。

## Agent 与 IM 互通

- 入站消息转发到用户绑定的 registry agent（默认 `outer:lead`）；在 IM 中可用 `/agent` 切换对象。
- 绑定 session idle 后，助手回复会自动推送到 IM。
- Agent 调用 `gatehouse_channels_send_file` 并传入项目内相对路径，可将图片/文件加入 IM 出站队列。

## 延伸阅读

- [快速上手 — IM 通道](../getting-started.zh.md#im-通道可选)
- [packages/core/README.md — IM Channels](../../packages/core/README.md#im-channels)（英文）
- [开发者指南](../dev.md)（英文）
