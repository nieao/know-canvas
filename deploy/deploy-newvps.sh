#!/usr/bin/env bash
# Know Canvas — 一键部署到新 VPS (66.245.216.250:8765)
#
# 用法 (本地开发机):
#   DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-newvps.sh
#
# 可选环境变量:
#   REMOTE_USER  默认 root
#   REMOTE_HOST  默认 66.245.216.250
#   REMOTE_PORT  默认 8765
#   DEEPSEEK_API_KEY  必填; 写入远端 /etc/know-canvas/llm.env (不进 git)
#   LLM_BASE_URL      默认 https://api.deepseek.com/v1
#   LLM_MODEL         默认 deepseek-chat
#
# 干什么:
#   1. 本地 npm run build:canvas
#   2. SSH 远端: 检查 / 安装 caddy + node 22
#   3. rsync dist/ → /var/www/know-canvas/
#   4. rsync server/ → /opt/know-canvas/server/  + npm install --production
#   5. 写 /etc/know-canvas/llm.env (LLM_API_KEY + base url + model)
#   6. 装 systemd unit (yws + llm-proxy), enable + start
#   7. 装 Caddyfile, reload caddy
#   8. 健康检查 /canvas/ + /canvas/api/llm/health

set -euo pipefail

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-66.245.216.250}"
REMOTE_PORT="${REMOTE_PORT:-8765}"
LLM_BASE_URL="${LLM_BASE_URL:-https://api.deepseek.com/v1}"
LLM_MODEL="${LLM_MODEL:-deepseek-chat}"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "ERROR: DEEPSEEK_API_KEY 必填"
  echo "用法: DEEPSEEK_API_KEY=sk-xxx bash deploy/deploy-newvps.sh"
  exit 1
fi

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_OPTS="-p ${REMOTE_PORT} -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -p ${REMOTE_PORT} -o StrictHostKeyChecking=accept-new"
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
ssh $SSH_OPTS "$REMOTE" 'bash -s' <<'REMOTE_PROBE'
set -e
echo "[probe] OS: $(. /etc/os-release && echo $PRETTY_NAME)"
echo "[probe] uname: $(uname -a)"

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
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update
  apt install -y caddy
fi
echo "[probe] caddy: $(caddy version | head -1)"

# rsync
if ! command -v rsync >/dev/null 2>&1; then
  apt install -y rsync
fi

# 准备目录
mkdir -p /opt/know-canvas/server /var/www/know-canvas /etc/know-canvas
chown -R www-data:www-data /opt/know-canvas /var/www/know-canvas
echo "[probe] 目录就绪"
REMOTE_PROBE

# 3. 上传前端
echo ""
echo "==> 3/8  rsync dist/ → /var/www/know-canvas/"
rsync -az --delete -e "$RSYNC_SSH" "$PROJECT_ROOT/dist/" "$REMOTE:/var/www/know-canvas/"
ssh $SSH_OPTS "$REMOTE" "chown -R www-data:www-data /var/www/know-canvas"

# 4. 上传 server + 装依赖
echo ""
echo "==> 4/8  rsync server/ → /opt/know-canvas/server/"
rsync -az --delete --exclude='node_modules' --exclude='yjs-data' \
  -e "$RSYNC_SSH" \
  "$PROJECT_ROOT/server/" "$REMOTE:/opt/know-canvas/server/"

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

# 6. 装 systemd units
echo ""
echo "==> 6/8  装 systemd unit (yws + llm-proxy)"
scp -P "$REMOTE_PORT" \
  "$PROJECT_ROOT/deploy/know-canvas-yws.service" \
  "$PROJECT_ROOT/deploy/know-canvas-llm-proxy.service" \
  "$REMOTE:/tmp/"

ssh $SSH_OPTS "$REMOTE" 'set -e
mv /tmp/know-canvas-yws.service /etc/systemd/system/
mv /tmp/know-canvas-llm-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable know-canvas-yws know-canvas-llm-proxy
systemctl restart know-canvas-yws know-canvas-llm-proxy
sleep 2
echo "--- yws ---"
systemctl status know-canvas-yws --no-pager -l | head -15
echo "--- llm-proxy ---"
systemctl status know-canvas-llm-proxy --no-pager -l | head -15
'

# 7. 装 Caddyfile
echo ""
echo "==> 7/8  装 Caddyfile + reload"
scp -P "$REMOTE_PORT" "$PROJECT_ROOT/deploy/Caddyfile.newvps" "$REMOTE:/tmp/Caddyfile"
ssh $SSH_OPTS "$REMOTE" 'set -e
mv /tmp/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
sleep 1
systemctl status caddy --no-pager -l | head -10
'

# 8. 健康检查
echo ""
echo "==> 8/8  健康检查"
ssh $SSH_OPTS "$REMOTE" 'set +e
echo "--- 本机 yws health ---"
curl -sf http://127.0.0.1:1234/health && echo
echo "--- 本机 llm-proxy health ---"
curl -sf http://127.0.0.1:17080/health && echo
echo "--- 通过 caddy /canvas/ ---"
curl -sI http://127.0.0.1/canvas/ | head -3
echo "--- 通过 caddy /canvas/api/llm/health ---"
curl -sf http://127.0.0.1/canvas/api/llm/health && echo
'

echo ""
echo "============================================================"
echo "部署完成。访问:"
echo ""
echo "  http://${REMOTE_HOST}/canvas/"
echo ""
echo "排查:"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u know-canvas-yws -n 50'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u know-canvas-llm-proxy -n 50'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'journalctl -u caddy -n 50'"
echo ""
echo "更换 API key:"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'nano /etc/know-canvas/llm.env'"
echo "  ssh -p ${REMOTE_PORT} ${REMOTE} 'systemctl restart know-canvas-llm-proxy'"
echo "============================================================"
