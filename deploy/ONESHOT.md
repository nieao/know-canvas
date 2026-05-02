# Know Canvas — VPS 一键部署 oneshot

> **场景**: boss / lichang333 在 VPS 终端 (ssh root@ha2.digitalvio.shop) 直接粘贴一行命令完成全部部署
> **优势**: 不依赖本地 rsync / SSH key 配对; 不依赖部署人本机的网络环境

---

## TL;DR — 一行部署

ssh 到 VPS 后, 复制粘贴这一段:

```bash
sudo bash -c '
set -e
test -d /opt/know-canvas/.git && (cd /opt/know-canvas && git pull) || git clone https://github.com/nieao/know-canvas.git /opt/know-canvas
cd /opt/know-canvas
bash deploy/deploy-on-vps.sh
'
```

**全程约 3-5 分钟**, 期间会自动:
1. git clone / pull 最新代码
2. npm install + npm run build:canvas (前端 build, base=/canvas/)
3. 复制 dist/ 到 /var/www/know-canvas/
4. cd server && npm install (Yjs sync 后端依赖)
5. 装 systemd unit know-canvas-yws + 启动
6. 健康检查 (curl localhost:1234/health)
7. 打印 Caddy 配置追加指引 (这步要手动 — 避免破坏 Hermes 的 Caddyfile)

---

## 前置要求 (VPS 应该已经满足)

```bash
# 检查
node --version    # 应该 >= 18
npm --version     # 应该 >= 8
git --version     # 任意
caddy version     # Hermes 已经在用, 应该已装

# 如果 node 不够新:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 部署完成后必须手动做的一步: Caddy 配置

部署脚本不会自动改 `/etc/caddy/Caddyfile` (太敏感, 可能跟 Hermes 配置冲突)。

```bash
sudo nano /etc/caddy/Caddyfile
```

在现有 `ha2.digitalvio.shop {...}` site block 里 (Hermes 的反代规则**之前**), 追加:

```caddy
# Know Canvas 前端 (静态文件)
handle_path /canvas/* {
    root * /var/www/know-canvas
    try_files {path} /index.html
    file_server
}

# Yjs WebSocket 反代 → localhost:1234
handle_path /yws/* {
    reverse_proxy localhost:1234 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }
}
```

然后:

```bash
sudo caddy validate /etc/caddy/Caddyfile     # 检查语法
sudo systemctl reload caddy                  # 生效
```

**完整范本**在 `/opt/know-canvas/deploy/Caddyfile.canvas` (deploy-on-vps.sh 末尾会打印).

---

## 验证部署成功

```bash
# 1) y-ws-server 起来
curl -s http://127.0.0.1:1234/health
# 期望: {"ok":true,"service":"know-canvas-yjs-sync","port":1234,...}

# 2) 前端能访问
curl -s -o /dev/null -w '%{http_code}\n' https://ha2.digitalvio.shop/canvas/
# 期望: 200

# 3) 浏览器打开
# https://ha2.digitalvio.shop/canvas/?room=demo-railway
# 在两个浏览器 / 两台电脑同时打开同一房间, 应该实时同步
```

---

## 升级 (代码更新后重新部署)

```bash
cd /opt/know-canvas && sudo bash deploy/deploy-on-vps.sh
```

git pull → 重 build → 重启 systemd. **服务无中断升级** (重启 yws 时 LevelDB 数据保留).

---

## 故障排查

```bash
# Yjs sync 起不来?
sudo journalctl -u know-canvas-yws -f

# 看占用端口
sudo netstat -tlnp | grep -E ':(1234|17081|18080)'

# 重启
sudo systemctl restart know-canvas-yws

# 备份画布数据 (LevelDB)
sudo tar czf /root/yjs-backup-$(date +%F).tgz /opt/know-canvas/server/yjs-data/

# 完全重置 (⚠ 删除所有画布数据)
sudo systemctl stop know-canvas-yws
sudo rm -rf /opt/know-canvas/server/yjs-data
sudo systemctl start know-canvas-yws
```

---

## 这套部署不包含的东西 (boss 自己还要做)

| 不做的事 | 怎么补 |
|---------|------|
| **claude-bridge** (本机 Claude CLI 桥) | 每个用户**自己电脑**跑 `cd server && npm run bridge`, 不能放云端 (会暴露 Claude 账号) |
| **hermes-proxy** (Hermes API 中转) | 同上, 不能跟 know-canvas 一起部署到云端 — 凭据敏感 (HERMES_USER/PASS), 应该走 Caddy 前置反代或本机跑 |
| **WSS 协议升级** | 现在脚本配的是 ws:// 反代, 上 SSL 后 Caddy 会自动 upgrade 到 wss:// (Caddy 默认行为) |
| **token 鉴权** | 默认关. 开启: `sudo systemctl edit know-canvas-yws` 加 `Environment=KNOW_CANVAS_TOKEN=随机字符串`, 然后前端 yjsClient.js 也要带 token (P1) |

---

## 给 [meta-cc] / 后续 cc 的提示

当用户说"部署 know-canvas 到云端" / "推上去" / "上线":

1. 检查 boss 本机能否 SSH 到 VPS (`ssh root@ha2.digitalvio.shop` 是否通)
2. **如果本机 SSH 不通** (DNS 劫持 / VPN / 防火墙阻拦): 用本文档的 oneshot 模式让 boss/lichang333 在 VPS 上自己跑
3. **如果本机 SSH 通**: 走 `bash deploy/deploy.sh root@ha2.digitalvio.shop` (本地 build + rsync)

两种方式产出一致, 选你能做的.
