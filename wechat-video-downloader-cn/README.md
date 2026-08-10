# 微信视频号下载 · 国内直连版

这个目录用于把原 GitHub Pages + Cloudflare Worker 版本迁移到腾讯云 CloudBase 云托管。

## 为什么要迁移

原版本包含两个对中国大陆网络不够稳定的环节：

- 页面托管在 `github.io`
- 视频解析默认调用 `workers.dev`

国内版改为：

```text
用户浏览器
  ↓
腾讯云 CloudBase 云托管
  ↓
本站 /api/parse
  ↓
腾讯元宝 yuanbao.tencent.com
  ↓
微信视频号 channels.weixin.qq.com
  ↓
腾讯视频 CDN
```

默认不会访问 `workers.dev`。

## 目录

```text
wechat-video-downloader-cn/
├─ Dockerfile
├─ .dockerignore
├─ package.json
├─ server.js
└─ public/
   └─ index.html
```

## 最简单的 CloudBase 部署方法

### 1. 打开腾讯云 CloudBase

访问：

```text
https://tcb.cloud.tencent.com/dev
```

进入你希望使用的云开发环境。

### 2. 打开“云托管”

选择：

```text
云托管 → 新建服务
```

服务名称建议：

```text
wechat-video-downloader
```

访问类型选择：

```text
WEB / 公网访问
```

### 3. 从 Git 仓库部署

选择 Git 仓库部署，并使用：

```text
https://github.com/hlforever11/hlforever11.github.io
```

分支：

```text
main
```

服务/代码根目录：

```text
wechat-video-downloader-cn
```

Dockerfile：

```text
Dockerfile
```

端口：

```text
3000
```

平台会根据根目录的 Dockerfile 自动构建 Node.js 服务。

如果控制台的 Git 部署界面不能选择子目录，可改用“本地代码/文件夹上传”，只上传 `wechat-video-downloader-cn` 这个目录。

## 4. 配置服务器端授权变量

国内直连解析需要服务器端环境变量：

```text
YUANBAO_COOKIE
```

它是登录腾讯元宝后浏览器中的 Cookie，只能配置在腾讯云服务端环境变量中。

**不要把 Cookie 写进 GitHub、网页 JavaScript，也不要发送到聊天、邮件或公开位置。**

在 CloudBase 云托管服务的“环境变量/变量配置”中添加：

```text
名称：YUANBAO_COOKIE
值：你本人当前有效的腾讯元宝 Cookie
```

修改后重新部署/重启服务。

## 5. 如何取得 YUANBAO_COOKIE

在电脑浏览器中登录：

```text
https://yuanbao.tencent.com/
```

按 `F12` 打开开发者工具，切到 Network（网络），刷新页面，点击一个发往 `yuanbao.tencent.com` 的请求，在 Request Headers（请求标头）中找到：

```text
Cookie: ...
```

只复制 `Cookie:` 后面的完整值，粘贴到 CloudBase 的 `YUANBAO_COOKIE` 环境变量。

Cookie 属于登录凭据，失效后只需要在 CloudBase 环境变量里更新，不需要改源码。

## 6. 部署后验证

部署完成后，CloudBase 会提供一个默认访问域名。

先访问：

```text
https://你的云托管域名/api/health
```

正常应返回类似：

```json
{
  "ok": true,
  "service": "wechat-video-downloader-cn",
  "directConfigured": true,
  "workerFallback": false
}
```

重点确认：

```text
directConfigured = true
workerFallback = false
```

然后打开网站首页，粘贴视频号公开视频分享链接进行测试。

## 7. 正式域名

CloudBase 默认域名适合先测试。

如果后续要长期公开使用，建议在 CloudBase 中绑定你自己的已备案域名，并开启 HTTPS。

## 安全设计

- `YUANBAO_COOKIE` 只存在腾讯云环境变量中
- 浏览器看不到 Cookie
- GitHub 源码中没有 Cookie
- 用户分享链接由本站后端处理
- 默认不访问 `workers.dev`
- 视频文件不在本站长期保存

## 备用 Worker

代码保留了显式备用能力，但默认关闭。

只有在 CloudBase 环境变量中主动设置：

```text
ALLOW_WORKER_FALLBACK=true
```

才会允许使用 `workers.dev`。

国内公开部署建议保持该变量不存在或为 `false`。
