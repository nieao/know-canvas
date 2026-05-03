/**
 * useProjectLibraryStore — 项目库（已完成的元认知/Aletheia 任务画布快照）
 *
 * 一个"项目"= 一次完整的元认知任务流 / Aletheia 综合的画布快照。
 * 用户可以在项目库面板里看到所有保存的项目，点击载入到画布上复现。
 *
 * 持久化策略：
 *   localStorage key: 'know_canvas_project_library'
 *   partialize: 只保 projects（运行时不需要其他状态）
 *
 * ProjectEntry schema:
 *   {
 *     id: string,
 *     title: string,
 *     summary: string,
 *     createdAt: number,                // ms
 *     snapshot: { nodes, edges },       // useCanvasStore.exportCanvasData() 的快照
 *     stats: { nodeCount, edgeCount, healthScore?, totalCostCny?, totalTokens? },
 *     thumbnail?: string,
 *     tags?: string[],
 *     source?: 'meta-cognitive' | 'aletheia' | 'manual',
 *   }
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

const MAX_PROJECTS = 50

const genId = () =>
  `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const useProjectLibraryStore = create(
  persist(
    immer((set, get) => ({
      // 已保存的项目列表（最新在前）
      projects: [],

      /**
       * 保存一个新项目
       * 入参 projectData = { id?, title, summary, createdAt?, snapshot, stats, thumbnail?, tags?, source? }
       * 推到数组头，超过 MAX_PROJECTS 时砍最旧
       * @returns {string} 项目 id
       */
      saveProject: (projectData) => {
        const id = projectData?.id || genId()
        const entry = {
          id,
          title: projectData?.title || '未命名项目',
          summary: projectData?.summary || '',
          createdAt: projectData?.createdAt || Date.now(),
          snapshot: projectData?.snapshot || { nodes: [], edges: [] },
          stats: projectData?.stats || { nodeCount: 0, edgeCount: 0 },
          thumbnail: projectData?.thumbnail || null,
          tags: Array.isArray(projectData?.tags) ? projectData.tags : [],
          source: projectData?.source || 'manual',
        }
        set((state) => {
          // 防重 — 同 id 已存在则替换
          const idx = state.projects.findIndex((p) => p.id === id)
          if (idx >= 0) state.projects.splice(idx, 1)
          state.projects.unshift(entry)
          if (state.projects.length > MAX_PROJECTS) {
            state.projects.length = MAX_PROJECTS
          }
        })
        return id
      },

      /** 删除指定项目 */
      removeProject: (id) =>
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== id)
        }),

      /** 重命名项目 */
      renameProject: (id, title) =>
        set((state) => {
          const p = state.projects.find((x) => x.id === id)
          if (p) p.title = (title || '').trim() || p.title
        }),

      /** 获取一个项目（深拷贝避免外部修改污染 store） */
      getProject: (id) => {
        const p = get().projects.find((x) => x.id === id)
        if (!p) return null
        try {
          return JSON.parse(JSON.stringify(p))
        } catch {
          return p
        }
      },

      /** 清空所有项目 */
      clearAll: () =>
        set((state) => {
          state.projects = []
        }),
    })),
    {
      name: 'know_canvas_project_library',
      partialize: (state) => ({ projects: state.projects }),
    },
  ),
)

export { useProjectLibraryStore }
export default useProjectLibraryStore
