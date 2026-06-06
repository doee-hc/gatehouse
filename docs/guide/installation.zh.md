<p align="center">
  <a href="installation.md">English</a> |
  <a href="installation.zh.md">简体中文</a>
</p>

# 安装指南

Gatehouse 是基于 [OpenCode](https://opencode.ai) 的多智能体团队插件。全局注册一次，进入项目目录启动 OpenCode TUI 后会自动创建 `.gatehouse/`。

| 目标 | 命令 | 写入内容 |
| :--- | :--- | :--- |
| 标准安装 | `bunx @gatehouse/core install` | 全局 `opencode.jsonc` + `tui.json`、agent 定义、`~/.config/gatehouse/config.yaml` |
| 非交互安装 | `bunx @gatehouse/core install --no-tui ...` | 同上，适合 CI / LLM Agent |
| 健康检查 | `bunx @gatehouse/core doctor [--probe]` | 检查 OpenCode、插件注册、`.gatehouse/` 项目结构、Portal |

**不要**使用 `npm install -g @gatehouse/core` — Gatehouse 是 OpenCode 插件，应通过 `bunx` 或 `opencode plug` 注册。

---

## 给人类用户

### 推荐：让 LLM Agent 帮你安装

安装涉及 OpenCode 版本、全局插件注册、locale / 模型预设 — 把下面提示词粘贴到 Cursor / Claude Code 等 Agent：

```
请按照以下文档安装并配置 Gatehouse：
https://raw.githubusercontent.com/doee-hc/gatehouse/main/docs/guide/installation.zh.md
```

### 自己动手（交互式）

```bash
bunx @gatehouse/core install
```

向导会询问：

1. 界面语言（`zh` / `en`）
2. 默认模型（可选，格式 `provider/model-id`，如 `opencode/big-pickle`；可用 `opencode models` 查看已安装 provider 的模型列表）

### 验证

```bash
bunx @gatehouse/core doctor
bunx @gatehouse/core doctor --probe   # 额外探测 Portal 端口
```

然后在项目目录启动 OpenCode：

```bash
cd /path/to/your/project
opencode
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

检查 OpenCode：

```bash
if command -v opencode &> /dev/null; then
  echo "OpenCode $(opencode --version) installed"
else
  echo "OpenCode not installed — install from https://opencode.ai first"
fi
```

要求：**OpenCode >= 1.14.40 且 < 1.17.0**（与 `@gatehouse/core` 的 `engines.opencode` 一致）。

检查 Bun（推荐）：

```bash
command -v bun && bun --version
```

### Step 1：收集安装选项

向用户确认：

1. **语言** — `zh` 或 `en`（默认 `zh`）
2. **默认模型**（可选）— 如 `opencode/big-pickle`；留空则使用 OpenCode 默认模型。运行 `opencode models` 查看可用模型。
3. **项目目录** — 用于 install 后 doctor 检查（默认当前目录）

### Step 2：运行安装器

非交互示例：

```bash
bunx @gatehouse/core install \
  --no-tui \
  --locale=<zh|en> \
  [--model=<provider/model-id>] \
  [--skip-doctor] \
  [-C /path/to/project]
```

**示例：**

- 中文 + 统一模型：
  ```bash
  bunx @gatehouse/core install --no-tui --locale=zh --model=opencode/big-pickle
  ```
- 仅注册插件、跳过 doctor：
  ```bash
  bunx @gatehouse/core install --no-tui --locale=en --skip-doctor
  ```

**等价方式（OpenCode 原生）：**

```bash
opencode plug @gatehouse/core --global
```

这只会注册插件，**不会**写入 `~/.config/gatehouse/config.yaml` — 若需要 locale / 模型预设，仍建议跑 `gatehouse install`。

**安装器会：**

| 步骤 | 写入 |
|------|------|
| 全局 OpenCode | `~/.config/opencode/opencode.jsonc` → `["@gatehouse/core", {}]` |
| 全局 TUI | `~/.config/opencode/tui.json` → `["@gatehouse/core/tui", {}]` |
| Agent 定义 | `~/.config/opencode/agent/{lead,architect,curator,arbiter}.md` |
| Gatehouse 配置 | `~/.config/gatehouse/config.yaml`（locale / models，若指定） |

### Step 3：运行 doctor

```bash
bunx @gatehouse/core doctor [-C /path/to/project] [--probe]
```

Doctor 检查六类：

| 类别 | 检查项 |
|------|--------|
| **System** | OpenCode CLI 版本、Bun |
| **Config** | 全局 server/TUI 插件、`~/.config/gatehouse/config.yaml` |
| **Agents** | 四个外层 agent md 是否同步 |
| **Project** | `.gatehouse/`、`opencode.jsonc` 的 `default_agent` / `skills.paths` |
| **Portal** | `--probe` 时探测配置的 Portal 端口（默认 18471 / 18472） |
| **Models** | `config.yaml` 中 models 格式 |

退出码：`0` = 全部通过，`1` = 有 error，`2` = 仅 warning。

### Step 4：首次启动项目

```bash
cd /path/to/project
opencode
```

插件会自动：

- 创建 `.gatehouse/`（已有文件不覆盖）
- 写入项目 `opencode.jsonc`（`default_agent: lead`，`skills.paths: [".gatehouse"]`）
- 启动 Portal（默认 `http://127.0.0.1:18471/`）

再次运行 doctor 确认 Project / Models 类别通过：

```bash
bunx @gatehouse/core doctor --probe
```

### Step 5：Provider 认证

若用户指定了 `--model=opencode/...` 或其他 provider，确保 OpenCode 已登录对应 provider：

```bash
opencode auth login
```

按 OpenCode 提示完成 OAuth / API key 配置。

### Step 6：（可选）IM 通道

```bash
gatehouse channels init
gatehouse channels doctor --probe
gatehouse channels serve
```

详见 [packages/channels-core/README.md](../../packages/channels-core/README.md)。

---

## 本地 .tgz 安装（高级）

发布包或离线环境：

```bash
# `bun pm pack` in packages/core 产出 gatehouse-core-<version>.tgz（@gatehouse/core 的 npm 打包名）
tar -xzf gatehouse-core-0.1.0.tgz
bun ./package/bin/gatehouse.ts install ./gatehouse-core-0.1.0.tgz --no-tui --locale=zh
```

**不要**使用 `opencode plug file:...tgz` — 可能因 npm 下载无进度而挂起。

---

## 故障排除

| 现象 | 处理 |
|------|------|
| doctor 报缺少 `@gatehouse/core` | 重新运行 `bunx @gatehouse/core install` |
| `.gatehouse/` 不存在 | 在项目根目录启动 `opencode` 一次 |
| Portal 打不开 | 确认 OpenCode 已加载插件；`doctor --probe` |
| 模型无效 | 检查 `config.yaml` 格式为 `provider/model-id` |
| OpenCode 版本不兼容 | 升级到 >= 1.14.40 且 < 1.17.0 |

---

## CLI 参考

| 命令 | 说明 |
|------|------|
| `bunx @gatehouse/core install` | 交互式全局安装 |
| `bunx @gatehouse/core install --no-tui --locale=zh --model=...` | 非交互安装 |
| `bunx @gatehouse/core doctor [--probe]` | 健康检查 |
| `gatehouse channels doctor [--probe]` | IM 通道专项检查 |
| `gatehouse portal` | 打印 Portal URL 提示 |
| `opencode plug @gatehouse/core --global` | OpenCode 原生注册（不含 config.yaml） |

---

## 配置层级

| 文件 | 用途 |
|------|------|
| `~/.config/gatehouse/config.yaml` | 全局：locale、默认模型、Portal 品牌 |
| `.gatehouse/config.yaml` | 项目级覆盖 |
| `~/.config/opencode/opencode.jsonc` | 全局 OpenCode 插件 |
| `~/.config/opencode/tui.json` | Gatehouse TUI 插件 |
| `{project}/opencode.jsonc` | 项目 default_agent、skills.paths |

安装器只初始化**全局**层；项目层在首次 OpenCode 启动时自动创建。
