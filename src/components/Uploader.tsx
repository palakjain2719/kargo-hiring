"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Role = "PM" | "SPM";
interface Pending { file: File; role: Role | "" }
interface Item {
  id: string; file: string; name: string; role: Role;
  status: "queued" | "processing" | "completed" | "failed";
  error: string | null; can_retry: boolean; needs_file: boolean;
}
interface Progress { total: number; queued: number; processing: number; completed: number; failed: number; items: Item[] }

// Pre-fills the role only when the filename says so ("pm_…", "spm_…"). Arjun can change it before uploading.
const roleFromName = (n: string): Role | "" => (/^spm[_\-\s]/i.test(n) ? "SPM" : /^pm[_\-\s]/i.test(n) ? "PM" : "");
const CHUNK = 5; // files per upload request (keeps each request under serverless body limits)
const WORKERS = 2; // parallel /api/process loops; each claims up to 3 CVs

export function Uploader() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState({ sent: 0, ok: 0, failed: 0 });
  const [batch, setBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = [...list].filter((f) => /\.(pdf|docx|txt|md)$/i.test(f.name));
    setPending((p) => [...p, ...accepted.filter((f) => !p.some((x) => x.file.name === f.name && x.file.size === f.size)).map((file) => ({ file, role: roleFromName(file.name) }))]);
  };

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/processing${batch ? `?batch=${batch}` : ""}`, { cache: "no-store" });
    if (res.ok) setProgress(await res.json());
  }, [batch]);

  useEffect(() => { refresh(); }, [refresh]);

  const runWorkers = useCallback(async () => {
    setRunning(true);
    stopRef.current = false;
    const worker = async () => {
      while (!stopRef.current) {
        const res = await fetch("/api/process?n=3", { method: "POST" });
        if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Processing error"); break; }
        const { processed, remaining } = await res.json();
        await refresh();
        if (processed === 0 && remaining === 0) break;
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    await refresh();
    setRunning(false);
  }, [refresh]);

  // Resume processing if anything is still queued when the page opens.
  useEffect(() => {
    if (!running && !error && progress && progress.queued > 0) runWorkers();
  }, [progress, running, error, runWorkers]);

  async function upload() {
    setError(null);
    if (pending.some((p) => !p.role)) { setError("Choose an applied role for every CV."); return; }
    setUploading(true);
    let batchId: string | null = null;
    let ok = 0, failed = 0, sent = 0;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);
      const fd = new FormData();
      if (batchId) fd.append("batch_id", batchId);
      chunk.forEach((p) => { fd.append("files", p.file); fd.append("roles", p.role); });
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      sent += chunk.length;
      if (!res.ok) {
        failed += chunk.length;
        setError((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
      } else {
        const data = await res.json();
        batchId = data.batch_id;
        setBatch(batchId);
        for (const r of data.results) (r.ok ? ok++ : failed++);
      }
      setUploaded({ sent, ok, failed });
    }
    setPending([]);
    setUploading(false);
    await refresh();
    runWorkers();
  }

  async function retry(id: string) {
    await fetch(`/api/candidates/${id}/retry`, { method: "POST" });
    await refresh();
    if (!running) runWorkers();
  }

  async function replace(id: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/candidates/${id}/replace-file`, { method: "POST", body: fd });
    if (!res.ok) setError((await res.json()).error);
    await refresh();
    if (!running) runWorkers();
  }

  const setAll = (role: Role) => setPending((p) => p.map((x) => ({ ...x, role })));
  const unassigned = pending.filter((p) => !p.role).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="card p-4">
        <h2 className="h-section mb-3">1. Add CVs</h2>
        <div
          className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-canvas px-4 py-8 text-center hover:border-accent/50"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <div className="font-medium">Drop CVs here or click to choose</div>
          <div className="mt-1 text-xs text-ink-3">PDF, DOCX or TXT · select as many as you like</div>
          <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {pending.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{pending.length} file{pending.length === 1 ? "" : "s"}</span>
              <span className="text-xs text-ink-3">{unassigned ? `${unassigned} without a role` : "all roles set"}</span>
              <span className="ml-auto text-xs text-ink-3">Set all to</span>
              <button className="btn btn-sm" onClick={() => setAll("PM")}>PM</button>
              <button className="btn btn-sm" onClick={() => setAll("SPM")}>SPM</button>
            </div>
            <div className="mt-2 max-h-[420px] overflow-y-auto rounded-md border border-line">
              {pending.map((p, i) => (
                <div key={i} className="flex items-center gap-2 border-b border-line-2 px-3 py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{p.file.name}</span>
                  <select
                    className={`input py-1 ${p.role ? "" : "border-warn/50"}`}
                    value={p.role}
                    onChange={(e) => setPending((all) => all.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))}
                    aria-label={`Applied role for ${p.file.name}`}
                  >
                    <option value="">Applied role…</option>
                    <option value="PM">PM</option>
                    <option value="SPM">SPM</option>
                  </select>
                  <button className="text-xs text-ink-3 hover:text-bad" onClick={() => setPending((all) => all.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary mt-3 w-full" disabled={uploading || unassigned > 0} onClick={upload}>
              {uploading ? `Uploading… ${uploaded.sent}/${pending.length}` : `Upload ${pending.length} CV${pending.length === 1 ? "" : "s"} and analyse`}
            </button>
          </>
        )}
        {(uploaded.sent > 0) && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[13px]">
            <div className="rounded-md bg-canvas py-2"><div className="label">Uploaded</div><div className="font-semibold tabular-nums">{uploaded.sent}</div></div>
            <div className="rounded-md bg-good-soft py-2"><div className="label">Successful</div><div className="font-semibold tabular-nums text-good">{uploaded.ok}</div></div>
            <div className="rounded-md bg-bad-soft py-2"><div className="label">Unreadable</div><div className="font-semibold tabular-nums text-bad">{uploaded.failed}</div></div>
          </div>
        )}
        {error && <div className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="h-section">2. Processing {batch ? "(this batch)" : "(unfinished CVs)"}</h2>
          {running && <span className="text-xs text-ink-3">working…</span>}
          {batch && <button className="btn btn-sm ml-auto" onClick={() => setBatch(null)}>Show all unfinished</button>}
        </div>
        {progress && progress.total > 0 ? (
          <>
            <div className="text-[15px] font-semibold">{progress.total} CV{progress.total === 1 ? "" : "s"} {batch ? "uploaded" : "not yet completed"}</div>
            <div className="mt-2 flex h-2 overflow-hidden rounded bg-line">
              <div className="bg-good" style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
              <div className="bg-accent/60" style={{ width: `${((progress.processing + progress.queued) / progress.total) * 100}%` }} />
              <div className="bg-bad" style={{ width: `${(progress.failed / progress.total) * 100}%` }} />
            </div>
            <div className="mt-2 flex gap-4 text-[13px]">
              <span><b className="tabular-nums text-good">{progress.completed}</b> completed</span>
              <span><b className="tabular-nums">{progress.processing + progress.queued}</b> processing</span>
              <span><b className="tabular-nums text-bad">{progress.failed}</b> failed</span>
            </div>
            <div className="mt-3 max-h-[420px] overflow-y-auto rounded-md border border-line">
              {progress.items.map((it) => (
                <div key={it.id} className="border-b border-line-2 px-3 py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${it.status === "completed" ? "bg-good" : it.status === "failed" ? "bg-bad" : "animate-pulse bg-accent"}`} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {it.status === "completed" ? <Link className="hover:underline" href={`/candidates/${it.id}`}>{it.name}</Link> : it.name}
                      <span className="ml-2 text-xs text-ink-3">{it.role}</span>
                    </span>
                    <span className="text-xs capitalize text-ink-2">{it.status}</span>
                    {it.can_retry && <button className="btn btn-sm" onClick={() => retry(it.id)}>Retry</button>}
                    {it.needs_file && (
                      <label className="btn btn-sm cursor-pointer">
                        Replace file
                        <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => e.target.files?.[0] && replace(it.id, e.target.files[0])} />
                      </label>
                    )}
                  </div>
                  {it.error && <div className="mt-1 pl-4 text-xs text-bad">{it.error}</div>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-[13px] text-ink-3">Nothing processing. Everything uploaded so far has been analysed.</div>
        )}
      </section>
    </div>
  );
}
