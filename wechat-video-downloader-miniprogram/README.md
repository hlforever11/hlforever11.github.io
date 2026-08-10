# 微信视频号下载 · 微信小程序

这是 `wechat-video-downloader` 网站的原生微信小程序版本。

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

## 第一次导入

### 1. 单独申请一个小程序 AppID

建议为“微信视频号下载”使用一个新的小程序 AppID，不要直接替换现有其他小程序的 AppID。

申请后，将根目录 `project.config.json` 中：

```json
"appid": "touristappid"
```

替换成新 AppID。

### 2. 微信开发者工具导入

在微信开发者工具中选择“导入项目”，项目目录选择：

```text
wechat-video-downloader-miniprogram
```

开发者工具会自动识别：

- 小程序目录：`miniprogram/`
- 云函数目录：`cloudfunctions/`

### 3. 开通云开发

在开发者工具顶部选择“云开发”，为这个新小程序创建一个云开发环境。

`miniprogram/app.js` 默认调用当前小程序绑定的默认云环境，因此通常无需把环境 ID 写死在代码里。

### 4. 部署解析云函数

在开发者工具左侧找到：

```text
cloudfunctions/parseVideo
```

右键选择：

**上传并部署：云端安装依赖**

部署完成后，小程序前端会通过：

```js
wx.cloud.callFunction({ name: 'parseVideo' })
```

调用云函数。

解析服务地址被封装在云函数中，默认使用：

```text
https://sph.litao.workers.dev/api/fetch_video_profile
```

如果以后需要切换解析服务，可以在云函数环境变量中设置：

```text
PARSER_ENDPOINT
```

无需修改小程序前端。

## 下载域名配置

解析操作走云函数，因此小程序前端无需把第三方解析服务加入 `request` 合法域名。

但“保存视频到相册”使用 `wx.downloadFile`，微信要求视频文件所在域名属于 `downloadFile` 合法域名。

视频解析成功后，云函数会同时返回：

```text
downloadHost
```

如果开发者工具或真机提示“url not in domain list / 不在 downloadFile 合法域名列表”，请进入：

**微信公众平台 → 开发管理 → 开发设置 / 域名设置 → downloadFile 合法域名**

把报错中提示的视频源域名加入白名单。

视频号常见视频源域名可能包括：

```text
https://finder.video.qq.com
https://findermp.video.qq.com
```

实际以解析结果返回的 `downloadHost` 为准。

> 开发阶段可以在微信开发者工具里临时关闭“校验合法域名、web-view、TLS 版本以及 HTTPS 证书”，但正式版不能依赖这个开发选项。

## 真机测试

建议按下面顺序测试：

1. 打开一个公开视频号视频
2. 在微信里复制该视频的分享链接
3. 打开小程序
4. 点击“粘贴”
5. 点击“开始解析”
6. 确认标题、作者、封面和视频预览正常
7. 点击“保存视频到相册”
8. 首次使用时允许相册权限
9. 在手机相册确认 MP4 已保存

## 一个需要提前知道的发布问题

开发版和体验版可以按上述方式测试完整功能；正式提交微信审核时，审核结果由微信平台决定。由于这个小程序的核心功能涉及解析和保存视频号内容，正式审核可能会比普通工具类小程序更严格。

## 数据处理

- 小程序本身不保存用户输入的分享链接
- 小程序本身不保存解析后的视频
- 分享链接会由云函数发送到第三方解析服务完成解析
- 视频文件下载后只作为临时文件存在，随后由微信客户端保存到用户手机相册

## 联系

`linhu@scu.edu.cn`
