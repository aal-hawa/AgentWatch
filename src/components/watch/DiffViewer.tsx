"use client";

// Side-by-side diff viewer for a single file's before/after content.
import { diffLines } from "diff";

type Row = { kind: "same" | "add" | "del"; text: string; leftNo?: number; rightNo?: number };

function buildRows(before: string, after: string): { rows: Row[]; maxLines: number } {
  const rows: Row[] = [];
  let ln = 0;
  let rn = 0;
  for (const part of diffLines(before || "", after || "")) {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      if (part.added) {
        rn++;
        rows.push({ kind: "add", text: line, rightNo: rn });
      } else if (part.removed) {
        ln++;
        rows.push({ kind: "del", text: line, leftNo: ln });
      } else {
        ln++;
        rn++;
        rows.push({ kind: "same", text: line, leftNo: ln, rightNo: rn });
      }
    }
  }
  return { rows, maxLines: Math.max(ln, rn) };
}

export function DiffViewer({
  before,
  after,
  height = "h-[420px]",
}: {
  before: string | null;
  after: string | null;
  height?: string;
}) {
  const { rows } = buildRows(before ?? "", after ?? "");

  // pair rows into left/right panes (aligned view)
  const left: Row[] = [];
  const right: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "same") {
      left.push(row);
      right.push(row);
      i++;
    } else if (row.kind === "del") {
      // collect del run followed by add run
      const delRun: Row[] = [];
      while (i < rows.length && rows[i].kind === "del") delRun.push(rows[i++]);
      const addRun: Row[] = [];
      while (i < rows.length && rows[i].kind === "add") addRun.push(rows[i++]);
      const max = Math.max(delRun.length, addRun.length);
      for (let k = 0; k < max; k++) {
        left.push(delRun[k] ?? { kind: "same", text: "" });
        right.push(addRun[k] ?? { kind: "same", text: "" });
      }
    } else {
      // pure addition
      const addRun: Row[] = [];
      while (i < rows.length && rows[i].kind === "add") addRun.push(rows[i++]);
      for (const r of addRun) {
        left.push({ kind: "same", text: "" });
        right.push(r);
      }
    }
  }

  const mono = "font-mono text-[11px] leading-[1.55] whitespace-pre";
  return (
    <div className={`aw-scroll ${height} overflow-auto rounded-lg border border-zinc-800`}>
      <table className="w-full border-collapse">
        <tbody>
          {left.map((l, idx) => {
            const r = right[idx];
            return (
              <tr key={idx}>
                <td className="w-10 select-none border-r border-zinc-800/70 bg-zinc-900/60 px-2 text-right text-[10px] text-zinc-600 align-top">
                  {l.leftNo ?? ""}
                </td>
                <td className={`w-1/2 align-top ${l.kind === "del" ? "diff-del" : ""} ${l.kind === "same" ? "text-zinc-400" : ""} px-3 ${mono}`}>
                  {l.text || " "}
                </td>
                <td className="w-10 select-none border-r border-l border-zinc-800/70 bg-zinc-900/60 px-2 text-right text-[10px] text-zinc-600 align-top">
                  {r?.rightNo ?? ""}
                </td>
                <td className={`w-1/2 align-top ${r?.kind === "add" ? "diff-add" : ""} ${r?.kind === "same" ? "text-zinc-400" : ""} px-3 ${mono}`}>
                  {r?.text || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">Empty on both sides.</div>}
    </div>
  );
}
