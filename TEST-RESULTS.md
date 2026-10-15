# 验证结果（2026-10-15）

环境：Windows 11 专业版 10.0.26100，Node.js 24.19.0，Rust 1.99.0 x86_64-pc-windows-gnu，Rust 自带 LLD，Microsoft Edge / WebView2。项目原有游戏代码未修改。

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript / 核心逻辑单元测试 | 20 通过，0 失败 | `logs/final-unit-race.txt` |
| Edge 浏览器验收（含缩小/放大循环） | 5 通过，0 失败 | `logs/acceptance-final.txt` |
| Rust 原生单元与持久化测试 | 7 通过，0 失败 | `logs/rust-manifest-tests.txt` |
| 真实 Windows 桌面端到端验收（含 Key 不落库） | 通过 | `logs/native-smoke-key-check.txt` |
| TypeScript 类型检查及 Vite 生产构建 | 通过 | `logs/final-build-race.txt` |
| npm audit | 0 已知漏洞 | `logs/dependency-audit.json` |
| Windows x64 NSIS 安装包 | 成功生成；约 5.73 MiB | `logs/installer-final.txt` |
| 安装包内容检查与提取 | 通过，包含主程序、WebView2Loader 和许可证 | `logs/installer-extract.txt` |
| 从安装包提取的发布版程序启动验收 | 通过；界面、设置 IPC、正常退出 | `logs/release-smoke.txt` |

## 已验证的关键流程

- 导入 PDF/TXT，SHA-256 去重、独立书架与文件副本读取。
- 在公式附近画笔圈选，放大到 120%，撤销/重做、翻页、刷新后批注恢复。浏览器额外检查重绘位图在期望公式坐标处存在笔迹像素。
- 荧光笔、矩形、整条笔迹橡皮擦、撤销/重做与保存恢复。
- 区域截图包含原始公式，提取附近文本，匹配相交批注 ID。
- TXT 文字选择、问题上下文与相对滚动进度在重开后恢复。
- **真实桌面进程关闭并重新启动** 后，SQLite 中批注点数组完全一致，缩放恢复。
- Windows 凭据管理器写入、读取、删除测试值；HTTP 请求通过 Rust 从系统凭据获取 Key。
- 测试服务器核验 Authorization 请求头；直接检查 SQLite 主文件及 WAL，不含测试 Key 明文。
- 从实际 Tauri 界面经 Rust HTTP 客户端发起请求，传输区域图片和文本，经本地 SSE 协议夹具返回分片中文数据，保存到正确文档、页码和批注。
- 重新加载后查看已保存对话；模拟断网后仍可翻页、恢复批注与查看已保存解释。
- 纯文字模型图片硬拦截、不安全端点拒绝、流中断保留部分正文、接口错误上报。
- 关闭窗口时等待保存，实际桌面进程正常退出。

本地 SSE 返回值明确包含 `[TEST FIXTURE]` 标记，只用于传输协议与持久化验收，未进入产品代码或默认回答流程。**没有用户真实 API Key，因此未验证 DeepSeek 在线回答质量、额度或服务端实际可用性。**

## 修复过的问题

1. 修复 PDF 尚未渲染完成时自动化测试过早拖动的问题，加入就绪等待。
2. 升级存在安全公告的 PDF.js 与 Vitest；最终 npm 审计无已知漏洞。
3. 修复旧页数加载回调覆盖用户新翻页状态的竞态，有失败复现和回归测试。
4. 修复 TXT 相对滚动进度恢复及初始化时忽略首次滚动的问题。
5. 使用无空格产物目录规避 GNU `windres` 路径问题，使用现代 LLD 规避旧 MinGW 链接器兼容问题。
6. 为应用和 Rust 测试程序统一嵌入 Common Controls v6 激活清单，修复原生测试程序入口点错误。

构建日志中的 Vite 大 chunk 提示属于非阻断体积提示。Playwright 的 `NO_COLOR` / `FORCE_COLOR` 提示来自运行环境，不影响测试。

安装包在原构建已完成二进制类型标记后，使用 `tauri bundle --no-binary-patching` 重新打包补齐工具和许可证；“Skipping binary patching”是明确指定参数的提示，本产品不包含自动更新插件。没有执行静默安装、创建系统快捷方式或更改卸载注册表；发布版启动验证使用安装包中提取的原始程序与 DLL。

最终包另行提取核验，主程序 SHA-256 与完成启动验收的程序一致，并包含 WebView2Loader、第三方说明和 NSIS 完整许可文本（`logs/payload-final.txt`）。完整源码 ZIP 已检查 CRC 及关键源码文件，`release/SHA256SUMS.txt` 提供安装包与源码包的 SHA-256。

Windows 10 实机、密码 PDF 和真实在线模型尚未验收；详见 `KNOWN-ISSUES.md`。
