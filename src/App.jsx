/**
 * App - Know Canvas 应用入口
 * 路由：
 *   - URL 没有 ?room= 或 没有用户名 → JoinRoom 入口页
 *   - 都有 → KnowledgeGraph 协作画布
 */

import { useState, useEffect } from 'react'
import KnowledgeGraph from './pages/KnowledgeGraph'
import JoinRoom from './pages/JoinRoom'
import ErrorBoundary from './components/ErrorBoundary'
import { getUsername, getRoomFromUrl } from './collab/session'

function App() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    const room = getRoomFromUrl()
    const name = getUsername()
    setHasSession(Boolean(room && name))
    setReady(true)
  }, [])

  if (!ready) return null

  return (
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        {hasSession ? <KnowledgeGraph /> : <JoinRoom />}
      </div>
    </ErrorBoundary>
  )
}

export default App
