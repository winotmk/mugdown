use crate::{
    atomic_write, presets,
    settings_file::{Loaded, Location, StorageInfo},
    Settings,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

const VERSION: &str = "macStorageVersion";
const PORTABLE: &str = "portableMode";

#[derive(Default)]
pub struct Paths {
    pub system: PathBuf,
    pub portable: PathBuf,
    legacy: PathBuf,
    legacy_presets: PathBuf,
}

impl Paths {
    pub fn new(executable: &Path, system: PathBuf) -> Self {
        let legacy = crate::settings_file::portable_path(executable, true);
        let parent = legacy.parent().expect("settings have a parent");
        Self {
            system,
            portable: parent.join("mugdown-data/settings.json"),
            legacy_presets: parent.join("presets"),
            legacy,
        }
    }

    pub fn active(&self, location: Location) -> &Path {
        match location {
            Location::System => &self.system,
            Location::Portable => &self.portable,
        }
    }

    pub fn presets(&self, location: Location) -> PathBuf {
        self.active(location).parent().unwrap().join("presets")
    }

    fn info(&self, location: Location, error: Option<String>) -> StorageInfo {
        StorageInfo {
            path: match location {
                Location::System => {
                    "~/Library/Application Support/com.winotmk.mugdown/settings.json".into()
                }
                Location::Portable => "./mugdown-data/settings.json".into(),
            },
            location,
            error,
        }
    }
}

fn failure(message: &str, path: &Path, error: impl std::fmt::Display) -> String {
    format!("{message}: {}: {error}", path.display())
}

fn read_value(path: &Path) -> Result<Option<Value>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| failure("设置文件格式错误（请修正 JSON）", path, error)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(failure("无法读取设置文件", path, error)),
    }
}

fn decode(value: &Value, language: &str, path: &Path) -> Result<Settings, String> {
    let mut value = value.clone();
    if let Some(object) = value.as_object_mut() {
        object.entry("language").or_insert_with(|| language.into());
    }
    serde_json::from_value(value)
        .map_err(|error| failure("设置文件格式错误（请修正 JSON）", path, error))
}

fn defaults(language: &str) -> Settings {
    Settings {
        language: language.into(),
        ..Settings::default()
    }
}

fn write_settings(
    path: &Path,
    settings: &Settings,
    portable: Option<bool>,
    base: Option<Value>,
) -> Result<(), String> {
    let mut object = base
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    object.extend(
        serde_json::to_value(settings)
            .unwrap()
            .as_object()
            .unwrap()
            .clone(),
    );
    object.insert(VERSION.into(), 1.into());
    if let Some(enabled) = portable {
        object.insert(PORTABLE.into(), enabled.into());
    } else {
        object.remove(PORTABLE);
    }
    fs::create_dir_all(path.parent().unwrap())
        .map_err(|error| failure("无法创建设置目录", path, error))?;
    atomic_write(path, &serde_json::to_vec_pretty(&object).unwrap())
        .map_err(|error| failure("无法保存设置，请选择可写的保存位置", path, error))
}

fn backup(path: &Path, root: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let directory = root.join("backups").join(crate::uid());
    fs::create_dir_all(&directory).map_err(|error| failure("无法备份设置", &directory, error))?;
    fs::copy(path, directory.join(path.file_name().unwrap()))
        .map_err(|error| failure("无法备份设置", path, error))?;
    Ok(())
}

fn custom_presets(directory: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(failure("无法读取 CSS 预设目录", directory, error)),
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| failure("无法读取 CSS 预设目录", directory, error))?;
        let path = entry.path();
        if !path.is_file()
            || !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("css"))
        {
            continue;
        }
        if entry
            .metadata()
            .map_err(|error| failure("无法读取 CSS 预设目录", &path, error))?
            .len()
            > 512_000
        {
            return Err(failure("CSS 预设超过 500 KB，已跳过", &path, ""));
        }
        let bytes = fs::read(&path).map_err(|error| failure("无法迁移个人预设", &path, error))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if presets::DEFAULTS
            .iter()
            .any(|(file, css)| *file == name && css.as_bytes() == bytes)
        {
            continue;
        }
        files.push((name, bytes));
    }
    Ok(files)
}

