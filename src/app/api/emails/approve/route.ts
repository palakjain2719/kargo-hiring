import { getRepo } from "@/lib/db";
import { unresolvedPlaceholders } from "@/lib/email/send";
import { fail, handle, ok } from "@/lib/http";

/** Approve (or un-approve) drafts. Approval is required before sending but does not send. */
export const POST = handle(async (req: Request) => {
  const { ids, approve = true } = (await req.json()) as { ids: string[]; approve?: boolean };
  if (!Array.isArray(ids) || !ids.length) return fail("No drafts given");
  const repo = getRepo();
  const results = [];
  for (const id of ids) {
    const d = await repo.getEmailDraft(id);
    if (!d || d.status === "sent") { results.push({ id, ok: false, error: "Not found or already sent" }); continue; }
    if (approve) {
      const left = unresolvedPlaceholders(`${d.subject}\n${d.body}`);
      if (left.length) { results.push({ id, ok: false, error: `Fill in ${left.join(", ")} first` }); continue; }
    }
    await repo.updateEmailDraft(id, approve ? { status: "approved", approved_at: new Date().toISOString(), error: null } : { status: "draft", approved_at: null });
    await repo.addAudit({ candidate_id: d.candidate_id, action: approve ? "email_approved" : "email_unapproved", actor: "founder", details: { draft_id: id } });
    results.push({ id, ok: true });
  }
  return ok({ results });
});
