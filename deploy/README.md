# Know Canvas 部署到 ha2.digitalvio.shop

本目录包含部署到 Hermes Agent 同机 VPS 的所有脚本和配置。

## 文件清单

| 文件 | 用途 |
|------|------|
| `deploy.sh` | 一键部署脚本（在本地 Windows 跑 git bash 即可） |
| `Caddyfile.canvas` | 追加到现有 Caddyfile 的两段配置（前端 + WS 反代） |
| `know-canvas-yws.service` | systemd unit 文件，让 yws 守护进程开机自启 |

## 部署架构

```
浏览器 → https://ha2.digitalvio.shop/canvas/         （前端 Vite build 产物）
浏览器 → wss://ha2.digitalvio.shop/yws/<room>        （Yjs 实时同步，反代到 :1234）
浏览器 → https://ha2.digitalvio.shop/api/...         （Hermes Agent，已有）
浏览器 → http://localhost:18080/chat                 （用户本机的 claude CLI 桥）
```

服务器目录：
- `/var/www/know-canvas/` — 前端静态资源
- `/opt/know-canvas/server/` — Node 协作后端
- `/opt/know-canvas/server/yjs-data/` — LevelDB 持久化

## 一次部署流程

### 0. 准备前提

服务器（ha2.digitalvio.shop）已经装好：
- Node.js 18+ (Hermes 也需要)
- Caddy (Hermes 的反代)

把你本地的 SSH 公钥 (`~/.ssh/id_ed25519.pub` 之类) 加到服务器的 `~/.ssh/authorized_keys`。

本地 Windows 装 Git Bash 或 WSL（执行 `deploy.sh` 用）。

### 1. 跑部署脚本

```bash
# 在 know-canvas 项目根目录
bash deploy/deploy.sh root@ha2.digitalvio.shop
```

脚本会：
1. 在本地 `npm run build:canvas`（base=/canvas/）
2. ssh 到目标机器创建目录
3. rsync 上传 `dist/` 到 `/var/www/know-canvas/`
4. rsync 上传 `server/` 到 `/opt/know-canvas/server/`，远端 `npm install --production`
5. 软链 `know-canvas-yws.service` 到 systemd，启动并 enable

### 2. 手动追加 Caddy 配置

脚本不会自动改 Caddyfile，因为可能跟 Hermes 冲突。你需要：

```bash
ssh root@ha2.digitalvio.shop
sudo nano /etc/caddy/Caddyfile
```

把 `Caddyfile.canvas` 中 `/canvas/*` 和 `/yws/*` 两段 `handle_path` 块**插入**到现有 `ha2.digitalvio.shop {...}` 的 site block 内，**位于 Hermes 已有规则之前**（Caddy 按顺序匹配）。

```bash
sudo caddy validate /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 3. 验证

```bash
# 服务器健康检查
ssh root@ha2.digitalvio.shop 'curl -s http://127.0.0.1:1234/health'
# 预期: {"ok":true,"service":"know-canvas-yjs-sync",...}

# 浏览器
open https://ha2.digitalvio.shop/canvas/
```

输入用户名 + 房间号即可进入。让另外两位团队成员同样进入相同房间号，三人同步开始。

## 常用维护命令

```bash
# 看 yws 日志
ssh root@ha2.digitalvio.shop 'sudo journalctl -u know-canvas-yws -f'

# 重启 yws（更新 server/ 后用）
ssh root@ha2.digitalvio.shop 'sudo systemctl restart know-canvas-yws'

# 备份画布数据
ssh root@ha2.digitalvio.shop 'tar czf yjs-backup-$(date +%F).tgz /opt/know-canvas/server/yjs-data/'

# 清空所有房间数据（谨慎！）
ssh root@ha2.digitalvio.shop 'sudo systemctl stop know-canvas-yws && sudo rm -rf /opt/know-canvas/server/yjs-data && sudo systemctl start know-canvas-yws'
```

## 启用 token 鉴权（推荐）

```bash
sudo systemctl edit know-canvas-yws
# 加上：
# [Service]
# Environment=KNOW_CANVAS_TOKEN=随机32字节的字符串

sudo systemctl restart know-canvas-yws
```

然后前端 `src/collab/yjsClient.js` 的 `startSync` 调用要带 token 参数（黑客松 v0 没接，可后续加）。

## 多 Provider AI 模型

每位队员可以在画布右上齿轮里设置自己的 AI provider：
- **Claude CLI 桥（默认）**：每人本机跑 `cd server && npm run bridge`，零 API 成本
- **DeepSeek / GLM / MiniMax / 阿里通义 / OpenAI** 等：填 baseURL + apiKey + model
- **本地规则解析**：不调 LLM 兜底

这部分在前端 localStorage 配置，不需要服务端改动。

## Claude CLI 桥 — 使用提示

桥**只能在用户本机跑**（不能部署到云端服务器，否则等于把 claude 账号公开）：

```bash
cd /path/to/know-canvas/server
npm run bridge
# 监听 http://127.0.0.1:18080
```

启动后浏览器画布的 AI 设置面板选"Claude CLI 桥（本机）"，点"测试连接"应该绿色 OK。

如果 cloud 部署的画布想用本机 claude CLI，需要 CORS 白名单：
```bash
CLAUDE_BRIDGE_ALLOW_ORIGINS=https://ha2.digitalvio.shop npm run bridge
```
