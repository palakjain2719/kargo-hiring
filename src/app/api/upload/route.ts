import { randomUUID } from "node:crypto";
import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { extractText, ParseError } from "@/lib/parse-file";
import { ingestCv, recordFailedUpload } from "@/lib/pipeline";
import { ROLES, type Role } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Accepts a chunk of CVs (the client sends large batches in several requests with one batch_id).
 * form fields: batch_id?, files[] and roles[] (same order). PII is separated here, before storage.
 */
export const POST = handle(async (req: Request) => {
  const criteria = await getRepo().listCriteria();
  if (!criteria.length) return fail("Rubric is not seeded. Run `npm run seed:rubric` first.", 409);

  const form = await req.formData();
  const batchId = (form.get("batch_id") as string) || randomUUID();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const roles = form.getAll("roles").map(String);
  if (!files.length) return fail("No files provided");
  if (roles.length !== files.length) return fail("Each file needs an applied role");
  if (!roles.every((r) => r === "AUTO" || (ROLES as readonly string[]).includes(r))) return fail("Role must be PM, SPM or AUTO");

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const role = roles[i] as Role | "AUTO";
    try {
      const text = await extractText(f.name, new Uint8Array(await f.arrayBuffer()));
      const c = await ingestCv({ batchId, role, fileName: f.name, text });
      results.push({ file: f.name, id: c.id, ok: true, name_detected: !!c.private_name });
    } catch (e) {
      const msg = e instanceof ParseError ? e.message : `Unexpected error: ${e instanceof Error ? e.message : e}`;
      const c = await recordFailedUpload({ batchId, role, fileName: f.name, error: msg });
      results.push({ file: f.name, id: c.id, ok: false, error: msg });
    }
  }
  return ok({ batch_id: batchId, results });
});
