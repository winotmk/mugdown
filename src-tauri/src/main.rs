#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod presets;
mod settings_file;
mod window_docking;

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    ui_theme: String,
    markdown_style: String,
    font_size: u32,
    content_width: u32,
    custom_css: String,
    #[serde(default = "default_language")]
    language: String,
    #[serde(default)]
    toolbar_pinned: bool,
}
fn default_language() -> String {
    "zh-CN".into()
}

#[cfg(test)]
mod settings_tests {
    use super::Settings;

    #[test]
    fn older_settings_keep_appearance_and_get_new_defaults() {
        let settings: Settings = serde_json::from_str(
            r##"{
            "uiTheme":"github-dark","markdownStyle":"sakura",
            "fontSize":19,"contentWidth":820,"customCss":"p { color: #abc; }"
        }"##,
        )
        .unwrap();
        assert_eq!(settings.ui_theme, "github-dark");
        assert_eq!(settings.markdown_style, "sakura");
        assert_eq!(settings.font_size, 19);
        assert_eq!(settings.content_width, 820);
        assert_eq!(settings.custom_css, "p { color: #abc; }");
        assert_eq!(settings.language, "zh-CN");
        assert!(!settings.toolbar_pinned);
    }

    #[test]
    fn language_and_toolbar_preference_roundtrip() {
        let settings = Settings {
            language: "en-US".into(),
            toolbar_pinned: true,
            ..Settings::default()
        };
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["language"], "en-US");
        assert_eq!(value["toolbarPinned"], true);
        let restored: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(restored.language, "en-US");
        assert!(restored.toolbar_pinned);
    }
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            ui_theme: "github-light".into(),
            markdown_style: "github".into(),
            font_size: 17,
            content_width: 900,
            custom_css: String::new(),
            language: default_language(),
            toolbar_pinned: false,
        }
    }
}
#[derive(Clone, Serialize)]
struct Document {
    id: String,
    path: Option<String>,
    name: String,
    raw: String,
    saved: String,
    revision: u64,
}
struct Journal {
    past: Vec<String>,
    future: Vec<String>,
    at: Instant,
    group: String,
    simple: bool,
    end: usize,
}
#[derive(Clone, Serialize)]
struct WindowData {
    label: String,
    ids: Vec<String>,
    active: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    documents: Vec<Document>,
    windows: Vec<WindowData>,
    settings: Settings,
    settings_storage: settings_file::StorageInfo,
    presets: presets::Catalog,
}
#[derive(Default)]
struct Workspace {
    documents: HashMap<String, Document>,
    windows: HashMap<String, WindowData>,
    history: HashMap<String, Journal>,
    settings: Settings,
    settings_storage: settings_file::StorageInfo,
    settings_paths: settings_file::Paths,
    presets: presets::Catalog,
}
impl Workspace {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            documents: self.documents.values().cloned().collect(),
            windows: self.windows.values().cloned().collect(),
            settings: self.settings.clone(),
            settings_storage: self.settings_storage.clone(),
            presets: self.presets.clone(),
        }
    }
}
type Store = Mutex<Workspace>;
fn uid() -> String {
    Uuid::new_v4().simple().to_string()
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn broadcast(app: &tauri::AppHandle, s: &Workspace) {
    let _ = app.emit("workspace", s.snapshot());
}
fn new_doc(s: &mut Workspace, label: &str, path: Option<String>, raw: String) -> Document {
    let id = uid();
    let name = path
        .as_ref()
        .and_then(|p| Path::new(p).file_name())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未命名.md".into());
    let doc = Document {
        id: id.clone(),
        path,
        name,
        raw: raw.clone(),
        saved: raw,
        revision: 0,
    };
    s.history.insert(
        id.clone(),
        Journal {
            past: vec![],
            future: vec![],
            at: Instant::now(),
            group: String::new(),
            simple: false,
            end: 0,
        },
    );
    s.documents.insert(id.clone(), doc.clone());
    let w = s.windows.get_mut(label).expect("registered editor");
    w.ids.push(id.clone());
    w.active = Some(id);
    doc
}
fn make_window(
    app: &tauri::AppHandle,
    label: &str,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<WebviewWindow, String> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("mugdown")
        .inner_size(980., 780.)
        .min_inner_size(540., 360.)
        .visible(false)
        .drag_and_drop(true);
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    } else {
        builder = builder.center();
    }
    builder.build().map_err(err)
}
#[tauri::command]
fn workspace(window: WebviewWindow, state: State<Store>) -> Snapshot {
    let mut s = state.lock().unwrap();
    s.windows
        .entry(window.label().into())
        .or_insert_with(|| WindowData {
            label: window.label().into(),
            ids: vec![],
            active: None,
        });
    s.snapshot()
}
#[tauri::command]
fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
#[tauri::command]
fn create_document(app: tauri::AppHandle, window: WebviewWindow, state: State<Store>) -> Document {
    let mut s = state.lock().unwrap();
    let d = new_doc(&mut s, window.label(), None, String::new());
    broadcast(&app, &s);
    d
}
fn open_paths(
    app: &tauri::AppHandle,
    label: &str,
    paths: Vec<String>,
) -> Result<Vec<Document>, String> {
    let state = app.state::<Store>();
    let mut s = state.lock().unwrap();
    let mut docs = vec![];
    for path in paths {
        let p = fs::canonicalize(&path).map_err(err)?;
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if !["md", "markdown", "mdown", "mkd", "txt"].contains(&ext.as_str()) {
            return Err("请选择 Markdown 或文本文件".into());
        }
        if fs::metadata(&p).map_err(err)?.len() > 32 * 1024 * 1024 {
            return Err("文档超过 32 MB，请使用专门的大文件编辑器".into());
        }
        let path = p.to_string_lossy().into_owned();
        if let Some(d) = s
            .documents
            .values()
            .find(|d| d.path.as_ref() == Some(&path))
            .cloned()
        {
            let owner = s
                .windows
                .values()
                .find(|w| w.ids.contains(&d.id))
                .map(|w| w.label.clone());
            if let Some(owner) = owner {
                if let Some(w) = s.windows.get_mut(&owner) {
                    w.active = Some(d.id.clone());
                }
                if let Some(w) = app.get_webview_window(&owner) {
                    let _ = w.set_focus();
                }
            }
            docs.push(d);
            continue;
        }
        let bytes = fs::read(&p).map_err(err)?;
        let raw = String::from_utf8(bytes)
            .map_err(|_| "文件不是 UTF-8 编码，请先转换为 UTF-8".to_string())?;
        docs.push(new_doc(&mut s, label, Some(path), raw));
    }
    broadcast(app, &s);
    Ok(docs)
}
#[tauri::command]
fn open_documents(
    app: tauri::AppHandle,
    window: WebviewWindow,
    paths: Vec<String>,
) -> Result<Vec<Document>, String> {
    open_paths(&app, window.label(), paths)
}
#[tauri::command]
fn activate_document(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<Store>,
    id: String,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let w = s.windows.get_mut(window.label()).ok_or("窗口不存在")?;
    if !w.ids.contains(&id) {
        return Err("文档不在此窗口".into());
    }
    w.active = Some(id);
    broadcast(&app, &s);
    Ok(())
}
#[tauri::command]
fn update_document(
    app: tauri::AppHandle,
    state: State<Store>,
    id: String,
    raw: String,
    group: String,
) -> Result<Document, String> {
    let mut s = state.lock().unwrap();
    let before = s.documents.get(&id).ok_or("文档已关闭")?.raw.clone();
    if before != raw {
        let a = before.chars().collect::<Vec<_>>();
        let b = raw.chars().collect::<Vec<_>>();
        let mut start = 0;
        let mut tail = 0;
        while start < a.len() && start < b.len() && a[start] == b[start] {
            start += 1;
        }
        while tail < a.len() - start
            && tail < b.len() - start
            && a[a.len() - tail - 1] == b[b.len() - tail - 1]
        {
            tail += 1;
        }
        let removed = &a[start..a.len() - tail];
        let inserted = &b[start..b.len() - tail];
        let simple = (removed.is_empty() || inserted.is_empty())
            && removed.len() + inserted.len() <= 20
            && !removed
                .iter()
                .chain(inserted)
                .any(|c| "\n\r*_`#[]<>".contains(*c));
        let h = s.history.get_mut(&id).unwrap();
        if h.group != group
            || h.at.elapsed() > Duration::from_millis(650)
            || !h.future.is_empty()
            || !simple
            || !h.simple
            || !(start == h.end || b.len() - tail == h.end)
        {
            h.past.push(before);
        }
        while h.past.len() > 150 {
            h.past.remove(0);
        }
        while h.past.iter().map(|t| t.len()).sum::<usize>() > 8_000_000 && h.past.len() > 1 {
            h.past.remove(0);
        }
        h.future.clear();
        h.group = group;
        h.at = Instant::now();
        h.simple = simple;
        h.end = b.len() - tail;
        let d = s.documents.get_mut(&id).unwrap();
        d.raw = raw;
        d.revision += 1;
    }
    let d = s.documents.get(&id).unwrap().clone();
    let _ = app.emit("document-changed", &d);
    Ok(d)
}
#[tauri::command]
fn undo_document(
    app: tauri::AppHandle,
    state: State<Store>,
    id: String,
    forward: bool,
) -> Result<Document, String> {
    let mut s = state.lock().unwrap();
    let before = s.documents.get(&id).ok_or("文档已关闭")?.raw.clone();
    let h = s.history.get_mut(&id).unwrap();
    let next = if forward {
        h.future.pop().inspect(|_| h.past.push(before.clone()))
    } else {
        h.past.pop().inspect(|_| h.future.push(before.clone()))
    };
    h.group = String::new();
    if let Some(raw) = next {
        let d = s.documents.get_mut(&id).unwrap();
        d.raw = raw;
        d.revision += 1;
    }
    let d = s.documents.get(&id).unwrap().clone();
    let _ = app.emit("document-changed", &d);
    Ok(d)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("无效文件目录")?;
    let tmp = parent.join(format!(".mugdown-{}.tmp", uid()));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)
            .map_err(err)?;
        f.write_all(bytes).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::rename(&tmp, path).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
