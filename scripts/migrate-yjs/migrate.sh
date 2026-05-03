#!/usr/bin/env bash
# migrate.sh — 一键合并两台 VPS 的 know-canvas 房间历史
#
# 用法（在本地开发机跑）：
#   ROOM=demo-final \
#   OLD_VPS="root@ha2.digitalvio.shop" \
#   OLD_PORT=22 \
#   NEW_VPS="root@66.245.216.250" \
#   NEW_PORT=8765 \
#   bash scripts/migrate-yjs/migrate.sh
#
# 可选环境变量：
#   ROOM             房间名（默认 demo-final）
#   OLD_VPS          旧 VPS SSH 地址（user@host）
#   OLD_PORT         旧 VPS SSH 端口（默认 22）
#   NEW_VPS          新 VPS SSH 地址（user@host）
#   NEW_PORT         新 VPS SSH 端口（默认 22）
#   SERVER_DIR       VPS 上 server 目录（默认 /opt/know-canvas/server）
#   YDATA            VPS 上 LevelDB 目录（默认 ./yjs-data，相对 SERVER_DIR）
#   SKIP_RESTART     设为 1 跳过重启 yws（手动控制）
#   DRY_RUN          设为 1 只 dump + merge，不 restore
#
# 输出：
#   tmp/migrate-<timestamp>/room-old.bin     旧 VPS dump
#   tmp/migrate-<timestamp>/room-new.bin     新 VPS dump
#   tmp/migrate-<timestamp>/room-merged.bin  合并结果
#   tmp/migrate-<timestamp>/migrate.log      执行日志

set -euo pipefail

# ============================================================
# 配置
# ============================================================
ROOM="${ROOM:-demo-final}"
OLD_VPS="${OLD_VPS:-}"
OLD_PORT="${OLD_PORT:-22}"
NEW_VPS="${NEW_VPS:-}"
NEW_PORT="${NEW_PORT:-22}"
SERVER_DIR="${SERVER_DIR:-/opt/know-canvas/server}"
YDATA="${YDATA:-./yjs-data}"
SKIP_RESTART="${SKIP_RESTART:-0}"
DRY_RUN="${DRY_RUN:-0}"

if [ -z "$OLD_VPS" ] || [ -z "$NEW_VPS" ]; then
  echo "ERROR: 必须指定 OLD_VPS 和 NEW_VPS"
  echo ""
  echo "示例："
  echo "  ROOM=demo-final \\"
  echo "    OLD_VPS=root@ha2.digitalvio.shop OLD_PORT=22 \\"
  echo "    NEW_VPS=root@66.245.216.250 NEW_PORT=8765 \\"
  echo "    bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
WORK="$PROJECT_ROOT/tmp/migrate-$TS"
mkdir -p "$WORK"

OLD_SSH="-p $OLD_PORT -o StrictHostKeyChecking=accept-new"
NEW_SSH="-p $NEW_PORT -o StrictHostKeyChecking=accept-new"

echo "============================================================"
echo "  Know Canvas · Yjs Room Migration"
echo "============================================================"
echo "  ROOM        = $ROOM"
echo "  OLD VPS     = $OLD_VPS  (port $OLD_PORT)"
echo "  NEW VPS     = $NEW_VPS  (port $NEW_PORT)"
echo "  SERVER_DIR  = $SERVER_DIR"
echo "  YDATA       = $YDATA"
echo "  WORK        = $WORK"
echo "  DRY_RUN     = $DRY_RUN"
echo "============================================================"
echo ""

# ============================================================
# Step 1: 上传 dump-room.cjs 到两台 VPS
# ============================================================
echo "==> 1/6  上传 dump-room.cjs 到两台 VPS"
scp -P "$OLD_PORT" "$SCRIPT_DIR/dump-room.cjs" "$OLD_VPS:/tmp/dump-room.cjs"
scp -P "$NEW_PORT" "$SCRIPT_DIR/dump-room.cjs" "$NEW_VPS:/tmp/dump-room.cjs"

# ============================================================
# Step 2: 在两台 VPS 上 dump
# ============================================================
echo ""
echo "==> 2/6  旧 VPS dump room=$ROOM"
ssh $OLD_SSH "$OLD_VPS" "cd $SERVER_DIR && node /tmp/dump-room.cjs '$ROOM' /tmp/room-old.bin '$YDATA'"

