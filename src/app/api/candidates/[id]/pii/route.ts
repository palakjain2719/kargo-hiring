import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { redactName } from "@/lib/pii";

/**
 * Founder corrects the private details. If a corrected name still appears in the anonymised
 * text, it is redacted there too and the candidate is re-queued for scoring.
 */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; email?: string; phone?: string };
  const repo = getRepo();
  const c = await repo.getCandidate(id);
  if (!c) return fail("Candidate not found", 404);
  const name = body.name?.trim() || null;
  const email = body.email?.trim() || null;
  const phone = body.phone?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Invalid email");

  let anon = c.anonymised_cv_content ?? "";
  let requeue = false;
  if (name && anon) {
    const r = redactName(anon, name);
    if (r.count) { anon = r.text; requeue = true; }
  }
  for (const v of [email, phone]) {
    if (v && anon.includes(v)) { anon = anon.split(v).join("[REDACTED]"); requeue = true; }
  }
  await repo.updateCandidate(id, {
    private_name: name,
    private_email: email,
    private_phone: phone,
    anonymised_cv_content: anon || c.anonymised_cv_content,
    ...(requeue && c.processing_status !== "processing" ? { processing_status: "queued" as const } : {}),
  });
  await repo.addAudit({ candidate_id: id, action: "private_details_edited", actor: "founder", details: { requeued: requeue } });
  return ok({ requeued: requeue });
});
