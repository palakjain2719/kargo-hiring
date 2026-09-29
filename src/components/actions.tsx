"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** A button that calls an API route, then refreshes server data. Optional confirm prompt. */
export function ActionButton({
  url, method = "POST", body, label, busyLabel, className = "btn", confirm,
}: {
  url: string; method?: string; body?: unknown; label: string; busyLabel?: string; className?: string; confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          try {
            const data = await call(url, method, body);
            if (data?.brief_error) setErr(`Status updated, but the interview brief failed: ${data.brief_error}`);
            start(() => router.refresh());
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? busyLabel ?? "Working…" : label}
      </button>
      {err && <span className="mt-1 max-w-xs text-xs text-bad">{err}</span>}
    </span>
  );
}

export function EmailEditor({
  draft, to,
}: {
  draft: { id: string; subject: string; body: string; status: string; edited_by_founder: boolean; sent_at: string | null; error: string | null; email_type: string };
  to: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = subject !== draft.subject || body !== draft.body;
  const sent = draft.status === "sent";

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      if (dirty) await call(`/api/emails/${draft.id}`, "PATCH", { subject, body });
      const r = await call("/api/emails/send", "POST", { ids: [draft.id], confirmation: "CONFIRM_SEND" });
      const res = r.results[0];
      if (!res.ok) throw new Error(res.error);
      setMsg({ ok: true, text: res.dryRun ? "Dry run: sending is switched off, so nothing was delivered." : `Sent to ${to}.` });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-ink-3">To: {to ?? <span className="text-bad">no email address on file</span>}</div>
      {editing && !sent ? (
        <>
          <input className="input w-full font-medium" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          <textarea className="input min-h-[220px] w-full font-mono text-[12.5px] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body" />
        </>
      ) : (
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="mb-2 font-medium">{subject}</div>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">{body}</pre>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!sent && (
          <>
            <button className="btn btn-primary" disabled={busy || !to} onClick={send} title={to ? "" : "No email address on file"}>
              {busy ? "Sending…" : "Send"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit (optional)"}</button>
          </>
        )}
        <span className="text-xs text-ink-3">
          Status: <b className="capitalize text-ink-2">{sent ? "sent" : draft.status === "failed" ? "failed" : "ready to send"}</b>
          {draft.edited_by_founder && " · edited by you"}
          {draft.sent_at && ` · ${new Date(draft.sent_at).toLocaleString()}`}
        </span>
      </div>
      {draft.error && !msg && <div className="text-xs text-bad">Last error: {draft.error}</div>}
      {msg && <div className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</div>}
    </div>
  );
}

export function PiiEditor({ id, name, email, phone }: { id: string; name: string | null; email: string | null; phone: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: name ?? "", email: email ?? "", phone: phone ?? "" });
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return (
      <button className="text-xs text-accent hover:underline" onClick={() => setOpen(true)}>
        Edit private details
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {(["name", "email", "phone"] as const).map((k) => (
        <label key={k} className="flex flex-col gap-0.5">
          <span className="label">{k}</span>
          <input className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </label>
      ))}
      <button
        className="btn btn-primary"
        onClick={async () => {
          try {
            const r = await call(`/api/candidates/${id}/pii`, "PATCH", v);
            setOpen(false);
            if (r.requeued) alert("The corrected details were found in the CV text and redacted. This candidate has been re-queued for scoring.");
            router.refresh();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Save
      </button>
      <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}

export { call };
