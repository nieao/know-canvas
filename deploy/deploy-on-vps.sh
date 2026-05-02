#!/usr/bin/env bash
# Know Canvas — 在 VPS 本地一键部署 (不依赖本地 SSH)
#
# 用法 (在 VPS 上 ssh 登录后跑):
#   sudo bash deploy/deploy-on-vps.sh
#
# 或者 oneshot 远程拉取 + 部署:
#   sudo bash -c "git clone https://github.com/nieao/know-canvas.git /opt/know-canvas-deploy && cd /opt/know-canvas-deploy && bash deploy/deploy-on-vps.sh"
#
# 假设 (满足则 OK, 不满足脚本会提示):
#   - Ubuntu 20.04+ / Debian 11+
#   - root 权限 (跑 sudo) 或者 systemd 写权限
#   - node >= 18, npm >= 8
#   - git
#   - Caddy 已部署且有 ha2.digitalvio.shop 的 site block (Hermes 已用)
#
# 部署后:
#   /opt/know-canvas/         前端源码 + server (做 git pull 升级用)
#   /var/www/know-canvas/     前端 build 产物 (Caddy 提供)
#   /opt/know-canvas/server/yjs-data/  LevelDB 持久化
#   systemd: know-canvas-yws  Yjs sync 守护进程
#
# 不会自动改 Caddyfile (太敏感, 可能跟 Hermes 冲突)
# 部署完后会打印 Caddyfile 追加位置 + 内容

set -e

REPO_URL="${REPO_URL:-https://github.com/nieao/know-canvas.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/know-canvas}"
WEB_DIR="${WEB_DIR:-/var/www/know-canvas}"
BRANCH="${BRANCH:-main}"

echo "============================================================"
echo "  Know Canvas 一键 VPS 部署"
echo "  仓库: $REPO_URL"
echo "  分支: $BRANCH"
echo "  安装到: $INSTALL_DIR + $WEB_DIR"
echo "============================================================"

# ---- 0. 前置检查 ----
echo ""
echo "[0/6] 前置检查..."

if [ "$EUID" -ne 0 ]; then
  echo "  WARN: 没用 root 运行, 部分步骤可能 sudo 弹密码"
fi

for cmd in node npm git; do
  if ! command -v $cmd > /dev/null 2>&1; then
    echo "  ERROR: 缺少 $cmd"
    if [ "$cmd" = "node" ]; then
      echo "    安装: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    elif [ "$cmd" = "git" ]; then
      echo "    安装: sudo apt install -y git"
    fi
    exit 1
  fi
done

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  ERROR: node 版本 $(node -v) < 18, 升级一下"
  exit 1
fi

echo "  ✓ node $(node -v), npm $(npm -v), git OK"

# ---- 1. clone / pull ----
echo ""
echo "[1/6] 拉取代码到 $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  目录已存在, git pull"
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo "  git clone"
  sudo mkdir -p "$(dirname "$INSTALL_DIR")"
  sudo git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ---- 2. 装前端依赖 + build ----
echo ""
echo "[2/6] 装前端依赖 + build (base=/canvas/)..."
cd "$INSTALL_DIR"
npm ci --no-audit --no-fund 2>&1 | tail -3 || npm install --no-audit --no-fund 2>&1 | tail -3
npm run build:canvas 2>&1 | tail -5

if [ ! -d "$INSTALL_DIR/dist" ]; then
  echo "  ERROR: build 失败, 没看到 dist/"
  exit 1
fi
echo "  ✓ build 完成, dist/ 大小 $(du -sh dist | cut -f1)"

# ---- 3. 复制 dist → /var/www/know-canvas/ ----
echo ""
echo "[3/6] 复制 dist → $WEB_DIR..."
sudo mkdir -p "$WEB_DIR"
sudo rsync -a --delete "$INSTALL_DIR/dist/" "$WEB_DIR/"
echo "  ✓ web 目录已更新"

# ---- 4. 装 server 依赖 ----
echo ""
echo "[4/6] 装 server (Yjs sync) 依赖..."
cd "$INSTALL_DIR/server"
npm install --production --no-audit --no-fund 2>&1 | tail -3
echo "  ✓ server deps OK"

# ---- 5. 装 systemd unit + 重启相关服务 ----
echo ""
echo "[5/6] 装 systemd unit know-canvas-yws + restart 相关守护..."
sudo cp "$INSTALL_DIR/deploy/know-canvas-yws.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable know-canvas-yws
sudo systemctl restart know-canvas-yws
sleep 2
echo "  yws status:"
sudo systemctl status know-canvas-yws --no-pager -l | head -10

# 如果 conductor 服务已装 (lichang/前面 agent 装过), 重启让它读新代码
# 不存在的话不报错
if systemctl list-unit-files | grep -q '^know-canvas-conductor.service'; then
  echo "  conductor 服务存在, 重启读新代码..."
  sudo systemctl restart know-canvas-conductor
  sleep 2
  sudo systemctl status know-canvas-conductor --no-pager -l | head -10
else
  echo "  (跳过 conductor — 服务未装, 用 server/orchestra-hermes-worker.js 手动起)"
fi

# llm-proxy 同理
if systemctl list-unit-files | grep -q '^know-canvas-llm-proxy.service'; then
  echo "  llm-proxy 不需要重启 (代码不在 repo, /opt/know-canvas-llm-proxy/server.js)"
fi

# ---- 6. 健康检查 ----
echo ""
echo "[6/6] 健康检查..."
HEALTH=$(curl -sf http://127.0.0.1:1234/health 2>&1 || echo 'FAILED')
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "  ✓ y-ws-server /health OK: $HEALTH"
else
  echo "  ✗ y-ws-server 起不来: $HEALTH"
  echo "  看日志: sudo journalctl -u know-canvas-yws -n 50"
fi

# ---- 完成提示 ----
echo ""
echo "============================================================"
echo "  ✓ Know Canvas 部署完成"
echo "============================================================"
echo ""
echo "下一步手动操作 (Caddy 追加, 不能自动改避免破坏 Hermes 配置):"
echo ""
echo "  1) 编辑 /etc/caddy/Caddyfile, 在 ha2.digitalvio.shop 这个 site block 里"
echo "     插入下面两段 (位于 Hermes 已有规则之前, Caddy 按顺序匹配):"
echo ""
echo "  --------- 复制开始 ---------"
sed -n '/^ha2.digitalvio.shop/,/^}/p' "$INSTALL_DIR/deploy/Caddyfile.canvas" 2>/dev/null || cat "$INSTALL_DIR/deploy/Caddyfile.canvas"
echo "  --------- 复制结束 ---------"
echo ""
echo "  2) sudo caddy validate /etc/caddy/Caddyfile"
echo "  3) sudo systemctl reload caddy"
echo ""
echo "验证: curl -sf https://ha2.digitalvio.shop/canvas/  → 应该看到 HTML"
echo "      curl -sf http://127.0.0.1:1234/health         → y-ws ok"
echo ""
echo "升级方式 (将来):"
echo "  cd $INSTALL_DIR && sudo bash deploy/deploy-on-vps.sh"
echo ""
echo "查看 Yjs 日志:"
echo "  sudo journalctl -u know-canvas-yws -f"
echo ""
echo "============================================================"
