import { getRepo } from "@/lib/db";
import { handle, ok } from "@/lib/http";
import { candidateName } from "@/lib/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Processing status for a batch (?batch=) or for everything not yet completed. */
export const GET = handle(async (req: Request) => {
  const batch = new URL(req.url).searchParams.get("batch");
  const all = await getRepo().listCandidates();
  const rows = batch ? all.filter((c) => c.batch_id === batch) : all.filter((c) => c.processing_status !== "completed");
  const count = (s: string) => rows.filter((c) => c.processing_status === s).length;
  return ok({
    total: rows.length,
    queued: count("queued"),
    processing: count("processing"),
    completed: count("completed"),
    failed: count("failed"),
    items: rows
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({
        id: c.id,
        file: c.original_file_name,
        name: candidateName(c),
        role: c.role_source === "best_fit" && c.processing_status !== "completed" ? "Best fit" : c.applied_role,
        status: c.processing_status,
        error: c.processing_error,
        can_retry: c.processing_status === "failed" && !!c.anonymised_cv_content,
        needs_file: c.processing_status === "failed" && !c.anonymised_cv_content,
      })),
  });
});
