import { handle, ok } from "@/lib/http";
import { queueRetry } from "@/lib/pipeline";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await queueRetry(id);
  return ok({ queued: true });
});
