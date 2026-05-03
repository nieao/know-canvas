#!/usr/bin/env node
/**
 * dump-room.cjs — 在 VPS 上跑，从 LevelDB 导出指定 room 的 Yjs Doc 为单个 update binary
 *
 * 用法：
 *   node dump-room.cjs <ROOM_NAME> <OUTPUT_FILE> [LEVELDB_DIR]
 *
 * 示例：
 *   cd /opt/know-canvas/server
 *   node /tmp/dump-room.cjs demo-final /tmp/room-old.bin ./yjs-data
 *
 * 输出：把 room 的完整 Yjs state 编码为单个 update binary，写到 OUTPUT_FILE。
 * 不会修改 LevelDB，只读。
 */

const fs = require('fs')
const path = require('path')

const [, , ROOM, OUT, DBDIR_ARG] = process.argv

if (!ROOM || !OUT) {
  console.error('用法: node dump-room.cjs <ROOM_NAME> <OUTPUT_FILE> [LEVELDB_DIR]')
  process.exit(1)
}

const DBDIR = path.resolve(DBDIR_ARG || './yjs-data')
if (!fs.existsSync(DBDIR)) {
  console.error(`ERROR: LevelDB 目录不存在: ${DBDIR}`)
  process.exit(1)
}

console.log(`[dump] room=${ROOM}`)
console.log(`[dump] leveldb=${DBDIR}`)
console.log(`[dump] output=${OUT}`)

;(async () => {
  let LeveldbPersistence, Y
  try {
    LeveldbPersistence = require('y-leveldb').LeveldbPersistence
    Y = require('yjs')
  } catch (e) {
    console.error('ERROR: 缺依赖，先 cd /opt/know-canvas/server && npm install y-leveldb yjs')
    console.error(e.message)
    process.exit(1)
  }

  const persistence = new LeveldbPersistence(DBDIR)
  try {
    const ydoc = await persistence.getYDoc(ROOM)
    const update = Y.encodeStateAsUpdate(ydoc)
    fs.writeFileSync(OUT, update)
    console.log(`[dump] OK · ${update.byteLength} bytes`)
    console.log(`[dump] node count: ${ydoc.getMap('nodes').size}`)
    console.log(`[dump] edge count: ${ydoc.getMap('edges').size}`)
  } catch (e) {
    console.error('[dump] 失败:', e.message)
    process.exit(1)
  } finally {
    try { await persistence.destroy() } catch (_) {}
  }
})()
