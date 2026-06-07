# Portal 分离部署：VPS 静态资源 + 本地后端

本文描述一种适合**公网直播间 / 多观众围观**的部署方式：

- **VPS**：托管 Portal 前端静态资源（HTML / JS / CSS / 角色贴图等），对外提供 HTTPS。
- **本地常开 Linux 机器**（或你家/机房里的工作机）：运行 OpenCode、Gatehouse 插件、Portal **Display API**（只读 + SSE），以及项目数据 `.gatehouse/`。
- **内网穿透**（推荐 frp）：让 VPS 上的 Nginx 能把 `/portal/api` 与 `/portal/events` 转发到本地 Portal API。

> **原则**：公网只暴露 **Display 面**（默认 `:18471` 对应的 API 路径）。**Admin 控制面**（`:18472`、`/admin`、Channel API）必须只监听 loopback，**永远不要**通过 frp / Nginx 暴露到公网。

---

## 1. 架构总览

```text
观众浏览器
    │
    ▼ HTTPS (portal.example.com)
┌─────────────────────────────────────┐
│ VPS                                 │
│  Nginx                              │
│   ├─ /              → 静态 dist/portal
│   ├─ /assets/       → 静态 dist/portal
│   ├─ /portal/api/*  ──proxy──┐
│   └─ /portal/events ──proxy──┤
└──────────────────────────────│──────┘
                               │ frp TCP 隧道（或专线/VPN）
                               ▼
┌─────────────────────────────────────┐
│ 本地常开 Linux（跑 Gatehouse 的那台）   │
│  OpenCode          :4096  (loopback) │
│  Portal Display API :18471 (loopback) │
│  Portal Admin       :18472 (loopback only) │
│  项目目录 .gatehouse/                │
└─────────────────────────────────────┘
```

Portal UI 的 `fetch` 与 `EventSource` 使用**同源相对路径**（`/portal/api/...`、`/portal/events`）。因此 VPS 上的 Nginx 必须同时：

1. 提供静态页面；
2. 把 `/portal/` 下的 API 与 SSE **反代到本地 Portal API**。

仅上传静态文件、不反代 API，页面会空白或一直「连接中」。

办公室场景的**动态布局贴图**（`/portal/api/office/*`）由 Portal API 从 `.gatehouse/portal/office/` 生成并下发，同样走反代，不要指望只拷静态包就能显示完整办公室。

---

## 2. 前提条件

