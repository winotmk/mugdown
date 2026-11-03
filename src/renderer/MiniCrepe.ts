import { t } from "../i18n";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import type { CrepeConfig, CrepeFeature } from "@milkdown/crepe";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { imageBlock } from "@milkdown/crepe/feature/image-block";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";

// Import only the features we ship. The default Crepe entry also loads all code
// languages, AI, diff tools and formula rendering even when their flags are off.
export class Crepe extends CrepeBuilder {
  static Feature = {
    Placeholder: "placeholder" as CrepeFeature.Placeholder,
    ImageBlock: "image-block" as CrepeFeature.ImageBlock,
    Toolbar: "toolbar" as CrepeFeature.Toolbar,
    BlockEdit: "block-edit" as CrepeFeature.BlockEdit,
    AI: "ai" as CrepeFeature.AI,
    TopBar: "top-bar" as CrepeFeature.TopBar,
    Latex: "latex" as CrepeFeature.Latex,
  };
  constructor({ featureConfigs = {}, root, defaultValue }: CrepeConfig) {
    super({ root, defaultValue });
    this.addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip, { inputPlaceholder: t("粘贴链接…") })
      .addFeature(imageBlock, featureConfigs[Crepe.Feature.ImageBlock])
      .addFeature(blockEdit, featureConfigs[Crepe.Feature.BlockEdit])
      .addFeature(toolbar, featureConfigs[Crepe.Feature.Toolbar])
      .addFeature(placeholder, featureConfigs[Crepe.Feature.Placeholder])
      .addFeature(table)
      .addFeature(codeMirror, {
        languages: [],
        copyText: t("复制"),
        searchPlaceholder: t("查找语言"),
        noResultText: t("无匹配语言"),
      });
  }
}
