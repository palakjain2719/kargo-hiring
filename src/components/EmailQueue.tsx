"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmailDraft } from "@/lib/types";
import { ActionButton, call, EmailEditor } from "./actions";

type Item = EmailDraft & { name: string; role: string; to: string | null };

const TONE: Record<string, string> = {
  draft: "bg-canvas text-ink-2 border-line",
  approved: "bg-accent-soft text-accent border-accent/20",
  sent: "bg-good-soft text-good border-good/20",
  failed: "bg-bad-soft text-bad border-bad/20",
};

export function EmailQueue({
  tab, items, rejectedWithoutDraft, selectedWithoutDraft, live, testRecipient,
}: {
  tab: "offer" | "rejection"; items: Item[]; rejectedWithoutDraft: number;
  selectedWithoutDraft: { id: string; name: string }[]; live: boolean; testRecipient: boolean;
}) {
  const router = useRouter();
  const list = items.filter((i) => i.email_type === tab);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const approved = list.filter((i) => i.status === "approved");
  const drafts = list.filter((i) => i.status === "draft" || i.status === "failed");
  const toSend = approved.filter((i) => picked.includes(i.id));
  const count = (s: string) => list.filter((i) => i.status === s).length;

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call("/api/emails/send", "POST", { ids: toSend.map((i) => i.id), confirmation: "CONFIRM_SEND" });
      const ok = r.results.filter((x: { ok: boolean }) => x.ok).length;
      const bad = r.results.filter((x: { ok: boolean }) => !x.ok);
      setMsg({
        ok: bad.length === 0,
        text: r.sending_enabled
          ? `${ok} sent${bad.length ? `, ${bad.length} failed: ${bad.map((b: { error: string }) => b.error).join("; ")}` : "."}`
          : `Dry run: ${ok} email(s) validated, none sent (EMAIL_SENDING_ENABLED is off).${bad.length ? ` ${bad.length} failed validation.` : ""}`,
      });
      setPicked([]); setConfirming(false); setTyped("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    const r = await call("/api/emails/approve", "POST", { ids: drafts.map((d) => d.id) });
    const bad = r.results.filter((x: { ok: boolean }) => !x.ok);
    setMsg({ ok: !bad.length, text: `${r.results.length - bad.length} approved.${bad.length ? ` ${bad.length} need edits: ${bad.map((b: { error: string }) => b.error).join("; ")}` : ""}` });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["offer", "rejection"] as const).map((t) => (
          <Link key={t} href={`?tab=${t}`} className={`btn ${tab === t ? "border-accent text-accent" : ""}`}>
            {t === "offer" ? "Offers" : "Rejections"} ({items.filter((i) => i.email_type === t).length})
          </Link>
        ))}
        <span className="ml-auto text-xs text-ink-3">
          {count("draft")} draft · {count("approved")} approved · {count("sent")} sent · {count("failed")} failed
        </span>
      </div>

      {tab === "rejection" && rejectedWithoutDraft > 0 && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-[13px]">{rejectedWithoutDraft} rejected candidate(s) have no rejection draft yet.</span>
          <ActionButton url="/api/rejections/drafts" label={`Prepare ${rejectedWithoutDraft} individual draft(s)`} busyLabel="Drafting individually…" className="btn btn-primary btn-sm ml-auto" />
        </div>
      )}
      {tab === "offer" && selectedWithoutDraft.length > 0 && (
        <div className="card px-4 py-3 text-[13px]">
          Offer drafts missing for: {selectedWithoutDraft.map((s) => <Link key={s.id} href={`/candidates/${s.id}`} className="mr-2 text-accent hover:underline">{s.name}</Link>)}
        </div>
      )}

      {msg && <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}

      <div className="card divide-y divide-line-2">
        {list.map((d) => (
          <div key={d.id}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={d.status !== "approved"}
                checked={picked.includes(d.id)}
                onChange={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))}
                title={d.status === "approved" ? "Include in send" : "Approve first"}
                aria-label={`Include ${d.name}`}
              />
              <div className="min-w-[180px] flex-1">
                <Link href={`/candidates/${d.candidate_id}`} className="font-medium hover:underline">{d.name}</Link>
                <span className="ml-2 text-xs text-ink-3">{d.role} · {d.to ?? "no email on record"}</span>
                <div className="truncate text-xs text-ink-2">{d.subject}</div>
              </div>
              {d.edited_by_founder && <span className="text-[11px] text-ink-3">edited</span>}
              <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${TONE[d.status]}`}>{d.status}</span>
              {d.sent_at && <span className="text-[11px] tabular-nums text-ink-3">{new Date(d.sent_at).toLocaleString()}</span>}
              <button className="btn btn-sm" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Close" : d.status === "sent" ? "View" : "Review & edit"}</button>
            </div>
            {open === d.id && <div className="border-t border-line-2 bg-canvas/50 px-4 py-3"><EmailEditor draft={d} /></div>}
          </div>
        ))}
        {!list.length && <div className="px-4 py-8 text-center text-[13px] text-ink-3">No {tab} drafts.</div>}
      </div>

      {list.length > 0 && (
        <div className="card sticky bottom-4 flex flex-wrap items-center gap-3 px-4 py-3 shadow-sm">
          {drafts.length > 0 && <button className="btn" onClick={approveAll}>Approve all {drafts.length} unapproved (after review)</button>}
          <button className="btn" disabled={!approved.length} onClick={() => setPicked(approved.map((a) => a.id))}>Select all approved ({approved.length})</button>
          <button className="btn btn-primary ml-auto" disabled={!toSend.length} onClick={() => setConfirming(true)}>
            Send {toSend.length || ""} approved email{toSend.length === 1 ? "" : "s"}…
          </button>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal>
          <div className="card w-full max-w-lg p-5 shadow-lg">
            <h2 className="text-[15px] font-semibold">Send {toSend.length} {tab} email{toSend.length === 1 ? "" : "s"}?</h2>
            <p className="mt-1 text-[13px] text-ink-2">
              {live
                ? testRecipient
                  ? "Sending is LIVE but redirected to EMAIL_TEST_RECIPIENT, not to candidates."
                  : "Sending is LIVE. These go to the candidates' real addresses and can't be recalled."
                : "Sending is OFF (dry run). Drafts are validated but nothing is delivered."}
            </p>
            <ul className="my-3 max-h-56 divide-y divide-line-2 overflow-y-auto rounded-md border border-line">
              {toSend.map((d) => (
                <li key={d.id} className="px-3 py-1.5 text-[13px]"><b>{d.name}</b> <span className="text-ink-3">· {d.to}</span></li>
              ))}
            </ul>
            <label className="block text-[13px]">
              Type <b>SEND</b> to confirm
              <input className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => { setConfirming(false); setTyped(""); }}>Cancel</button>
              <button className="btn btn-primary" disabled={typed !== "SEND" || busy} onClick={send}>{busy ? "Sending…" : "Confirm send"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
