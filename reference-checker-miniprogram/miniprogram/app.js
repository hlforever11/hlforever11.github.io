App({
  globalData: {
    cloudAvailable: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("当前微信版本不支持云开发");
      return;
    }

    wx.cloud.init({
      traceUser: true
    });
    this.globalData.cloudAvailable = true;
  }
});

