/**
 * useProjectLibraryStore — 项目库（yjs 共享 + 本地降级）
 *
 * 一个"项目"= 一次完整的元认知任务流 / Aletheia 综合的画布快照。
 * 项目库是**全房间共享**的: 三人协作时, 大家看到同一份项目库,
 * 每个项目带 owner 字段标识谁创建的.
 *
 * 双写策略:
 *   - 启动后调 bindToYjs() (在 startSync 之后), 内部:
 *     1) 把 yjs `projects` map 读出来合并到本地 state
 *     2) 本地有 yjs 没有的项目 push 到 yjs (迁移老 localStorage 数据)
 *     3) 订阅 yjs map.observe → 同步外部协作者的写入到本地 state
 *   - 写操作 saveProject/removeProject/renameProject 同时写 zustand 和 yjs map
 *   - localStorage persist 保留作为离线/未连接时的降级
 *
 * ProjectEntry schema:
 *   {
 *     id, title, summary, createdAt,
 *     owner: { name, color },           // 创建者 (来自 session)
 *     snapshot: { nodes, edges },       // 完整画布快照
 *     stats: { nodeCount, edgeCount, healthScore?, totalCostCny?, totalTokens? },
 *     thumbnail?, tags?, source?,
 *     commits?: [{ ts, snapshot, message? }],  // 时间轴回放用 (Step 2 加)
 *   }
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { getProjectsMap } from '../collab/yjsClient'
import { getUsername, getUserColor } from '../collab/session'

const MAX_PROJECTS = 50

const genId = () =>
  `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const getCurrentOwner = () => ({
  name: getUsername() || '匿名',
  color: getUserColor(),
})

// 模块级 yjs 订阅句柄 — bindToYjs 多次调用时先解绑旧的
let _yjsObserver = null
let _yjsMap = null

const useProjectLibraryStore = create(
  persist(
    immer((set, get) => ({
      // 已保存的项目列表（最新在前）
      projects: [],
      // yjs 是否已绑定 — UI 可据此显示"协作模式"标记
      yjsBound: false,

      /**
       * 保存一个新项目 — 双写到 zustand + yjs
       * 入参 projectData = { id?, title, summary, createdAt?, owner?, snapshot, stats, thumbnail?, tags?, source? }
       * @returns {string} 项目 id
       */
      saveProject: (projectData) => {
        const id = projectData?.id || genId()
        const entry = {
          id,
          title: projectData?.title || '未命名项目',
          summary: projectData?.summary || '',
          createdAt: projectData?.createdAt || Date.now(),
          owner: projectData?.owner || getCurrentOwner(),
          snapshot: projectData?.snapshot || { nodes: [], edges: [] },
          stats: projectData?.stats || { nodeCount: 0, edgeCount: 0 },
          thumbnail: projectData?.thumbnail || null,
          tags: Array.isArray(projectData?.tags) ? projectData.tags : [],
          source: projectData?.source || 'manual',
          commits: Array.isArray(projectData?.commits) ? projectData.commits : [],
        }
        set((state) => {
          const idx = state.projects.findIndex((p) => p.id === id)
          if (idx >= 0) state.projects.splice(idx, 1)
          state.projects.unshift(entry)
          if (state.projects.length > MAX_PROJECTS) {
            state.projects.length = MAX_PROJECTS
          }
        })
        // 推到 yjs map (其他客户端 observe 会同步)
        if (_yjsMap) {
          try { _yjsMap.set(id, entry) } catch (e) { console.warn('[ProjectLibrary] yjs set 失败:', e?.message) }
        }
        return id
      },

      /** 删除指定项目 — 双写 */
      removeProject: (id) => {
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== id)
        })
        if (_yjsMap) {
          try { _yjsMap.delete(id) } catch (_e) {}
        }
      },

      /** 重命名项目 — 双写 */
      renameProject: (id, title) => {
        const trimmed = (title || '').trim()
        if (!trimmed) return
        set((state) => {
          const p = state.projects.find((x) => x.id === id)
          if (p) p.title = trimmed
        })
        if (_yjsMap) {
          const cur = _yjsMap.get(id)
          if (cur) {
            try { _yjsMap.set(id, { ...cur, title: trimmed }) } catch (_e) {}
          }
        }
      },

      /** 获取一个项目（深拷贝避免外部修改污染 store） */
      getProject: (id) => {
        const p = get().projects.find((x) => x.id === id)
        if (!p) return null
        try { return JSON.parse(JSON.stringify(p)) } catch { return p }
      },

      /** 清空所有项目 — 双写 */
      clearAll: () => {
        set((state) => { state.projects = [] })
        if (_yjsMap) {
          try {
            _yjsMap.forEach((_v, k) => _yjsMap.delete(k))
          } catch (_e) {}
        }
      },

      /**
       * 绑定到 yjs projects map — 在 startSync() 之后调用
       *  1) 读 yjs 已有项目合并到 state (按 createdAt 倒序)
       *  2) 本地有 yjs 没有的 push 到 yjs (老 localStorage 数据迁移)
       *  3) 订阅 map.observe → 远端协作者写入同步到 state
       */
      bindToYjs: () => {
        const map = getProjectsMap()
        if (!map) return
        if (_yjsMap === map && get().yjsBound) return  // 已绑同一 map

        // 解旧
        if (_yjsObserver && _yjsMap) {
          try { _yjsMap.unobserve(_yjsObserver) } catch (_e) {}
        }
        _yjsMap = map

        // 读 yjs → 合并到 state
        const yjsProjects = []
        map.forEach((v) => { if (v && v.id) yjsProjects.push(v) })

        const localOnly = []
        const localProjects = get().projects || []
        for (const p of localProjects) {
          if (p && p.id && !map.has(p.id)) localOnly.push(p)
        }

        // 合并: yjs 已有的优先 (远端权威), 本地多出的迁移到 yjs
        const merged = [...yjsProjects, ...localOnly].sort(
          (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
        )
        const sliced = merged.slice(0, MAX_PROJECTS)

        set((state) => {
          state.projects = sliced
          state.yjsBound = true
        })

        // 把本地多的写到 yjs (使用 transact 减少事件)
        if (localOnly.length > 0) {
          const ydoc = map.doc
          if (ydoc) {
            try {
              ydoc.transact(() => {
                for (const p of localOnly) {
                  if (!map.has(p.id)) map.set(p.id, p)
                }
              }, 'local')
            } catch (_e) {}
          }
        }

        // observe — 远端协作者 set/delete 同步过来
        _yjsObserver = (event) => {
          set((state) => {
            event.changes.keys.forEach((change, key) => {
              if (change.action === 'add' || change.action === 'update') {
                const v = map.get(key)
                if (!v) return
                const idx = state.projects.findIndex((p) => p.id === key)
                if (idx >= 0) state.projects.splice(idx, 1)
                state.projects.unshift(v)
              } else if (change.action === 'delete') {
                state.projects = state.projects.filter((p) => p.id !== key)
              }
            })
            // 排序裁剪
            state.projects.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            if (state.projects.length > MAX_PROJECTS) {
              state.projects.length = MAX_PROJECTS
            }
          })
        }
        map.observe(_yjsObserver)
      },

      /** 解绑 yjs (切换房间或销毁前调用) */
      unbindFromYjs: () => {
        if (_yjsObserver && _yjsMap) {
          try { _yjsMap.unobserve(_yjsObserver) } catch (_e) {}
        }
        _yjsObserver = null
        _yjsMap = null
        set((state) => { state.yjsBound = false })
      },
    })),
    {
      name: 'know_canvas_project_library',
      partialize: (state) => ({ projects: state.projects }),
    },
  ),
)

export { useProjectLibraryStore }
export default useProjectLibraryStore
