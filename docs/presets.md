# Markdown 排版预设

原有 GitHub、Sakura、Modest 保留，另附 Air、Book、Compact、Notebook 四个 CSS 预设，位于程序旁的 `presets` 文件夹。macOS 在 `.app` 旁使用同名目录。

打开调色板，在 Markdown 排版下方点击“打开目录”。将自己的 UTF-8 `.css` 文件放入目录，再点击“刷新预设”，文件名就会出现在下拉列表。修改或删除文件后也可刷新，无需重启。单文件上限 500 KB，不需要安装插件或重新编译。

预设以 GitHub 的基础排版为底，再叠加文件中的 CSS。CSS 作用于可视化正文，文件内容不会被改写；MD 源码模式使用代码编辑器自己的显示。下方“自定义 CSS”仍可叠加，优先于所选预设。

例如保存为 `My Notes.css`：

```css
body {
  font-family: Georgia, "Noto Serif SC", "Songti SC", serif;
  line-height: 1.9;
}
h1, h2 { border-bottom: 0; }
h1 { text-align: center; }
blockquote { border-left: 2px solid var(--md-link); }
```

默认继承当前明暗配色。需要固定纸色时，可以添加：

```css
:root {
  --md-bg: #faf7ef;
  --md-fg: #403a32;
  --md-muted: #807362;
  --md-link: #86603b;
  --md-code-bg: #eee9de;
  --md-code-fg: #403a32;
}
```

编辑区域和顶部拉手会一起采用该底色。新增的空行提示也使用正文配色，避免深色界面搭配浅色纸张时看不清。

便携包只附带原始四个预设，不会收录已有便携目录中的个人新增文件或改动。升级到新文件夹时，可复制自己的 CSS 文件到新目录。选中的文件暂时缺失时，正文使用 GitHub 基础排版，恢复文件并刷新后即可继续使用。
