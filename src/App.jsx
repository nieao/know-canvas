/**
 * App - 知识图谱应用入口
 * 单页面应用，直接渲染知识图谱画布
 */

import KnowledgeGraph from './pages/KnowledgeGraph'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden">
        <KnowledgeGraph />
      </div>
    </ErrorBoundary>
  )
}

export default App
