import { t } from "../i18n";
import { forwardRef, lazy, Suspense, type ComponentProps } from "react";
import type { EditorHandle } from "./Editor";
const Rich = lazy(() =>
  import("./Editor").then((module) => ({ default: module.RichEditor })),
);
const Source = lazy(() =>
  import("./Editor").then((module) => ({ default: module.SourceEditor })),
);
export type { EditorHandle } from "./Editor";
export const RichEditor = forwardRef<EditorHandle, ComponentProps<typeof Rich>>(
  function RichEditor(props, ref) {
    return (
      <Suspense
        fallback={
          <p className="muted" style={{ padding: "20px 45px" }}>
            {t("正在加载编辑器…")}{" "}
          </p>
        }
      >
        <Rich {...props} ref={ref} />
      </Suspense>
    );
  },
);
export const SourceEditor = forwardRef<
  EditorHandle,
  ComponentProps<typeof Source>
>(function SourceEditor(props, ref) {
  return (
    <Suspense
      fallback={
        <p className="muted" style={{ padding: "20px 45px" }}>
          {t("正在加载源码编辑器…")}{" "}
        </p>
      }
    >
      <Source {...props} ref={ref} />
    </Suspense>
  );
});
