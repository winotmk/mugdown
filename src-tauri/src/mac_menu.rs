use std::{collections::HashMap, sync::OnceLock};
use tauri::{
    menu::{
        AboutMetadata, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
        HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
    },
    AppHandle, Emitter, Manager,
};

fn text(language: &str, source: &str) -> String {
    static ENGLISH: OnceLock<serde_json::Value> = OnceLock::new();
    if language == "en-US" {
        ENGLISH.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/i18n/locales/en-US.json")).unwrap()
        })["messages"][source]
            .as_str()
            .unwrap_or(source)
            .to_owned()
    } else {
        source.to_owned()
    }
}

// Compile the shared menu API on other desktops; install it only on macOS.
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let t = |source: &str| text(language, source);
    let command = |id: &str, title: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, format!("mugdown:{id}"), t(title), true, accelerator)
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "mugdown",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some(&t("关于 mugdown")),
                        Some(AboutMetadata {
                            name: Some("mugdown".into()),
                            version: Some(app.package_info().version.to_string()),
                            ..Default::default()
                        }),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("appearance", "外观设置…", Some("CmdOrCtrl+,"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some(&t("服务")))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(&t("隐藏 mugdown")))?,
                    &PredefinedMenuItem::hide_others(app, Some(&t("隐藏其他")))?,
                    &PredefinedMenuItem::show_all(app, Some(&t("全部显示")))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(&t("退出 mugdown")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                t("文件"),
                true,
                &[
                    &command("new", "新建文档", Some("CmdOrCtrl+N"))?,
                    &command("open", "打开…", Some("CmdOrCtrl+O"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("save", "保存", Some("CmdOrCtrl+S"))?,
                    &command("save-as", "另存为…", Some("CmdOrCtrl+Shift+S"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("close", "关闭文档", Some("CmdOrCtrl+W"))?,
                    &command("close-window", "关闭窗口", Some("CmdOrCtrl+Shift+W"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                t("编辑"),
                true,
                &[
                    &command("undo", "撤销", Some("CmdOrCtrl+Z"))?,
                    &command("redo", "重做", Some("CmdOrCtrl+Shift+Z"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some(&t("剪切")))?,
                    &PredefinedMenuItem::copy(app, Some(&t("复制")))?,
                    &PredefinedMenuItem::paste(app, Some(&t("粘贴")))?,
                    &command("paste-plain", "粘贴为纯文本", Some("CmdOrCtrl+Shift+V"))?,
                    &command("copy-plain", "复制为纯文本", None)?,
                    &command("copy-html", "复制为 HTML", None)?,
                    &PredefinedMenuItem::select_all(app, Some(&t("全选")))?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("find", "查找", Some("CmdOrCtrl+F"))?,
                    &command("replace", "替换", Some("CmdOrCtrl+Alt+F"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                t("格式"),
                true,
                &[
                    &command("bold", "粗体", Some("CmdOrCtrl+B"))?,
                    &command("italic", "斜体", Some("CmdOrCtrl+I"))?,
                    &command("underline", "下划线", Some("CmdOrCtrl+U"))?,
                    &command("strike", "删除线", None)?,
                    &command("clear", "清除样式", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("heading", "标题", None)?,
                    &command("list", "无序列表", None)?,
                    &command("ordered", "有序列表", None)?,
                    &command("quote", "引用", None)?,
                    &command("codeblock", "代码块", None)?,
                    &command("table", "表格", None)?,
                    &command("image", "插入图片", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("duplicate-block", "创建段落副本", None)?,
                    &command("paragraph-before", "在前面插入段落", None)?,
                    &command("paragraph-after", "在后面插入段落", None)?,
                    &command("delete-block", "删除当前段落", None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                t("显示"),
                true,
                &[
                    &command("toggle-mode", "切换编辑模式", Some("CmdOrCtrl+/"))?,
                    &PredefinedMenuItem::fullscreen(app, Some(&t("切换全屏")))?,
                ],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                t("窗口"),
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some(&t("最小化")))?,
                    &PredefinedMenuItem::maximize(app, Some(&t("缩放")))?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("detach", "移到新窗口", None)?,
                    &Submenu::with_id_and_items(
                        app,
                        "mugdown:merge-targets",
                        t("合并文档到"),
                        false,
                        &[],
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::bring_all_to_front(app, Some(&t("全部置于前台")))?,
                ],
            )?,
            &Submenu::with_id_and_items(
                app,
                HELP_SUBMENU_ID,
                t("帮助"),
                true,
                &[&command("help", "使用帮助", None)?],
            )?,
        ],
    )
}

pub fn dispatch(app: &AppHandle, event: MenuEvent) {
    if let Some(command) = event.id().as_ref().strip_prefix("mugdown:") {
        if command == "help" {
            #[cfg(target_os = "macos")]
            let _ = crate::open_external(format!(
                "https://github.com/winotmk/mugdown/blob/main/{}",
                if crate::mac_platform::language() == "zh-CN" {
                    "README.md"
                } else {
                    "README.en.md"
                }
            ));
            return;
        }
        if let Some(window) = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
        {
            let _ = window.emit("menu-command", command);
        }
    }
}

fn index_items(
    items: Vec<MenuItemKind<tauri::Wry>>,
    result: &mut HashMap<String, MenuItemKind<tauri::Wry>>,
) -> tauri::Result<()> {
    for item in items {
        if let Some(submenu) = item.as_submenu() {
            index_items(submenu.items()?, result)?;
        }
        result.insert(item.id().as_ref().to_owned(), item);
    }
    Ok(())
}

fn refresh_on_main(
    app: &AppHandle,
    snapshot: &crate::Snapshot,
    language: &str,
) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let mut items = HashMap::new();
    index_items(menu.items()?, &mut items)?;
    let focused = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    let label = focused.as_ref().map(|window| window.label());
    let active = snapshot
        .windows
        .iter()
        .find(|window| Some(window.label.as_str()) == label)
        .and_then(|window| window.active.as_ref())
        .is_some();
    for command in [
        "save",
        "save-as",
        "close",
        "undo",
        "redo",
        "paste-plain",
        "copy-plain",
        "copy-html",
        "bold",
        "italic",
        "underline",
        "strike",
        "clear",
        "heading",
        "list",
        "ordered",
        "quote",
        "codeblock",
        "table",
        "image",
        "duplicate-block",
        "paragraph-before",
        "paragraph-after",
        "delete-block",
        "toggle-mode",
        "detach",
    ] {
        if let Some(item) = items
            .get(&format!("mugdown:{command}"))
            .and_then(|item| item.as_menuitem())
        {
            item.set_enabled(active)?;
        }
    }
    if let Some(targets) = items
        .get("mugdown:merge-targets")
        .and_then(|item| item.as_submenu())
    {
        for item in targets.items()? {
            targets.remove(&item)?;
        }
        let mut count = 0;
        for window in snapshot
            .windows
            .iter()
            .filter(|window| Some(window.label.as_str()) != label)
        {
            count += 1;
            let title = text(language, "合并到窗口 {0}").replace("{0}", &count.to_string());
            targets.append(&MenuItem::with_id(
                app,
                format!("mugdown:merge:{}", window.label),
                title,
                true,
                None::<&str>,
            )?)?;
        }
        targets.set_enabled(active && count > 0)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    // Queue outside the caller's workspace lock, then read the latest state.
    // Never block AppKit while a command is changing a window or moving data.
    tauri::async_runtime::spawn(async move {
        let menu_app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let state = menu_app.state::<crate::Store>();
            let Ok(workspace) = state.try_lock() else {
                return;
            };
            let snapshot = workspace.snapshot();
            drop(workspace);
            if let Err(error) =
                refresh_on_main(&menu_app, &snapshot, crate::mac_platform::language())
            {
                eprintln!("Could not update the macOS menu: {error}");
            }
        });
    });
}
