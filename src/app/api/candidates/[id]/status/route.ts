import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { buildAssessment, buildEmailDraft } from "@/lib/pipeline";
import type { WorkflowStatus } from "@/lib/types";
import { canTransition } from "@/lib/workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Founder moves a candidate through the workflow. "selected" is only set via /api/selections/confirm. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { to } = (await req.json()) as { to: WorkflowStatus };
  const repo = getRepo();
  const c = await repo.getCandidate(id);
  if (!c) return fail("Candidate not found", 404);
  if (c.processing_status !== "completed") return fail("Candidate has not been analysed yet");
  if (!canTransition(c.workflow_status, to)) return fail(`Cannot move from ${c.workflow_status} to ${to}`);

  // Undoing a decision is blocked once the corresponding email has gone out.
  if (c.workflow_status === "selected" || c.workflow_status === "rejected") {
    const type = c.workflow_status === "selected" ? "offer" : "rejection";
    const d = await repo.getEmailDraftFor(id, type);
    if (d?.status === "sent") return fail(`The ${type} email has already been sent; this decision can't be undone here.`);
    if (d) await repo.deleteEmailDraft(d.id);
  }

  await repo.updateCandidate(id, { workflow_status: to, decided_by_founder: true });
  await repo.addAudit({ candidate_id: id, action: "status_changed", actor: "founder", details: { from: c.workflow_status, to } });

  // Shortlisting generates the interview brief (if missing). Failure here doesn't undo the move.
  let briefError: string | null = null;
  if ((to === "shortlisted" || to === "finalist") && !(await repo.getAssessment(id))) {
    try {
      await buildAssessment(id);
    } catch (e) {
      briefError = e instanceof Error ? e.message : String(e);
    }
  }
  // Rejection: prepare the individual rejection email straight away so it is ready to send.
  if (to === "rejected") {
    try {
      await buildEmailDraft(id, "rejection");
    } catch (e) {
      briefError = `Rejection email could not be drafted: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return ok({ status: to, brief_error: briefError });
});
