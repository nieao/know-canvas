/**
 * 文件解析工具
 * 将不同格式的文件解析为结构化知识数据
 */

/**
 * 解析文件，返回结构化知识内容
 * @param {File} file - 要解析的文件对象
 * @returns {Promise<{title: string, content: string, concepts: Array}>}
 */
export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const text = await file.text()

  switch (ext) {
    case 'md':
      return parseMarkdown(text, file.name)
    case 'txt':
      return parsePlainText(text, file.name)
    case 'json':
      return parseJSON(text, file.name)
    case 'csv':
      return parseCSV(text, file.name)
    default:
      return {
        title: file.name,
        content: text,
        concepts: [],
        source: file.name,
      }
  }
}

/**
 * 解析 Markdown 文件
 * 提取标题作为概念，段落作为描述
 * @param {string} text - Markdown 文本内容
 * @param {string} fileName - 文件名
 * @returns {{title: string, content: string, concepts: Array}}
 */
export function parseMarkdown(text, fileName = '') {
  const lines = text.split('\n')
  const concepts = []
  let docTitle = fileName.replace(/\.md$/i, '')

  let currentHeading = null
  let currentDescription = []
  let currentLevel = 0
  let currentTags = []

  // 逐行解析
  lines.forEach((line) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      // 遇到新标题时，保存前一个概念
      if (currentHeading) {
        concepts.push({
          title: currentHeading,
          description: currentDescription.join('\n').trim(),
          tags: currentTags,
          level: currentLevel,
        })
      }

      const level = headingMatch[1].length
      const heading = headingMatch[2].trim()

      // 第一个 H1 作为文档标题
      if (level === 1 && concepts.length === 0 && !currentHeading) {
        docTitle = heading
      }

      currentHeading = heading
      currentLevel = level
      currentDescription = []
      currentTags = []
    } else if (currentHeading) {
      // 收集描述内容（排除空行和分隔线）
      const trimmed = line.trim()
      if (trimmed && !trimmed.match(/^[-=*]{3,}$/)) {
        currentDescription.push(trimmed)

        // 提取行内标签（如 `#tag` 或 **加粗关键词**）
        const tagMatches = trimmed.match(/#[\w\u4e00-\u9fa5]+/g)
        if (tagMatches) {
          currentTags.push(...tagMatches.map(t => t.slice(1)))
        }
      }
    }
  })

  // 保存最后一个概念
  if (currentHeading) {
    concepts.push({
      title: currentHeading,
      description: currentDescription.join('\n').trim(),
      tags: currentTags,
      level: currentLevel,
    })
  }

  return {
    title: docTitle,
    content: text,
    concepts,
    source: fileName,
  }
}

/**
 * 解析纯文本文件
 * 按段落分割，每个段落成为一个概念
 * @param {string} text - 纯文本内容
 * @param {string} fileName - 文件名
 * @returns {{title: string, content: string, concepts: Array}}
 */
export function parsePlainText(text, fileName = '') {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  const docTitle = fileName.replace(/\.txt$/i, '') || '文本文档'

  const concepts = paragraphs.map((paragraph, index) => {
    const trimmed = paragraph.trim()
    const lines = trimmed.split('\n')

    // 第一行作为标题
    let title = lines[0].trim()
    let description = lines.slice(1).join('\n').trim()

    // 如果只有一行且较长，截断作为标题
    if (!description && title.length > 50) {
      description = title
      title = title.slice(0, 50) + '...'
    }

    // 如果标题太短（可能只是序号），使用段落序号
    if (title.length < 3) {
      title = `段落 ${index + 1}`
      description = trimmed
    }

    return {
      title,
      description,
      tags: [],
    }
  })

  return {
    title: docTitle,
    content: text,
    concepts,
    source: fileName,
  }
}

/**
 * 解析 JSON 文件
 * 如果是数组，每个对象成为一个概念
 * 如果是对象，尝试提取有意义的字段
 * @param {string} text - JSON 文本内容
 * @param {string} fileName - 文件名
 * @returns {{title: string, content: string, concepts: Array}}
 */
