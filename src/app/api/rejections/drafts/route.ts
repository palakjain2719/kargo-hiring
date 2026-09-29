import { getRepo } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { buildEmailDraft } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Prepare an individual rejection DRAFT for every rejected candidate who doesn't have one. Nothing is sent. */
export const POST = handle(async () => {
  const repo = getRepo();
  const [candidates, drafts] = await Promise.all([repo.listCandidates(), repo.listEmailDrafts()]);
  const has = new Set(drafts.filter((d) => d.email_type === "rejection").map((d) => d.candidate_id));
  const todo = candidates.filter((c) => c.workflow_status === "rejected" && !has.has(c.id));
  const results: { id: string; ok: boolean; error?: string }[] = [];
  // Small concurrency so 60+ drafts finish without hammering the model.
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (c) => {
        try {
          await buildEmailDraft(c.id, "rejection");
          results.push({ id: c.id, ok: true });
        } catch (e) {
          results.push({ id: c.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }
  return ok({ prepared: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
});
