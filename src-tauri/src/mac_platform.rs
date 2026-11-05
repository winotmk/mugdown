pub fn language_for(preferred: &str) -> &'static str {
    if preferred
        .split(['-', '_'])
        .next()
        .is_some_and(|s| s.eq_ignore_ascii_case("zh"))
    {
        "zh-CN"
    } else {
        "en-US"
    }
}

#[cfg(target_os = "macos")]
pub fn language() -> &'static str {
    use objc2_foundation::{ns_string, NSLocale, NSUserDefaults};
    use std::sync::OnceLock;
    static LANGUAGE: OnceLock<&'static str> = OnceLock::new();
    LANGUAGE.get_or_init(|| {
        // AppleLanguages includes macOS's per-application language override.
        let preferred = NSUserDefaults::standardUserDefaults()
            .stringArrayForKey(ns_string!("AppleLanguages"))
            .and_then(|languages| languages.firstObject())
            .or_else(|| NSLocale::preferredLanguages().firstObject())
            .map(|language| language.to_string())
            .unwrap_or_default();
        language_for(&preferred)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_variants_use_chinese_and_other_languages_use_english() {
        for language in ["zh", "zh-CN", "zh-Hans-CN", "zh-Hant-TW", "zh_HK"] {
            assert_eq!(language_for(language), "zh-CN");
        }
        for language in ["en-US", "fr-FR", "ja-JP", "", "zho"] {
            assert_eq!(language_for(language), "en-US");
        }
    }
}