export function parseJSON(text, fileName = '') {
  const docTitle = fileName.replace(/\.json$/i, '') || 'JSON 数据'

  try {
    const data = JSON.parse(text)

    // 数组格式：每个元素作为一个概念
    if (Array.isArray(data)) {
      const concepts = data.map((item, index) => {
        if (typeof item === 'string') {
          return {
            title: item.length > 50 ? item.slice(0, 50) + '...' : item,
            description: item,
            tags: [],
          }
        }

        if (typeof item === 'object' && item !== null) {
          // 尝试常见字段名
          const title = item.title || item.name || item.label ||
                       item.heading || item.key || item.id ||
                       `项目 ${index + 1}`
          const description = item.description || item.content ||
                            item.text || item.summary || item.body ||
                            JSON.stringify(item, null, 2)
          const tags = item.tags || item.keywords || item.categories || []

          return {
            title: String(title),
            description: String(description),
            tags: Array.isArray(tags) ? tags.map(String) : [],
          }
        }

        return {
          title: `项目 ${index + 1}`,
          description: JSON.stringify(item),
          tags: [],
        }
      })

      return {
        title: docTitle,
        content: text,
        concepts,
        source: fileName,
      }
    }

    // 对象格式：将顶级键作为概念
    if (typeof data === 'object' && data !== null) {
      const concepts = Object.entries(data).map(([key, value]) => {
        const description = typeof value === 'string'
          ? value
          : JSON.stringify(value, null, 2)

        return {
          title: key,
          description,
          tags: [],
        }
      })

      return {
        title: data.title || data.name || docTitle,
        content: text,
        concepts,
        source: fileName,
      }
    }

    // 非数组非对象：单一概念
    return {
      title: docTitle,
      content: text,
      concepts: [{
        title: docTitle,
        description: String(data),
        tags: [],
      }],
      source: fileName,
    }
  } catch (error) {
    console.error('JSON 解析失败:', error)
    return {
      title: docTitle,
      content: text,
      concepts: [],
      source: fileName,
      error: 'JSON 格式错误',
    }
  }
}

/**
 * 解析 CSV 文件
 * 第一行为表头，每行数据成为一个概念
 * @param {string} text - CSV 文本内容
 * @param {string} fileName - 文件名
 * @returns {{title: string, content: string, concepts: Array}}
 */
export function parseCSV(text, fileName = '') {
  const docTitle = fileName.replace(/\.csv$/i, '') || 'CSV 数据'
  const lines = text.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    return {
      title: docTitle,
      content: text,
      concepts: [],
      source: fileName,
    }
  }

  // 解析表头
  const headers = parseCSVLine(lines[0])

  // 智能识别标题和描述列
  const titleCol = findBestColumn(headers, ['title', 'name', 'label', 'heading', '标题', '名称'])
  const descCol = findBestColumn(headers, ['description', 'content', 'text', 'summary', '描述', '内容'])
  const tagCol = findBestColumn(headers, ['tags', 'keywords', 'category', '标签', '分类'])

  // 解析每行数据
  const concepts = lines.slice(1).map((line, index) => {
    const values = parseCSVLine(line)
    const rowData = {}
    headers.forEach((h, i) => {
      rowData[h] = values[i] || ''
    })

    const title = titleCol !== -1
      ? values[titleCol] || `行 ${index + 1}`
      : values[0] || `行 ${index + 1}`

    const description = descCol !== -1
      ? values[descCol] || ''
      : headers.map((h, i) => i !== titleCol ? `${h}: ${values[i] || ''}` : '').filter(Boolean).join('\n')

    let tags = []
    if (tagCol !== -1 && values[tagCol]) {
      tags = values[tagCol].split(/[,;|、]/).map(t => t.trim()).filter(Boolean)
    }

    return {
      title: title.trim(),
      description: description.trim(),
      tags,
    }
  })

  return {
    title: docTitle,
    content: text,
    concepts,
    source: fileName,
    headers,
  }
}

/**
 * 解析 CSV 行（处理引号包裹的字段）
 * @param {string} line - CSV 行
 * @returns {string[]} - 字段数组
 */
function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // 转义的引号
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

/**
 * 在表头中查找最佳匹配列
 * @param {string[]} headers - 表头数组
 * @param {string[]} candidates - 候选列名
 * @returns {number} - 匹配的列索引，未找到返回 -1
 */
function findBestColumn(headers, candidates) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim())

  for (const candidate of candidates) {
    const index = lowerHeaders.indexOf(candidate.toLowerCase())
    if (index !== -1) return index
  }

  // 模糊匹配
  for (const candidate of candidates) {
    const index = lowerHeaders.findIndex(h => h.includes(candidate.toLowerCase()))
    if (index !== -1) return index
  }

  return -1
}
