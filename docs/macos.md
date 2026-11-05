# macOS 构建与安装

在 [Releases](https://github.com/winotmk/mugdown/releases/latest) 下载 `mugdown-版本号-macos-universal.dmg`，打开后将 mugdown 拷贝到「应用程序」再启动。下载旁的 `.sha256` 文件可用于校验。

开发版本也可在 [GitHub Actions](https://github.com/winotmk/mugdown/actions/workflows/build.yml) 中选择对应分支的成功构建，下载 `mugdown-macos-universal` 产物，解压后使用其中的 `.dmg`。

通用包同时包含 Apple Silicon（arm64）与 Intel（x86_64）。请使用 DMG 安装；Actions 直接归档的 `.app` 文件不保留可执行权限。

当前默认使用无需开发者证书的本地签名（ad hoc signing），尚未经过 Apple 公证。首次下载打开时，如 macOS 拦截，可在「系统设置 → 隐私与安全性」中确认打开。正式公开发行可以通过 `APPLE_SIGNING_IDENTITY` 覆盖本地签名，并配置 Developer ID 证书和 Apple 公证凭据；不要将这些凭据写入仓库。

窗口左上角保留 macOS 原生关闭、最小化与全屏按钮，并为按钮组预留内边距。文件、编辑、格式、显示、窗口与帮助菜单位于屏幕顶部，窗口内不再重复显示主菜单；格式工具栏及「更多编辑操作」继续留在文档窗口中。快捷键使用 ⌘，正文编辑器与 Windows 共用。

系统菜单跟随 macOS 为 mugdown 选择的首选语言：中文使用中文，其他语言使用英文。可在「系统设置 → 通用 → 语言与地区 → 应用程序」中指定语言，重新启动 mugdown 后生效。窗口内的语言仍可在外观设置中选择。

默认将设置保存在 `~/Library/Application Support/com.winotmk.mugdown/settings.json`，个人 CSS 预设保存在同目录的 `presets/`。首次启动使用内存中的默认值，首次修改设置时才写入配置；内置 CSS 预设直接随应用提供，不会自动生成文件。在外观设置的设置存储区域点击「打开配置文件夹」即可在 Finder 中打开当前目录；尚未保存设置时只创建目录。

开启「便携模式」后，当前设置与个人预设会复制到 `.app` 旁的 `mugdown-data/`，其中包含 `settings.json` 和按需创建的 `presets/`。移动应用时一起复制这个文件夹。请将应用放在可写目录中后再开启便携模式；不要直接在只读的 DMG 内开启。关闭便携模式会把当前数据复制回用户目录，同时保留标记为停用的便携副本。切换时目标目录中发生冲突的配置与 CSS 会备份到该目录的 `backups/`，不会删除源文件。

旧版本在 `.app` 旁生成的 `mugdown.settings.json` 和个人 CSS 预设会自动迁移到用户目录，原文件保留。后续启动会使用迁移后的配置，避免旧副本反复覆盖修改。应用不会往 `.app` 包内写入设置。

工作流在 macOS 15 Intel runner 上执行后端测试和 Mac 界面测试，验证通用二进制的两个架构、菜单语言声明及代码签名，再分别启动默认模式和便携模式下的打包应用。窗口只有在前端初始化完成后才显示；检查也会确认首次启动不生成默认配置或预设，便携启动不改写配置或应用包。Apple Silicon 的实机交互体验仍需单独验收。
