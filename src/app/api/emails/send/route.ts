import { getRepo } from "@/lib/db";
import { sendApprovedDraft, sendingEnabled } from "@/lib/email/send";
import { fail, handle, ok } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The ONLY route that sends email. Requires the founder's explicit confirmation token,
 * and only sends drafts already approved. With EMAIL_SENDING_ENABLED != "true" it is a dry run.
 */
export const POST = handle(async (req: Request) => {
  const { ids, confirmation } = (await req.json()) as { ids: string[]; confirmation: string };
  if (confirmation !== "CONFIRM_SEND") return fail("Sending requires explicit confirmation");
  if (!Array.isArray(ids) || !ids.length) return fail("No drafts given");
  const repo = getRepo();
  const results = [];
  for (const id of ids) {
    const d = await repo.getEmailDraft(id);
    if (!d) { results.push({ draftId: id, ok: false, dryRun: false, error: "Not found" }); continue; }
    results.push(await sendApprovedDraft(d));
  }
  return ok({ sending_enabled: sendingEnabled(), results });
});
