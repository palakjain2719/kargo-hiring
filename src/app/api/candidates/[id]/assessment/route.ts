import { handle, ok } from "@/lib/http";
import { buildAssessment } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return ok(await buildAssessment(id));
});
