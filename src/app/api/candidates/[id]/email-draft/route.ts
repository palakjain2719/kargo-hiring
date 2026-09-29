import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { buildEmailDraft } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/** (Re)generate the offer or rejection draft that matches the candidate's current decision. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const c = await getRepo().getCandidate(id);
  if (!c) return fail("Candidate not found", 404);
  if (c.workflow_status === "selected") return ok(await buildEmailDraft(id, "offer"));
  if (c.workflow_status === "rejected") return ok(await buildEmailDraft(id, "rejection"));
  return fail("Emails are drafted only for selected or rejected candidates");
});
