"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "./actions";
import { Score, StatusBadge } from "./ui";

interface F { id: string; name: string; role: "PM" | "SPM"; score: number | null; strength: string | null; concern: string | null; probe: string | null }

export function FinalistSelector({ finalists, alreadySelected }: { finalists: F[]; alreadySelected: { id: string; name: string; role: string; status: string }[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = finalists.filter((f) => picked.includes(f.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call("/api/selections/confirm", "POST", { ids: picked, confirm: true });
      const failed = r.results.filter((x: { ok: boolean }) => !x.ok).length;
      setMsg({ ok: !failed, text: `${r.selected} candidate(s) selected. Offer drafts prepared${failed ? `, ${failed} failed (retry from the candidate page)` : ""}. Review them in Communications.` });
      setPicked([]); setReviewing(false); setAck(false);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
          {msg.text} {msg.ok && <Link href="/communications" className="underline">Go to Communications →</Link>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className="th w-10" />
              <th className="th">Finalist</th>
              <th className="th">Role</th>
              <th className="th text-right">Score</th>
              <th className="th">Strongest criterion</th>
              <th className="th">Main concern</th>
              <th className="th">Probe in interview</th>
            </tr>
          </thead>
          <tbody>
            {finalists.map((f) => (
              <tr key={f.id} className={picked.includes(f.id) ? "bg-accent-soft/60" : ""}>
                <td className="td"><input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`} /></td>
                <td className="td font-medium"><Link href={`/candidates/${f.id}`} className="hover:underline">{f.name}</Link></td>
                <td className="td">{f.role}</td>
                <td className="td text-right"><Score value={f.score} /></td>
                <td className="td text-[13px] text-ink-2">{f.strength ?? "—"}</td>
                <td className="td text-[13px] text-ink-2">{f.concern ?? "—"}</td>
                <td className="td max-w-[300px] text-[13px] text-ink-2">{f.probe ?? "—"}</td>
              </tr>
            ))}
            {!finalists.length && (
              <tr><td className="td py-8 text-center text-ink-3" colSpan={7}>No finalists yet. Move shortlisted candidates to finalist from the shortlist pages.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {finalists.length > 0 && (
        <div className="card sticky bottom-4 flex flex-wrap items-center gap-3 px-4 py-3 shadow-sm">
          <div>
            <div className="label">Selected candidates</div>
            <div className="text-[13px]">
              <b className="tabular-nums">Total selected: {picked.length}</b>
              {chosen.length > 0 && <span className="text-ink-2"> · {chosen.map((c) => c.name).join(", ")}</span>}
            </div>
            <div className="text-[11px] text-ink-3">Typically 2–4, but choose as many as you want to make offers to.</div>
          </div>
          <button className="btn btn-primary ml-auto" disabled={!picked.length} onClick={() => setReviewing(true)}>
            Review selected candidates
          </button>
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal>
          <div className="card w-full max-w-lg p-5 shadow-lg">
            <h2 className="text-[15px] font-semibold">Confirm selections</h2>
            <p className="mt-1 text-[13px] text-ink-2">These candidates will be marked <b>Selected</b> and an individual offer draft will be prepared for each. No email is sent now; you'll review, edit and approve each draft first.</p>
            <ul className="my-3 divide-y divide-line-2 rounded-md border border-line">
              {chosen.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <span className="font-medium">{c.name} <span className="font-normal text-ink-3">· {c.role}</span></span>
                  <Score value={c.score} />
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I have reviewed these candidates and this selection is my decision.
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => { setReviewing(false); setAck(false); }}>Back</button>
              <button className="btn btn-primary" disabled={!ack || busy} onClick={confirm}>
                {busy ? "Preparing offer drafts…" : `Confirm ${chosen.length} selection${chosen.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {alreadySelected.length > 0 && (
        <section>
          <h2 className="h-section mb-2">Already selected ({alreadySelected.length})</h2>
          <div className="card divide-y divide-line-2">
            {alreadySelected.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <Link href={`/candidates/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                <span className="text-ink-3">{s.role}</span>
                <span className="ml-auto"><StatusBadge label={s.status} /></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
