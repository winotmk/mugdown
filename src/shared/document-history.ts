type Edit = { start: number; end: number; simple: boolean };
function editRange(before: string, after: string): Edit {
  let start = 0,
    tail = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before.at(-tail - 1) === after.at(-tail - 1)
  )
    tail++;
  const removed = before.slice(start, before.length - tail),
    inserted = after.slice(start, after.length - tail);
  return {
    start,
    end: after.length - tail,
    simple:
      (!removed || !inserted) &&
      removed.length + inserted.length <= 20 &&
      !/[\n\r*_`#\[\]<>]/.test(removed + inserted),
  };
}
interface Entry {
  current: string;
  past: string[];
  future: string[];
  at: number;
  group: string;
  edit?: Edit;
}
// The journal belongs to the document, so replacing either editor cannot discard it.
export class DocumentHistory {
  private documents = new Map<string, Entry>();
  open(id: string, value: string) {
    const entry = this.documents.get(id);
    if (!entry) this.reset(id, value);
    else if (entry.current !== value)
      this.record(id, entry.current, value, "external");
    this.boundary(id);
  }
  reset(id: string, value: string) {
    this.documents.set(id, {
      current: value,
      past: [],
      future: [],
      at: -Infinity,
      group: "",
    });
  }
  forget(id: string) {
    this.documents.delete(id);
  }
  boundary(id: string) {
    const entry = this.documents.get(id);
    if (entry) entry.at = -Infinity;
  }
  record(
    id: string,
    before: string,
    after: string,
    group: string,
    at = Date.now(),
  ) {
    if (before === after) return;
    if (this.documents.get(id)?.current !== before) this.reset(id, before);
    const entry = this.documents.get(id)!,
      edit = editRange(before, after);
    const coalesce =
      (group === "visual" || group === "source") &&
      entry.group === group &&
      at - entry.at < 650 &&
      !entry.future.length &&
      entry.edit?.simple &&
      edit.simple &&
      (edit.start === entry.edit.end || edit.end === entry.edit.start);
    if (!coalesce) entry.past.push(before);
    entry.past = entry.past.slice(-150);
    let retained = entry.past.reduce((size, text) => size + text.length, 0);
    while (entry.past.length > 1 && retained > 8_000_000)
      retained -= entry.past.shift()!.length;
    entry.future = [];
    entry.current = after;
    entry.group = group;
    entry.at = at;
    entry.edit = edit;
  }
  undo(id: string, current: string) {
    return this.move(id, current, false);
  }
  redo(id: string, current: string) {
    return this.move(id, current, true);
  }
  private move(id: string, current: string, forward: boolean) {
    const entry = this.documents.get(id);
    if (!entry || entry.current !== current) return null;
    const from = forward ? entry.future : entry.past,
      to = forward ? entry.past : entry.future;
    const value = from.pop();
    if (value === undefined) return null;
    to.push(current);
    entry.current = value;
    entry.at = -Infinity;
    return value;
  }
}
