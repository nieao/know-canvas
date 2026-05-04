/**
 * 会话工具 — 用户名/房间号/用户色
 *
 * 本应用不接 OAuth，黑客松场景：用户输入用户名 + 房间号即"登录"。
 * 数据存 localStorage：
 *   - know_canvas_username: string
 *   - know_canvas_user_color: string (hex)
 *
 * 房间号来自 URL 参数 ?room=xxx，不存 localStorage（每个标签页可以进不同房间）。
 */

const KEY_USERNAME = 'know_canvas_username'
const KEY_USER_COLOR = 'know_canvas_user_color'

// 协作用户色板（避开主题暖色）
const USER_PALETTE = [
  '#ef4444', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7',
  '#d946ef', '#ec4899',
]

export function getUsername() {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(KEY_USERNAME) || ''
}

export function setUsername(name) {
  if (typeof localStorage === 'undefined') return
  if (name) localStorage.setItem(KEY_USERNAME, name)
  else localStorage.removeItem(KEY_USERNAME)
}

export function getUserColor() {
  if (typeof localStorage === 'undefined') return USER_PALETTE[0]
  let c = localStorage.getItem(KEY_USER_COLOR)
  if (!c) {
    c = USER_PALETTE[Math.floor(Math.random() * USER_PALETTE.length)]
    localStorage.setItem(KEY_USER_COLOR, c)
  }
  return c
}

export function setUserColor(color) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY_USER_COLOR, color)
}

export function clearSession() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEY_USERNAME)
  localStorage.removeItem(KEY_USER_COLOR)
}

/** 从当前 URL 取房间号 */
export function getRoomFromUrl() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('room') || ''
}

/** 跳到指定房间，保留其他参数 */
export function navigateToRoom(roomId) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  window.location.href = url.toString()
}

// ────────────────────────────────────────────────────────────────────
// 频道命名约定 (channel = yjs room)
//   private-{username}  → 个人草稿空间, 别人看不到
//   pub-{communityId}   → 公共社区频道
//   pub-default         → 全站公共
//   demo-final / demo-railway / 自定义 id → 视为遗留命名, 兼容显示
// ────────────────────────────────────────────────────────────────────

/** 判断是否私人频道 */
export function isPrivateRoom(roomId) {
  return typeof roomId === 'string' && roomId.startsWith('private-')
}

/** 判断是否公共频道 (pub- 前缀 / 主 demo room) */
export function isPublicRoom(roomId) {
  if (typeof roomId !== 'string') return false
  if (roomId.startsWith('pub-')) return true
  return roomId === 'demo-final' || roomId === 'demo-railway'
}

/** 给用户名生成私人频道 id (英数化用户名, 防中文 url-encode 问题) */
export function getPrivateRoomFor(username) {
  if (!username) return ''
  // url-safe slug: 中文用户名走 base64url 摘要前 8 位防冲突 + 可读后缀
  let slug = String(username).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!slug || slug.length < 2) {
    // 中文/纯符号用户名: hash 后 8 位
    let h = 0
    for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0
    slug = 'u' + Math.abs(h).toString(36).slice(0, 8)
  }
  return `private-${slug}`
}

/** 频道显示名 (UI 标签) */
export function getRoomDisplayName(roomId) {
  if (!roomId) return '未命名频道'
  if (isPrivateRoom(roomId)) return '私人草稿'
  if (roomId === 'pub-default') return '公共频道'
  if (roomId.startsWith('pub-')) return `公共 · ${roomId.slice(4)}`
  if (roomId === 'demo-final' || roomId === 'demo-railway') return `主房间 · ${roomId}`
  return roomId
}

/** 频道类型 (用于 UI 配色) */
export function getRoomType(roomId) {
  if (isPrivateRoom(roomId)) return 'private'
  if (isPublicRoom(roomId)) return 'public'
  return 'custom'
}

export { USER_PALETTE }
