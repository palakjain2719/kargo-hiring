import Link from "next/link";
import { CandidateTable } from "@/components/CandidateTable";
import { Empty, PageHeader, Stat } from "@/components/ui";
import { loadAll } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { rows, criteria } = await loadAll();
  const by = (s: string) => rows.filter((r) => r.workflow_status === s).length;
  const processing = rows.filter((r) => r.processing_status !== "completed").length;

  return (
    <>
      <PageHeader
        title="Kargo Hiring Dashboard"
        sub="AI ranks and explains against the Kargo rubric. You make every decision."
        actions={
          <Link href="/upload" className="btn btn-primary">
            Upload CVs
          </Link>
        }
      />
      {!criteria.length && (
        <div className="card mb-4 border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          The rubric has not been seeded. Run <code>npm run seed:rubric</code>. Scoring is blocked until then.
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Applications" value={rows.length} />
        <Stat label="PM candidates" value={rows.filter((r) => r.applied_role === "PM").length} href="/shortlist/PM" />
        <Stat label="SPM candidates" value={rows.filter((r) => r.applied_role === "SPM").length} href="/shortlist/SPM" />
        <Stat label="Awaiting review" value={by("analysed")} />
        <Stat label="Shortlisted" value={by("shortlisted")} />
        <Stat label="Finalists" value={by("finalist")} href="/finalists" />
        <Stat label="Selected" value={by("selected")} href="/communications" />
        <Stat label="Rejected" value={by("rejected")} href="/communications" />
      </div>
      {processing > 0 && (
        <Link href="/upload" className="card mb-4 flex items-center justify-between px-4 py-2.5 text-[13px] hover:border-accent/40">
          <span>{processing} CV{processing === 1 ? "" : "s"} still processing or failed</span>
          <span className="text-accent">View processing →</span>
        </Link>
      )}
      {rows.length ? <CandidateTable rows={rows} /> : <Empty>No candidates yet. Upload a batch of CVs to begin.</Empty>}
    </>
  );
}
