# YouTube 下载助手后端

该服务部署在 Render，供 GitHub Pages 前端调用。后端包含：

- 最新版 yt-dlp 与 yt-dlp-ejs；
- Node.js JavaScript 解密运行环境；
- FFmpeg 音视频合并与音频转换；
- BgUtils PO Token Provider；
- 视频时长、文件大小、并发与请求频率限制。

## 一键部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hlforever11/hlforever11.github.io)

登录 Render 后点击上方按钮，确认 Blueprint 名称并选择 **Deploy Blueprint**。Render 会读取仓库根目录的 `render.yaml`，创建免费的 `hlforever11-youtube-downloader-api` Web Service。

## 接口

- `GET /health`：运行状态。
- `POST /api/resolve`：解析公开视频并返回可选格式。
- `GET /api/download`：生成并返回视频或 MP3 文件。

默认仅允许 30 分钟、250 MB 以内的单个文件。服务不保存下载历史，临时文件在响应完成后删除。
