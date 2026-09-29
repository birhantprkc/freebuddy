import type { CliStreamItem } from "@/services/cli/parsers";

export type FileEdit = Extract<CliStreamItem, { kind: "file-edit" }>;
export type DiffRow = { kind: "context" | "add" | "delete" | "meta"; text: string; oldLine?: number; newLine?: number };
export type FileDiff = { rows: DiffRow[]; added: number; removed: number; notice?: "missing" | "truncated" | "large" | "raw"; partial?: boolean };

/** Keep individual edits when their baselines cannot safely be combined. */
export function collectFileEdits(items: CliStreamItem[]): FileEdit[] {
  const edits: FileEdit[] = [];
  const results = new Map<string, Extract<CliStreamItem, { kind: "tool-result" }>>();
  for (const item of items) if (item.kind === "tool-result" && item.id) results.set(item.id, item);
  for (const item of items) {
    if (item.kind === "file-edit" && (!item.status || item.status === "completed")) edits.push(item);
    if (item.kind !== "tool-call" || item.isError || (item.status && item.status !== "completed")) continue;
    const result = item.id ? results.get(item.id) : undefined;
    if (result?.isError) continue;
    if (item.toolOutputs?.length) {
      edits.push(...collectFileEdits(item.toolOutputs));
      continue;
    }
    // Claude Edit contains snippets, not the complete file. Only show after success.
    if (!(result || item.status === "completed")) continue;
    const input = item.input as Record<string, unknown> | undefined;
    if (item.tool !== "Edit" || !input || typeof input.file_path !== "string") continue;
    if (typeof input.old_string === "string" && typeof input.new_string === "string") {
      edits.push({ kind: "file-edit", path: input.file_path, action: "update", oldText: input.old_string, newText: input.new_string, partial: true });
    }
  }
  return edits;
}

function lines(text: string): string[] {
  if (!text) return [];
  const result = text.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

export function buildFileDiff(edit: FileEdit): FileDiff {
  const result: FileDiff = { rows: [], added: 0, removed: 0, partial: edit.partial };
  if (edit.truncated || [edit.patch, edit.oldText, edit.newText].some((s) => s?.includes("[truncated]"))) {
    return { ...result, notice: "truncated" };
  }
  const before = edit.oldText ?? (edit.action === "create" ? "" : undefined);
  const after = edit.newText ?? (edit.action === "delete" ? "" : undefined);
  if (before !== undefined && after !== undefined) {
    if (before.length + after.length > 400_000) return { ...result, notice: "large" };
    const a = lines(before), b = lines(after);
    let prefix = 0, suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
    // Bound both allocation and work for unrelated large files.
    if ((n + 1) * (m + 1) > 1_000_000 || a.length + b.length > 20_000) return { ...result, notice: "large" };
    let oldLine = 1, newLine = 1;
    const push = (kind: DiffRow["kind"], text: string) => {
      result.rows.push({ kind, text, oldLine: kind !== "add" ? oldLine++ : undefined, newLine: kind !== "delete" ? newLine++ : undefined });
      if (kind === "add") result.added++;
      if (kind === "delete") result.removed++;
    };
    for (let i = 0; i < prefix; i++) push("context", a[i]);
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[prefix + i] === b[prefix + j]
        ? 1 + table[(i + 1) * width + j + 1]
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) { push("context", a[prefix + i++]); j++; }
      else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) push("delete", a[prefix + i++]);
      else push("add", b[prefix + j++]);
    }
    for (let k = a.length - suffix; k < a.length; k++) push("context", a[k]);
    if (before !== after && before.endsWith("\n") !== after.endsWith("\n")) result.rows.push({ kind: "meta", text: after.endsWith("\n") ? "+ EOF newline" : "− EOF newline" });
    return result;
  }
  if (!edit.patch) return { ...result, notice: "missing" };
  if (edit.patch.length > 400_000) return { ...result, notice: "large" };
  let oldLine = 0, newLine = 0, inHunk = false;
  for (const text of lines(edit.patch)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; }
    if (inHunk && !hunk && text.startsWith("+")) { result.rows.push({ kind: "add", text: text.slice(1), newLine: newLine++ }); result.added++; }
    else if (inHunk && !hunk && text.startsWith("-")) { result.rows.push({ kind: "delete", text: text.slice(1), oldLine: oldLine++ }); result.removed++; }
    else if (inHunk && text.startsWith(" ")) result.rows.push({ kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ });
    else { result.rows.push({ kind: "meta", text }); if (!hunk && !text.startsWith("\\")) inHunk = false; }
  }
  if (!result.rows.some((r) => r.kind !== "meta")) result.notice = "raw";
  return result;
}

/** Collapse unchanged runs without modifying the underlying diff or its counts. */
export function foldDiffRows(rows: DiffRow[]): (DiffRow | { kind: "fold"; count: number })[] {
  const out: ReturnType<typeof foldDiffRows> = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== "context") { out.push(rows[i++]); continue; }
    let end = i;
    while (end < rows.length && rows[end].kind === "context") end++;
    if (end - i > 8) { out.push(...rows.slice(i, i + 3), { kind: "fold", count: end - i - 6 }, ...rows.slice(end - 3, end)); }
    else out.push(...rows.slice(i, end));
    i = end;
  }
  return out;
}
