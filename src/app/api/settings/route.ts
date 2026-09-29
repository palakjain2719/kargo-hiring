import { getRepo } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import type { Settings } from "@/lib/types";

export const GET = handle(async () => ok(await getRepo().getSettings()));

export const PUT = handle(async (req: Request) => {
  const b = (await req.json()) as Partial<Settings>;
  const repo = getRepo();
  const cur = await repo.getSettings();
  const next: Settings = {
    shortlist_size: { ...cur.shortlist_size, ...(b.shortlist_size ?? {}) },
    min_recommend_score: b.min_recommend_score ?? cur.min_recommend_score,
  };
  const sizes = Object.values(next.shortlist_size);
  if (sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) return fail("Shortlist size must be 1–100");
  if (next.min_recommend_score < 0 || next.min_recommend_score > 100) return fail("Minimum score must be 0–100");
  await repo.saveSettings(next);
  await repo.addAudit({ candidate_id: null, action: "settings_changed", actor: "founder", details: { ...next } });
  return ok(next);
});
