#!/usr/bin/env node
/**
 * restore-room.cjs — 在 VPS 上跑，把合并后的 update binary 灌回 LevelDB
 *
 * 用法：
 *   node restore-room.cjs <ROOM_NAME> <INPUT_FILE> [LEVELDB_DIR]
 *
 * 示例：
 *   cd /opt/know-canvas/server
 *   sudo systemctl stop know-canvas-yws
 *   node /tmp/restore-room.cjs demo-final /tmp/room-merged.bin ./yjs-data
 *   sudo systemctl start know-canvas-yws
 *
 * 干什么：
 *   1. 自动备份：把整个 LevelDB 目录 cp -r 到 yjs-data.bak.<timestamp>/
 *   2. clearDocument(ROOM)：清掉这个 room 的所有历史 update
 *   3. storeUpdate(ROOM, mergedBuf)：写入合并后的 update（一次完整 state）
 *   4. flushDocument(ROOM)：合并 LevelDB 里的散碎 update 为单条
 *
 * 警告：这个操作会**覆盖** ROOM 的历史。备份目录是回滚保险。
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const [, , ROOM, INPUT, DBDIR_ARG] = process.argv

if (!ROOM || !INPUT) {
  console.error('用法: node restore-room.cjs <ROOM_NAME> <INPUT_FILE> [LEVELDB_DIR]')
  process.exit(1)
}

const DBDIR = path.resolve(DBDIR_ARG || './yjs-data')
if (!fs.existsSync(DBDIR)) {
  console.error(`ERROR: LevelDB 目录不存在: ${DBDIR}`)
  process.exit(1)
}
if (!fs.existsSync(INPUT)) {
  console.error(`ERROR: 输入文件不存在: ${INPUT}`)
  process.exit(1)
}

console.log(`[restore] room=${ROOM}`)
console.log(`[restore] leveldb=${DBDIR}`)
console.log(`[restore] input=${INPUT}`)

;(async () => {
  // 1. 备份
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${DBDIR}.bak.${ts}`
  console.log(`[restore] 1/4 备份 LevelDB → ${backup}`)
  try {
    execSync(`cp -r "${DBDIR}" "${backup}"`)
    console.log(`[restore]      备份大小: ${execSync(`du -sh "${backup}"`).toString().trim()}`)
  } catch (e) {
    console.error('[restore] 备份失败，停止:', e.message)
    process.exit(1)
  }

  let LeveldbPersistence, Y
  try {
    LeveldbPersistence = require('y-leveldb').LeveldbPersistence
    Y = require('yjs')
  } catch (e) {
    console.error('ERROR: 缺依赖，先 cd /opt/know-canvas/server && npm install y-leveldb yjs')
    process.exit(1)
  }

  const persistence = new LeveldbPersistence(DBDIR)
  try {
    // 2. 验证输入
    const buf = fs.readFileSync(INPUT)
    const verify = new Y.Doc()
    Y.applyUpdate(verify, buf)
    const nodes = verify.getMap('nodes').size
    const edges = verify.getMap('edges').size
    console.log(`[restore] 2/4 输入验证 OK · ${buf.byteLength} bytes · nodes=${nodes}, edges=${edges}`)
    if (nodes === 0 && edges === 0) {
      console.error('[restore] WARN: 输入是空 doc，已停止以避免清空线上数据')
      console.error('[restore] 如果你确认要清空，请加 --force 参数（暂未实现）')
      process.exit(1)
    }

    // 3. 清旧 room
    console.log(`[restore] 3/4 清除旧 room 历史: ${ROOM}`)
    await persistence.clearDocument(ROOM)

    // 4. 灌入合并 update
    console.log(`[restore] 4/4 写入合并 update`)
    await persistence.storeUpdate(ROOM, buf)

    // 5. flush（合并散碎 update 为一条 — 减小 LevelDB 体积）
    if (typeof persistence.flushDocument === 'function') {
      await persistence.flushDocument(ROOM)
      console.log('[restore]    flushDocument OK')
    }

    // 验证回写
    const after = await persistence.getYDoc(ROOM)
    console.log(`[restore] 验证: nodes=${after.getMap('nodes').size}, edges=${after.getMap('edges').size}`)
    console.log('')
    console.log('[restore] ✓ 完成。')
    console.log('[restore] 回滚命令: rm -rf "' + DBDIR + '" && mv "' + backup + '" "' + DBDIR + '"')
  } catch (e) {
    console.error('[restore] 失败:', e.stack || e.message)
    console.error('[restore] 回滚命令: rm -rf "' + DBDIR + '" && mv "' + backup + '" "' + DBDIR + '"')
    process.exit(1)
  } finally {
    try { await persistence.destroy() } catch (_) {}
  }
})()
