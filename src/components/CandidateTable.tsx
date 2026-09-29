"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CandidateRow } from "@/lib/views";
import { RecBadge, Score, StatusBadge } from "./ui";

type SortKey = "applied" | "pm" | "spm" | "name" | "created_at";

const STATUSES = ["all", "processing", "analysed", "shortlisted", "finalist", "selected", "rejected", "failed"];

export function CandidateTable({ rows }: { rows: CandidateRow[] }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("applied");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (role !== "all" && r.applied_role !== role) return false;
      if (status === "failed" ? r.processing_status !== "failed" : status !== "all" && r.workflow_status !== status) return false;
      return !needle || r.name.toLowerCase().includes(needle) || r.file.toLowerCase().includes(needle);
    });
    const val = (r: CandidateRow) => (sort === "name" ? r.name.toLowerCase() : sort === "created_at" ? r.created_at : (r[sort] ?? -1));
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === "asc" ? c : -c;
    });
  }, [rows, q, role, status, sort, dir]);

  const header = (key: SortKey, label: string, right = false) => (
    <th className={`th ${right ? "text-right" : ""}`}>
      <button
        className="inline-flex items-center gap-1 uppercase hover:text-ink"
        onClick={() => {
          if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
          else { setSort(key); setDir(key === "name" ? "asc" : "desc"); }
        }}
      >
        {label}
        {sort === key && <span>{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <input className="input w-64" placeholder="Search candidate or file…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role filter">
          <option value="all">All roles</option>
          <option value="PM">PM</option>
          <option value="SPM">SPM</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-3">{shown.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr>
              {header("name", "Candidate")}
              <th className="th">Applied role</th>
              {header("pm", "PM score", true)}
              {header("spm", "SPM score", true)}
              {header("applied", "Applied-role score", true)}
              <th className="th">Recommendation</th>
              <th className="th">Status</th>
              {header("created_at", "Uploaded")}
              <th className="th text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-canvas/60">
                <td className="td">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink-3">{r.file}</div>
                </td>
                <td className="td">{r.applied_role}{r.role_source === "best_fit" && <div className="text-[11px] text-ink-3">best fit</div>}</td>
                <td className="td text-right"><Score value={r.pm} /></td>
                <td className="td text-right"><Score value={r.spm} /></td>
                <td className="td text-right">
                  <Score value={r.applied} />
                  {r.rank != null && <div className="text-[11px] text-ink-3">#{r.rank} in {r.applied_role}</div>}
                </td>
                <td className="td"><RecBadge rec={r.recommendation} /></td>
                <td className="td"><StatusBadge label={r.status_label} /></td>
                <td className="td text-xs text-ink-2 tabular-nums">{new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                <td className="td text-right">
                  <Link href={`/candidates/${r.id}`} className="btn btn-sm">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