#[tauri::command]
fn save_document(
    app: tauri::AppHandle,
    state: State<Store>,
    id: String,
    path: Option<String>,
    force: bool,
) -> Result<Document, String> {
    let mut s = state.lock().unwrap();
    let d = s.documents.get(&id).ok_or("文档已关闭")?.clone();
    let dest = PathBuf::from(path.or(d.path.clone()).ok_or("请先选择保存位置")?);
    if s.documents
        .values()
        .any(|other| other.id != id && other.path.as_ref().is_some_and(|p| Path::new(p) == dest))
    {
        return Err("此文件已在其他标签中打开").map_err(str::to_string);
    }
    if !force
        && d.path.as_ref().is_some_and(|p| Path::new(p) == dest)
        && dest.exists()
        && fs::read(&dest).map_err(err)? != d.saved.as_bytes()
    {
        return Err("EXTERNAL_CHANGE:文件已被其他程序修改，请另存为，或确认覆盖".into());
    }
    // Save As copies local images alongside the document, preserving relative references.
    if let Some(old) = &d.path {
        if Path::new(old) != dest {
            copy_local_images(
                &d.raw,
                Path::new(old).parent().unwrap(),
                dest.parent().unwrap(),
            )?;
        }
    }
    atomic_write(&dest, d.raw.as_bytes())?;
    let d = s.documents.get_mut(&id).unwrap();
    d.path = Some(
        fs::canonicalize(&dest)
            .map_err(err)?
            .to_string_lossy()
            .into_owned(),
    );
    d.name = dest.file_name().unwrap().to_string_lossy().into_owned();
    d.saved = d.raw.clone();
    let d = d.clone();
    broadcast(&app, &s);
    Ok(d)
}
fn copy_local_images(raw: &str, old: &Path, new: &Path) -> Result<(), String> {
    // Only resources under the original document's directory are copied; no unrelated folders.
    for part in raw.split("](").skip(1) {
        let rel = part
            .split(')')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('<')
            .trim_matches('>');
        if rel.contains("://") || rel.starts_with("data:") {
            continue;
        }
        let rel = percent_encoding::percent_decode_str(rel.split(" \"").next().unwrap_or(rel))
            .decode_utf8_lossy()
            .into_owned();
        let path = Path::new(&rel);
        if path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            continue;
        }
        let from = old.join(path);
        let to = new.join(path);
        if from.is_file() && !to.exists() {
            fs::create_dir_all(to.parent().unwrap()).map_err(err)?;
            fs::copy(from, to).map_err(err)?;
        }
    }
    Ok(())
}
#[tauri::command]
fn close_document(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<Store>,
    id: String,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let w = s.windows.get_mut(window.label()).ok_or("窗口不存在")?;
    w.ids.retain(|i| i != &id);
    if w.active.as_ref() == Some(&id) {
        w.active = w.ids.last().cloned();
    }
    s.documents.remove(&id);
    s.history.remove(&id);
    broadcast(&app, &s);
    Ok(())
}
#[tauri::command]
fn reorder_documents(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<Store>,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let w = s.windows.get_mut(window.label()).ok_or("窗口不存在")?;
    let mut a = w.ids.clone();
    let mut b = ids.clone();
    a.sort();
    b.sort();
    if a != b {
        return Err("无效标签顺序".into());
    }
    w.ids = ids;
    broadcast(&app, &s);
    Ok(())
}
fn transfer(app: &tauri::AppHandle, id: &str, source: &str, target: &str) -> Result<(), String> {
    let state = app.state::<Store>();
    let mut s = state.lock().unwrap();
    if source == target {
        return Ok(());
    }
    if !s.windows.contains_key(target) {
        return Err("目标窗口已关闭".into());
    }
    if !s
        .windows
        .get(source)
        .is_some_and(|w| w.ids.contains(&id.to_string()))
    {
        return Err("文档已经移动".into());
    }
    let w = s.windows.get_mut(source).unwrap();
    w.ids.retain(|i| i != id);
    if w.active.as_deref() == Some(id) {
        w.active = w.ids.last().cloned();
    }
    let empty = w.ids.is_empty();
    let w = s.windows.get_mut(target).ok_or("目标窗口已关闭")?;
    w.ids.push(id.into());
    w.active = Some(id.into());
    if empty {
        s.windows.remove(source);
    }
    broadcast(app, &s);
    drop(s);
    if empty {
        if let Some(w) = app.get_webview_window(source) {
            let _ = w.destroy();
        }
    }
    if let Some(w) = app.get_webview_window(target) {
        let _ = w.set_focus();
    }
    Ok(())
}
fn merge_window_data(s: &mut Workspace, source: &str, target: &str) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    if !s.windows.contains_key(target) {
        return Err("目标窗口已关闭".into());
    }
    let source = s.windows.remove(source).ok_or("窗口不存在")?;
    let target = s.windows.get_mut(target).unwrap();
    target.ids.extend(source.ids);
    if source.active.is_some() {
        target.active = source.active;
    }
    Ok(())
}
#[tauri::command]
async fn start_window_drag(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    window_docking::start(app, window).await
}

