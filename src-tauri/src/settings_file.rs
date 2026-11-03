use crate::{atomic_write, Settings};
use serde::Serialize;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Location {
    #[default]
    Portable,
    System,
}

#[derive(Default)]
pub(crate) struct Paths {
    pub portable: PathBuf,
    pub system: PathBuf,
}
impl Paths {
    pub fn active(&self, location: Location) -> &Path {
        match location {
            Location::Portable => &self.portable,
            Location::System => &self.system,
        }
    }
    fn info(&self, location: Location) -> StorageInfo {
        let path = match location {
            Location::Portable => format!(
                "./{}",
                self.portable
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ),
            Location::System => {
                if cfg!(target_os = "macos") {
                    "~/Library/Application Support/com.winotmk.mugdown/settings.json".into()
                } else {
                    "%APPDATA%\\com.winotmk.mugdown\\settings.json".into()
                }
            }
        };
        StorageInfo {
            path,
            location,
            error: None,
        }
    }
}

#[derive(Clone, Default, Serialize)]
pub(crate) struct StorageInfo {
    pub path: String,
    pub location: Location,
    pub error: Option<String>,
}

pub(crate) struct Loaded {
    pub settings: Settings,
    pub storage: StorageInfo,
}

pub(crate) fn portable_path(executable: &Path, mac_bundle: bool) -> PathBuf {
    let directory = executable
        .parent()
        .expect("executable has a parent directory");
    if mac_bundle && directory.file_name().is_some_and(|name| name == "MacOS") {
        if let Some(contents) = directory
            .parent()
            .filter(|p| p.file_name().is_some_and(|n| n == "Contents"))
        {
            if let Some(bundle) = contents
                .parent()
                .filter(|p| p.extension().is_some_and(|ext| ext == "app"))
            {
                if let Some(parent) = bundle.parent() {
                    // Keep preferences outside the signed application bundle.
                    return parent.join("mugdown.settings.json");
                }
            }
        }
    }
    directory.join("settings.json")
}

fn failure(prefix: &str, path: &Path, error: impl std::fmt::Display) -> String {
    format!("{prefix}: {}: {error}", path.display())
}

pub(crate) fn load(path: &Path, legacy: Option<&Path>) -> Loaded {
    load_with_writer(path, legacy, atomic_write)
}

pub(crate) fn load_selected(paths: &Paths) -> Loaded {
    let location = fs::read(&paths.portable)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("settingsLocation").cloned())
        .and_then(|value| serde_json::from_value::<Location>(value).ok())
        .unwrap_or_default();
    let mut loaded = match location {
        Location::Portable => load(&paths.portable, Some(&paths.system)),
        Location::System => {
            let _ = paths.system.parent().map(fs::create_dir_all);
            load(&paths.system, None)
        }
    };
    let error = loaded.storage.error.take();
    loaded.storage = paths.info(location);
    loaded.storage.error = error;
    loaded
}

pub(crate) fn switch_location(
    paths: &Paths,
    location: Location,
    settings: &Settings,
) -> Result<StorageInfo, String> {
    if location == Location::System {
        if let Some(parent) = paths.system.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| failure("无法创建系统设置目录", parent, error))?;
        }
        save(&paths.system, settings)?;
        // This small pointer remembers the choice without duplicating preferences.
        atomic_write(&paths.portable, b"{\"settingsLocation\":\"system\"}\n")
            .map_err(|error| failure("无法记录设置保存位置", &paths.portable, error))?;
    } else {
        save(&paths.portable, settings)?;
    }
    Ok(paths.info(location))
}