| 组件 | 要求 |
|------|------|
| 本地机器 | Linux（推荐常开服务器），已安装 [OpenCode](https://opencode.ai) ≥ 1.14.40、[Bun](https://bun.sh) |
| Gatehouse | 已在本地安装插件：`bunx @gatehouse/core install` |
| 项目 | 已有 Gatehouse 项目目录，含 `.gatehouse/config.yaml` |
| VPS | Ubuntu / Debian 等，Nginx，可选 Certbot（Let's Encrypt） |
| 穿透 | frp（`frps` 在 VPS，`frpc` 在本地）或其他 TCP 隧道 |
| 构建机 | 与仓库一致的环境，用于 `bun run build` 生成 `dist/portal` |

---

## 3. 本地后端部署

### 3.1 项目配置

编辑项目 `.gatehouse/config.yaml`，建议至少配置：

```yaml
schema_version: 1
locale: zh
portal:
  # 公网访问用的项目 slug（浏览器 ?project= 与 API 校验）
  project_slug: gatehouse-live
  display:
    sse_max: 500
    snapshot_ttl_ms: 5000
    team_stats_ttl_ms: 10000
    blog_ttl_ms: 30000
    # Nginx 同源反代时可省略；若静态与 API 不同域再配置
    # cors_origins:
    #   - https://portal.example.com
    snapshot_poll_ms: 15000
    team_stats_poll_ms: 12000
  brand:
    title: Gatehouse
    subtitle: 团队直播间
```

配置优先级：**环境变量 > 项目 config > 全局 `~/.config/gatehouse/config.yaml` > 代码默认值**。

### 3.2 启动 OpenCode（终端 1）

在**项目根目录**启动 OpenCode（TUI 或你惯用的方式）：

```bash
cd /path/to/your-project

# 关闭 Portal 自带的 Vite/UI 侧车，只保留 API（由 VPS 提供静态页）
export GATEHOUSE_PROJECT_DIR=/path/to/your-project
export GATEHOUSE_PORTAL_UI=0
export OPENCODE_URL=http://127.0.0.1:4096

opencode
```

`GATEHOUSE_PORTAL_UI=0` 会让 dev 脚本以 **API-only** 模式拉起 Portal（`portal-stack api`），不在本地提供开发用 Vite UI。

若你使用仓库开发脚本：

```bash
cd /path/to/gatehouse
GATEHOUSE_PORTAL_UI=0 GATEHOUSE_PROJECT_DIR=/path/to/your-project bun run dev /path/to/your-project
```

### 3.3 仅启动 Portal API（终端 2，可选替代方式）

若不通过 `bun run dev` 侧车，可单独起 API 守护进程：

```bash
cd /path/to/gatehouse/packages/portal

export GATEHOUSE_PROJECT_DIR=/path/to/your-project
export OPENCODE_URL=http://127.0.0.1:4096
export GATEHOUSE_PORTAL_PORT=18471
export GATEHOUSE_PORTAL_ADMIN_PORT=18472

bun script/portal-stack.ts api
```

### 3.4 本地健康检查

```bash
curl -s http://127.0.0.1:18471/portal/api/health | jq
```

期望 JSON 中包含：

- `"ok": true`
- `"project": "gatehouse-live"`（与 `project_slug` 一致）
- `"bridge_running": true`（OpenCode 可达时）
- `"opencode_reachable": true`

Admin 仅在本地访问：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18472/admin
# 应返回 200（或 3xx 到 admin.html）
```

### 3.5 systemd 示例（本地 API）

`/etc/systemd/system/gatehouse-portal-api.service`：

```ini
[Unit]
Description=Gatehouse Portal Display API
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/gatehouse/packages/portal
Environment=GATEHOUSE_PROJECT_DIR=/path/to/your-project
Environment=OPENCODE_URL=http://127.0.0.1:4096
Environment=GATEHOUSE_PORTAL_PORT=18471
Environment=GATEHOUSE_PORTAL_ADMIN_PORT=18472
ExecStart=/home/YOUR_USER/.bun/bin/bun script/portal-stack.ts api
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gatehouse-portal-api
```

OpenCode 本身建议用你现有的方式保活（`tmux`、`screen` 或单独 unit）；Portal API 依赖 OpenCode 的 `/event` 与 session 状态。

---

## 4. 构建静态资源并上传到 VPS

在 **gatehouse 仓库根目录**（与线上一致的分支）：

```bash
cd /path/to/gatehouse
bun install
bun run build
```

构建产物路径：

```text
packages/core/dist/portal/
├── index.html
├── admin.html          # 不要部署到公网站点（Admin 走本地 :18472）
├── assets/
└── ...
```

上传到 VPS（示例）：

```bash
rsync -avz --delete \
  packages/core/dist/portal/ \
  deploy@YOUR_VPS:/var/www/gatehouse-portal/
```

> **注意**：公网 Nginx 的 `root` 只需面向观众的 `index.html` 与 `assets/`。不要把 Admin 控制面挂在公网域名下。

---

## 5. frp 内网穿透

### 5.1 VPS 端 `frps.ini`

```ini
[common]
bind_port = 7000
# 建议设置 token / TLS，参见 frp 官方文档
token = YOUR_FRPS_TOKEN
```

```bash
# 示例：systemd 或 nohup 启动 frps
./frps -c frps.ini
```

### 5.2 本地 `frpc.ini`

将本地 Portal Display API 暴露到 VPS 的 loopback：

```ini
[common]
server_addr = YOUR_VPS_IP
server_port = 7000
token = YOUR_FRPS_TOKEN

[gatehouse-portal-display]
type = tcp
local_ip = 127.0.0.1
local_port = 18471
remote_ip = 127.0.0.1
remote_port = 18471
```

```bash
./frpc -c frpc.ini
```

验证（在 **VPS 上**执行）：

```bash
curl -s http://127.0.0.1:18471/portal/api/health | jq
```

**不要**为 `:18472` Admin 端口添加 frp 段。

---

## 6. VPS Nginx 配置

以下示例域名：`portal.example.com`。静态根目录：`/var/www/gatehouse-portal`。

```nginx
server {
    listen 443 ssl http2;
    server_name portal.example.com;

    ssl_certificate     /etc/letsencrypt/live/portal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.example.com/privkey.pem;

    root /var/www/gatehouse-portal;
    index index.html;

    # 安全头（可按需收紧 CSP）
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    # ── Portal API（反代到 frp 暴露的本地 :18471）──
    location /portal/api/ {
        proxy_pass http://127.0.0.1:18471;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }

    # ── SSE：必须单独关闭缓冲、拉长超时 ──
    location /portal/events {
        proxy_pass http://127.0.0.1:18471;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding off;
    }

    # ── 静态资源：带 hash 的 assets 可长期缓存 ──
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # ── SPA：其余路径回退 index.html ──
    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name portal.example.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 同源说明

上述配置下，浏览器访问 `https://portal.example.com`，API 请求也是同一域名，属于**同源**，一般**不必**单独配置 `cors_origins`。只有当你把静态站与 API 拆到不同域名时，才需要在 `portal.display.cors_origins` 或 `GATEHOUSE_PORTAL_CORS_ORIGINS` 中写明前端 Origin。

---

## 7. 首次上线检查清单

在本地：

- [ ] `curl http://127.0.0.1:4096/health` OpenCode 正常
- [ ] `curl http://127.0.0.1:18471/portal/api/health` Portal API 正常
- [ ] `frpc` 运行中，VPS 上 `curl http://127.0.0.1:18471/portal/api/health` 通

在公网浏览器：

- [ ] 打开 `https://portal.example.com/` 办公室能加载
- [ ] 开发者工具 Network：`/portal/api/snapshot` 200
- [ ] `/portal/events` 类型为 `eventsource`，状态 pending（长连接）
- [ ] 切到「团队数据」Tab，token/cost 有数据
- [ ] 发布博客后，博客 Tab 能在短时间内出现新文章（不必等满 30s TTL）

安全：

- [ ] 公网域名**无法**访问 `https://portal.example.com:18472` 或任意 `/admin` 反代
- [ ] VPS 防火墙未对公网开放 18471/18472（仅 Nginx 443 + frp 控制端口）

---

## 8. 日常更新流程

| 变更类型 | 操作 |
|----------|------|
| 只改 Portal UI | 本地 `bun run build` → `rsync dist/portal` 到 VPS → 浏览器强刷 |
| 只改 Portal API / 插件 | 本地拉代码 → 重启 OpenCode / `gatehouse-portal-api` → 一般**不必**重传静态包 |
| 改 `portal.display` 或品牌 | 改 `.gatehouse/config.yaml` → 重启 Portal API；poll 间隔刷新页面即生效 |
| 改办公室工位数等 | 依赖 API 重新生成 office 资产；确保 OpenCode 与 Portal 跑起来后访问一次办公室 Tab |

---

## 9. 常见问题

### 页面一直「连接中」

1. VPS 上 `curl http://127.0.0.1:18471/portal/api/health` 是否失败 → 检查 frpc / 本地 API。
2. Nginx 是否只配了静态、没配 `/portal/api` 反代。
3. 本地 `GATEHOUSE_PROJECT_DIR` 是否指向正确项目。

### SSE 频繁断开

1. 检查 Nginx `location /portal/events` 是否 `proxy_buffering off`、`proxy_read_timeout` 足够长。
2. 中间 CDN / 负载均衡是否不支持 SSE（需绕过或关闭缓冲）。

### CORS 报错

多出现在**静态与 API 不同域**时。在 `.gatehouse/config.yaml` 增加：

```yaml
portal:
  display:
    cors_origins:
      - https://你的前端域名
```

或临时设置 `GATEHOUSE_PORTAL_CORS_ORIGINS`。

### `forbidden_project` / 403

API 的 `?project=` slug 与 `portal.project_slug` 不一致，或请求未带 project 且默认目录校验失败。公网访问建议固定 slug：

```text
https://portal.example.com/?project=gatehouse-live
```

并在 config 中设置相同的 `project_slug`。

### 观众人数与性能

默认 `sse_max: 500`，API 有 TTL 缓存与单例 OpenCode bridge。约 **100 人同时围观**在同源 Nginx + 单 Portal API 进程下通常可行；更高并发需压测并考虑调大 `sse_max`、略增 poll / TTL 间隔。

---

## 10. 端口与环境变量速查

| 端口 / 变量 | 默认值 | 说明 |
|-------------|--------|------|
| OpenCode | `4096` | `OPENCODE_URL` |
| Portal Display | `18471` | `GATEHOUSE_PORTAL_PORT`，可经 frp 穿透 |
| Portal Admin | `18472` | **仅 loopback**，`GATEHOUSE_PORTAL_ADMIN_PORT` |
| `GATEHOUSE_PROJECT_DIR` | — | 项目根目录（必填） |
| `GATEHOUSE_PORTAL_UI=0` | — | 本地不启 Vite UI，适合 VPS 静态分离 |
| `GATEHOUSE_PORTAL=0` | — | 完全关闭 Portal |
| `portal.display.*` | 见模板注释 | 推荐写入 config，少依赖 export |

---

## 相关文档

- [快速上手](../getting-started.zh.md) — Portal 功能概览
- [packages/portal/README.md](../../packages/portal/README.md) — 本地开发与 demo
- [packages/core/README.md](../../packages/core/README.md) — 插件与 IM Channels
