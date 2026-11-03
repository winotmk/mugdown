import { describe, it, expect } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { history, undo, redo } from "@milkdown/kit/prose/history";
import { moveBlock } from "../src/renderer/BlockDrag";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph+" },
    text: {},
  },
  marks: { strong: {} },
});
const paragraph = (value: string) =>
  schema.node("paragraph", null, schema.text(value, [schema.mark("strong")]));
describe("block moves", () => {
  it("moves the whole node down and back up, preserving formatting and undo", () => {
    const first = paragraph("Alpha"),
      last = paragraph("Beta");
    let state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [first, last]),
      plugins: [history()],
    });
    const original = state.doc;
    state = state.apply(moveBlock(state, 0, state.doc.content.size)!);
    expect(state.doc.firstChild?.textContent).toBe("Beta");
    expect(state.doc.lastChild?.eq(first)).toBe(true);
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(original)).toBe(true);
    redo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.firstChild?.textContent).toBe("Beta");
    state = state.apply(moveBlock(state, last.nodeSize, 0)!);
    expect(state.doc.eq(original)).toBe(true);
  });
  it("does not delete a block when released on itself", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [paragraph("Alpha"), paragraph("Beta")]),
    });
    expect(moveBlock(state, 0, 2)).toBeNull();
    expect(moveBlock(state, 0, state.doc.firstChild!.nodeSize)).toBeNull();
  });
  it("reorders list items without removing list structure", () => {
    const first = schema.node("list_item", null, paragraph("One")),
      second = schema.node("list_item", null, paragraph("Two"));
    let state = EditorState.create({
      schema,
      doc: schema.node(
        "doc",
        null,
        schema.node("bullet_list", null, [first, second]),
      ),
    });
    state = state.apply(
      moveBlock(state, 1, 1 + first.nodeSize + second.nodeSize)!,
    );
    expect(state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(state.doc.firstChild?.firstChild?.eq(second)).toBe(true);
    expect(state.doc.firstChild?.lastChild?.eq(first)).toBe(true);
  });
});
