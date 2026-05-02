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

export { USER_PALETTE }
