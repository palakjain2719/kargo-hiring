import { EmailQueue } from "@/components/EmailQueue";
import { PageHeader } from "@/components/ui";
import { sendingEnabled } from "@/lib/email/send";
import { loadAll } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const { rows, candidates, drafts } = await loadAll();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const items = drafts
    .filter((d) => {
      const c = byId.get(d.candidate_id);
      // Only drafts matching the candidate's current decision (e.g. not an offer for someone later un-selected).
      return c && (d.email_type === "offer" ? c.workflow_status === "selected" : c.workflow_status === "rejected");
    })
    .map((d) => ({
      ...d,
      name: rowById.get(d.candidate_id)!.name,
      role: byId.get(d.candidate_id)!.applied_role,
      to: byId.get(d.candidate_id)!.private_email,
    }));
  const rejectedWithoutDraft = candidates.filter(
    (c) => c.workflow_status === "rejected" && !drafts.some((d) => d.candidate_id === c.id && d.email_type === "rejection"),
  ).length;
  const selectedWithoutDraft = candidates.filter(
    (c) => c.workflow_status === "selected" && !drafts.some((d) => d.candidate_id === c.id && d.email_type === "offer"),
  );

  return (
    <>
      <PageHeader
        title="Communications"
        sub="Every candidate gets their own email, written and ready. Click Send and it goes."
      />
      <EmailQueue
        tab={tab === "rejection" ? "rejection" : "offer"}
        items={items}
        rejectedWithoutDraft={rejectedWithoutDraft}
        selectedWithoutDraft={selectedWithoutDraft.map((c) => ({ id: c.id, name: rowById.get(c.id)!.name }))}
        live={sendingEnabled()}
        testRecipient={!!process.env.EMAIL_TEST_RECIPIENT}
      />
    </>
  );
}
