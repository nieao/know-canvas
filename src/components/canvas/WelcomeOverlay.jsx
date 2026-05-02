/**
 * WelcomeOverlay — 画布空状态欢迎覆盖层
 *
 * 当 nodes.length === 0 时显示在画布上层，引导用户导入文件 / 添加节点。
 *
 * 拆出来的目的：把"空态视觉"这块 60+ 行 JSX 从 KnowledgeGraph 主组件剥离。
 */

const STEPS = [
  { step: '01', text: '导入文件或粘贴文本', desc: '图片 / 视频 / PDF / MD / TXT / JSON / CSV' },
  { step: '02', text: '自动提取关键概念', desc: '标题、关键词、高频术语' },
  { step: '03', text: '发现概念间关系', desc: '层级、共现、语义关联' },
  { step: '04', text: '导出知识图谱', desc: 'Markdown / JSON-LD / PNG' },
]

export default function WelcomeOverlay({ onShowShortcuts }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="text-center max-w-md mx-auto px-8 pointer-events-none">
        {/* 建筑网格装饰 */}
        <div className="fixed inset-0 pointer-events-none z-0" style={{ opacity: 0.03 }}>
          <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: 'var(--black)' }} />
          <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: 'var(--black)' }} />
        </div>

        <div className="section-label mb-6">KNOW / CANVAS</div>
        <h1 className="heading-serif text-2xl font-light mb-4" style={{ color: 'var(--black)' }}>
          知识图谱
        </h1>
        <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--gray-700)' }}>
          将文档、链接和文本导入画布，<br />
          AI 自动提取概念、发现关系，<br />
          构建你的知识网络。
        </p>

        {/* 操作引导 */}
        <div className="space-y-3 text-left max-w-xs mx-auto">
          {STEPS.map(item => (
            <div
              key={item.step}
              className="flex items-start gap-3 p-3 rounded-md transition-all duration-300"
              style={{ border: '1px solid var(--gray-100)', background: 'rgba(250,250,250,0.9)' }}
            >
              <span className="text-xs font-light mt-0.5" style={{ color: 'var(--warm)', fontFamily: 'var(--font-serif)' }}>
                {item.step}
              </span>
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--dark)' }}>{item.text}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--gray-500)' }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 拖拽提示 */}
        <div className="mt-8 py-6 px-8 rounded-lg border-dashed" style={{ border: '2px dashed var(--gray-100)', background: 'rgba(250,250,250,0.8)' }}>
          <svg className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--gray-300)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-xs" style={{ color: 'var(--gray-500)' }}>拖拽文件到此处开始</p>
        </div>

        {/* 快捷键提示 */}
        <button
          onClick={onShowShortcuts}
          className="mt-6 text-[10px] tracking-wider transition-colors duration-300 pointer-events-auto"
          style={{ color: 'var(--gray-300)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--warm)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--gray-300)'}
        >
          按 ? 查看快捷键
        </button>
      </div>
    </div>
  )
}
