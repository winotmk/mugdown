use serde::Serialize;
use std::{collections::BTreeMap, fs, path::Path};

const DEFAULTS: [(&str, &str); 4] = [
    ("Air.css", include_str!("../../assets/presets/Air.css")),
    ("Book.css", include_str!("../../assets/presets/Book.css")),
    (
        "Compact.css",
        include_str!("../../assets/presets/Compact.css"),
    ),
    (
        "Notebook.css",
        include_str!("../../assets/presets/Notebook.css"),
    ),
];
#[derive(Clone, Serialize)]
pub(crate) struct Preset {
    pub id: String,
    pub name: String,
    pub css: String,
}
#[derive(Clone, Default, Serialize)]
pub(crate) struct Catalog {
    pub directory: String,
    pub items: Vec<Preset>,
    pub error: Option<String>,
}

pub(crate) fn load(directory: &Path) -> Catalog {
    let mut catalog = Catalog {
        directory: "./presets".into(),
        ..Catalog::default()
    };
    let mut files = BTreeMap::new();
    if !directory.exists() {
        if fs::create_dir_all(directory).is_ok() {
            for (name, css) in DEFAULTS {
                let _ = fs::write(directory.join(name), css);
            }
        } else {
            // Read-only installations still have the four small built-in styles.
            for (name, css) in DEFAULTS {
                files.insert(name.to_string(), css.to_string());
            }
            catalog.error = Some("无法创建 CSS 预设目录".into());
        }
    }
    match fs::read_dir(directory) {
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
                if entry.metadata().map(|m| m.len() > 512_000).unwrap_or(true) {
                    catalog.error = Some("CSS 预设超过 500 KB，已跳过".into());
                    continue;
                }
                match fs::read_to_string(&path) {
                    Ok(css) => {
                        files.insert(entry.file_name().to_string_lossy().into_owned(), css);
                    }
                    Err(_) => catalog.error = Some("无法读取 CSS 预设，请使用 UTF-8 编码".into()),
                }
            }
        }
        Err(_) => catalog.error = Some("无法读取 CSS 预设目录".into()),
    }
    catalog.items = files
        .into_iter()
        .map(|(file, css)| Preset {
            name: Path::new(&file)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            id: format!("external:{file}"),
            css,
        })
        .collect();
    catalog
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_refresh_pick_up_additions_edits_and_removal() {
        let root = std::env::current_dir()
            .unwrap()
            .join(".qa/preset-tests")
            .join(crate::uid());
        assert_eq!(load(&root).items.len(), 4);
        fs::write(root.join("我的排版.css"), "h1 { color: red; }").unwrap();
        let catalog = load(&root);
        assert_eq!(catalog.items.len(), 5);
        assert!(catalog
            .items
            .iter()
            .any(|item| item.name == "我的排版" && item.id == "external:我的排版.css"));
        fs::write(root.join("我的排版.css"), "h1 { color: blue; }").unwrap();
        assert!(load(&root)
            .items
            .iter()
            .any(|item| item.css.contains("blue")));
        fs::remove_file(root.join("我的排版.css")).unwrap();
        assert_eq!(load(&root).items.len(), 4);
        fs::remove_file(root.join("Air.css")).unwrap();
        assert_eq!(load(&root).items.len(), 3);
    }
    #[test]
    fn ignores_non_css_and_reports_invalid_utf8_without_losing_other_presets() {
        let root = std::env::current_dir()
            .unwrap()
            .join(".qa/preset-tests")
            .join(crate::uid());
        load(&root);
        fs::write(root.join("ignore.txt"), "text").unwrap();
        fs::write(root.join("broken.css"), [0xff]).unwrap();
        let catalog = load(&root);
        assert_eq!(catalog.items.len(), 4);
        assert!(catalog.error.is_some());
    }
}
