
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

# Gatehouse

**自我迭代的多智能体团队**

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/doee-hc/gatehouse/actions/workflows/ci.yml"><img src="https://github.com/doee-hc/gatehouse/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opencode.ai"><img src="https://img.shields.io/badge/OpenCode-Plugin-6366f1.svg" alt="OpenCode Plugin"></a>
  <a href="https://github.com/doee-hc/gatehouse"><img src="https://img.shields.io/github/stars/doee-hc/gatehouse?style=social" alt="GitHub stars"></a>
</p>

基于 [OpenCode](https://opencode.ai) — 分工协作、任务生命周期、可视化 Portal 办公室。

> [!WARNING]
> **早期开发提示：** Gatehouse 仍处于早期开发阶段，尚未适合生产环境。功能可能变更、中断或不完整，请自行评估风险。

<p align="center">
  <img src="./docs/assets/portal-preview-zh.gif" alt="Gatehouse Portal 办公室预览" width="800">
</p>

本地运行插件后访问 `http://127.0.0.1:18471/` 可查看办公室 UI；独立 Portal 站点规划为对外项目门户。

---

### 安装

**前置条件：** 已安装 [OpenCode](https://opencode.ai) >= 1.14.40。

```bash
# 注册 Gatehouse 插件（全局，一次即可）
opencode plug @gatehouse/core --global

# 或使用安装助手（推荐：可配置 locale / 模型）
bunx @gatehouse/core install

# 验证安装
bunx @gatehouse/core doctor
```

完整安装指南（含 LLM Agent 逐步说明）：[docs/guide/installation.zh.md](./docs/guide/installation.zh.md)

然后在**你的项目目录**启动 OpenCode。插件会自动初始化 `.gatehouse/` 配置与 agent 定义，并将默认对话 agent 设为 **Lead**（显示名可在配置中修改）。

### 快速开始

1. **启动** — 在项目根目录运行 `opencode` 启动 TUI（Desktop / IDE 扩展尚未验证）。
2. **与 Lead 对话** — 说明目标与约束；Lead 会组建核心团队（架构、策展、仲裁等角色）。
3. **确认任务** — 方向对齐后，Lead 将任务写入队列并启动；内层执行团队由插件自动编排。
4. **打开 Portal** — 浏览器访问 `http://127.0.0.1:18471/`，在办公室视图里观察各 agent 的状态与协作；任务产出可发布到 Portal 博客，沉淀的 Skill 可在 Skill 栏浏览。

更完整的用户流程见 [快速上手指南](./docs/getting-started.zh.md)。

### 你能得到什么

- **核心团队** — Lead、Architect、Curator、Arbiter 分工明确；角色显示名与模型可在配置中自定义。
- **任务生命周期** — 排队 → 执行 → 验收 → 复盘 → 技能沉淀；团队状态持久化在项目 `.gatehouse/` 中。
- **自我迭代** — 复盘与技能提取会反哺后续任务，团队能力随项目演进。
- **Portal 办公室** — Phaser 像素风办公室：agent 忙碌时在工位、空闲时走动；附带博客与 Skill Tab。
- **IM 通道（可选）** — 通过微信 / 飞书 / QQ 与任意团队成员远程对话（见 [Channels 文档](./packages/channels-core/README.md)）。

### 配置

Gatehouse 使用两层配置，项目级覆盖全局级：

| 文件 | 用途 |
| --- | --- |
| `~/.config/gatehouse/config.yaml` | 全局：角色显示名、默认模型、Portal 品牌 |
| `.gatehouse/config.yaml` | 项目级覆盖 |

首次启动 OpenCode 时会自动生成项目配置。详细说明见 [快速上手指南 — 配置](./docs/getting-started.zh.md#配置)。

### 文档

| 文档 | 说明 |
| --- | --- |
| [docs/getting-started.zh.md](./docs/getting-started.zh.md) | 用户快速上手、任务流程、Portal |
| [docs/guide/installation.zh.md](./docs/guide/installation.zh.md) | 完整安装指南 |
| [packages/core/README.md](./packages/core/README.md) | 插件工具参考（进阶，英文） |
| [packages/portal/README.md](./packages/portal/README.md) | Portal 开发与调试（英文） |
| [docs/dev.md](./docs/dev.md) | 本仓库开发与贡献（英文） |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史与已知限制 |
| [docs/README.zh.md](./docs/README.zh.md) | 文档索引 |

独立文档站点与对外 Portal 门户正在规划中；部署后将在此补充链接。

### 开发与贡献

本仓库为 Gatehouse monorepo。本地开发、测试与发布流程见 [docs/dev.md](./docs/dev.md)。

### 基于 OpenCode 进行开发

Gatehouse 是基于 [OpenCode](https://opencode.ai) 的社区插件，**并非** OpenCode 官方团队开发或维护，与 OpenCode 无任何隶属关系。使用 OpenCode 即表示你同意其各自的使用条款与隐私政策。

Portal 办公室的像素美术素材来自 [LimeZu](https://limezu.itch.io/)，感谢作者的精彩创作。

---

## Star 曲线

<a href="https://www.star-history.com/?repos=doee-hc%2Fgatehouse&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=doee-hc/gatehouse&type=date&legend=top-left" />
  </picture>
</a>
