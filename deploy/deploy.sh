#!/usr/bin/env bash
# Know Canvas — 一键部署到 Ubuntu VPS（ha2.digitalvio.shop）
#
# 用法（在本地开发机跑）:
#   bash deploy/deploy.sh user@ha2.digitalvio.shop
#
# 干什么:
#   1. 本地 npm run build 生成 dist/
#   2. 通过 ssh 到目标机器：
#      - 创建 /opt/know-canvas + /var/www/know-canvas 目录
#      - rsync 上传 dist/ 到 /var/www/know-canvas/
#      - rsync 上传 server/ 到 /opt/know-canvas/server/
#      - 在远端 cd /opt/know-canvas/server && npm install --production
#      - 软链 systemd unit 并启动
#      - 提示用户手动追加 Caddy 配置
#
# 不会自动改 Caddyfile（共用 Hermes 配置太敏感），需要用户回看 deploy/Caddyfile.canvas

set -e

if [ -z "$1" ]; then
  echo "用法: bash deploy/deploy.sh user@host"
  echo "  例: bash deploy/deploy.sh root@ha2.digitalvio.shop"
  exit 1
fi

REMOTE="$1"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[deploy] 项目根: $PROJECT_ROOT"
echo "[deploy] 目标: $REMOTE"

# 1. 本地 build（带子路径 base=/canvas/）
echo ""
echo "==> 1/5  本地 build 前端（base=/canvas/）"
cd "$PROJECT_ROOT"
npm run build:canvas

if [ ! -d "dist" ]; then
  echo "[deploy] ERROR: dist/ 不存在，build 可能失败"
  exit 1
fi

# 2. 远端建目录
echo ""
echo "==> 2/5  远端建目录"
ssh "$REMOTE" "set -e; \
  sudo mkdir -p /opt/know-canvas/server /var/www/know-canvas; \
  sudo chown -R \$USER:\$USER /opt/know-canvas /var/www/know-canvas"

# 3. 上传前端
echo ""
echo "==> 3/5  上传前端 build → /var/www/know-canvas/"
rsync -az --delete "$PROJECT_ROOT/dist/" "$REMOTE:/var/www/know-canvas/"

# 4. 上传 server + 安装依赖
echo ""
echo "==> 4/5  上传 server/ → /opt/know-canvas/server/"
rsync -az --delete --exclude='node_modules' --exclude='yjs-data' \
  "$PROJECT_ROOT/server/" "$REMOTE:/opt/know-canvas/server/"

echo "        远端 npm install..."
ssh "$REMOTE" "cd /opt/know-canvas/server && npm install --production"

# 5. 软链 systemd unit
echo ""
echo "==> 5/5  systemd 服务"
scp "$PROJECT_ROOT/deploy/know-canvas-yws.service" "$REMOTE:/tmp/"
ssh "$REMOTE" "set -e; \
  sudo mv /tmp/know-canvas-yws.service /etc/systemd/system/; \
  sudo systemctl daemon-reload; \
  sudo systemctl enable know-canvas-yws; \
  sudo systemctl restart know-canvas-yws; \
  sleep 2; \
  sudo systemctl status know-canvas-yws --no-pager -l | head -20"

# 健康检查
echo ""
echo "==> 健康检查"
ssh "$REMOTE" "curl -sf http://127.0.0.1:1234/health || echo '(yws 未起？看 journalctl -u know-canvas-yws）'"

echo ""
echo "============================================================"
echo "部署完成。下一步手动操作："
echo ""
echo "1) 把 deploy/Caddyfile.canvas 中的两段（/canvas/ 和 /yws/）"
echo "   合并到现有的 /etc/caddy/Caddyfile 中 ha2.digitalvio.shop 这个 site block 里"
echo ""
echo "2) sudo caddy validate /etc/caddy/Caddyfile  (检查语法)"
echo "   sudo systemctl reload caddy             (生效)"
echo ""
echo "3) 浏览器打开 https://ha2.digitalvio.shop/canvas/  开始用！"
echo ""
echo "可选：开 token 鉴权"
echo "   sudo systemctl edit know-canvas-yws  → 添加 Environment=KNOW_CANVAS_TOKEN=xxx"
echo "   前端 yjsClient.js 里相应也带 token （后续优化）"
echo "============================================================"
