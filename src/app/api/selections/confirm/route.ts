import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { buildEmailDraft } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The founder's explicit selection decision. Requires confirm: true.
 * Moves the chosen finalists to "selected" and prepares offer DRAFTS. Nothing is sent.
 */
export const POST = handle(async (req: Request) => {
  const { ids, confirm } = (await req.json()) as { ids: string[]; confirm: boolean };
  if (confirm !== true) return fail("Selections must be explicitly confirmed");
  if (!Array.isArray(ids) || !ids.length) return fail("Select at least one candidate");
  const repo = getRepo();
  const candidates = await Promise.all(ids.map((id) => repo.getCandidate(id)));
  const bad = candidates.filter((c) => !c || c.workflow_status !== "finalist");
  if (bad.length) return fail("Only finalists can be selected");

  const results = [];
  for (const c of candidates) {
    await repo.updateCandidate(c!.id, { workflow_status: "selected" });
    await repo.addAudit({ candidate_id: c!.id, action: "selected_for_offer", actor: "founder", details: { batch_size: ids.length } });
    try {
      const d = await buildEmailDraft(c!.id, "offer");
      results.push({ id: c!.id, draft_id: d.id, ok: true });
    } catch (e) {
      results.push({ id: c!.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return ok({ selected: ids.length, results });
});
