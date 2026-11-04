use tauri::{
    menu::{Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem},
    AppHandle, Emitter, Manager,
};

// Compile this module on every desktop platform so CI also checks the shared
// menu API. Only macOS installs it as the screen's application menu.
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let english: serde_json::Value =
        serde_json::from_str(include_str!("../../src/i18n/locales/en-US.json"))
            .expect("the bundled language pack is valid JSON");
    let text = |source: &str| {
        if language == "en-US" {
            english["messages"][source]
                .as_str()
                .unwrap_or(source)
                .to_owned()
        } else {
            source.to_owned()
        }
    };
    let command = |id: &str, source: &str, accelerator: &str| {
        MenuItem::with_id(
            app,
            format!("mugdown:{id}"),
            text(source),
            true,
            Some(accelerator),
        )
    };
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };
        match submenu.text()?.as_str() {
            "File" => {
                submenu.set_text(text("文件"))?;
                for item in submenu.items()? {
                    submenu.remove(&item)?;
                }
                submenu.append_items(&[
                    &command("new", "新建文档", "CmdOrCtrl+N")?,
                    &command("open", "打开…", "CmdOrCtrl+O")?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("save", "保存", "CmdOrCtrl+S")?,
                    &command("save-as", "另存为…", "CmdOrCtrl+Shift+S")?,
                    &PredefinedMenuItem::separator(app)?,
                    &command("close", "关闭文档", "CmdOrCtrl+W")?,
                    &command("close-window", "关闭窗口", "CmdOrCtrl+Shift+W")?,
                ])?;
            }
            "Edit" => {
                submenu.set_text(text("编辑"))?;
                // Use mugdown's document history, including edits made before a
                // visual/source mode switch, rather than WKWebView's undo stack.
                submenu.remove_at(0)?;
                submenu.remove_at(0)?;
                submenu.insert_items(
                    &[
                        &command("undo", "撤销", "CmdOrCtrl+Z")?,
                        &command("redo", "重做", "CmdOrCtrl+Shift+Z")?,
                    ],
                    0,
                )?;
                // Retain the native cut/copy/paste/select-all responders so they
                // also work in text fields and dialogs.
                submenu.append_items(&[
                    &PredefinedMenuItem::separator(app)?,
                    &command("find", "查找", "CmdOrCtrl+F")?,
                    &command("replace", "替换", "CmdOrCtrl+Alt+F")?,
                ])?;
            }
            "Window" => submenu.set_text(text("窗口"))?,
            "mugdown" => submenu.insert_items(
                &[
                    &command("appearance", "外观设置…", "CmdOrCtrl+,")?,
                    &PredefinedMenuItem::separator(app)?,
                ],
                2,
            )?,
            _ => {}
        }
    }
    Ok(menu)
}

pub fn dispatch(app: &AppHandle, event: MenuEvent) {
    if let Some(command) = event.id().as_ref().strip_prefix("mugdown:") {
        if let Some(window) = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
        {
            let _ = window.emit("menu-command", command);
        }
    }
}
