import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { extractText, ParseError } from "@/lib/parse-file";
import { extractPii } from "@/lib/pii";

export const runtime = "nodejs";

/** Replace the file for a candidate whose upload could not be read, then re-queue it. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const repo = getRepo();
  const c = await repo.getCandidate(id);
  if (!c) return fail("Candidate not found", 404);
  if (c.processing_status !== "failed") return fail("Only failed candidates can have their file replaced");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return fail("No file");
  try {
    const text = await extractText(file.name, new Uint8Array(await file.arrayBuffer()));
    const pii = extractPii(text);
    await repo.updateCandidate(id, {
      original_file_name: file.name,
      private_name: pii.name,
      private_email: pii.email,
      private_phone: pii.phone,
      anonymised_cv_content: pii.anonymised,
      redaction_summary: pii.redactions,
      processing_status: "queued",
      processing_error: null,
    });
    await repo.addAudit({ candidate_id: id, action: "file_replaced", actor: "founder", details: { file: file.name } });
    return ok({ queued: true });
  } catch (e) {
    if (e instanceof ParseError) return fail(e.message);
    throw e;
  }
});