fn copy_presets(
    files: &[(String, Vec<u8>)],
    directory: &Path,
    backup_root: &Path,
) -> Result<(), String> {
    for (name, bytes) in files {
        let target = directory.join(name);
        if fs::read(&target).ok().as_deref() == Some(bytes.as_slice()) {
            continue;
        }
        if target.exists() {
            backup(&target, backup_root)?;
        }
        fs::create_dir_all(directory)
            .map_err(|error| failure("无法迁移个人预设", directory, error))?;
        atomic_write(&target, bytes)
            .map_err(|error| failure("无法迁移个人预设", &target, error))?;
    }
    Ok(())
}

pub fn load(paths: &Paths, language: &str) -> Loaded {
    // A portable profile is self-contained: its own JSON records activation.
    // No selector or pointer is ever written beside the .app or in Preferences.
    let portable = read_value(&paths.portable);
    if paths.portable.exists()
        && !matches!(&portable, Ok(Some(value)) if value.get(PORTABLE) == Some(&Value::Bool(false)))
    {
        let result = portable.and_then(|value| match value {
            Some(value) => decode(&value, language, &paths.portable),
            None => Ok(defaults(language)),
        });
        return match result {
            Ok(settings) => Loaded {
                settings,
                storage: paths.info(Location::Portable, None),
            },
            Err(error) => Loaded {
                settings: defaults(language),
                storage: paths.info(Location::Portable, Some(error)),
            },
        };
    }
    let mut loaded = Loaded {
        settings: defaults(language),
        storage: paths.info(Location::System, None),
    };
    let result = (|| -> Result<(), String> {
        let system = read_value(&paths.system)?;
        if let Some(value) = &system {
            loaded.settings = decode(value, language, &paths.system)?;
            if value.get(VERSION).and_then(Value::as_u64) == Some(1) {
                return Ok(());
            }
        }
        let legacy = read_value(&paths.legacy)?;
        let legacy_profile = legacy.as_ref().filter(|value| {
            value.get("settingsLocation").and_then(Value::as_str) != Some("system")
        });
        let base = if let Some(value) = legacy_profile {
            loaded.settings = decode(value, language, &paths.legacy)?;
            Some(value.clone())
        } else {
            system.clone()
        };
        let files = custom_presets(&paths.legacy_presets)?;
        if base.is_none() && files.is_empty() {
            return Ok(());
        }
        // Preserve every legacy file. A version marker prevents stale copies
        // from replacing the migrated profile on subsequent launches.
        if legacy_profile.is_some() && paths.system.exists() {
            backup(&paths.system, paths.system.parent().unwrap())?;
        }
        copy_presets(
            &files,
            &paths.presets(Location::System),
            paths.system.parent().unwrap(),
        )?;
        write_settings(&paths.system, &loaded.settings, None, base)
    })();
    loaded.storage.error = result.err();
    loaded
}

pub fn save(paths: &Paths, location: Location, settings: &Settings) -> Result<(), String> {
    let path = paths.active(location);
    let base = match read_value(path) {
        Ok(value) => value,
        Err(_) => {
            backup(path, path.parent().unwrap())?;
            None
        }
    };
    write_settings(
        path,
        settings,
        (location == Location::Portable).then_some(true),
        base,
    )
}

pub fn switch_location(
    paths: &Paths,
    current: Location,
    next: Location,
    settings: &Settings,
) -> Result<StorageInfo, String> {
    if current == next {
        return Ok(paths.info(current, None));
    }
    // Read the source completely before touching the inactive destination.
    let files = custom_presets(&paths.presets(current))?;
    let target = paths.active(next);
    let base = read_value(target).unwrap_or_default();
    if target.exists() {
        backup(target, target.parent().unwrap())?;
    }
    if next == Location::Portable {
        // Failed activation must remain disabled after restarting the app.
        write_settings(target, settings, Some(false), base.clone())
            .map_err(|error| format!("无法启用便携模式，请确认 app 旁的数据目录可写: {error}"))?;
    }
    copy_presets(&files, &paths.presets(next), target.parent().unwrap())?;
    write_settings(
        target,
        settings,
        (next == Location::Portable).then_some(true),
        base,
    )?;
    if current == Location::Portable {
        // Retain the old portable profile as a backup, marked inactive.
        write_settings(
            &paths.portable,
            settings,
            Some(false),
            read_value(&paths.portable)?,
        )?;
    }
    Ok(paths.info(next, None))
}

