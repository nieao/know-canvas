#!/usr/bin/env bash
# Know Canvas — 一键部署到新 VPS (66.245.216.250:8765)
#
# 设计原则: 独立 caddy 实例 + 独立端口 (默认 :8081), 跟同机其他 caddy/服务完全解耦.
# 这样邻居 (比如 Hermes Agent) 怎么覆盖主 Caddyfile 都不影响我们.
#
# 用法 (本地开发机):
#   DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-newvps.sh
#
# 可选环境变量:
#   REMOTE_USER  默认 root
#   REMOTE_HOST  默认 66.245.216.250
#   REMOTE_PORT  默认 8765
#   CANVAS_PORT  默认 8081 (独立 caddy 监听端口)
#   DEEPSEEK_API_KEY  必填; 写入远端 /etc/know-canvas/llm.env (不进 git)
#   LLM_BASE_URL      默认 https://api.deepseek.com/v1
#   LLM_MODEL         默认 deepseek-chat
#
# 干什么:
#   1. 本地 npm run build:canvas
#   2. SSH 远端: 检查 / 安装 caddy + node 22
#   3. tar dist/ → /var/www/know-canvas/
#   4. tar server/ → /opt/know-canvas/server/  + npm install --production
#   5. 写 /etc/know-canvas/llm.env (LLM_API_KEY + base url + model)
#   6. 装 systemd unit (yws + llm-proxy + know-canvas-caddy), enable + start
#   7. 不动主 /etc/caddy/Caddyfile — 我们跑独立 caddy 实例监听 CANVAS_PORT
#   8. 健康检查 http://host:CANVAS_PORT/canvas/ + .../api/llm/health

set -euo pipefail

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-66.245.216.250}"
REMOTE_PORT="${REMOTE_PORT:-8765}"
CANVAS_PORT="${CANVAS_PORT:-8081}"
LLM_BASE_URL="${LLM_BASE_URL:-https://api.deepseek.com/v1}"
LLM_MODEL="${LLM_MODEL:-deepseek-chat}"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "ERROR: DEEPSEEK_API_KEY 必填"
  echo "用法: DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-newvps.sh"
  exit 1
fi

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_OPTS="-p ${REMOTE_PORT} -o StrictHostKeyChecking=accept-new"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[deploy-newvps] 项目根: $PROJECT_ROOT"
echo "[deploy-newvps] 目标:   $REMOTE  (port $REMOTE_PORT)"
echo "[deploy-newvps] 上游:   $LLM_BASE_URL  model=$LLM_MODEL"
echo ""

# 1. 本地 build
echo "==> 1/8  本地 build (base=/canvas/)"
cd "$PROJECT_ROOT"
npm run build:canvas
if [ ! -d "dist" ]; then
  echo "ERROR: dist/ 不存在 — build 失败"
  exit 1
fi

# 2. 远端环境探测 + 安装依赖
echo ""
echo "==> 2/8  探测远端环境 (caddy / node)"
ssh $SSH_OPTS "$REMOTE" "CANVAS_PORT=${CANVAS_PORT} bash -s" <<'REMOTE_PROBE'
set -e
echo "[probe] OS: $(. /etc/os-release && echo $PRETTY_NAME)"
echo "[probe] uname: $(uname -a)"
echo "[probe] CANVAS_PORT=${CANVAS_PORT}"

# Node
if ! command -v node >/dev/null 2>&1; then
  echo "[probe] 装 Node 22..."
  apt update
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
echo "[probe] node: $(node -v)"

# Caddy
if ! command -v caddy >/dev/null 2>&1; then
  echo "[probe] 装 Caddy..."
  # 清 /tmp 防止 tmpfs 满 (apt extract debian-keyring 需要 ~50MB)
  rm -rf /tmp/camoufox* /tmp/uv-* 2>/dev/null || true
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  # --batch --yes 避免 ssh 无 tty 时 gpg 报错
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update
  apt install -y caddy
fi
echo "[probe] caddy: $(caddy version | head -1)"

# UFW 开独立 caddy 监听端口 (默认 8081)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow ${CANVAS_PORT}/tcp 2>/dev/null || true
fi

# 独立 caddy 实例的目录 (跟系统 caddy 完全隔离, 不共享 storage)
mkdir -p /opt/know-canvas/server /opt/know-canvas/caddy-data /var/www/know-canvas /etc/know-canvas
chown -R caddy:caddy /opt/know-canvas/caddy-data 2>/dev/null || true
chown -R www-data:www-data /opt/know-canvas/server /var/www/know-canvas
echo "[probe] 目录就绪"
REMOTE_PROBE

