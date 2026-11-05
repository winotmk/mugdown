# mugdown v0.2.9

本次将 macOS 适配合入 main，并首次在 Releases 提供 Apple Silicon / Intel 通用安装包。Windows 保持原有功能与配置存储方式。

- 调整 Mac 左上角三色窗口按钮的间距，保留原生关闭、最小化与全屏交互。
- 移除 Mac 窗口内重复的主菜单，保留格式工具栏；屏幕顶部提供完整原生菜单，跟随 macOS 的首选语言显示中文或英文。
- Mac 默认将配置保存在 `~/Library/Application Support/com.winotmk.mugdown/`，首次修改设置时才生成配置文件，内置排版预设不再自动展开为文件。
- 设置中新增「打开配置文件夹」及「便携模式」。便携数据保存在 app 旁的 `mugdown-data/`，切换时携带当前配置与个人 CSS，保留源数据，并备份目标目录中的冲突文件。
- 自动迁移旧版 Mac 的 app 旁配置与个人 CSS，原文件保留。

**Mac**：下载 `mugdown-0.2.9-macos-universal.dmg`，打开后将 mugdown 拷贝到「应用程序」。安装包同时支持 Apple Silicon 与 Intel，使用系统 WKWebView。目前采用本地签名，尚未经过 Apple 公证；首次下载若被拦截，可在「系统设置 → 隐私与安全性」中确认打开。便携模式需要 app 所在目录可写，移动时请同时复制 `mugdown-data/`。

**Windows x64**：下载 `mugdown-0.2.9-windows-x64.zip`，解压后运行 `mugdown.exe`，需要 Microsoft Edge WebView2。升级时可复制旧版设置与个人 `presets/`。

两种下载均附 `.sha256` 校验文件。发布流程在 Windows 构建及便携包检查、Mac 界面与后端测试、通用架构与签名检查、默认和便携模式启动检查全部通过后上传安装包。

For macOS, download the universal DMG and copy mugdown to Applications. This release adds native menus, improved window-control spacing, user settings storage, and an optional portable profile beside the app. The app is ad hoc signed and has not been notarized. Windows retains its existing behavior; download the Windows x64 portable ZIP. SHA-256 checksums accompany both downloads.
