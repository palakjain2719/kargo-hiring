import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";

/** Founder edits a draft. Editing an approved draft returns it to draft so it must be re-approved. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { subject, body } = (await req.json()) as { subject?: string; body?: string };
  const repo = getRepo();
  const d = await repo.getEmailDraft(id);
  if (!d) return fail("Draft not found", 404);
  if (d.status === "sent") return fail("Sent emails can't be edited");
  if (subject !== undefined && !subject.trim()) return fail("Subject can't be empty");
  if (body !== undefined && body.trim().length < 20) return fail("Body is too short");
  const updated = await repo.updateEmailDraft(id, {
    subject: subject ?? d.subject,
    body: body ?? d.body,
    edited_by_founder: true,
    status: "draft",
    approved_at: null,
    error: null,
  });
  await repo.addAudit({ candidate_id: d.candidate_id, action: "email_edited", actor: "founder", details: { draft_id: id } });
  return ok(updated);
});
