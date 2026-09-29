"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmailDraft } from "@/lib/types";
import { ActionButton, call, EmailEditor } from "./actions";

type Item = EmailDraft & { name: string; role: string; to: string | null };

const TONE: Record<string, string> = {
  ready: "bg-accent-soft text-accent border-accent/20",
  sent: "bg-good-soft text-good border-good/20",
  failed: "bg-bad-soft text-bad border-bad/20",
  "no email": "bg-canvas text-ink-3 border-line",
};
const stateOf = (d: Item) => (d.status === "sent" ? "sent" : !d.to ? "no email" : d.status === "failed" ? "failed" : "ready");

export function EmailQueue({
  tab, items, rejectedWithoutDraft, selectedWithoutDraft, live, testRecipient,
}: {
  tab: "offer" | "rejection"; items: Item[]; rejectedWithoutDraft: number;
  selectedWithoutDraft: { id: string; name: string }[]; live: boolean; testRecipient: boolean;
}) {
  const router = useRouter();
  const list = items.filter((i) => i.email_type === tab);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ready = list.filter((i) => stateOf(i) === "ready" || stateOf(i) === "failed");
  const count = (s: string) => list.filter((i) => stateOf(i) === s).length;

  async function send(ids: string[]) {
    setBusy(ids.length === 1 ? ids[0] : "all");
    setMsg(null);
    try {
      const r = await call("/api/emails/send", "POST", { ids, confirmation: "CONFIRM_SEND" });
      const ok = r.results.filter((x: { ok: boolean }) => x.ok).length;
      const bad = r.results.filter((x: { ok: boolean }) => !x.ok);
      setMsg({
        ok: bad.length === 0,
        text: r.sending_enabled
          ? `${ok} email${ok === 1 ? "" : "s"} sent${bad.length ? `. ${bad.length} failed: ${bad.map((b: { error: string }) => b.error).join("; ")}` : "."}`
          : `Dry run: sending is switched off, so nothing was delivered (${ok} email${ok === 1 ? "" : "s"} checked).`,
      });
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
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
          {count("ready")} ready · {count("sent")} sent · {count("failed")} failed · {count("no email")} no email on file
        </span>
      </div>

      {!live && (
        <div className="rounded-md border border-warn/20 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Email sending is switched off. Send buttons run a dry run until Resend is connected and EMAIL_SENDING_ENABLED=true.
        </div>
      )}
      {live && testRecipient && (
        <div className="rounded-md border border-warn/20 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Test mode: every email goes to EMAIL_TEST_RECIPIENT, not to candidates.
        </div>
      )}

      {tab === "rejection" && rejectedWithoutDraft > 0 && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-[13px]">{rejectedWithoutDraft} rejected candidate(s) don't have their email written yet.</span>
          <ActionButton url="/api/rejections/drafts" label={`Write ${rejectedWithoutDraft} email(s)`} busyLabel="Writing individually…" className="btn btn-primary btn-sm ml-auto" />
        </div>
      )}
      {tab === "offer" && selectedWithoutDraft.length > 0 && (
        <div className="card px-4 py-3 text-[13px]">
          Offer email missing for: {selectedWithoutDraft.map((s) => <Link key={s.id} href={`/candidates/${s.id}`} className="mr-2 text-accent hover:underline">{s.name}</Link>)}
        </div>
      )}

      {msg && <div className={`rounded-md px-3 py-2 text-[13px] ${msg.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{msg.text}</div>}

      <div className="card divide-y divide-line-2">
        {list.map((d) => {
          const st = stateOf(d);
          return (
            <div key={d.id}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-[180px] flex-1">
                  <Link href={`/candidates/${d.candidate_id}`} className="font-medium hover:underline">{d.name}</Link>
                  <span className="ml-2 text-xs text-ink-3">{d.role} · {d.to ?? "no email address on file"}</span>
                  <div className="truncate text-xs text-ink-2">{d.subject}</div>
                </div>
                <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${TONE[st]}`}>{st}</span>
                {d.sent_at && <span className="text-[11px] tabular-nums text-ink-3">{new Date(d.sent_at).toLocaleString()}</span>}
                <button className="btn btn-sm" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Close" : "Read"}</button>
                {(st === "ready" || st === "failed") && (
                  <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => send([d.id])}>
                    {busy === d.id ? "Sending…" : st === "failed" ? "Retry send" : "Send"}
                  </button>
                )}
              </div>
              {open === d.id && <div className="border-t border-line-2 bg-canvas/50 px-4 py-3"><EmailEditor draft={d} to={d.to} /></div>}
            </div>
          );
        })}
        {!list.length && <div className="px-4 py-8 text-center text-[13px] text-ink-3">No {tab} emails.</div>}
      </div>

      {ready.length > 1 && (
        <div className="card sticky bottom-4 flex flex-wrap items-center gap-3 px-4 py-3 shadow-sm">
          <span className="text-[13px]">{ready.length} {tab} emails ready</span>
          <button className="btn btn-primary ml-auto" disabled={!!busy} onClick={() => setConfirming(true)}>
            Send all {ready.length}
          </button>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal>
          <div className="card w-full max-w-lg p-5 shadow-lg">
            <h2 className="text-[15px] font-semibold">Send {ready.length} {tab} emails?</h2>
            <p className="mt-1 text-[13px] text-ink-2">Each person gets their own email. Sent emails can't be recalled.</p>
            <ul className="my-3 max-h-56 divide-y divide-line-2 overflow-y-auto rounded-md border border-line">
              {ready.map((d) => (
                <li key={d.id} className="px-3 py-1.5 text-[13px]"><b>{d.name}</b> <span className="text-ink-3">· {d.to}</span></li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => send(ready.map((r) => r.id))}>{busy ? "Sending…" : `Send ${ready.length}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
