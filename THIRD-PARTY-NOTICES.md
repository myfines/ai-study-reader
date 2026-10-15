# 第三方组件

本项目自身代码采用 MIT 许可证，第三方代码保留各自许可证。

- 前端和 PDF.js（包括字体与 WASM notice）：`DEPENDENCY-LICENSES.md` 与 `licenses/`。
- Rust、Tauri、rusqlite、keyring、reqwest 等：`RUST-LICENSES.md` 与 `licenses/`；SQLite 本体为 public domain。
- Windows 安装器由未修改的 NSIS 3.11 生成。NSIS 主体采用 zlib/libpng 许可证，压缩模块另含 bzip2 / CPL-1.0 条款，完整上游文本保留在 `licenses/nsis-3.11-COPYING.txt`。上游项目与源码入口：[NSIS](https://nsis.sourceforge.io/)、[NSIS source](https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/)。
- 本机 GNU 编译器 / LLD 是开发工具，不包含在产品源码包或安装包内；标准 Windows 开发也可使用 MSVC。
- Microsoft WebView2 Runtime 和 WebView2Loader 遵循微软 SDK/运行时许可。Windows 上的运行时由系统或安装程序从微软取得；本项目不把它重新声明为 MIT。
- DeepSeek 或其他 AI 服务使用用户自己的 Key，服务费用与条款由相应提供方决定。
