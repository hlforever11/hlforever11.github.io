# V24更新步骤

1. 解压并导入包含project.config.json的完整项目目录。沿用原AppID和云环境。
2. 右键cloudfunctions/verifyReference，选择“上传并部署：云端安装依赖”。必须部署整个目录，新版包含lib/usage-stats.js及wx-server-sdk依赖。响应build应为2026.11.04-usage1。
3. 首次统计上报会尝试创建verification_usage集合；若环境不允许自动创建，手工创建同名集合，设置仅云函数/管理端读写，不允许客户端直接读写。不要清空原数据库。
4. 在开发者工具编译并手机预览，完成一次核验。云开发控制台测试verifyReference，参数为：
   {"action":"usage.read"}
   返回kind应为wenzheng-usage-v1，网站与小程序checked分别列出，total为两端checked之和。initialized:false表示尚无已接收记录，不代表历史核验量为0。
5. 上传客户端版本1.0.24，设体验版检查后提交审核、发布。仅上传客户端不能替代第2步；仅部署云端也不能更新旧客户端。
6. 若此前V23文档解析函数尚未更新，同时部署extractDocument，目标build为2026.10.22-extract3；userHistory本轮未改，已部署的保留即可。首次安装请部署三个云函数。

网站统计接入使用原/api/verify-reference网关，无需新增HTTP路径；需先部署本包核验函数后才能接收统计。部署前，新网站上报会在本机排队，不伪报成功。

自动测试使用模拟数据库，不写生产统计；手机预览验收属于实际交互，会计入条次。查询统计不会增加核验量。

历史记录只读汇总参数：
{"action":"usage.retainedHistory"}

具体口径见USAGE.md。此包不代表已部署云函数或发布微信正式版。
