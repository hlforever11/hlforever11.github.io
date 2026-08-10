const https = require('https')

const DEFAULT_ENDPOINT = 'https://sph.litao.workers.dev/api/fetch_video_profile'

function extractUrl(text = '') {
  const urls = String(text).match(/https?:\/\/[^\s<>"'，。；、）)】]+/gi) || []
  for (const raw of urls) {
    try {
      const u = new URL(raw)
      const host = u.hostname.toLowerCase()
      if (host === 'weixin.qq.com' || host === 'channels.weixin.qq.com' || host.endsWith('.weixin.qq.com')) {
        return u.toString()
      }
    } catch (e) {}
  }
  return ''
}

function postJson(target, payload, timeoutMs = 22000) {
  return new Promise((resolve, reject) => {
    const u = new URL(target)
    const body = JSON.stringify(payload)

    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 WeChatMiniProgram/1.0'
      },
      timeout: timeoutMs
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`解析服务错误（HTTP ${res.statusCode}）`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('解析服务返回了无法识别的数据。'))
        }
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error('解析超时，请稍后再试。'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function safeHost(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}`
  } catch (e) {
    return ''
  }
}

exports.main = async (event = {}) => {
  const shareUrl = extractUrl(event.input || '')
  if (!shareUrl) {
    return { ok: false, message: '没有识别到有效的视频号分享链接。' }
  }

  try {
    const endpoint = process.env.PARSER_ENDPOINT || DEFAULT_ENDPOINT
    const json = await postJson(endpoint, { url: shareUrl })

    if (json && json.errCode !== undefined && json.errCode !== 0) {
      return {
        ok: false,
        message: json.errMsg || json.message || '这个链接暂时无法解析，请确认视频仍为公开状态。'
      }
    }

    const data = (json && json.data) || {}
    const feed = data.feedInfo || {}
    const authorInfo = data.authorInfo || {}
    const h264 = feed.h264VideoInfo || {}
    const h265 = feed.h265VideoInfo || {}

    // 小程序保存相册时优先 H.264，兼容性通常优于 H.265。
    const videoUrl = h264.videoUrl || feed.videoUrl || h265.videoUrl || ''
    if (!videoUrl) {
      return { ok: false, message: '已经取得视频信息，但没有找到可下载的视频地址。' }
    }

    const cover = feed.coverUrl || h264.coverUrl || h265.coverUrl || ''
    const desc = String(feed.description || '').trim()
    const title = desc ? desc.split('\n')[0].slice(0, 100) : '微信视频号视频'
    const codec = h264.videoUrl ? 'H.264 / MP4' : (h265.videoUrl && !feed.videoUrl ? 'H.265 / MP4' : 'MP4')

    return {
      ok: true,
      video: {
        title,
        author: authorInfo.nickname || '',
        cover,
        videoUrl,
        codec,
        downloadHost: safeHost(videoUrl)
      }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : '解析失败，请稍后再试。'
    return {
      ok: false,
      message: /ENOTFOUND|ECONNRESET|socket|network/i.test(msg)
        ? '云端暂时无法连接解析服务，请稍后再试。'
        : msg
    }
  }
}
