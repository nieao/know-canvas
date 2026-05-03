/**
 * useCollabSession — 协作会话生命周期 Hook
 *
 * 职责：
 *   - 从 URL/localStorage 读取 room/username/userColor
 *   - mount 时启动 Yjs sync，unmount 时清理
 *   - 提供 exitSession 方法（清 localStorage 并跳到首页）
 *
 * 把"协作会话生命周期"这一关注点从 KnowledgeGraph 拆出来，
 * 让主页面只负责 UI 编排，不操心 sync 启停。
 */

import { useEffect } from 'react'
import { startSync, stopSync, setLocalUser } from './yjsClient'
import { attachYjsSync, detachYjsSync } from './yjsSync'
import { getUsername, getUserColor, getRoomFromUrl, clearSession } from './session'
import useProjectLibraryStore from '../stores/useProjectLibraryStore'

export function useCollabSession() {
  const room = getRoomFromUrl()
  const username = getUsername()
  const userColor = getUserColor()

  useEffect(() => {
    if (!room || !username) return
    startSync(room, { user: { name: username, color: userColor } })
    setLocalUser({ name: username, color: userColor })
    attachYjsSync()
    // 项目库共享 — 把本地 localStorage 的项目迁到 yjs, 并订阅远端协作者写入
    useProjectLibraryStore.getState().bindToYjs?.()
    return () => {
      useProjectLibraryStore.getState().unbindFromYjs?.()
      detachYjsSync()
      stopSync()
    }
  }, [room, username, userColor])

  const exitSession = () => {
    clearSession()
    window.location.href = '/'
  }

  return { room, username, userColor, exitSession }
}
