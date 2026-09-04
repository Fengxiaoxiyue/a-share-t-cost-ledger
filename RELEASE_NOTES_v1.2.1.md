# A 股做 T 成本簿 v1.2.1

这是一个 Windows 启动入口修复版本。

## 修复

- 修复 Windows PowerShell 5.1 对本地页面 URL 的变量解析错误。该问题会导致 `start-local.cmd` 只打开 Chrome 空白新标签页。
- Chrome 或 Edge 现以独立应用窗口打开股票工具，不再显示为普通浏览器标签页。
- 保留原有 Umi-OCR 自动检测、自动启动和 localhost 监听检查。

## 验证

- Windows PowerShell 5.1 实际启动成功。
- 打开的窗口标题为“A 股做 T 成本簿”。
- Umi-OCR HTTP 服务继续只监听 `127.0.0.1:1224`。
- 完整自动化测试 22 项全部通过。
