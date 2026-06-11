<p align="center">
  <a href="getting-started.md">English</a> |
  <a href="getting-started.zh.md">简体中文</a>
</p>

# 快速上手

Gatehouse 是 OpenCode 的多智能体团队插件。安装后，你在终端里对话的不再只是单个 AI，而是一支有分工、有流程、能复盘的团队。

## 前置条件

- [OpenCode](https://opencode.ai) >= 1.14.40
- 一个你要让团队协助的项目目录（Git 仓库或普通文件夹均可）

## 安装插件

```bash
# 1. 全局安装
bunx @gatehouse/core install

# 2. 验证全局层
bunx @gatehouse/core doctor --global-only

# 3. 项目初始化（二选一）
bunx @gatehouse/core scaffold -C /path/to/project
cd /path/to/project && opencode
```

完整验证：`bunx @gatehouse/core doctor -C /path/to/project --probe`

详细步骤见 [安装指南](./guide/installation.zh.md)。模型等配置不在安装阶段设置，需要时编辑 `config.yaml`。

## 第一次启动

1. 进入你的项目目录。
2. 运行 `opencode` 启动 TUI（目前仅验证过终端 TUI；Desktop / IDE 扩展尚未测试）。
3. 插件会自动：
   - 创建 `.gatehouse/` 目录（已有文件不会被覆盖）
   - 同步 agent 定义到 OpenCode
   - 将默认对话 agent 设为 **Lead**

新开对话时，Lead 会组建核心团队（Architect、Curator、Arbiter）。你主要与 Lead 沟通目标与验收标准即可。

## 典型工作流

```text
与 Lead 讨论方向
    ↓
确认任务（写入 `missions.yaml` 队列）
    ↓
Lead 启动任务 → Architect 编排执行树 → 内层 agent 执行
    ↓
验收 → 复盘 → 技能沉淀
    ↓
产出发布到 Portal 博客；Skill 沉淀可在 Skill 栏浏览（可选）
```

你不需要手动调用底层工具；Lead 与团队会在对话中完成编排。若需了解各工具职责，见 [packages/core/README.md](../packages/core/README.md)。

## Portal 办公室

插件启动后，Portal 默认可通过浏览器访问：

```text
http://127.0.0.1:18471/
```

Portal 包含四个 Tab：

| Tab | 说明 |
|-----|------|
| **办公室** | 像素风场景，实时反映各 agent 状态（忙碌、调研、闲聊、空闲走动） |
| **博客** | 任务复盘报告等 Markdown 内容（需 agent 发布后可见） |
| **Skill** | 团队 Skill 目录，浏览与搜索复盘沉淀的领域技能 |
| **团队数据** | 各任务的 token、cost、耗时与执行角色分布 |

关闭 Portal：`GATEHOUSE_PORTAL=0 opencode`（或在启动脚本中设置该环境变量）。

## 配置

### 语言（locale）

在 `.gatehouse/config.yaml`（或全局 `~/.config/gatehouse/config.yaml`）中设置：

```yaml
locale: zh   # zh | en，默认 zh
```

- **Agent 系统提示词**、**meta-skill / skill 模板**、**运行时 Gatehouse 系统消息** 随 `locale` 切换。
- **Tool 描述**统一为英文（不受 locale 影响）。
- 项目内自定义内容按 locale 存放在 `.gatehouse/zh/` 与 `.gatehouse/en/`；切换语言**不会**覆盖你已编辑的文件，缺失时从 bundled 模板补齐。
- 修改 `locale` 后需**重启 Gatehouse / OpenCode**，或对 Lead 重新执行 `gatehouse_init_team`，已注入的 session 系统提示词才会更新。

### 角色显示名

编辑 `.gatehouse/config.yaml`：

```yaml
agents:
  lead:
    name: Len        # 终端里看到的 Lead 名字
  architect:
    name: Archie
  curator:
    name: Kurt
  arbiter:
    name: Art
```

### 模型

可在同一文件中为各角色指定模型（项目级覆盖全局）：

```yaml
models:
  lead: opencode/big-pickle
  architect: opencode/big-pickle
  curator: opencode/deepseek-v4-flash-free
  arbiter: opencode/deepseek-v4-flash-free
```

可用 `opencode models` 查看当前环境支持的模型；格式为 `provider/model-id`。

全局默认位于 `~/.config/gatehouse/config.yaml`。

### Portal 品牌与 Admin

```yaml
portal:
  brand:
    title: Gatehouse
    subtitle: 团队门户
    logo: brand/logo.png
  # admin_key 首次启动时自动生成，用于 http://127.0.0.1:18472/admin 解锁频道管理
```

Admin key 位于 `.gatehouse/config.yaml` 的 `portal.admin_key`。也可用环境变量 `GATEHOUSE_PORTAL_ADMIN_KEY` 覆盖（适合 CI 或临时调试）。

## IM 通道

若希望通过微信、飞书或 QQ 与 Lead 对话：

```bash
bunx @gatehouse/core channels init
bunx @gatehouse/core channels login weixin   # 或 feishu / qq
bunx @gatehouse/core channels serve
```

完整说明：[docs/guide/channels.zh.md](./guide/channels.zh.md)

各平台配置：

- [微信](../packages/weixin-bridge/README.md)
- [飞书](../packages/feishu-bridge/README.md)
- [QQ](../packages/qq-bridge/README.md)

## 下一步

- [插件工具参考](../packages/core/README.md) — 14 个 registry 工具与任务细节
- [Portal 开发](../packages/portal/README.md) — UI 调试与布局
- [开发者指南](./dev.md) — 在本仓库贡献代码
