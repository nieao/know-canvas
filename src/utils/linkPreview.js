/**
 * 链接预览工具
 * 使用 Microlink API 获取网页元数据
 * 支持视频平台检测和 ID 提取
 */

// Microlink API 端点
const MICROLINK_API = 'https://api.microlink.io'

// Bilibili API 端点（备用）
const BILIBILI_API = 'https://api.bilibili.com/x/web-interface/view'
const CORS_PROXY = 'https://api.allorigins.win/raw?url='

/**
 * 获取域名 favicon URL
 * @param {string} url - 页面 URL
 * @returns {string} - Favicon URL
 */
function getFaviconUrl(url) {
  try {
    const hostname = new URL(url).hostname
    if (hostname.includes('bilibili.com')) {
      return 'https://www.bilibili.com/favicon.ico'
    }
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'https://www.youtube.com/favicon.ico'
    }
    if (hostname.includes('xiaohongshu.com')) {
      return 'https://www.xiaohongshu.com/favicon.ico'
    }
    if (hostname.includes('tiktok.com')) {
      return 'https://www.tiktok.com/favicon.ico'
    }
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return ''
  }
}

/**
 * 获取 Bilibili 视频元数据（通过官方 API + CORS 代理）
 * @param {string} url - Bilibili 视频 URL
 * @returns {Promise<Object|null>} - 视频元数据或 null
 */
