/**
 * Know-Canvas - 知识库状态管理 (Zustand)
 * 管理知识来源、分类和概念检索
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// 知识来源类型
export const SOURCE_TYPES = {
  FILE: 'file',
  URL: 'url',
  TEXT: 'text',
  API: 'api',
}

// 默认分类颜色池
const DEFAULT_COLORS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#22c55e',
  '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
]

// 生成唯一 ID
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const useKnowledgeStore = create(
  persist(
    immer((set, get) => ({
      // 知识来源列表
      sources: [],

      // 用户自定义分类（不硬编码）
      categories: [],

      // 搜索与筛选
      searchQuery: '',
      filterByCategory: null,
      filterBySource: null,

      // ========== 来源管理 ==========

      // 添加知识来源
      addSource: (source) => {
        const newSource = {
          id: source.id || generateId(),
          name: source.name || '未命名来源',
          type: source.type || SOURCE_TYPES.TEXT,
          ext: source.ext || '',
          content: source.content || '',
          metadata: source.metadata || {},
          concepts: source.concepts || [],
          importedAt: new Date().toISOString(),
        }

        set((state) => {
          state.sources.push(newSource)
        })

        return newSource.id
      },

      // 移除知识来源
      removeSource: (id) => {
        set((state) => {
          state.sources = state.sources.filter(s => s.id !== id)
        })
      },

      // 更新知识来源
      updateSource: (id, data) => {
        set((state) => {
          const source = state.sources.find(s => s.id === id)
          if (source) {
            Object.assign(source, data)
          }
        })
      },

      // ========== 分类管理 ==========

      // 添加分类
      addCategory: (name, color = null) => {
        const { categories } = get()

        // 检查是否已存在同名分类
        const exists = categories.find(c => c.name === name)
        if (exists) return exists.id

        // 自动分配颜色
        const assignedColor = color || DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length]

        const newCategory = {
          id: generateId(),
          name,
          color: assignedColor,
          icon: '',
          createdAt: new Date().toISOString(),
        }

        set((state) => {
          state.categories.push(newCategory)
        })

        return newCategory.id
      },

      // 移除分类
      removeCategory: (id) => {
        set((state) => {
          state.categories = state.categories.filter(c => c.id !== id)
        })
      },

      // 更新分类
      updateCategory: (id, data) => {
        set((state) => {
          const category = state.categories.find(c => c.id === id)
          if (category) {
            Object.assign(category, data)
          }
        })
      },

      // ========== 导入功能 ==========

      // 导入文件 - 解析文件内容并添加到来源
      importFile: async (file) => {
        const { addSource } = get()

        try {
          const text = await file.text()
          const ext = file.name.split('.').pop().toLowerCase()

          let concepts = []
          let content = text

          // 根据文件类型提取概念
          if (ext === 'json') {
            try {
              const parsed = JSON.parse(text)
              if (Array.isArray(parsed)) {
                concepts = parsed.map(item => ({
                  title: item.title || item.name || JSON.stringify(item).slice(0, 30),
                  description: item.description || item.content || '',
                  tags: item.tags || [],
                }))
              }
            } catch {
              console.warn('JSON 解析失败，作为纯文本处理')
            }
          } else if (ext === 'md') {
            // 提取 Markdown 标题作为概念
            const headingRegex = /^#{1,3}\s+(.+)$/gm
            let match
            while ((match = headingRegex.exec(text)) !== null) {
              concepts.push({
                title: match[1].trim(),
                description: '',
                tags: [],
              })
            }
          } else if (ext === 'csv') {
            const lines = text.split('\n').filter(l => l.trim())
            if (lines.length > 1) {
              const headers = lines[0].split(',').map(h => h.trim())
              concepts = lines.slice(1).map(line => {
                const values = line.split(',').map(v => v.trim())
                const obj = {}
                headers.forEach((h, i) => { obj[h] = values[i] || '' })
                return {
                  title: obj[headers[0]] || '',
                  description: obj[headers[1]] || '',
                  tags: [],
                }
              })
            }
          }

          const sourceId = addSource({
            name: file.name,
            type: SOURCE_TYPES.FILE,
            content,
            concepts,
            metadata: {
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type || ext,
            },
          })

          return { sourceId, concepts }
        } catch (error) {
          console.error('文件导入失败:', error)
          return null
        }
      },

      // 导入文本 - 解析文本为概念
      importText: (text) => {
        const { addSource } = get()

        if (!text || !text.trim()) return null

        // 按段落分割
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
        const concepts = paragraphs.map(p => {
          const lines = p.trim().split('\n')
          const title = lines[0].replace(/^#+\s*/, '').trim()
          const description = lines.slice(1).join('\n').trim()
          return { title, description, tags: [] }
        })

        const sourceId = addSource({
          name: `文本导入 ${new Date().toLocaleString('zh-CN')}`,
          type: SOURCE_TYPES.TEXT,
          content: text,
          concepts,
          metadata: {
            charCount: text.length,
            paragraphCount: paragraphs.length,
          },
        })

        return { sourceId, concepts }
      },

      // 导入 URL - 获取 URL 元数据并创建来源
      importUrl: (url, metadata = {}) => {
        const { addSource } = get()

        const sourceId = addSource({
          name: metadata.title || url,
          type: SOURCE_TYPES.URL,
          content: url,
          concepts: metadata.concepts || [],
          metadata: {
            url,
            title: metadata.title || '',
            description: metadata.description || '',
            favicon: metadata.favicon || '',
            image: metadata.image || '',
          },
        })

        return sourceId
      },

      // ========== 查询功能 ==========

      // 按分类获取概念
      getConceptsByCategory: (categoryName) => {
        const { sources } = get()
        const concepts = []
        sources.forEach(source => {
          (source.concepts || []).forEach(concept => {
            if (concept.category === categoryName) {
              concepts.push({ ...concept, sourceId: source.id, sourceName: source.name })
            }
          })
        })
        return concepts
      },

      // 按来源获取概念
      getConceptsBySource: (sourceId) => {
        const { sources } = get()
        const source = sources.find(s => s.id === sourceId)
        if (!source) return []
        return (source.concepts || []).map(c => ({
          ...c,
          sourceId: source.id,
          sourceName: source.name,
        }))
      },

      // 搜索概念（标题和描述模糊匹配）
      searchConcepts: (query) => {
        const { sources } = get()
        if (!query || !query.trim()) return []

        const lowerQuery = query.toLowerCase()
        const results = []

        sources.forEach(source => {
          (source.concepts || []).forEach(concept => {
            const titleMatch = (concept.title || '').toLowerCase().includes(lowerQuery)
            const descMatch = (concept.description || '').toLowerCase().includes(lowerQuery)
            const tagMatch = (concept.tags || []).some(t => t.toLowerCase().includes(lowerQuery))

            if (titleMatch || descMatch || tagMatch) {
              results.push({
                ...concept,
                sourceId: source.id,
                sourceName: source.name,
                // 简单相关度评分：标题匹配权重高
                score: (titleMatch ? 3 : 0) + (tagMatch ? 2 : 0) + (descMatch ? 1 : 0),
              })
            }
          })
        })

        // 按相关度排序
        return results.sort((a, b) => b.score - a.score)
      },

      // 获取所有概念（扁平列表）
      getAllConcepts: () => {
        const { sources } = get()
        const concepts = []
        sources.forEach(source => {
          (source.concepts || []).forEach(concept => {
            concepts.push({
              ...concept,
              sourceId: source.id,
              sourceName: source.name,
            })
          })
        })
        return concepts
      },

      // ========== 筛选状态 ==========

      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterByCategory: (categoryId) => set({ filterByCategory: categoryId }),
      setFilterBySource: (sourceId) => set({ filterBySource: sourceId }),
      clearFilters: () => set({
        searchQuery: '',
        filterByCategory: null,
        filterBySource: null,
      }),

      // ========== 统计信息 ==========

      getStats: () => {
        const { sources, categories } = get()
        let totalConcepts = 0
        sources.forEach(s => {
          totalConcepts += (s.concepts || []).length
        })
        return {
          sourceCount: sources.length,
          categoryCount: categories.length,
          conceptCount: totalConcepts,
        }
      },
    })),
    {
      name: 'know-canvas-knowledge',
      partialize: (state) => ({
        sources: state.sources,
        categories: state.categories,
      }),
    }
  )
)

export default useKnowledgeStore
