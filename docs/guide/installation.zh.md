<p align="center">
  <a href="installation.md">English</a> |
  <a href="installation.zh.md">简体中文</a>
</p>

# 安装指南

Gatehouse 是基于 [OpenCode](https://opencode.ai) 的多智能体团队插件。全局注册一次，再在项目目录完成初始化即可使用。

| 目标 | 命令 | 写入内容 |
| :--- | :--- | :--- |
| 标准安装 | `bunx @gatehouse/core install` | 全局 `opencode.jsonc` + `tui.json`、agent 定义、`~/.config/gatehouse/config.yaml` |
| 非交互安装 | `bunx @gatehouse/core install --no-tui ...` | 同上，适合 CI / LLM Agent |
| 项目初始化 | `bunx @gatehouse/core scaffold -C <项目>` | `.gatehouse/`、项目 `opencode.jsonc` |
| 健康检查 | `bunx @gatehouse/core doctor [--probe]` | 检查 OpenCode、插件注册、项目结构、Portal |

## CLI 调用方式

推荐通过 Bun 临时运行（无需全局安装）：

```bash
bunx @gatehouse/core <子命令>
```

下文所有 CLI 示例均以此形式书写。若已执行 `bun install -g @gatehouse/core`，可将前缀 `bunx @gatehouse/core` 简写为 `gatehouse`。

**不要**使用 `npm install -g @gatehouse/core` — Gatehouse 是 OpenCode 插件，应通过 `bunx` 注册；npm 无法直接运行 TypeScript bin。

**推荐路径：** 始终使用 `bunx @gatehouse/core install`。`opencode plug @gatehouse/core --global` 仅注册插件，不会写入 `config.yaml` 或同步 agent 定义，适合高级用户。

---

## 给人类用户

### 推荐：让 LLM Agent 帮你安装

安装涉及 OpenCode 版本、Bun、全局插件注册与 locale — 把下面提示词粘贴到 Cursor / Claude Code 等 Agent：

```
请按照以下文档安装并配置 Gatehouse：
https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.zh.md
```

### 自己动手（3 步）

**1. 全局安装**

```bash
bunx @gatehouse/core install
```

向导会询问界面语言（`zh` / `en`）。安装时会校验 OpenCode 版本与 Bun；模型不在安装阶段配置，需要时自行编辑 `~/.config/gatehouse/config.yaml`。

**2. 验证全局层**

```bash
bunx @gatehouse/core doctor --global-only
```

**3. 项目初始化（二选一）**

```bash
# A. 提前创建 .gatehouse/（推荐）
bunx @gatehouse/core scaffold -C /path/to/your/project

# B. 首次启动时自动创建
cd /path/to/your/project && opencode
```

完整验证：

```bash
bunx @gatehouse/core doctor -C /path/to/your/project --probe
```

浏览器打开 `http://127.0.0.1:18471/` 查看 Portal 办公室。

---

## 给 LLM Agent

> **IMPORTANT:** 使用 `curl` 拉取本文档，不要用 WebFetch — WebFetch 会丢失 `--no-tui`、`--locale` 等 flag 细节。
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.zh.md
> ```

按顺序执行以下步骤。向用户问好，并说明你在帮助安装 Gatehouse。

### Step 0：确认前置条件

`install` 会自动校验；也可手动检查：

```bash
command -v bun && bun --version
if command -v opencode &> /dev/null; then
  echo "OpenCode $(opencode --version) installed"
else
  echo "OpenCode not installed — install from https://opencode.ai first"
fi
```

要求：

- **Bun** 已安装（`install` 硬依赖）
- **OpenCode >= 1.14.40 且 < 1.17.0**（与 `@gatehouse/core` 的 `engines.opencode` 一致）

### Step 1：收集安装选项

向用户确认：

1. **语言** — `zh` 或 `en`（默认按系统 `LANG` 推断）
2. **项目目录** — 用于后续 scaffold / doctor（默认当前目录）

不在安装阶段配置模型；若用户需要，安装后编辑 `~/.config/gatehouse/config.yaml` 的 `models` 段。

### Step 2：运行安装器

```bash
bunx @gatehouse/core install \
  --no-tui \
  --locale=<zh|en> \
  [--skip-doctor] \
  [-C /path/to/project]
```

**示例：**

```bash
bunx @gatehouse/core install --no-tui --locale=zh
```

**安装器会：**

| 步骤 | 写入 |
|------|------|
| 全局 OpenCode | `~/.config/opencode/opencode.jsonc` → `["@gatehouse/core", {}]` |
| 全局 TUI | `~/.config/opencode/tui.json` → `["@gatehouse/core", {}]` |
| Agent 定义 | `~/.config/opencode/agent/{lead,architect,curator,arbiter}.md` |
| Gatehouse 配置 | `~/.config/gatehouse/config.yaml`（locale，若指定） |

### Step 3：运行 doctor（全局层）

```bash
bunx @gatehouse/core doctor --global-only
```

安装完成后会自动运行全局层 doctor。完整 doctor 六类：

| 类别 | 检查项 |
|------|--------|
| **System** | OpenCode CLI 版本、Bun |
| **Config** | 全局 server/TUI 插件、`~/.config/gatehouse/config.yaml` |
| **Agents** | 四个外层 agent md 是否同步 |
| **Project** | `.gatehouse/`、`opencode.jsonc`（`--global-only` 时跳过） |
| **Portal** | `--probe` 时探测 Portal 端口 |
| **Models** | `config.yaml` 中 models 格式 |

退出码：`0` = 全部通过，`1` = 有 error，`2` = 仅 warning。

### Step 4：项目初始化

**方式 A（推荐）：**

```bash
bunx @gatehouse/core scaffold -C /path/to/project
```

**方式 B：**

```bash
cd /path/to/project && opencode
```

插件会自动创建 `.gatehouse/`、写入项目 `opencode.jsonc`、启动 Portal。

再次运行 doctor：

```bash
bunx @gatehouse/core doctor -C /path/to/project --probe
```

### Step 5：Provider 认证（按需）

若用户在 `config.yaml` 中配置了模型，确保 OpenCode 已登录对应 provider：

```bash
opencode auth login
```

### Step 6：IM 通道（可选）

```bash
bunx @gatehouse/core channels init
bunx @gatehouse/core channels doctor --probe
bunx @gatehouse/core channels serve
```

详见 [docs/guide/channels.zh.md](./channels.zh.md)。

---

## 升级与卸载

```bash
# 刷新插件注册与 agent 定义
bunx @gatehouse/core upgrade

# 从全局 OpenCode 配置移除 Gatehouse
bunx @gatehouse/core uninstall
bunx @gatehouse/core uninstall --keep-config --keep-agents  # 保留配置与 agent 文件
```

---

## 本地 .tgz 安装（高级）

```bash
bunx @gatehouse/core install ./gatehouse-core-0.1.0.tgz --no-tui --locale=zh
```

**不要**使用 `opencode plug file:...tgz` — 可能因 npm 下载无进度而挂起。

---

## 故障排除

| 现象 | 处理 |
|------|------|
| install 报 OpenCode / Bun 缺失 | 安装前置依赖后重试 |
| doctor 报缺少 `@gatehouse/core` | `bunx @gatehouse/core install` 或 `upgrade` |
| `.gatehouse/` 不存在 | `scaffold -C <项目>` 或启动 `opencode` |
| Portal 打不开 | 确认 OpenCode 已加载插件；`doctor --probe` |
| 模型无效 | 检查 `config.yaml` 格式为 `provider/model-id` |
| OpenCode 版本不兼容 | 升级到 >= 1.14.40 且 < 1.17.0 |

---

## CLI 参考

| 命令 | 说明 |
|------|------|
| `bunx @gatehouse/core install` | 交互式全局安装 |
| `bunx @gatehouse/core install --no-tui --locale=zh` | 非交互安装 |
| `bunx @gatehouse/core scaffold -C <项目>` | 提前初始化项目层 |
| `bunx @gatehouse/core upgrade` | 刷新插件与 agent 定义 |
| `bunx @gatehouse/core uninstall` | 卸载全局插件 |
| `bunx @gatehouse/core doctor [--global-only] [--probe]` | 健康检查 |
| `bunx @gatehouse/core channels init\|login\|serve\|...` | IM 通道管理 |
| `bunx @gatehouse/core portal` | 打印 Portal URL |

---

## 配置层级

| 文件 | 用途 |
|------|------|
| `~/.config/gatehouse/config.yaml` | 全局：locale、模型、Portal 品牌 |
| `.gatehouse/config.yaml` | 项目级覆盖 |
| `~/.config/opencode/opencode.jsonc` | 全局 OpenCode 插件 |
| `~/.config/opencode/tui.json` | Gatehouse TUI 插件 |
| `{project}/opencode.jsonc` | 项目 default_agent、skills.paths |

安装器只初始化**全局**层；项目层通过 `scaffold` 或首次 `opencode` 创建。