fn load_with_writer(
    path: &Path,
    legacy: Option<&Path>,
    write: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Loaded {
    let mut loaded = Loaded {
        settings: Settings::default(),
        storage: StorageInfo {
            path: path.to_string_lossy().into_owned(),
            location: Location::Portable,
            error: None,
        },
    };
    match fs::read(path) {
        Ok(bytes) => {
            match serde_json::from_slice(&bytes) {
                Ok(settings) => loaded.settings = settings,
                Err(error) => {
                    loaded.storage.error =
                        Some(failure("设置文件格式错误（请修正 JSON）", path, error))
                }
            }
            // An existing portable file always wins, including an invalid one.
            return loaded;
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            loaded.storage.error = Some(failure("无法读取设置文件", path, error));
            return loaded;
        }
    }
    let mut migrated_bytes = None;
    if let Some(legacy) = legacy.filter(|legacy| *legacy != path) {
        match fs::read(legacy) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(settings) => {
                    loaded.settings = settings;
                    // Preserve additional keys from older/newer versions on migration.
                    migrated_bytes = Some(bytes);
                }
                Err(error) => {
                    loaded.storage.error = Some(failure("旧版设置文件格式错误", legacy, error))
                }
            },
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => loaded.storage.error = Some(failure("无法读取旧版设置", legacy, error)),
        }
    }
    let bytes = migrated_bytes.unwrap_or_else(|| {
        serde_json::to_vec_pretty(&loaded.settings).expect("settings serialize")
    });
    if let Err(error) = write(path, &bytes) {
        let message = failure("无法保存设置，请选择可写的保存位置", path, error);
        loaded.storage.error = Some(match loaded.storage.error {
            Some(previous) => format!("{message}\n{previous}"),
            None => message,
        });
    }
    loaded
}

