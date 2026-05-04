/**
 * Hacker News 插件 — 参考实现
 *
 * search: Algolia HN Search API (https://hn.algolia.com/api)
 * fetch:  Firebase HN API (https://hacker-news.firebaseio.com/v0)
 *
 * 零 token, 仅依赖公开 API. 用作 source-plugin spec 的参考.
 */

const ALGOLIA = 'https://hn.algolia.com/api/v1'
const FIREBASE = 'https://hacker-news.firebaseio.com/v0'

function extractItemId(input) {
  const s = String(input || '').trim()
  if (/^\d+$/.test(s)) return s
  const m = s.match(/(?:item\?id=|hn\.algolia\.com\/.*\/(?:story|comment)\/)(\d+)/)
  return m ? m[1] : ''
}

const plugin = {
  /**
   * 关键词搜 HN — 用 Algolia 做全文索引
   */
  async search(ctx, { query, pageSize = 10 }) {
    const url = `${ALGOLIA}/search?query=${encodeURIComponent(query)}&hitsPerPage=${Math.min(pageSize, 30)}&tags=story`
    const r = await ctx.fetch(url)
    if (!r.ok) throw new Error(`HN Algolia ${r.status}`)
    const j = await r.json()
    const results = (j.hits || []).map((h) => ({
      id: String(h.objectID),
      title: h.title || '(无标题)',
      summary: (h.story_text || h.url || '').replace(/\s+/g, ' ').slice(0, 200),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      meta: {
        author: h.author,
        points: h.points,
        comments: h.num_comments,
        createdAt: h.created_at,
      },
    }))
    return { results, total: j.nbHits || results.length }
  },

  /**
   * 取单条 story 全文 — 接受 HN URL / Algolia URL / 纯数字 id
   */
  async fetch(ctx, { url, id }) {
    const itemId = extractItemId(id || url)
    if (!itemId) throw new Error('无法从输入解析 HN item id (需要 news.ycombinator.com/item?id=N 或纯数字)')
    const r = await ctx.fetch(`${FIREBASE}/item/${itemId}.json`)
    if (!r.ok) throw new Error(`HN Firebase ${r.status}`)
    const item = await r.json()
    if (!item) throw new Error(`HN item ${itemId} 不存在`)
    // story 的 content 可能在 text (Ask HN) 或 url (External link) — 都拼一下
    const lines = []
    if (item.title) lines.push(`# ${item.title}`)
    if (item.url) lines.push('', `🔗 ${item.url}`)
    if (item.text) lines.push('', item.text.replace(/<[^>]+>/g, '')) // 去 HTML tag
    if (item.by) lines.push('', `— by ${item.by} · ${item.score || 0} points · ${item.descendants || 0} comments`)
    return {
      data: {
        title: item.title || `HN #${itemId}`,
        content: lines.join('\n'),
        url: item.url || `https://news.ycombinator.com/item?id=${itemId}`,
        meta: {
          itemId,
          author: item.by,
          points: item.score,
          comments: item.descendants,
          createdAt: item.time ? new Date(item.time * 1000).toISOString() : null,
        },
      },
    }
  },
}

export default plugin
