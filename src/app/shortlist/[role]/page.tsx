import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/actions";
import { ShortlistSettings } from "@/components/ShortlistSettings";
import { Empty, PageHeader, Pips, RecBadge, Score, StatusBadge } from "@/components/ui";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/types";
import { loadAll, type CandidateRow } from "@/lib/views";

export const dynamic = "force-dynamic";

function Card({ r, brief }: { r: CandidateRow; brief?: { interview_brief: string; biggest_probe_area: string } }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-10 text-center">
          <div className="label">Rank</div>
          <div className="text-lg font-semibold tabular-nums">{r.rank}</div>
        </div>
        <div className="min-w-[200px] flex-1">
          <Link href={`/candidates/${r.id}`} className="text-[15px] font-semibold hover:underline">{r.name}</Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <StatusBadge label={r.status_label} />
            <RecBadge rec={r.recommendation} />
          </div>
        </div>
        <div className="text-right">
          <div className="label">Score</div>
          <Score value={r.applied} size="lg" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <div className="label mb-1">Why shortlisted / key strengths</div>
          {r.top_strengths.length ? r.top_strengths.map((s) => (
            <div key={s.criterion_id} className="mb-1.5 text-[13px]">
              <div className="flex items-center gap-1.5 font-medium"><Pips score={s.score} />{s.criterion_name}</div>
              <div className="text-ink-2">{s.reasoning}</div>
            </div>
          )) : <div className="text-[13px] text-ink-3">No criterion with clear evidence.</div>}
        </div>
        <div>
          <div className="label mb-1">Key concerns</div>
          {r.top_gaps.length ? r.top_gaps.map((s) => (
            <div key={s.criterion_id} className="mb-1.5 text-[13px]">
              <div className="flex items-center gap-1.5 font-medium"><Pips score={s.score} />{s.criterion_name}</div>
              <div className="text-ink-2">{s.reasoning}</div>
            </div>
          )) : <div className="text-[13px] text-ink-3">No weak criteria.</div>}
        </div>
        <div>
          <div className="label mb-1">Interview brief</div>
          {brief ? (
            <div className="space-y-1.5 text-[13px] text-ink-2">
              <p>{brief.interview_brief}</p>
              <p><b className="text-ink">Probe:</b> {brief.biggest_probe_area}</p>
              <Link href={`/candidates/${r.id}`} className="text-accent hover:underline">Questions & full brief →</Link>
            </div>
          ) : (
            <div className="text-[13px] text-ink-3">Written when you shortlist.</div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line-2 pt-3">
        {r.workflow_status === "analysed" && (
          <ActionButton url={`/api/candidates/${r.id}/status`} body={{ to: "shortlisted" }} label="Shortlist" busyLabel="Shortlisting & writing brief…" className="btn btn-primary btn-sm" />
        )}
        {r.workflow_status === "shortlisted" && (
          <ActionButton url={`/api/candidates/${r.id}/status`} body={{ to: "finalist" }} label="Move to finalist" className="btn btn-primary btn-sm" />
        )}
        {["analysed", "shortlisted", "finalist"].includes(r.workflow_status) && (
          <ActionButton url={`/api/candidates/${r.id}/status`} body={{ to: "rejected" }} label="Reject" className="btn btn-danger btn-sm" confirm={`Reject ${r.name}?`} />
        )}
        <Link href={`/candidates/${r.id}`} className="btn btn-sm">Open decision map</Link>
      </div>
    </div>
  );
}

export default async function ShortlistPage({ params }: { params: Promise<{ role: string }> }) {
  const { role: raw } = await params;
  const role = raw.toUpperCase() as Role;
  if (!ROLES.includes(role)) notFound();
  const { rows, assessmentMap, settings } = await loadAll();
  const pool = rows.filter((r) => r.applied_role === role && r.applied != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const inPipeline = pool.filter((r) => ["shortlisted", "finalist", "selected"].includes(r.workflow_status));
  const recommended = pool.filter((r) => r.recommendation === "Recommend shortlist" && r.workflow_status === "analysed");
  const rest = pool.filter((r) => !inPipeline.includes(r) && !recommended.includes(r));

  return (
    <>
      <PageHeader
        title={`${ROLE_LABEL[role]} shortlist`}
        sub={`${pool.length} analysed ${role} applicants, ranked by ${role} rubric score. The AI recommends; you decide who moves forward.`}
        actions={<ShortlistSettings role={role} size={settings.shortlist_size[role]} minScore={settings.min_recommend_score} />}
      />
      {!pool.length && <Empty>No analysed {role} candidates yet.</Empty>}

      {inPipeline.length > 0 && (
        <section className="mb-6">
          <h2 className="h-section mb-2">Shortlisted by you ({inPipeline.length})</h2>
          <div className="space-y-3">{inPipeline.map((r) => <Card key={r.id} r={r} brief={assessmentMap.get(r.id)} />)}</div>
        </section>
      )}

      {recommended.length > 0 && (
        <section className="mb-6">
          <h2 className="h-section mb-2">AI-recommended, awaiting your review ({recommended.length})</h2>
          <p className="mb-2 text-xs text-ink-3">
            Top {settings.shortlist_size[role]} by {role} score with at least {settings.min_recommend_score}/100.
          </p>
          <div className="space-y-3">{recommended.map((r) => <Card key={r.id} r={r} brief={assessmentMap.get(r.id)} />)}</div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="h-section mb-2">Other applicants ({rest.length})</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead><tr><th className="th">Rank</th><th className="th">Candidate</th><th className="th text-right">Score</th><th className="th">Main concern</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {rest.map((r) => (
                  <tr key={r.id}>
                    <td className="td tabular-nums">{r.rank}</td>
                    <td className="td font-medium">{r.name}<div className="text-xs font-normal"><RecBadge rec={r.recommendation} /></div></td>
                    <td className="td text-right"><Score value={r.applied} /></td>
                    <td className="td text-[13px] text-ink-2">{r.top_gaps[0]?.criterion_name ?? "—"}</td>
                    <td className="td"><StatusBadge label={r.status_label} /></td>
                    <td className="td text-right"><Link className="btn btn-sm" href={`/candidates/${r.id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
