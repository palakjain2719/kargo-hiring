import { Resend } from "resend";
import { getRepo } from "../db";
import type { EmailDraft } from "../types";

export function sendingEnabled() {
  return process.env.EMAIL_SENDING_ENABLED === "true" && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/** Bracketed placeholders like [Start date] that Arjun must fill in before approval. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z][A-Za-z ]{2,40}\]|\{\{[a-z_]+\}\}/g) ?? [])];
}

export interface SendResult {
  draftId: string;
  ok: boolean;
  dryRun: boolean;
  error?: string;
}

/**
 * Sends ONE draft. Only called from /api/emails/send, i.e. when the founder clicks Send.
 * With sending disabled it validates everything and records a dry run, but never sends.
 */
export async function sendDraft(draft: EmailDraft): Promise<SendResult> {
  const repo = getRepo();
  const c = await repo.getCandidate(draft.candidate_id);
  const fail = async (error: string, markFailed = true): Promise<SendResult> => {
    if (markFailed) await repo.updateEmailDraft(draft.id, { status: "failed", error });
    await repo.addAudit({ candidate_id: draft.candidate_id, action: "email_send_failed", actor: "system", details: { draft_id: draft.id, error } });
    return { draftId: draft.id, ok: false, dryRun: false, error };
  };

  if (draft.status === "sent") return fail("Already sent", false);
  if (!c) return fail("Candidate not found");
  const expected = draft.email_type === "offer" ? "selected" : "rejected";
  if (c.workflow_status !== expected) return fail(`Candidate is no longer ${expected}`, false);
  if (!c.private_email) return fail("No email address on file for this candidate", false);
  const left = unresolvedPlaceholders(`${draft.subject}\n${draft.body}`);
  if (left.length) return fail(`Unfilled placeholders: ${left.join(", ")}`, false);

  const to = process.env.EMAIL_TEST_RECIPIENT || c.private_email;

  if (!sendingEnabled()) {
    await repo.addAudit({
      candidate_id: c.id,
      action: "email_dry_run",
      actor: "founder",
      details: { draft_id: draft.id, type: draft.email_type, note: "EMAIL_SENDING_ENABLED is not true; nothing sent" },
    });
    return { draftId: draft.id, ok: true, dryRun: true };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
      {
        from: process.env.EMAIL_FROM!,
        to: [to],
        replyTo: process.env.EMAIL_REPLY_TO || undefined,
        subject: draft.subject,
        text: draft.body,
      },
      { idempotencyKey: `kargo-draft-${draft.id}-${draft.updated_at}` },
    );
    if (error) return fail(`Resend: ${error.message}`);
    await repo.updateEmailDraft(draft.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      error: null,
      provider_message_id: data?.id ?? null,
    });
    await repo.addAudit({
      candidate_id: c.id,
      action: "email_sent",
      actor: "founder",
      details: { draft_id: draft.id, type: draft.email_type, test_recipient: !!process.env.EMAIL_TEST_RECIPIENT },
    });
    return { draftId: draft.id, ok: true, dryRun: false };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