pub fn ensure_settings_directory(paths: &Paths, location: Location) -> Result<PathBuf, String> {
    let directory = paths.active(location).parent().unwrap();
    fs::create_dir_all(directory).map_err(|error| failure("无法创建设置目录", directory, error))?;
    Ok(directory.to_owned())
}

pub fn catalog(paths: &Paths, location: Location) -> presets::Catalog {
    let directory = paths.presets(location);
    let mut files: BTreeMap<String, String> = presets::DEFAULTS
        .iter()
        .map(|(file, css)| (file.to_string(), css.to_string()))
        .collect();
    let mut catalog = presets::Catalog {
        directory: match location {
            Location::System => "~/Library/Application Support/com.winotmk.mugdown/presets".into(),
            Location::Portable => "./mugdown-data/presets".into(),
        },
        ..Default::default()
    };
    match fs::read_dir(&directory) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file()
                    || !path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("css"))
                {
                    continue;
                }
                if entry
                    .metadata()
                    .map(|metadata| metadata.len() > 512_000)
                    .unwrap_or(true)
                {
                    catalog.error = Some("CSS 预设超过 500 KB，已跳过".into());
                    continue;
                }
                match fs::read_to_string(&path) {
                    Ok(css) => {
                        files.insert(entry.file_name().to_string_lossy().into_owned(), css);
                    }
                    Err(error) => {
                        catalog.error = Some(failure(
                            "无法读取 CSS 预设，请使用 UTF-8 编码",
                            &path,
                            error,
                        ))
                    }
                }
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => catalog.error = Some(failure("无法读取 CSS 预设目录", &directory, error)),
    }
    catalog.items = files
        .into_iter()
        .map(|(file, css)| presets::Preset {
            id: format!("external:{file}"),
            name: Path::new(&file)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            css,
        })
        .collect();
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: PathBuf,
        paths: Paths,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("mugdown-mac-{}", crate::uid()));
            let executable = root.join("Apps/mugdown.app/Contents/MacOS/mugdown");
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            let paths = Paths::new(
                &executable,
                root.join("User/Library/Application Support/com.winotmk.mugdown/settings.json"),
            );
            Self { root, paths }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn fresh_launch_uses_system_defaults_without_creating_files() {
        let f = Fixture::new();
        let loaded = load(&f.paths, "en-US");
        assert_eq!(loaded.storage.location, Location::System);
        assert_eq!(loaded.settings.language, "en-US");
        assert!(loaded.storage.error.is_none());
        assert_eq!(catalog(&f.paths, Location::System).items.len(), 4);
        assert!(!f.paths.system.parent().unwrap().exists());
        assert!(!f.paths.portable.parent().unwrap().exists());
        assert!(!f.paths.legacy.exists());
    }

    #[test]
    fn first_change_creates_only_the_user_configuration() {
        let f = Fixture::new();
        let mut settings = load(&f.paths, "en-US").settings;
        settings.font_size = 20;
        save(&f.paths, Location::System, &settings).unwrap();
        assert_eq!(load(&f.paths, "zh-CN").settings.font_size, 20);
        assert!(!f.paths.portable.parent().unwrap().exists());
        assert!(!f.paths.presets(Location::System).exists());
        assert!(!f.paths.legacy.exists());
    }

    #[test]
    fn opening_configuration_directory_does_not_generate_default_files() {
        let f = Fixture::new();
        let directory = ensure_settings_directory(&f.paths, Location::System).unwrap();
        assert!(directory.is_dir());
        assert!(!f.paths.system.exists());
        assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
    }

    #[test]
    fn portable_switch_moves_preferences_and_custom_presets_and_survives_restart() {
        let f = Fixture::new();
        let mut settings = defaults("en-US");
        settings.custom_css = "h1 { color: red }".into();
        save(&f.paths, Location::System, &settings).unwrap();
        fs::create_dir_all(f.paths.presets(Location::System)).unwrap();
        fs::write(
            f.paths.presets(Location::System).join("Personal.css"),
            "p { color: green }",
        )
        .unwrap();
        switch_location(&f.paths, Location::System, Location::Portable, &settings).unwrap();
        let loaded = load(&f.paths, "zh-CN");
        assert_eq!(loaded.storage.location, Location::Portable);
        assert_eq!(loaded.settings.custom_css, settings.custom_css);
        assert!(f
            .paths
            .presets(Location::Portable)
            .join("Personal.css")
            .exists());
        settings.font_size = 23;
        switch_location(&f.paths, Location::Portable, Location::System, &settings).unwrap();
        let loaded = load(&f.paths, "zh-CN");
        assert_eq!(loaded.storage.location, Location::System);
        assert_eq!(loaded.settings.font_size, 23);
        assert_eq!(
            read_value(&f.paths.portable).unwrap().unwrap()[PORTABLE],
            false
        );
        assert!(!f.paths.legacy.exists());
    }

    #[test]
    fn failed_portable_activation_does_not_change_mode_after_restart() {
        let f = Fixture::new();
        let settings = defaults("en-US");
        save(&f.paths, Location::System, &settings).unwrap();
        fs::create_dir_all(f.paths.presets(Location::System)).unwrap();
        fs::write(
            f.paths.presets(Location::System).join("Personal.css"),
            "p{}",
        )
        .unwrap();
        fs::create_dir_all(f.paths.portable.parent().unwrap()).unwrap();
        fs::write(f.paths.presets(Location::Portable), "not a directory").unwrap();
        assert!(
            switch_location(&f.paths, Location::System, Location::Portable, &settings).is_err()
        );
        assert_eq!(load(&f.paths, "en-US").storage.location, Location::System);
        assert!(f
            .paths
            .presets(Location::System)
            .join("Personal.css")
            .exists());
    }

    #[test]
    fn failed_system_switch_preserves_the_active_portable_profile() {
        let f = Fixture::new();
        let settings = defaults("en-US");
        switch_location(&f.paths, Location::System, Location::Portable, &settings).unwrap();
        fs::create_dir_all(f.paths.system.parent().unwrap().parent().unwrap()).unwrap();
        fs::write(f.paths.system.parent().unwrap(), "not a directory").unwrap();
        assert!(
            switch_location(&f.paths, Location::Portable, Location::System, &settings).is_err()
        );
        assert_eq!(load(&f.paths, "en-US").storage.location, Location::Portable);
    }

    #[test]
    fn migration_preserves_legacy_settings_unknown_keys_and_custom_styles() {
        let f = Fixture::new();
        let mut old = serde_json::to_value(defaults("zh-CN")).unwrap();
        old["fontSize"] = 22.into();
        old["futurePreference"] = "keep me".into();
        fs::write(&f.paths.legacy, serde_json::to_vec(&old).unwrap()).unwrap();
        fs::create_dir_all(&f.paths.legacy_presets).unwrap();
        fs::write(
            f.paths.legacy_presets.join("Air.css"),
            presets::DEFAULTS[0].1,
        )
        .unwrap();
        fs::write(f.paths.legacy_presets.join("Personal.css"), "p {color:red}").unwrap();
        let loaded = load(&f.paths, "en-US");
        assert_eq!(loaded.storage.location, Location::System);
        assert_eq!(loaded.settings.font_size, 22);
        assert!(loaded.storage.error.is_none());
        assert_eq!(
            read_value(&f.paths.system).unwrap().unwrap()["futurePreference"],
            "keep me"
        );
        assert!(f.paths.legacy.exists());
        assert!(!f.paths.presets(Location::System).join("Air.css").exists());
        assert!(f
            .paths
            .presets(Location::System)
            .join("Personal.css")
            .exists());
        old["fontSize"] = 13.into();
        fs::write(&f.paths.legacy, serde_json::to_vec(&old).unwrap()).unwrap();
        assert_eq!(load(&f.paths, "en-US").settings.font_size, 22);
    }

    #[test]
    fn legacy_system_pointer_keeps_the_selected_user_profile_and_migrates_styles() {
        let f = Fixture::new();
        fs::create_dir_all(f.paths.system.parent().unwrap()).unwrap();
        let mut settings = defaults("en-US");
        settings.font_size = 21;
        fs::write(&f.paths.system, serde_json::to_vec(&settings).unwrap()).unwrap();
        let pointer = b"{\"settingsLocation\":\"system\"}";
        fs::write(&f.paths.legacy, pointer).unwrap();
        fs::create_dir_all(&f.paths.legacy_presets).unwrap();
        fs::write(
            f.paths.legacy_presets.join("Personal.css"),
            "p{color:green}",
        )
        .unwrap();
        let loaded = load(&f.paths, "zh-CN");
        assert!(loaded.storage.error.is_none());
        assert_eq!(loaded.settings.font_size, 21);
        assert_eq!(loaded.settings.language, "en-US");
        assert!(f
            .paths
            .presets(Location::System)
            .join("Personal.css")
            .exists());
        assert_eq!(fs::read(&f.paths.legacy).unwrap(), pointer);
        assert!(!f.paths.portable.exists());
    }

    #[test]
    fn invalid_legacy_and_portable_files_are_reported_without_overwriting_them() {
        let f = Fixture::new();
        fs::write(&f.paths.legacy, "invalid JSON").unwrap();
        assert!(load(&f.paths, "en-US").storage.error.is_some());
        assert!(!f.paths.system.exists());
        assert_eq!(fs::read_to_string(&f.paths.legacy).unwrap(), "invalid JSON");
        fs::create_dir_all(f.paths.portable.parent().unwrap()).unwrap();
        fs::write(&f.paths.portable, "broken portable JSON").unwrap();
        let loaded = load(&f.paths, "en-US");
        assert_eq!(loaded.storage.location, Location::Portable);
        assert!(loaded.storage.error.is_some());
        assert_eq!(
            fs::read_to_string(&f.paths.portable).unwrap(),
            "broken portable JSON"
        );
    }

    #[test]
    fn built_in_styles_stay_embedded_and_user_styles_override_them() {
        let f = Fixture::new();
        let directory = f.paths.presets(Location::System);
        assert_eq!(catalog(&f.paths, Location::System).items.len(), 4);
        assert!(!directory.exists());
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("Book.css"), "h1 {color:blue}").unwrap();
        fs::write(directory.join("Bad.css"), [0xff]).unwrap();
        let catalog = catalog(&f.paths, Location::System);
        assert_eq!(catalog.items.len(), 4);
        assert!(catalog
            .items
            .iter()
            .any(|item| item.name == "Book" && item.css.contains("blue")));
        assert!(catalog.error.is_some());
        assert!(!directory.join("Air.css").exists());
    }

    #[test]
    fn conflicting_destination_presets_are_backed_up_before_moving() {
        let f = Fixture::new();
        for location in [Location::System, Location::Portable] {
            fs::create_dir_all(f.paths.presets(location)).unwrap();
        }
        fs::write(
            f.paths.presets(Location::System).join("Personal.css"),
            "new style",
        )
        .unwrap();
        fs::write(
            f.paths.presets(Location::Portable).join("Personal.css"),
            "old style",
        )
        .unwrap();
        switch_location(
            &f.paths,
            Location::System,
            Location::Portable,
            &defaults("en-US"),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(f.paths.presets(Location::Portable).join("Personal.css")).unwrap(),
            "new style"
        );
        let backups = f.paths.portable.parent().unwrap().join("backups");
        assert!(fs::read_dir(backups)
            .unwrap()
            .flatten()
            .any(
                |entry| fs::read_to_string(entry.path().join("Personal.css"))
                    .ok()
                    .as_deref()
                    == Some("old style")
            ));
    }
}
