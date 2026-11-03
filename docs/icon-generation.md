# mugdown 图标

2026-10-21，使用内置 imagegen 编辑原 `Winotypo 项目中的 assets/icon.png`，原项目文件保持不变。成品为 `assets/icon.png`，Tauri CLI 负责尺寸与 ICO/ICNS 格式转换，见 `src-tauri/icons/`。

最终提示词：

> Edit target: the existing attached Winotypo pixel-art icon, a Siamese cat in a very short cream ceramic cup with a right handle. Remove the entire cat completely, including ears, face, whiskers, body, and both paws. Keep ONLY the existing shallow cream cup and its right handle. Complete the cup's exposed top opening with a subtle dark warm brown elliptical interior and cream pixel rim where the cat used to be, maintaining the original cup identity, cream colors, chunky square pixel steps, dark brown outline and limited beige shading. Keep the cup shallow like the original, not a tall mug. Recenter and enlarge the cup to fill about 80 percent of the square canvas width with balanced transparent margins. Single cup, no animal, no steam, no props, no text, no watermark, no app tile, no smooth vector redraw. Genuine transparent background. Deliver the finished mugdown desktop icon as one square PNG.

## 0.2.0：加高、圆润的空杯

模式：imagegen 编辑（edit），透明背景。输入为 0.1 版图标，旧版备份在 `assets/icon-v0.1.png`。最终 PNG：`assets/icon.png`；Windows ICO、macOS ICNS 和各尺寸图标已通过 Tauri CLI 同步生成。

最终提示词：

> Edit target: the attached mugdown icon, a chunky pixel-art cream ceramic cup with a right handle. Change it into a taller, rounder, very cute EMPTY ceramic mug. Increase the cup body height by about 60 percent while keeping a softly rounded, gently bulbous silhouette and a rounded generous right handle. The cup is completely empty: remove all coffee/liquid, the inside must be the SAME pale cream ceramic material as the outside, with only subtle beige inner-wall shadow showing the hollow cup and an empty pale bottom. Absolutely no dark brown filled ellipse, no beverage, no steam, no cat, no face, no lettering, no props. Preserve the existing warm cream/beige palette, dark cocoa pixel outline, charming coherent chunky pixel-art steps and limited soft-looking pixel shading. Keep pixel art rather than a smooth vector redesign. Center the taller cup in a square transparent canvas, fill around 80 percent of the canvas with balanced margins. One finished desktop app icon on genuine transparent background.

## 0.2.1：小尺寸专用版本

模式：内置 imagegen 编辑（edit），透明背景。输入为原有大图，简化细节、加粗轮廓，只用于小尺寸。原有 `assets/icon.png`、64/128/256 等较大 PNG 保留原始数据。

最终母版：`assets/icon-small-master.png`。用 Tauri CLI 转为 `assets/icons-small/16x16.png`、`20x20.png`、`24x24.png`、`32x32.png`；另有 `48x48.png` 与 `64x64.png` 用于高 DPI 标题栏。标题栏使用 `srcset` 按显示缩放挑选图像，空白页的大图保持原样。

`scripts/sync-small-icons.mjs` 把 16–32 像素版本写入 ICO/ICNS 的对应小图。ICO 中的 48/64/256 和 ICNS 中更大图像的压缩数据逐字节保留。

最终提示词：

> Edit target: the attached mugdown cream ceramic EMPTY mug icon. Make a dedicated tiny UI icon master for later conversion to 16x16, 20x20, 24x24 and 32x32 PNGs. Preserve this recognizable tall rounded empty cream mug and right handle, but drastically simplify it for legibility at 16 pixels: a continuous bold dark cocoa silhouette outline, thick strong rim and handle contours, a wide clear handle hole, a few broad flat cream/beige color regions only. Use an extremely low resolution 24 by 24 logical pixel grid enlarged cleanly on the output canvas, with coherent large square pixel steps. Outline should occupy at least 1 to 2 logical pixels everywhere so it remains visibly unbroken after downscaling; no hairlines, no tiny highlights, no gradients, no texture, no antialiasing speckles. Keep the mug EMPTY: pale cream ceramic interior with a simple beige inner wall shadow, no coffee or liquid, no steam. No face, no cat, no text, no tile, no props or drop shadow. Center a SINGLE cup on a square genuinely transparent background, use about 88 percent of available width and height with compact balanced transparent margin. The delivered image is only the simplified small-icon master, not an icon sheet or multiple icons. The existing detailed large icon is a reference and must not be redesigned.