# 3. 上传前端 (用 tar+ssh, Windows Git Bash 没 rsync 也能跑)
echo ""
echo "==> 3/8  tar dist/ → /var/www/know-canvas/"
tar -czf - -C "$PROJECT_ROOT/dist" . | ssh $SSH_OPTS "$REMOTE" \
  'cd /var/www/know-canvas && tar -xzf - && chown -R www-data:www-data /var/www/know-canvas'

# 4. 上传 server + 装依赖
echo ""
echo "==> 4/8  tar server/ → /opt/know-canvas/server/"
tar -czf - --exclude='node_modules' --exclude='yjs-data' --exclude='package-lock.json' \
  -C "$PROJECT_ROOT/server" . | ssh $SSH_OPTS "$REMOTE" \
  'cd /opt/know-canvas/server && tar -xzf -'

ssh $SSH_OPTS "$REMOTE" 'set -e
cd /opt/know-canvas/server
npm install --production
mkdir -p yjs-data
chown -R www-data:www-data /opt/know-canvas
'

# 5. 写 /etc/know-canvas/llm.env
echo ""
echo "==> 5/8  写 /etc/know-canvas/llm.env (含 DeepSeek key)"
ssh $SSH_OPTS "$REMOTE" "set -e
cat > /etc/know-canvas/llm.env <<EOF
LLM_API_KEY=${DEEPSEEK_API_KEY}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_MODEL=${LLM_MODEL}
EOF
chmod 600 /etc/know-canvas/llm.env
chown root:root /etc/know-canvas/llm.env
echo '[llm.env] 已写入'
"

# 6. 装 systemd units (yws + llm-proxy + 独立 caddy 实例)
echo ""
echo "==> 6/8  装 systemd unit (yws + llm-proxy + know-canvas-caddy)"
scp -P "$REMOTE_PORT" \
  "$PROJECT_ROOT/deploy/know-canvas-yws.service" \
  "$PROJECT_ROOT/deploy/know-canvas-llm-proxy.service" \
  "$PROJECT_ROOT/deploy/know-canvas-caddy.service" \
  "$PROJECT_ROOT/deploy/know-canvas-caddy.Caddyfile" \
  "$REMOTE:/tmp/"

ssh $SSH_OPTS "$REMOTE" 'set -e
mv /tmp/know-canvas-yws.service /etc/systemd/system/
mv /tmp/know-canvas-llm-proxy.service /etc/systemd/system/
mv /tmp/know-canvas-caddy.service /etc/systemd/system/
mv /tmp/know-canvas-caddy.Caddyfile /opt/know-canvas/Caddyfile
chown caddy:caddy /opt/know-canvas/Caddyfile 2>/dev/null || true
systemctl daemon-reload
systemctl enable know-canvas-yws know-canvas-llm-proxy know-canvas-caddy
systemctl restart know-canvas-yws know-canvas-llm-proxy know-canvas-caddy
sleep 2
echo "--- yws ---"
systemctl is-active know-canvas-yws || true
echo "--- llm-proxy ---"
systemctl is-active know-canvas-llm-proxy || true
echo "--- know-canvas-caddy ---"
systemctl is-active know-canvas-caddy || true
'

# 7. 推 dist (前端)
echo ""
echo "==> 7/8  推 dist 已在 step 3 完成 (这一步无操作, 跳过)"

# 8. 健康检查 (用独立端口 CANVAS_PORT)
echo ""
echo "==> 8/8  健康检查 (端口 ${CANVAS_PORT})"
ssh $SSH_OPTS "$REMOTE" "CANVAS_PORT=${CANVAS_PORT} bash -s" <<'HEALTHCHECK'
set +e
echo "--- 内部 yws ---"
curl -sf http://127.0.0.1:1234/health && echo
echo "--- 内部 llm-proxy ---"
curl -sf http://127.0.0.1:17080/health && echo
echo "--- 通过独立 caddy /canvas/ ---"
curl -sI http://127.0.0.1:${CANVAS_PORT}/canvas/ | head -3
echo "--- /canvas/api/llm/health ---"
curl -sf http://127.0.0.1:${CANVAS_PORT}/canvas/api/llm/health && echo
HEALTHCHECK

echo ""
echo "============================================================"
echo "部署完成。访问:"
echo ""
echo "  http://${REMOTE_HOST}:${CANVAS_PORT}/canvas/"
echo ""
echo "(独立 caddy 监听 :${CANVAS_PORT}, 完全跟系统 caddy/Hermes 解耦)"
echo ""
echo "排查:"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u know-canvas-yws -n 50'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u know-canvas-llm-proxy -n 50'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u know-canvas-caddy -n 50'"
echo ""
echo "更换 API key:"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'nano /etc/know-canvas/llm.env'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'systemctl restart know-canvas-llm-proxy'"
echo "============================================================"