pub(crate) fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    atomic_write(path, &bytes)
        .map_err(|error| failure("无法保存设置，请选择可写的保存位置", path, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_switch_migrates_current_preferences_and_survives_restart() {
        let (portable, system) = fixture();
        let paths = Paths { portable, system };
        let first = load_selected(&paths);
        assert_eq!(first.storage.path, "./settings.json");
        assert_eq!(first.storage.location, Location::Portable);
        let mut settings: Settings = serde_json::from_slice(&legacy_bytes()).unwrap();
        let storage = switch_location(&paths, Location::System, &settings).unwrap();
        assert_eq!(storage.location, Location::System);
        assert!(!Path::new(&storage.path).is_absolute());
        let restarted = load_selected(&paths);
        assert_eq!(restarted.storage.location, Location::System);
        assert_eq!(restarted.settings.language, "en-US");
        assert_eq!(restarted.settings.custom_css, settings.custom_css);
        settings.font_size = 24;
        save(paths.active(restarted.storage.location), &settings).unwrap();
        assert_eq!(load_selected(&paths).settings.font_size, 24);
        let pointer: serde_json::Value =
            serde_json::from_slice(&fs::read(&paths.portable).unwrap()).unwrap();
        assert_eq!(pointer["settingsLocation"], "system");
        let previous_system = fs::read(&paths.system).unwrap();
        switch_location(&paths, Location::Portable, &settings).unwrap();
        let restarted = load_selected(&paths);
        assert_eq!(restarted.storage.location, Location::Portable);
        assert_eq!(restarted.settings.font_size, 24);
        assert_eq!(fs::read(&paths.system).unwrap(), previous_system);
    }
    #[test]
    fn failed_system_switch_keeps_portable_preferences_and_location() {
        let (portable, system) = fixture();
        let paths = Paths { portable, system };
        save(&paths.portable, &Settings::default()).unwrap();
        let original = fs::read(&paths.portable).unwrap();
        fs::create_dir(&paths.system).unwrap();
        assert!(switch_location(&paths, Location::System, &Settings::default()).is_err());
        assert_eq!(fs::read(&paths.portable).unwrap(), original);
        assert_eq!(load_selected(&paths).storage.location, Location::Portable);
    }
    #[test]
    fn first_selected_load_migrates_old_appdata_and_displays_relative_path() {
        let (portable, system) = fixture();
        let paths = Paths { portable, system };
        fs::write(&paths.system, legacy_bytes()).unwrap();
        let loaded = load_selected(&paths);
        assert_eq!(loaded.settings.language, "en-US");
        assert_eq!(loaded.storage.path, "./settings.json");
        assert_eq!(loaded.storage.location, Location::Portable);
        assert_eq!(fs::read(&paths.portable).unwrap(), legacy_bytes());
    }

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::current_dir()
            .unwrap()
            .join(".qa/settings-tests")
            .join(crate::uid());
        fs::create_dir_all(root.join("portable")).unwrap();
        fs::create_dir_all(root.join("legacy")).unwrap();
        (
            root.join("portable/settings.json"),
            root.join("legacy/settings.json"),
        )
    }
    fn legacy_bytes() -> Vec<u8> {
        br##"{"uiTheme":"github-dark","markdownStyle":"sakura","fontSize":19,"contentWidth":820,"customCss":"p { color: #abc; }","language":"en-US","toolbarPinned":true,"futureOption":42}"##.to_vec()
    }
    #[test]
    fn settings_beside_windows_executable_not_working_directory() {
        let root = std::env::current_dir().unwrap().join("somewhere/portable");
        assert_eq!(
            portable_path(&root.join("mugdown.exe"), false),
            root.join("settings.json")
        );
    }
    #[test]
    fn mac_settings_are_outside_signed_bundle() {
        let root = std::env::current_dir().unwrap().join("Applications");
        assert_eq!(
            portable_path(&root.join("mugdown.app/Contents/MacOS/mugdown"), true),
            root.join("mugdown.settings.json")
        );
        assert_eq!(
            portable_path(&root.join("mugdown"), true),
            root.join("settings.json")
        );
    }
    #[test]
    fn first_launch_creates_portable_defaults_only() {
        let (path, legacy) = fixture();
        let loaded = load(&path, Some(&legacy));
        assert!(loaded.storage.error.is_none());
        assert_eq!(loaded.storage.path, path.to_string_lossy());
        let settings: Settings = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(settings.ui_theme, Settings::default().ui_theme);
        assert!(!legacy.exists());
    }
    #[test]
    fn migration_preserves_settings_original_bytes_and_legacy_file() {
        let (path, legacy) = fixture();
        fs::write(&legacy, legacy_bytes()).unwrap();
        let loaded = load(&path, Some(&legacy));
        assert!(loaded.storage.error.is_none());
        assert_eq!(loaded.settings.language, "en-US");
        assert_eq!(loaded.settings.custom_css, "p { color: #abc; }");
        assert_eq!(loaded.settings.ui_theme, "github-dark");
        assert!(loaded.settings.toolbar_pinned);
        assert_eq!(fs::read(&path).unwrap(), legacy_bytes());
        assert_eq!(fs::read(&legacy).unwrap(), legacy_bytes());
    }
    #[test]
    fn portable_file_wins_and_changes_survive_restart_without_touching_legacy() {
        let (path, legacy) = fixture();
        fs::write(&legacy, legacy_bytes()).unwrap();
        let mut settings = Settings::default();
        settings.font_size = 23;
        save(&path, &settings).unwrap();
        assert_eq!(load(&path, Some(&legacy)).settings.font_size, 23);
        settings.ui_theme = "system".into();
        settings.toolbar_pinned = true;
        save(&path, &settings).unwrap();
        let restored = load(&path, Some(&legacy));
        assert_eq!(restored.settings.ui_theme, "system");
        assert!(restored.settings.toolbar_pinned);
        assert_eq!(fs::read(legacy).unwrap(), legacy_bytes());
    }
    #[test]
    fn invalid_portable_file_is_reported_and_left_untouched() {
        let (path, legacy) = fixture();
        fs::write(&path, b"{ broken").unwrap();
        fs::write(&legacy, legacy_bytes()).unwrap();
        let loaded = load(&path, Some(&legacy));
        assert!(loaded
            .storage
            .error
            .unwrap()
            .starts_with("设置文件格式错误"));
        assert_eq!(loaded.settings.language, "zh-CN");
        assert_eq!(fs::read(path).unwrap(), b"{ broken");
    }
    #[test]
    fn invalid_legacy_is_preserved_and_portable_defaults_are_created() {
        let (path, legacy) = fixture();
        fs::write(&legacy, b"broken legacy").unwrap();
        let loaded = load(&path, Some(&legacy));
        assert!(loaded
            .storage
            .error
            .unwrap()
            .starts_with("旧版设置文件格式错误"));
        assert!(path.is_file());
        assert_eq!(fs::read(legacy).unwrap(), b"broken legacy");
    }
    #[test]
    fn write_failure_retains_migrated_appearance_without_appdata_fallback() {
        let (path, legacy) = fixture();
        fs::write(&legacy, legacy_bytes()).unwrap();
        let loaded = load_with_writer(&path, Some(&legacy), |_, _| Err("permission denied".into()));
        assert_eq!(loaded.settings.ui_theme, "github-dark");
        let error = loaded.storage.error.unwrap();
        assert!(error.contains(path.to_string_lossy().as_ref()));
        assert!(error.contains("permission denied"));
        assert!(!path.exists());
        assert_eq!(fs::read(legacy).unwrap(), legacy_bytes());
    }
    #[test]
    fn failed_save_reports_portable_path_and_cleans_temporary_file() {
        let (path, _) = fixture();
        fs::create_dir(&path).unwrap();
        let error = save(&path, &Settings::default()).unwrap_err();
        assert!(error.contains(path.to_string_lossy().as_ref()));
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
}