#[cfg(test)]
mod window_merge_tests {
    use super::*;
    fn workspace() -> Workspace {
        let mut s = Workspace::default();
        for (label, ids, active) in [("target", vec!["a"], "a"), ("source", vec!["b", "c"], "b")] {
            s.windows.insert(
                label.into(),
                WindowData {
                    label: label.into(),
                    ids: ids.into_iter().map(String::from).collect(),
                    active: Some(active.into()),
                },
            );
        }
        s.documents.insert(
            "b".into(),
            Document {
                id: "b".into(),
                path: None,
                name: "draft.md".into(),
                raw: "unsaved words".into(),
                saved: "original".into(),
                revision: 3,
            },
        );
        s.history.insert(
            "b".into(),
            Journal {
                past: vec!["original".into()],
                future: vec!["redo".into()],
                at: Instant::now(),
                group: "visual".into(),
                simple: false,
                end: 0,
            },
        );
        s
    }
    #[test]
    fn all_documents_move_with_active_draft_and_history() {
        let mut s = workspace();
        merge_window_data(&mut s, "source", "target").unwrap();
        assert!(!s.windows.contains_key("source"));
        assert_eq!(s.windows["target"].ids, vec!["a", "b", "c"]);
        assert_eq!(s.windows["target"].active.as_deref(), Some("b"));
        assert_eq!(s.documents["b"].raw, "unsaved words");
        assert_eq!(s.documents["b"].saved, "original");
        assert_eq!(s.history["b"].past, vec!["original"]);
        assert_eq!(s.history["b"].future, vec!["redo"]);
    }
    #[test]
    fn closing_target_does_not_remove_source_documents() {
        let mut s = workspace();
        s.windows.remove("target");
        assert!(merge_window_data(&mut s, "source", "target").is_err());
        assert_eq!(s.windows["source"].ids, vec!["b", "c"]);
        assert_eq!(s.documents["b"].raw, "unsaved words");
    }
    #[test]
    fn self_merge_and_missing_source_do_not_change_target() {
        let mut s = workspace();
        merge_window_data(&mut s, "target", "target").unwrap();
        assert!(merge_window_data(&mut s, "missing", "target").is_err());
        assert_eq!(s.windows["target"].ids, vec!["a"]);
        assert_eq!(s.windows.len(), 2);
    }
}
#[tauri::command]
fn merge_windows(
    app: tauri::AppHandle,
    window: WebviewWindow,
    target: String,
    state: State<Store>,
) -> Result<(), String> {
    if window.label() == target {
        return Ok(());
    }
    let destination = app.get_webview_window(&target).ok_or("目标窗口已关闭")?;
    let mut s = state.lock().unwrap();
    merge_window_data(&mut s, window.label(), &target)?;
    broadcast(&app, &s);
    drop(s);
    let _ = window.destroy();
    let _ = destination.set_focus();
    Ok(())
}
#[tauri::command]
async fn move_document(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    target: Option<String>,
) -> Result<(), String> {
    let target = match target {
        Some(t) => t,
        None => {
            let label = format!("editor-{}", uid());
            let state = app.state::<Store>();
            state.lock().unwrap().windows.insert(
                label.clone(),
                WindowData {
                    label: label.clone(),
                    ids: vec![],
                    active: None,
                },
            );
            let p = window.cursor_position().ok();
            let scale = window.scale_factor().unwrap_or(1.);
            make_window(
                &app,
                &label,
                p.map(|p| p.x / scale - 80.),
                p.map(|p| p.y / scale - 16.),
            )?;
            label
        }
    };
    transfer(&app, &id, window.label(), &target)
}
#[tauri::command]
async fn finish_tab_drag(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    let cursor = window.cursor_position().map_err(err)?;
    let target = window_docking::target_at(&app, window.label(), (cursor.x, cursor.y));
    if target.is_some() {
        return move_document(app, window, id, target).await;
    }
    let p = window.outer_position().map_err(err)?;
    let size = window.outer_size().map_err(err)?;
    if cursor.x < p.x as f64
        || cursor.x > p.x as f64 + size.width as f64
        || cursor.y < p.y as f64
        || cursor.y > p.y as f64 + size.height as f64
    {
        move_document(app, window, id, None).await?;
    }
    Ok(())
}
#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: State<Store>,
    mut settings: Settings,
) -> Result<(), String> {
    settings.font_size = settings.font_size.clamp(12, 28);
    settings.content_width = settings.content_width.clamp(500, 1600);
    if settings.custom_css.len() > 200_000 {
        return Err("CSS 过大".into());
    }
    let mut s = state.lock().unwrap();
    if let Err(error) = settings_file::save(
        s.settings_paths.active(s.settings_storage.location),
        &settings,
    ) {
        s.settings_storage.error = Some(error.clone());
        broadcast(&app, &s);
        return Err(error);
    }
    s.settings = settings;
    s.settings_storage.error = None;
    broadcast(&app, &s);
    Ok(())
}
#[tauri::command]
fn set_settings_location(
    app: tauri::AppHandle,
    state: State<Store>,
    location: settings_file::Location,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    match settings_file::switch_location(&s.settings_paths, location, &s.settings) {
        Ok(storage) => {
            s.settings_storage = storage;
            broadcast(&app, &s);
            Ok(())
        }
        Err(error) => {
            s.settings_storage.error = Some(error.clone());
            broadcast(&app, &s);
            Err(error)
        }
    }
}
#[tauri::command]
fn refresh_presets(app: tauri::AppHandle, state: State<Store>) {
    let mut s = state.lock().unwrap();
    s.presets = presets::load(&s.settings_paths.portable.parent().unwrap().join("presets"));
    broadcast(&app, &s);
}
#[tauri::command]
fn open_presets_folder(state: State<Store>) -> Result<(), String> {
    let s = state.lock().unwrap();
    let path = s.settings_paths.portable.parent().unwrap().join("presets");
    fs::create_dir_all(&path).map_err(err)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(err)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
fn import_image(
    state: State<Store>,
    id: String,
    name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let s = state.lock().unwrap();
    let doc = s.documents.get(&id).ok_or("文档已关闭")?;
    let path = PathBuf::from(doc.path.as_ref().ok_or("请先保存文档，再粘贴图片")?);
    if data.len() > 32 * 1024 * 1024 {
        return Err("图片超过 32 MB".into());
    }
    let ext = Path::new(&name)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].contains(&ext.as_str()) {
        return Err("不支持此图片格式".into());
    }
    let folder = path.file_stem().unwrap().to_string_lossy();
    let dir = path.parent().unwrap().join(folder.as_ref());
    fs::create_dir_all(&dir).map_err(err)?;
    let filename = format!("image-{}.{}", uid(), ext);
    atomic_write(&dir.join(&filename), &data)?;
    Ok(format!("{}/{}", folder, filename))
}
#[tauri::command]
fn image_source(state: State<Store>, id: String, url: String) -> Result<String, String> {
    if url.starts_with("https://") || url.starts_with("http://") || url.starts_with("data:image/") {
        return Ok(url);
    }
    let s = state.lock().unwrap();
    let doc = s.documents.get(&id).ok_or("文档已关闭")?;
    let parent = Path::new(doc.path.as_ref().ok_or("文档尚未保存")?)
        .parent()
        .unwrap();
    let path = if url.starts_with("file://") {
        url::Url::parse(&url)
            .map_err(err)?
            .to_file_path()
            .map_err(|_| "图片路径无效")?
    } else {
        parent.join(
            percent_encoding::percent_decode_str(url.split('#').next().unwrap_or(&url))
                .decode_utf8_lossy()
                .as_ref(),
        )
    };
    let path = fs::canonicalize(path).map_err(err)?;
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => return Err("不是图片文件".into()),
    };
    if fs::metadata(&path).map_err(err)?.len() > 32 * 1024 * 1024 {
        return Err("图片过大".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(fs::read(path).map_err(err)?)
    ))
}
#[tauri::command]
fn import_image_file(state: State<Store>, id: String, path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if fs::metadata(&path).map_err(err)?.len() > 32 * 1024 * 1024 {
        return Err("图片超过 32 MB".into());
    }
    let name = path
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .into_owned();
    let data = fs::read(path).map_err(err)?;
    import_image(state, id, name, data)
}
#[tauri::command]
fn read_css(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if path.extension().unwrap_or_default() != "css" {
        return Err("请选择 CSS 文件".into());
    }
    if fs::metadata(path).map_err(err)?.len() > 200_000 {
        return Err("CSS 文件过大".into());
    }
    fs::read_to_string(path).map_err(err)
}
#[tauri::command]
fn read_clipboard() -> Result<serde_json::Value, String> {
    let mut c = arboard::Clipboard::new().map_err(err)?;
    Ok(
        serde_json::json!({"text":c.get_text().unwrap_or_default(),"html":c.get().html().unwrap_or_default()}),
    )
}
#[tauri::command]
fn write_clipboard(text: String, html: Option<String>) -> Result<(), String> {
    let mut c = arboard::Clipboard::new().map_err(err)?;
    if let Some(html) = html {
        c.set_html(html, Some(text)).map_err(err)
    } else {
        c.set_text(text).map_err(err)
    }
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let u = url::Url::parse(&url).map_err(err)?;
    if !["https", "http", "mailto"].contains(&u.scheme()) {
        return Err("不支持的链接类型".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(u.as_str())
            .spawn()
            .map_err(err)?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(u.as_str())
            .spawn()
            .map_err(err)?;
    }
    Ok(())
}
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            let s = app.state::<Store>();
            let label = s.lock().unwrap().windows.keys().next().cloned();
            if let Some(label) = label {
                let paths = args
                    .into_iter()
                    .skip(1)
                    .filter(|a| !a.starts_with('-'))
                    .collect();
                let _ = open_paths(app, &label, paths);
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Workspace::default()))
        .manage(window_docking::Sessions::default())
        .invoke_handler(tauri::generate_handler![
            workspace,
            ready,
            create_document,
            open_documents,
            activate_document,
            update_document,
            undo_document,
            save_document,
            close_document,
            reorder_documents,
            move_document,
            finish_tab_drag,
            start_window_drag,
            merge_windows,
            save_settings,
            set_settings_location,
            refresh_presets,
            open_presets_folder,
            import_image,
            import_image_file,
            image_source,
            read_css,
            read_clipboard,
            write_clipboard,
            open_external
        ])
        .setup(|app| {
            let label = format!("editor-{}", uid());
            let executable = std::env::current_exe()?;
            let path = settings_file::portable_path(&executable, cfg!(target_os = "macos"));
            let paths = settings_file::Paths {
                portable: path,
                system: app.path().app_config_dir()?.join("settings.json"),
            };
            let loaded = settings_file::load_selected(&paths);
            let catalog = presets::load(&paths.portable.parent().unwrap().join("presets"));
            let state = app.state::<Store>();
            {
                let mut s = state.lock().unwrap();
                s.settings = loaded.settings;
                s.settings_storage = loaded.storage;
                s.settings_paths = paths;
                s.presets = catalog;
                s.windows.insert(
                    label.clone(),
                    WindowData {
                        label: label.clone(),
                        ids: vec![],
                        active: None,
                    },
                );
            }
            make_window(app.handle(), &label, None, None)?;
            let paths = std::env::args()
                .skip(1)
                .filter(|s| !s.starts_with('-'))
                .collect::<Vec<_>>();
            if !paths.is_empty() {
                let _ = open_paths(app.handle(), &label, paths);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("mugdown could not start");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let windows = app.webview_windows();
            if !windows.is_empty() {
                api.prevent_exit();
                for (_, w) in windows {
                    let _ = w.emit("request-close", ());
                }
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let state = app.state::<Store>();
            let label = state.lock().unwrap().windows.keys().next().cloned();
            if let Some(label) = label {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = open_paths(app, &label, paths);
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            let state = app.state::<Store>();
            let mut s = state.lock().unwrap();
            if let Some(w) = s.windows.remove(&label) {
                for id in w.ids {
                    s.documents.remove(&id);
                    s.history.remove(&id);
                }
            }
            broadcast(app, &s);
        }
        _ => {}
    });
}
