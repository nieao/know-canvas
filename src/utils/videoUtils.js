/**
 * 视频工具函数
 * 提供视频处理相关工具，如帧提取、格式识别、时长格式化等
 */

/**
 * 从视频文件中提取第一帧作为 Data URL
 * @param {File|Blob|string} videoSource - 视频文件、Blob 或 URL
 * @returns {Promise<string>} - 第一帧的 Data URL
 */
export const extractFirstFrame = (videoSource) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'

    // 创建画布用于帧捕获
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    // 设置视频源
    if (videoSource instanceof File || videoSource instanceof Blob) {
      video.src = URL.createObjectURL(videoSource)
    } else {
      video.src = videoSource
    }

    // 元数据加载完成后定位到第一帧
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      video.currentTime = 0.1
    }

    // 定位完成后捕获帧
    video.onseeked = () => {
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8)

        if (videoSource instanceof File || videoSource instanceof Blob) {
          URL.revokeObjectURL(video.src)
        }
        video.remove()

        resolve(dataUrl)
      } catch (err) {
        reject(err)
      }
    }

    // 错误处理
    video.onerror = (err) => {
      if (videoSource instanceof File || videoSource instanceof Blob) {
        URL.revokeObjectURL(video.src)
      }
      video.remove()
      reject(new Error('视频加载失败: ' + (err?.message || '未知错误')))
    }

    // 超时兜底
    setTimeout(() => {
      if (!video.seeking && !video.ended) {
        video.remove()
        reject(new Error('视频帧提取超时'))
      }
    }, 10000)
  })
}

/**
 * 获取视频格式/扩展名标签
 * @param {string} fileName - 文件名
 * @param {string} mimeType - MIME 类型（可选）
 * @returns {string} - 视频格式标签
 */
export const getVideoFormat = (fileName, mimeType = '') => {
  const ext = fileName?.split('.').pop()?.toLowerCase()

  const formatMap = {
    'mp4': 'MP4',
    'm4v': 'M4V',
    'webm': 'WebM',
    'mkv': 'MKV',
    'avi': 'AVI',
    'mov': 'MOV',
    'wmv': 'WMV',
    'flv': 'FLV',
    'ogv': 'OGV',
    '3gp': '3GP',
  }

  if (ext && formatMap[ext]) {
    return formatMap[ext]
  }

  if (mimeType) {
    const mimeFormat = mimeType.split('/').pop()?.toUpperCase()
    if (mimeFormat) return mimeFormat
  }

  return 'VIDEO'
}

/**
 * 格式化视频时长为 MM:SS 或 HH:MM:SS
 * @param {number} seconds - 时长（秒）
 * @returns {string} - 格式化后的时长字符串
 */
export const formatVideoDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return ''

  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * 获取视频元数据（时长、尺寸）
 * @param {File|Blob|string} videoSource - 视频文件、Blob 或 URL
 * @returns {Promise<{duration: number, width: number, height: number}>}
 */
export const getVideoMetadata = (videoSource) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    if (videoSource instanceof File || videoSource instanceof Blob) {
      video.src = URL.createObjectURL(videoSource)
    } else {
      video.src = videoSource
    }

    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      }

      if (videoSource instanceof File || videoSource instanceof Blob) {
        URL.revokeObjectURL(video.src)
      }
      video.remove()

      resolve(metadata)
    }

    video.onerror = (err) => {
      if (videoSource instanceof File || videoSource instanceof Blob) {
        URL.revokeObjectURL(video.src)
      }
      video.remove()
      reject(err)
    }
  })
}
