import {
  NodeSelection,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import { dropPoint } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";

export function moveBlock(state: EditorState, from: number, to: number) {
  const node = state.doc.nodeAt(from);
  if (!node || (to >= from && to <= from + node.nodeSize)) return null;
  const slice = NodeSelection.create(state.doc, from).content();
  const tr = state.tr.delete(from, from + node.nodeSize);
  const target = dropPoint(tr.doc, tr.mapping.map(to), slice);
  if (target == null) return null;
  tr.insert(target, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(target + 1)));
  return tr.scrollIntoView();
}

// Pointer dragging stays inside the editor, so Windows' native file drop target
// cannot take over the gesture. External file dropping remains enabled.
export function bindBlockDrag(
  handle: HTMLElement,
  getActive: () => { from: number; view: EditorView } | null,
  changed: () => void,
) {
  let cleanup: (() => void) | null = null;
  const preventNative = (event: DragEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  handle.addEventListener("dragstart", preventNative, true);
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const active = getActive();
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup?.();
    const { view, from } = active,
      original = view.state.doc,
      $from = original.resolve(from);
    const parent = $from.parent,
      start = $from.start();
    const indicator = document.createElement("div");
    indicator.className = "block-drop-indicator";
    let started = false,
      target = from,
      lastY = event.clientY,
      frame = 0;
    const workspace = view.dom.closest<HTMLElement>(".workspace");
    const stop = () => {
      cancelAnimationFrame(frame);
      indicator.remove();
      delete document.documentElement.dataset.blockDragging;
      handle.classList.remove("moving");
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", stop, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", stop);
      cleanup = null;
    };
    const position = () => {
      if (!started) return;
      const bounds = view.dom.getBoundingClientRect();
      let lineY = bounds.top;
      target = start;
      parent.forEach((node, offset) => {
        const dom = view.nodeDOM(start + offset);
        if (!(dom instanceof HTMLElement)) return;
        const rect = dom.getBoundingClientRect();
        if (lastY >= rect.top + rect.height / 2) {
          target = start + offset + node.nodeSize;
          lineY = rect.bottom;
        } else if (target === start + offset) lineY = rect.top;
      });
      const valid =
        view.state.doc === original &&
        !(target >= from && target <= from + original.nodeAt(from)!.nodeSize);
      indicator.hidden = !valid;
      Object.assign(indicator.style, {
        left: `${bounds.left}px`,
        width: `${bounds.width}px`,
        top: `${lineY}px`,
      });
    };
    const scroll = () => {
      if (started && workspace) {
        const rect = workspace.getBoundingClientRect();
        if (lastY < rect.top + 32) workspace.scrollTop -= 8;
        else if (lastY > rect.bottom - 32) workspace.scrollTop += 8;
        position();
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault();
      lastY = next.clientY;
      if (
        !started &&
        Math.hypot(
          next.clientX - event.clientX,
          next.clientY - event.clientY,
        ) >= 4
      ) {
        started = true;
        changed();
        document.documentElement.dataset.blockDragging = "true";
        handle.classList.add("moving");
        document.body.append(indicator);
        frame = requestAnimationFrame(scroll);
      }
      position();
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const rect =
        workspace?.getBoundingClientRect() ?? view.dom.getBoundingClientRect();
      if (
        started &&
        view.state.doc === original &&
        next.clientX >= rect.left &&
        next.clientX <= rect.right &&
        next.clientY >= rect.top &&
        next.clientY <= rect.bottom
      ) {
        const tr = moveBlock(view.state, from, target);
        if (tr) {
          view.dispatch(tr);
          changed();
        }
      }
      stop();
      view.focus();
    };
    const key = (next: KeyboardEvent) => {
      if (next.key === "Escape") {
        next.preventDefault();
        next.stopPropagation();
        stop();
      }
    };
    cleanup = stop;
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", stop, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", stop);
  };
  handle.addEventListener("pointerdown", down);
  return () => {
    cleanup?.();
    handle.removeEventListener("pointerdown", down);
    handle.removeEventListener("dragstart", preventNative, true);
  };
}
