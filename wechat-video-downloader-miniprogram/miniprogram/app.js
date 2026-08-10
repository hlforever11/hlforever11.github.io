App({
  globalData: {
    cloudAvailable: false,
    envId: 'cloud1-d6gtx1retbc8754fa'
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请升级微信后再使用本小程序。',
        showCancel: false
      })
      return
    }

    wx.cloud.init({
      env: this.globalData.envId,
      traceUser: true
    })
    this.globalData.cloudAvailable = true
  }
})
