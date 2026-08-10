# Windows 按需启动后端

这套脚本把下载后端按需运行在当前 Windows 电脑，并通过 Tailscale Funnel 提供固定的 HTTPS 地址。GitHub Pages 网页仍托管在 GitHub；只有解析和文件传输经过这台电脑。登录 Windows 后，后端不会自动启动。

## 首次安装

1. 解压整个下载包到一个不会随意移动的位置，例如 `C:\YouTubeDownloaderBackend`。不要直接在 ZIP 压缩包内运行。
2. 双击 `windows\setup-local-backend.cmd`。
3. Windows 如询问是否允许安装软件，请选择允许。脚本只安装缺少的 Python、Node.js、FFmpeg 和 Tailscale。
4. 浏览器打开 Tailscale 时登录；第一次启用 Funnel 时，再点击一次允许。
5. 安装完成后，打开 `windows\public-url.txt`，把其中的 `https://...ts.net` 地址发给我。

## 日常使用

- 需要使用时，双击桌面的“启动 YouTube 下载助手”。它会启动后端并自动打开网站。
- 使用结束后，可双击桌面的“停止 YouTube 下载服务”。
- 也可以直接运行 `windows\start-local-backend.cmd` 和 `windows\stop-local-backend.cmd`。
- 错误日志：`windows\backend-error.log`。

没有启动后端、电脑睡眠、关机或断网时，网页下载功能会显示离线；再次双击启动快捷方式即可恢复。

## 安全边界

- 后端只监听 `127.0.0.1:10000`，不会直接开放路由器或局域网端口。
- Funnel 地址是公开地址；服务已限制来源、请求频率、视频时长、文件大小以及同时下载数量。
- 只下载本人创作、已获授权、公共领域或明确允许下载的内容。

Tailscale Funnel 官方说明：<https://tailscale.com/docs/features/tailscale-funnel>
