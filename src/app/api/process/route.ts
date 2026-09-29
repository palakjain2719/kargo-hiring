import { handle, ok } from "@/lib/http";
import { processQueue } from "@/lib/pipeline";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Worker tick: claims a few queued candidates and analyses them. The processing page calls
 * this in a loop; a cron job (GET with CRON_SECRET) can do the same. Claims are atomic, so
 * concurrent callers never double-process a candidate.
 */
async function tick(req: Request) {
  const url = new URL(req.url);
  const n = Math.min(Math.max(Number(url.searchParams.get("n") ?? 3), 1), 5);
  const processed = await processQueue(n);
  const all = await getRepo().listCandidates();
  const remaining = all.filter((c) => c.processing_status === "queued").length;
  return ok({ processed, remaining });
}

export const POST = handle(tick);
export const GET = handle(tick);
