#!/usr/bin/env bash
# Know Canvas — VPS autopull 安装脚本
# 在 VPS 上跑一次 (root), 之后每 60s 自动 git pull + build + 部署到 /var/www/know-canvas/
#
# 用法 (VPS root):
#   bash install-autopull.sh
#
# 卸载:
#   sudo systemctl disable --now know-canvas-autopull.timer
#   sudo rm /etc/systemd/system/know-canvas-autopull.{service,timer}
#   sudo rm /usr/local/bin/know-canvas-autopull.sh
#   sudo systemctl daemon-reload

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nieao/know-canvas.git}"
REPO_DIR="${REPO_DIR:-/opt/know-canvas-repo}"
WEB_DIR="${WEB_DIR:-/var/www/know-canvas}"
BRANCH="${BRANCH:-main}"
INTERVAL="${INTERVAL:-60s}"
SCRIPT_PATH=/usr/local/bin/know-canvas-autopull.sh
SVC_PATH=/etc/systemd/system/know-canvas-autopull.service
TIMER_PATH=/etc/systemd/system/know-canvas-autopull.timer

echo "============================================================"
echo "  Know Canvas autopull installer"
echo "  REPO_URL=$REPO_URL  BRANCH=$BRANCH  INTERVAL=$INTERVAL"
echo "  REPO_DIR=$REPO_DIR  WEB_DIR=$WEB_DIR"
echo "============================================================"

# ---- 1. clone or fetch ----
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[1/7] cloning $REPO_URL → $REPO_DIR"
  git clone --depth 50 "$REPO_URL" "$REPO_DIR"
else
  echo "[1/7] repo exists, fetching $BRANCH"
  cd "$REPO_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi
cd "$REPO_DIR"

# ---- 2. initial npm ci ----
echo "[2/7] initial npm ci"
npm ci --no-audit --no-fund

# ---- 3. write autopull script ----
echo "[3/7] writing $SCRIPT_PATH"
cat > "$SCRIPT_PATH" <<'SCRIPT'
#!/usr/bin/env bash
# 60s timer 触发. 仅在远端有新 commit 时才 build + 部署.
set -euo pipefail
REPO_DIR=/opt/know-canvas-repo
WEB_DIR=/var/www/know-canvas
BRANCH=main
LOG_PFX="[know-canvas-autopull]"

cd "$REPO_DIR"

git fetch origin "$BRANCH" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$LOG_PFX new commit: $LOCAL → $REMOTE"

git reset --hard "origin/$BRANCH"

# package change → npm ci
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package.json package-lock.json; then
  echo "$LOG_PFX package change, npm ci"
  npm ci --no-audit --no-fund
fi

echo "$LOG_PFX building (BUILD_BASE=/canvas/)"
BUILD_BASE=/canvas/ npm run build

# rsync 同步 dist → web (不加 --delete 保留 docs/ + intro.html 等手动维护的文件)
echo "$LOG_PFX rsync dist → $WEB_DIR"
rsync -a dist/ "$WEB_DIR/"

# 写 deploy-marker 让外部 curl 能查当前 sha
echo "$REMOTE" > "$WEB_DIR/.deploy-marker"
echo "$LOG_PFX done $REMOTE"
SCRIPT
chmod +x "$SCRIPT_PATH"

# ---- 4. systemd service ----
echo "[4/7] writing $SVC_PATH"
cat > "$SVC_PATH" <<EOF
[Unit]
Description=Know Canvas autopull (git pull + build + deploy)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$SCRIPT_PATH
StandardOutput=journal
StandardError=journal
TimeoutStartSec=180
EOF

# ---- 5. systemd timer ----
echo "[5/7] writing $TIMER_PATH"
cat > "$TIMER_PATH" <<EOF
[Unit]
Description=Know Canvas autopull timer ($INTERVAL)

[Timer]
OnBootSec=30s
OnUnitActiveSec=$INTERVAL
Unit=know-canvas-autopull.service
Persistent=true

[Install]
WantedBy=timers.target
EOF

# ---- 6. enable + trigger initial run ----
echo "[6/7] enable + start timer"
systemctl daemon-reload
systemctl enable --now know-canvas-autopull.timer

echo "[6.5/7] triggering initial run (synchronous)"
systemctl start know-canvas-autopull.service

# ---- 7. status ----
echo "[7/7] verify"
echo "--- timer status ---"
systemctl status know-canvas-autopull.timer --no-pager | head -8
echo
echo "--- last service run ---"
journalctl -u know-canvas-autopull.service -n 25 --no-pager | tail -20
echo
echo "--- deploy-marker ---"
cat "$WEB_DIR/.deploy-marker" 2>/dev/null || echo "(not yet written)"

echo
echo "============================================================"
echo "Install complete. Timer fires every $INTERVAL."
echo "  Manual trigger:  sudo systemctl start know-canvas-autopull.service"
echo "  Live logs:       sudo journalctl -u know-canvas-autopull.service -f"
echo "  Disable:         sudo systemctl disable --now know-canvas-autopull.timer"
echo "============================================================"
