#!/usr/bin/env node
/**
 * merge-rooms.cjs — 本地跑，合并 N 个 Yjs update binary 为一份
 *
 * 用法：
 *   node merge-rooms.cjs <OUTPUT> <INPUT1> <INPUT2> [INPUT3 ...]
 *
 * 示例：
 *   node merge-rooms.cjs ./room-merged.bin ./room-old.bin ./room-new.bin
 *
 * 原理：
 *   - new Y.Doc → 依次 applyUpdate 所有 input → encodeStateAsUpdate → 写出
 *   - Yjs 是 CRDT：合并幂等 + 可交换 + 关联（顺序无所谓）
 *   - Y.Map 同 key 冲突按 Lamport 时间戳取最后一次写入（last-write-wins）
 *
 * 不动任何远端文件。只读 input，写 output。
 */

const fs = require('fs')

const args = process.argv.slice(2)
if (args.length < 3) {
  console.error('用法: node merge-rooms.cjs <OUTPUT> <INPUT1> <INPUT2> [INPUT3 ...]')
  process.exit(1)
}

const [OUTPUT, ...INPUTS] = args

let Y
try {
  Y = require('yjs')
} catch (e) {
  console.error('ERROR: 本地缺 yjs。在仓库根目录 npm install yjs')
  process.exit(1)
}

console.log(`[merge] inputs (${INPUTS.length}):`)
INPUTS.forEach((f) => {
  if (!fs.existsSync(f)) {
    console.error(`  ✗ ${f} 不存在`)
    process.exit(1)
  }
  const stat = fs.statSync(f)
  console.log(`  ✓ ${f} (${stat.size} bytes)`)
})

const doc = new Y.Doc()
const before = { nodes: 0, edges: 0 }
const after = { nodes: 0, edges: 0 }

INPUTS.forEach((f, i) => {
  const buf = fs.readFileSync(f)
  Y.applyUpdate(doc, buf)
  const n = doc.getMap('nodes').size
  const e = doc.getMap('edges').size
  console.log(`[merge] step ${i + 1}: applied ${f.split(/[\\/]/).pop()} → nodes=${n}, edges=${e}`)
  if (i === 0) {
    before.nodes = n
    before.edges = e
  }
  after.nodes = n
  after.edges = e
})

const merged = Y.encodeStateAsUpdate(doc)
fs.writeFileSync(OUTPUT, merged)

console.log('')
console.log(`[merge] OK · output ${OUTPUT} (${merged.byteLength} bytes)`)
console.log(`[merge] 第一个输入: nodes=${before.nodes}, edges=${before.edges}`)
console.log(`[merge] 全部合并后: nodes=${after.nodes}, edges=${after.edges}`)
console.log(`[merge] 新增节点: ${after.nodes - before.nodes}, 新增边: ${after.edges - before.edges}`)

if (after.nodes < before.nodes) {
  console.warn('[merge] WARN: 合并后节点数减少 — 可能是同一节点 ID 在两端有不同位置，CRDT 取了 last-write-wins')
}
