use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Default)]
pub struct Sessions(Mutex<HashSet<String>>);
pub struct DockRect {
    pub label: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}
// Physical desktop pixels throughout, including on mixed-DPI monitors.
pub fn choose_target(point: (f64, f64), windows: &[DockRect]) -> Option<String> {
    windows
        .iter()
        .filter(|w| {
            point.0 >= w.left
                && point.0 < w.left + w.width
                && point.1 >= w.top
                && point.1 < w.top + w.height
        })
        .min_by(|a, b| {
            ((point.1 - a.top) / a.scale)
                .total_cmp(&((point.1 - b.top) / b.scale))
                .then_with(|| a.label.cmp(&b.label))
        })
        .map(|w| w.label.clone())
}
pub fn target_at(app: &tauri::AppHandle, source: &str, point: (f64, f64)) -> Option<String> {
    let labels: HashSet<String> = app
        .state::<crate::Store>()
        .lock()
        .unwrap()
        .windows
        .keys()
        .cloned()
        .collect();
    let candidates: Vec<DockRect> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, w)| {
            if label == source
                || !labels.contains(&label)
                || !w.is_visible().unwrap_or(false)
                || w.is_minimized().unwrap_or(true)
            {
                return None;
            }
            let p = w.inner_position().ok()?;
            let size = w.inner_size().ok()?;
            Some(DockRect {
                label,
                left: p.x as f64,
                top: p.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                scale: w.scale_factor().ok()?,
            })
        })
        .collect();
    choose_target(point, &candidates)
}
#[cfg(target_os = "windows")]
fn mouse_state() -> (bool, bool) {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    unsafe { (GetAsyncKeyState(1) < 0, GetAsyncKeyState(0x1b) < 0) }
}
#[cfg(target_os = "macos")]
fn mouse_state() -> (bool, bool) {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
        fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
    }
    unsafe { (CGEventSourceButtonState(1, 0), CGEventSourceKeyState(1, 53)) }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn mouse_state() -> (bool, bool) {
    (false, false)
}
struct Preview {
    app: tauri::AppHandle,
    source: String,
    target: Option<String>,
    count: usize,
}
impl Preview {
    fn set(&mut self, target: Option<String>) {
        if self.target == target {
            return;
        }
        if let Some(w) = self
            .target
            .as_ref()
            .and_then(|s| self.app.get_webview_window(s))
        {
            let _ = w.emit("window-merge-target", Option::<usize>::None);
        }
        self.target = target;
        if let Some(w) = self
            .target
            .as_ref()
            .and_then(|s| self.app.get_webview_window(s))
        {
            let _ = w.emit("window-merge-target", Some(self.count));
        }
        if let Some(w) = self.app.get_webview_window(&self.source) {
            let _ = w.emit("window-merge-preview", &self.target);
        }
    }
}
impl Drop for Preview {
    fn drop(&mut self) {
        self.set(None);
        self.app
            .state::<Sessions>()
            .0
            .lock()
            .unwrap()
            .remove(&self.source);
    }
}
pub async fn start(app: tauri::AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    let source = window.label().to_string();
    if !app
        .state::<Sessions>()
        .0
        .lock()
        .unwrap()
        .insert(source.clone())
    {
        return Ok(None);
    }
    let count = app
        .state::<crate::Store>()
        .lock()
        .unwrap()
        .windows
        .get(&source)
        .map_or(0, |w| w.ids.len());
    let initial = window.outer_position().map_err(|e| e.to_string());
    let abort = Arc::new(AtomicBool::new(false));
    let stopped = abort.clone();
    let tracked = window.clone();
    let task = tauri::async_runtime::spawn_blocking(move || {
        let mut preview = Preview {
            app,
            source,
            target: None,
            count,
        };
        let initial = initial?;
        let since = Instant::now();
        loop {
            if stopped.load(Ordering::Relaxed)
                || since.elapsed() > Duration::from_secs(180)
                || preview.app.get_webview_window(&preview.source).is_none()
            {
                return Ok(None);
            }
            let (held, escaped) = mouse_state();
            if escaped {
                return Ok(None);
            }
            let p = tracked.outer_position().map_err(|e| e.to_string())?;
            let moved = (p.x as f64 - initial.x as f64).hypot(p.y as f64 - initial.y as f64) > 7.;
            let point = tracked.cursor_position().map_err(|e| e.to_string())?;
            let target = if moved && count > 0 {
                target_at(&preview.app, &preview.source, (point.x, point.y))
            } else {
                None
            };
            if !held {
                return Ok(target);
            }
            preview.set(target);
            std::thread::sleep(Duration::from_millis(30));
        }
    });
    if let Err(e) = window.start_dragging() {
        abort.store(true, Ordering::Relaxed);
        let _ = task.await;
        return Err(e.to_string());
    }
    task.await.map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rect(label: &str, left: f64, top: f64, scale: f64) -> DockRect {
        DockRect {
            label: label.into(),
            left,
            top,
            width: 980. * scale,
            height: 780. * scale,
            scale,
        }
    }
    #[test]
    fn whole_window_including_body_and_bottom() {
        let windows = [rect("target", 200., 100., 1.)];
        assert_eq!(
            choose_target((260., 140.), &windows).as_deref(),
            Some("target")
        );
        assert_eq!(
            choose_target((260., 240.), &windows).as_deref(),
            Some("target")
        );
        assert_eq!(
            choose_target((1179., 879.), &windows).as_deref(),
            Some("target")
        );
        assert_eq!(
            choose_target((200., 100.), &windows).as_deref(),
            Some("target")
        );
        assert!(choose_target((1180., 140.), &windows).is_none());
        assert!(choose_target((260., 880.), &windows).is_none());
        assert!(choose_target((190., 140.), &windows).is_none());
    }
    #[test]
    fn mixed_dpi_and_negative_monitors() {
        let windows = [rect("left", -1960., -200., 2.), rect("right", 0., 0., 1.)];
        assert_eq!(
            choose_target((-1800., 20.), &windows).as_deref(),
            Some("left")
        );
        assert_eq!(
            choose_target((-1800., 1359.), &windows).as_deref(),
            Some("left")
        );
        assert!(choose_target((-1800., 1360.), &windows).is_none());
        assert_eq!(
            choose_target((100., 100.), &windows).as_deref(),
            Some("right")
        );
    }
    #[test]
    fn overlap_order_is_stable() {
        assert_eq!(
            choose_target(
                (100., 50.),
                &[rect("back", 0., 0., 1.), rect("front", 0., 30., 1.)]
            )
            .as_deref(),
            Some("front")
        );
        assert_eq!(
            choose_target(
                (100., 50.),
                &[rect("front", 0., 30., 1.), rect("back", 0., 0., 1.)]
            )
            .as_deref(),
            Some("front")
        );
    }
}
