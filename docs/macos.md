# macOS 构建与安装

在 [GitHub Actions](https://github.com/winotmk/mugdown/actions/workflows/build.yml) 中选择对应分支的成功构建，下载 `mugdown-macos-universal` 产物。解压后打开其中的 `.dmg`，将 mugdown 拷贝到「应用程序」再启动。

通用包同时包含 Apple Silicon（arm64）与 Intel（x86_64）。请使用 DMG 安装；Actions 直接归档的 `.app` 文件不保留可执行权限。

当前默认使用无需开发者证书的本地签名（ad hoc signing），尚未经过 Apple 公证。首次下载打开时，如 macOS 拦截，可在「系统设置 → 隐私与安全性」中确认打开。正式公开发行可以通过 `APPLE_SIGNING_IDENTITY` 覆盖本地签名，并配置 Developer ID 证书和 Apple 公证凭据；不要将这些凭据写入仓库。

窗口左上角保留 macOS 原生关闭、最小化与全屏按钮。屏幕顶部的系统菜单栏提供新建、打开、保存、撤销、查找与外观设置；格式工具栏继续留在文档窗口中。快捷键使用 ⌘，正文编辑器与 Windows 共用。

工作流在 macOS 15 Intel runner 上执行后端测试，验证通用二进制的两个架构及代码签名，再启动打包后的 WKWebView 应用。窗口只有在前端初始化完成后才显示；检查也会确认设置与预设写在 `.app` 包外。Apple Silicon 的实机交互体验仍需单独验收。
