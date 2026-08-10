Page({
  data: {
    input: '',
    canParse: false,
    parsing: false,
    downloading: false,
    downloadText: '正在下载…',
    statusText: '',
    statusType: 'loading',
    video: null
  },

  onInput(e) {
    const input = e.detail.value || ''
    this.setData({
      input,
      canParse: this.hasValidLink(input)
    })
  },

  hasValidLink(text) {
    return /https?:\/\/(?:[^\s/]+\.)?weixin\.qq\.com\/[\S]+/i.test(text || '') ||
      /https?:\/\/channels\.weixin\.qq\.com\/[\S]+/i.test(text || '')
  },

  async pasteFromClipboard() {
    try {
      const res = await wx.getClipboardData()
      const input = res.data || ''
      this.setData({ input, canParse: this.hasValidLink(input) })
      if (!this.hasValidLink(input)) {
        this.setStatus('error', '剪贴板中没有识别到有效的视频号分享链接。')
      } else {
        this.setStatus('', '')
      }
    } catch (err) {
      this.setStatus('error', '读取剪贴板失败，请手动粘贴链接。')
    }
  },

  clearAll() {
    this.setData({
      input: '',
      canParse: false,
      parsing: false,
      downloading: false,
      downloadText: '正在下载…',
      statusText: '',
      video: null
    })
  },

  resetForNew() {
    this.clearAll()
    wx.pageScrollTo({ scrollTop: 0, duration: 260 })
  },

  setStatus(type, text) {
    this.setData({ statusType: type || 'loading', statusText: text || '' })
  },

  async parseVideo() {
    if (!this.data.canParse || this.data.parsing) return

    this.setData({ parsing: true, video: null })
    this.setStatus('loading', '正在解析视频，请稍候…')

    try {
      const res = await wx.cloud.callFunction({
        name: 'parseVideo',
        data: { input: this.data.input }
      })

      const result = res.result || {}
      if (!result.ok || !result.video) {
        throw new Error(result.message || '这个链接暂时无法解析，请确认视频仍为公开状态。')
      }

      this.setData({ video: result.video })
      this.setStatus('success', '解析成功。可以预览或保存视频到手机相册。')
      setTimeout(() => {
        wx.pageScrollTo({ scrollTop: 520, duration: 260 })
      }, 80)
    } catch (err) {
      const msg = (err && (err.errMsg || err.message)) || '解析失败，请稍后再试。'
      this.setStatus('error', msg)
    } finally {
      this.setData({ parsing: false })
    }
  },

  async downloadVideo() {
    const video = this.data.video
    if (!video || !video.videoUrl || this.data.downloading) return

    this.setData({ downloading: true, downloadText: '正在下载…' })

    try {
      const downloadRes = await new Promise((resolve, reject) => {
        const task = wx.downloadFile({
          url: video.videoUrl,
          timeout: 120000,
          success: resolve,
          fail: reject
        })

        task.onProgressUpdate((res) => {
          const progress = Number(res.progress || 0)
          this.setData({ downloadText: `正在下载 ${progress}%` })
        })
      })

      if (downloadRes.statusCode !== 200 || !downloadRes.tempFilePath) {
        throw new Error(`下载失败（HTTP ${downloadRes.statusCode || '未知'}）`)
      }

      await new Promise((resolve, reject) => {
        wx.saveVideoToPhotosAlbum({
          filePath: downloadRes.tempFilePath,
          success: resolve,
          fail: reject
        })
      })

      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err) {
      const msg = (err && (err.errMsg || err.message)) || '保存失败'

      if (/domain|合法域名|url not in domain list/i.test(msg)) {
        wx.showModal({
          title: '需要配置下载域名',
          content: `请在小程序后台把 ${video.downloadHost || '视频源域名'} 添加到 downloadFile 合法域名后再试。`,
          showCancel: false
        })
      } else if (/auth deny|authorize|permission|privacy/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在微信设置中允许本小程序保存视频到相册。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting()
          }
        })
      } else {
        wx.showModal({ title: '保存失败', content: msg, showCancel: false })
      }
    } finally {
      this.setData({ downloading: false, downloadText: '正在下载…' })
    }
  },

  copyVideoUrl() {
    const url = this.data.video && this.data.video.videoUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '直链已复制', icon: 'success' })
    })
  },

  copyEmail() {
    wx.setClipboardData({
      data: 'linhu@scu.edu.cn',
      success: () => wx.showToast({ title: '邮箱已复制', icon: 'none' })
    })
  }
})