echo ""
echo "==> 3/6  新 VPS dump room=$ROOM"
ssh $NEW_SSH "$NEW_VPS" "cd $SERVER_DIR && node /tmp/dump-room.cjs '$ROOM' /tmp/room-new.bin '$YDATA'"

# ============================================================
# Step 3: 拉回本地
# ============================================================
echo ""
echo "==> 4/6  拉回本地"
scp -P "$OLD_PORT" "$OLD_VPS:/tmp/room-old.bin" "$WORK/room-old.bin"
scp -P "$NEW_PORT" "$NEW_VPS:/tmp/room-new.bin" "$WORK/room-new.bin"

ls -lh "$WORK"/*.bin

# ============================================================
# Step 4: 本地合并
# ============================================================
echo ""
echo "==> 5/6  本地合并"
cd "$PROJECT_ROOT"
if [ ! -d "node_modules/yjs" ]; then
  echo "[migrate] 本地缺 yjs，先 npm install"
  npm install yjs
fi

node "$SCRIPT_DIR/merge-rooms.cjs" \
  "$WORK/room-merged.bin" \
  "$WORK/room-old.bin" \
  "$WORK/room-new.bin"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "============================================================"
  echo "  DRY_RUN=1，已停在 merge 步骤"
  echo "  合并结果在: $WORK/room-merged.bin"
  echo "  确认无误后，去掉 DRY_RUN 重跑"
  echo "============================================================"
  exit 0
fi

# ============================================================
# Step 5: 上传 restore + 灌回新 VPS
# ============================================================
echo ""
echo "==> 6/6  上传 restore + 灌回新 VPS"
scp -P "$NEW_PORT" "$SCRIPT_DIR/restore-room.cjs" "$NEW_VPS:/tmp/restore-room.cjs"
scp -P "$NEW_PORT" "$WORK/room-merged.bin" "$NEW_VPS:/tmp/room-merged.bin"

if [ "$SKIP_RESTART" = "0" ]; then
  echo "[migrate] 停止 know-canvas-yws ..."
  ssh $NEW_SSH "$NEW_VPS" "systemctl stop know-canvas-yws || true"
fi

ssh $NEW_SSH "$NEW_VPS" "cd $SERVER_DIR && node /tmp/restore-room.cjs '$ROOM' /tmp/room-merged.bin '$YDATA'"

if [ "$SKIP_RESTART" = "0" ]; then
  echo "[migrate] 启动 know-canvas-yws ..."
  ssh $NEW_SSH "$NEW_VPS" "systemctl start know-canvas-yws && sleep 2 && systemctl is-active know-canvas-yws"

  # 健康检查
  ssh $NEW_SSH "$NEW_VPS" "curl -sf http://127.0.0.1:1234/health"
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo "============================================================"
echo "  ✓ 合并完成"
echo "============================================================"
echo ""
echo "下一步建议："
echo "  1. 浏览器打开新 VPS 上的画布，确认节点都在"
echo "     http://66.245.216.250:8081/canvas/?room=$ROOM"
echo "     或经域名: https://canvas.digitalvio.shop/canvas/?room=$ROOM"
echo ""
echo "  2. DNS 切换：把 canvas.digitalvio.shop 的 A 记录指到 66.245.216.250"
echo "     如果用 sing-box / mihomo 本地代理，需要更新 fake-ip 映射"
echo ""
echo "  3. 让客户端清 IndexedDB（强制 reload 或前端发版加 build hash）"
echo ""
echo "  4. 旧 VPS 留 24-48h 回滚窗口，确认无误后再退役"
echo ""
echo "工作目录：$WORK"
echo "  - room-old.bin     旧 VPS dump"
echo "  - room-new.bin     新 VPS dump"
echo "  - room-merged.bin  合并结果（已灌入新 VPS）"
echo ""
echo "回滚（在新 VPS 上）："
echo "  systemctl stop know-canvas-yws"
echo "  cd $SERVER_DIR"
echo "  ls -d yjs-data.bak.*  # 找最近的备份"
echo "  rm -rf yjs-data && mv yjs-data.bak.<TS> yjs-data"
echo "  systemctl start know-canvas-yws"
echo "============================================================"
