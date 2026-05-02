/**
 * ShortcutsModal — 快捷键说明弹窗
 *
 * 通过按 "?" 或欢迎覆盖层的"按 ? 查看快捷键"打开。
 *
 * 拆出来的目的：让 KnowledgeGraph 不再硬编码这张表格。
 */

const SHORTCUTS = [
  { keys: 'Ctrl + B', desc: '切换左侧知识源面板' },
  { keys: 'Ctrl + ]', desc: '切换右侧详情面板' },
  { keys: 'Ctrl + A', desc: '全选节点' },
  { keys: 'Ctrl + C / V', desc: '复制 / 粘贴节点' },
  { keys: 'Ctrl + 0', desc: '适应视图' },
  { keys: 'Ctrl + 1', desc: '重置缩放' },
  { keys: 'Space', desc: '按住拖拽画布' },
  { keys: '双击画布', desc: '快速添加节点' },
  { keys: '?', desc: '显示/隐藏快捷键' },
  { keys: 'Esc', desc: '取消选中 / 关闭弹窗' },
  { keys: 'Delete', desc: '删除选中节点' },
]

export default function ShortcutsModal({ open, onClose }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 rounded-lg shadow-xl p-6"
        style={{ background: 'var(--white)', border: '1px solid var(--gray-100)' }}
      >
        <div className="section-label mb-3">快捷键</div>
        <h3 className="heading-serif text-base font-semibold mb-4" style={{ color: 'var(--black)' }}>
          键盘快捷键
        </h3>
        <div className="space-y-2.5">
          {SHORTCUTS.map(item => (
            <div key={item.keys} className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--gray-700)' }}>{item.desc}</span>
              <kbd className="px-2 py-0.5 text-[10px] rounded" style={{ background: 'var(--warm-bg)', color: 'var(--warm)', fontFamily: 'var(--font-sans)' }}>
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-5 py-2 text-xs rounded-md transition-all duration-300"
          style={{ border: '1px solid var(--gray-100)', color: 'var(--gray-700)' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--warm)'; e.currentTarget.style.color = 'var(--warm)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--gray-100)'; e.currentTarget.style.color = 'var(--gray-700)' }}
        >
          关闭
        </button>
      </div>
    </>
  )
}
