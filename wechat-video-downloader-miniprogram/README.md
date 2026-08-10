# 微信视频号下载 · 微信小程序

这是 `wechat-video-downloader` 网站的原生微信小程序版本。

## 已复用“文证”现有配置

本工程已经直接使用“文证”小程序现有的微信配置：

```text
AppID: wxf7f4471533143581
云环境: cloud1-d6gtx1retbc8754fa
```

因此无需重新申请 AppID，也无需新建云开发环境。

新功能使用独立云函数：

```text
parseVideo
```

现有“文证”云函数 `extractDocument`、`userHistory`、`verifyReference` 不需要修改。

> 注意：由于 AppID 相同，这个工程与“文证”在微信平台上属于同一个小程序身份。开发测试没有问题；如果把这个工程上传并发布为正式版本，会更新该 AppID 对应的小程序版本，而不是生成第二个独立小程序。

## 已实现功能

- 粘贴视频号分享链接或整段分享文字
- 一键读取剪贴板
- 云函数解析公开视频号链接
- 显示视频标题、作者、封面并直接预览
- 优先选择 H.264 视频源，提高手机端兼容性
- 显示下载进度
- 保存视频到手机系统相册
- 复制视频直链
- 中文错误提示
- 页脚邮箱 `linhu@scu.edu.cn`
- 不保存用户输入的链接和视频文件

## 工程结构

```text
wechat-video-downloader-miniprogram/
├─ project.config.json
├─ miniprogram/
│  ├─ app.js
│  ├─ app.json
│  ├─ app.wxss
│  └─ pages/index/
│     ├─ index.js
│     ├─ index.json
│     ├─ index.wxml
│     └─ index.wxss
└─ cloudfunctions/
   └─ parseVideo/
      ├─ index.js
      └─ package.json
```

## 导入微信开发者工具

在微信开发者工具中选择“导入项目”，项目目录选择：

```text
wechat-video-downloader-miniprogram
```

开发者工具会自动读取：

```text
AppID: wxf7f4471533143581
小程序目录: miniprogram/
云函数目录: cloudfunctions/
```

`miniprogram/app.js` 已明确初始化原“文证”云环境：

```js
wx.cloud.init({
  env: 'cloud1-d6gtx1retbc8754fa',
  traceUser: true
})
```

## 部署解析云函数

导入后，在开发者工具左侧找到：

```text
cloudfunctions/parseVideo
```

右键选择：

**上传并部署：云端安装依赖**

它会部署到既有云环境：

```text
cloud1-d6gtx1retbc8754fa
```

现有“文证”云函数不会被覆盖，因为函数名不同。

解析服务地址封装在云函数中，默认使用：

```text
https://sph.litao.workers.dev/api/fetch_video_profile
```

如果以后需要更换解析服务，可以在云函数环境变量中设置：

```text
PARSER_ENDPOINT
```

## 下载域名配置

解析操作走云函数，因此前端无需把第三方解析接口加入 `request` 合法域名。

“保存视频到相册”使用 `wx.downloadFile`，正式小程序要求视频文件源域名在 `downloadFile` 合法域名列表中。

解析成功后，云函数会返回实际的：

```text
downloadHost
```

如果真机提示：

```text
url not in domain list
```

请进入微信公众平台：

**开发管理 → 开发设置 → 服务器域名 → downloadFile 合法域名**

把错误提示中的实际视频源域名加入即可。

开发调试阶段，可以在微信开发者工具中临时勾选：

**不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**

正式发布不能依赖这一选项。

## 真机测试建议

1. 微信视频号中找到一个公开视频
2. 复制视频分享链接
3. 打开本工程的小程序开发版
4. 点击“粘贴”
5. 点击“开始解析”
6. 确认标题、作者、封面和视频预览正常
7. 点击“保存视频到相册”
8. 首次使用时允许相册权限
9. 在手机相册确认视频已经保存

## 数据处理

- 小程序本身不保存用户输入的分享链接
- 小程序本身不保存解析后的视频
- 分享链接通过微信云函数发送到第三方解析服务
- 视频下载后仅作为客户端临时文件，再保存到用户手机相册

## 联系

`linhu@scu.edu.cn`
