# 微信视频号解析 API（EdgeOne Pages Functions）

腾讯 EdgeOne Pages Functions 部署目录，仅包含后端 API：

- `GET /api/health`
- `POST /api/parse`
- `OPTIONS /api/health`
- `OPTIONS /api/parse`

部署时将项目根目录设为 `wechat-video-edgeone`，并在生产环境变量中配置
`YUANBAO_COOKIE`。该变量不得写入代码、提交记录或日志。

本服务不保存用户提交链接或视频文件，不提供任意上游地址，也不配置第三方回退。