async function fetchBilibiliMetadata(url) {
  try {
    const bvMatch = url.match(/BV[\w]+/)
    if (!bvMatch) {
      console.warn('无法从 URL 中提取 Bilibili BV 号:', url)
      return null
    }

    const bvid = bvMatch[0]
    const apiUrl = `${BILIBILI_API}?bvid=${bvid}`
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`

    const response = await fetch(proxyUrl)

    if (!response.ok) {
      console.warn('Bilibili API 请求失败:', response.status)
      return null
    }

    const data = await response.json()

    if (data.code === 0 && data.data) {
      const { title, desc, pic, owner } = data.data
      return {
        title: title || 'Bilibili 视频',
        description: desc || `UP: ${owner?.name || ''}`,
        image: pic ? pic.replace('http:', 'https:') : '',
        favicon: 'https://www.bilibili.com/favicon.ico',
        screenshot: pic ? pic.replace('http:', 'https:') : '',
      }
    }

    console.warn('Bilibili API 返回错误:', data)
    return null
  } catch (error) {
    console.warn('获取 Bilibili 元数据失败:', error)
    return null
  }
}

/**
 * 检查图片是否满足最小宽度要求
 * @param {string} imageUrl - 图片 URL
 * @param {number} minWidth - 最小宽度（像素）
 * @returns {Promise<boolean>}
 */
async function checkImageSize(imageUrl, minWidth = 200) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.width >= minWidth)
    img.onerror = () => resolve(false)
    setTimeout(() => resolve(false), 5000)
    img.src = imageUrl
  })
}

/**
 * 获取链接元数据（标题、描述、图片、favicon）
 * @param {string} url - 要获取元数据的 URL
 * @returns {Promise<{title: string, description: string, image: string, favicon: string, screenshot: string}>}
 */
export async function fetchLinkMetadata(url) {
  try {
    new URL(url)
  } catch {
    return {
      title: url,
      description: '',
      image: '',
      favicon: '',
      screenshot: '',
    }
  }

  // 检测是否为视频 URL
  const { isVideo } = detectVideoUrl(url)

  // Bilibili 视频优先使用官方 API
  if (url.includes('bilibili.com') && url.match(/BV[\w]+/)) {
    const bilibiliMeta = await fetchBilibiliMetadata(url)
    if (bilibiliMeta) {
      return bilibiliMeta
    }
  }

  // 使用 Microlink API 获取元数据
  try {
    const response = await fetch(`${MICROLINK_API}?url=${encodeURIComponent(url)}`)

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      console.warn('元数据 API 返回非 JSON 响应:', contentType)
      return getFallbackMetadata(url)
    }

    const data = await response.json()

    if (data.status === 'success' && data.data) {
      const { title, description, image, logo } = data.data
      const pageImage = image?.url
      let finalImage = ''

      // 检查页面图片是否存在且满足最小尺寸要求（>=200px）
      if (pageImage) {
        const imageWidth = image?.width
        if (imageWidth && imageWidth >= 200) {
          finalImage = pageImage
        } else if (!imageWidth) {
          const isSuitable = await checkImageSize(pageImage)
          if (isSuitable) {
            finalImage = pageImage
          }
        }
      }

      // 没有合适图片时回退到截图
      if (!finalImage) {
        const screenshotUrl = `${MICROLINK_API}?url=${encodeURIComponent(url)}&screenshot=true`
        try {
          const ssResponse = await fetch(screenshotUrl)
          const ssContentType = ssResponse.headers.get('content-type') || ''
          if (ssContentType.includes('application/json')) {
            const ssData = await ssResponse.json()
            if (ssData.status === 'success' && ssData.data?.screenshot?.url) {
              finalImage = ssData.data.screenshot.url
            }
          }
        } catch (ssError) {
          console.warn('截图备用方案失败:', ssError)
        }
      }

      return {
        title: title || url,
        description: description || '',
        image: finalImage,
        favicon: logo?.url || getFaviconUrl(url),
        screenshot: finalImage,
      }
    }

    return getFallbackMetadata(url)
  } catch (error) {
    console.warn('获取链接元数据失败:', error)
    return getFallbackMetadata(url)
  }
}

/**
 * 仅获取 URL 截图
 * @param {string} url - 要截图的 URL
 * @returns {Promise<string>} - 截图 URL
 */
export async function fetchScreenshot(url) {
  try {
    const response = await fetch(
      `${MICROLINK_API}?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`
    )

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }

    const data = await response.json()

    if (data.status === 'success' && data.data?.screenshot?.url) {
      return data.data.screenshot.url
    }

    return ''
  } catch (error) {
    console.warn('获取截图失败:', error)
    return ''
  }
}

/**
 * API 失败时的降级元数据
 * @param {string} url - 页面 URL
 * @returns {Object} - 降级元数据
 */
function getFallbackMetadata(url) {
  try {
    const urlObj = new URL(url)
    return {
      title: urlObj.hostname,
      description: url,
      image: '',
      favicon: `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`,
      screenshot: '',
    }
  } catch {
    return {
      title: url,
      description: '',
      image: '',
      favicon: '',
      screenshot: '',
    }
  }
}

/**
 * 检测 URL 是否为视频链接
 * @param {string} url - 要检测的 URL
 * @returns {{isVideo: boolean, platform: string}}
 */
export function detectVideoUrl(url) {
  const videoPatterns = [
    // 主要视频平台
    { pattern: /youtube\.com\/watch|youtu\.be|youtube\.com\/shorts/, platform: 'youtube' },
    { pattern: /bilibili\.com\/video/, platform: 'bilibili' },
    { pattern: /vimeo\.com\/\d+/, platform: 'vimeo' },
    { pattern: /dailymotion\.com\/video/, platform: 'dailymotion' },
    { pattern: /nicovideo\.jp\/watch/, platform: 'niconico' },

    // 社交媒体视频
    { pattern: /tiktok\.com\/@.*\/video/, platform: 'tiktok' },
    { pattern: /douyin\.com\/video/, platform: 'douyin' },
    { pattern: /xiaohongshu\.com\/explore|xiaohongshu\.com\/discovery/, platform: 'xiaohongshu' },
    { pattern: /twitter\.com\/.*\/status|x\.com\/.*\/status/, platform: 'twitter' },
    { pattern: /instagram\.com\/(p|reel|tv)\//, platform: 'instagram' },
    { pattern: /weibo\.com\/.*\/\d+/, platform: 'weibo' },

    // 直播平台
    { pattern: /twitch\.tv\/videos|clips\.twitch\.tv/, platform: 'twitch' },
  ]

  for (const { pattern, platform } of videoPatterns) {
    if (pattern.test(url)) {
      return { isVideo: true, platform }
    }
  }

  return { isVideo: false, platform: '' }
}

/**
 * 从 URL 提取视频 ID
 * @param {string} url - 视频 URL
 * @param {string} platform - 视频平台
 * @returns {string} - 视频 ID
 */
export function extractVideoId(url, platform) {
  switch (platform) {
    case 'youtube': {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
      return match ? match[1] : ''
    }
    case 'bilibili': {
      const match = url.match(/BV[\w]+/)
      return match ? match[0] : ''
    }
    case 'vimeo': {
      const match = url.match(/vimeo\.com\/(\d+)/)
      return match ? match[1] : ''
    }
    default:
      return ''
  }
}
