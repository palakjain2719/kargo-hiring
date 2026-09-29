import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, EmailEditor, PiiEditor } from "@/components/actions";
import { Pips, RecBadge, Score, StatusBadge } from "@/components/ui";
import { SCORE_SCALE } from "@/lib/scoring";
import { ROLE_LABEL, type CandidateScore, type Role } from "@/lib/types";
import { gapsOf, loadCandidate, strengthsOf } from "@/lib/views";
import { ACTION_LABEL, MANUAL_TRANSITIONS } from "@/lib/workflow";

export const dynamic = "force-dynamic";

function Section({ n, title, children, aside }: { n: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-canvas text-[11px] font-semibold text-ink-2">{n}</span>
        <h2 className="h-section">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Breakdown({ score, role }: { score: CandidateScore | undefined; role: Role }) {
  if (!score) return <p className="text-[13px] text-ink-3">Not scored against the {role} rubric yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr>
            <th className="th w-[22%]">Criterion</th>
            <th className="th text-right">Weight</th>
            <th className="th">Score</th>
            <th className="th text-right">Weighted</th>
            <th className="th w-[30%]">AI reasoning</th>
            <th className="th w-[30%]">Evidence from CV</th>
          </tr>
        </thead>
        <tbody>
          {score.criterion_scores.map((c) => (
            <tr key={c.criterion_id}>
              <td className="td font-medium">{c.criterion_name}</td>
              <td className="td text-right tabular-nums">{c.weight}%</td>
              <td className="td whitespace-nowrap">
                <Pips score={c.score} /> <span className="ml-1 text-xs tabular-nums text-ink-2">{c.score}/5</span>
              </td>
              <td className="td text-right tabular-nums">
                {c.weighted_contribution.toFixed(1)}
                <span className="text-ink-3">/{c.weight}</span>
              </td>
              <td className="td text-[13px] text-ink-2">{c.reasoning}</td>
              <td className="td text-[13px]">
                {c.evidence.length ? (
                  <ul className="space-y-1">
                    {c.evidence.map((e, i) => (
                      <li key={i} className="border-l-2 border-accent/30 pl-2 text-ink-2">“{e}”</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-ink-3">Evidence not present in the CV.</span>
                )}
                {c.discarded_quotes > 0 && (
                  <div className="mt-1 text-[11px] text-warn">{c.discarded_quotes} AI quote(s) discarded: not found verbatim in CV</div>
                )}
              </td>
            </tr>
          ))}
          <tr>
            <td className="td font-semibold">Total</td>
            <td className="td text-right tabular-nums">100%</td>
            <td className="td" />
            <td className="td text-right"><Score value={score.overall_score} /></td>
            <td className="td text-[13px] text-ink-2" colSpan={2}>{score.generated_reasoning}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function CandidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rubric?: string }> }) {
  const { id } = await params;
  const { rubric } = await searchParams;
  const data = await loadCandidate(id);
  if (!data) notFound();
  const { candidate: c, row, scores, assessment, drafts, audit, poolSize } = data;
  const applied = scores[c.applied_role];
  const other: Role = c.applied_role === "PM" ? "SPM" : "PM";
  const shownRole: Role = rubric === other ? other : c.applied_role;
  const strengths = strengthsOf(applied, 3);
  const gaps = gapsOf(applied, 3);
  const inPipeline = ["shortlisted", "finalist", "selected"].includes(c.workflow_status);
  const draft = drafts.find((d) => d.email_type === (c.workflow_status === "selected" ? "offer" : "rejection"));
  const analysed = c.processing_status === "completed";

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-3">
        <Link href="/" className="hover:underline">Dashboard</Link> / Candidate
      </div>

      {/* Header: the decision at a glance */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-[240px] flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{row.name}</h1>
            <div className="mt-0.5 text-[13px] text-ink-2">
              Applied for <b>{ROLE_LABEL[c.applied_role]}</b> · {c.original_file_name}
            </div>
            <div className="mt-1 text-xs text-ink-3">
              Private: {c.private_email ?? "no email found"} · {c.private_phone ?? "no phone found"}
            </div>
            <PiiEditor id={c.id} name={c.private_name} email={c.private_email} phone={c.private_phone} />
          </div>
          <div className="flex gap-6">
            <div><div className="label">Applied-role score</div><Score value={row.applied} size="lg" />{row.rank && <div className="text-xs text-ink-3">#{row.rank} of {poolSize} {c.applied_role} applicants</div>}</div>
            <div><div className="label">PM score</div><Score value={row.pm} size="lg" /></div>
            <div><div className="label">SPM score</div><Score value={row.spm} size="lg" /></div>
          </div>
          <div className="space-y-1.5">
            <div className="label">Current status</div>
            <StatusBadge label={row.status_label} />
            <div><RecBadge rec={row.recommendation} /> <span className="text-[11px] text-ink-3">(AI suggestion)</span></div>
          </div>
        </div>
        {analysed && (
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line-2 pt-3">
            <span className="label mr-1 mt-2">Your decision</span>
            {MANUAL_TRANSITIONS[c.workflow_status].map((to) => (
              <ActionButton
                key={to}
                url={`/api/candidates/${c.id}/status`}
                body={{ to }}
                label={ACTION_LABEL[to] ?? to}
                busyLabel={to === "shortlisted" ? "Shortlisting & writing brief…" : undefined}
                className={to === "rejected" ? "btn btn-danger" : to === "shortlisted" || to === "finalist" ? "btn btn-primary" : "btn"}
                confirm={to === "rejected" ? `Reject ${row.name}? A rejection draft can then be prepared. Nothing is sent without your approval.` : undefined}
              />
            ))}
            {c.workflow_status === "finalist" && (
              <Link href="/finalists" className="btn">Select for offer on Finalists page →</Link>
            )}
          </div>
        )}
        {c.processing_status !== "completed" && (
          <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-[13px] text-ink-2">
            Processing status: <b>{c.processing_status}</b>
            {c.processing_error && <span className="text-bad"> · {c.processing_error}</span>}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section n={1} title="Why they fit">
          {strengths.length ? (
            <ul className="space-y-2.5">
              {strengths.map((s) => (
                <li key={s.criterion_id}>
                  <div className="flex items-center gap-2 text-[13px] font-medium"><Pips score={s.score} /> {s.criterion_name} <span className="text-xs font-normal text-ink-3">{s.weight}%</span></div>
                  <p className="mt-0.5 text-[13px] text-ink-2">{s.reasoning}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">No criterion reached a clear-evidence score (3/5 or higher) on the {c.applied_role} rubric.</p>
          )}
        </Section>
        <Section n={2} title="Where they fall short">
          {gaps.length ? (
            <ul className="space-y-2.5">
              {gaps.map((s) => (
                <li key={s.criterion_id}>
                  <div className="flex items-center gap-2 text-[13px] font-medium"><Pips score={s.score} /> {s.criterion_name} <span className="text-xs font-normal text-ink-3">−{(s.weight - s.weighted_contribution).toFixed(0)} pts</span></div>
                  <p className="mt-0.5 text-[13px] text-ink-2">{s.reasoning}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">No criterion scored 2/5 or below.</p>
          )}
        </Section>
      </div>

      <Section
        n={3}
        title={`Rubric breakdown: ${shownRole}`}
        aside={
          <div className="flex gap-1">
            {([c.applied_role, other] as Role[]).map((r) => (
              <Link key={r} href={`?rubric=${r}`} className={`btn btn-sm ${shownRole === r ? "border-accent text-accent" : ""}`}>
                {r}{r === c.applied_role ? " (applied)" : ""}
              </Link>
            ))}
          </div>
        }
      >
        <Breakdown score={scores[shownRole]} role={shownRole} />
        <details className="mt-3 text-xs text-ink-3">
          <summary className="cursor-pointer">Scoring scale</summary>
          <ul className="mt-1 space-y-0.5">{SCORE_SCALE.map((s) => <li key={s.score}><b>{s.score}</b>: {s.label}</li>)}</ul>
          <p className="mt-1">Weighted contribution = score ÷ 5 × weight. Every quote is checked against the CV text; if none can be verified, the score is capped at 1.</p>
        </details>
      </Section>

      <Section n={4} title="Evidence">
        {applied ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="label mb-1.5">Verified CV quotes used ({c.applied_role} rubric)</div>
              <ul className="space-y-1.5 text-[13px]">
                {applied.criterion_scores.flatMap((cs) => cs.evidence.map((e, i) => (
                  <li key={`${cs.criterion_id}-${i}`} className="border-l-2 border-accent/30 pl-2">
                    “{e}” <span className="text-[11px] text-ink-3">· {cs.criterion_name}</span>
                  </li>
                )))}
                {applied.criterion_scores.every((cs) => !cs.evidence.length) && <li className="text-ink-3">No verifiable evidence was found.</li>}
              </ul>
            </div>
            <div>
              {c.profile?.notable_outcomes?.length ? (
                <>
                  <div className="label mb-1.5">Outcomes stated in the CV</div>
                  <ul className="mb-3 list-disc space-y-1 pl-4 text-[13px] text-ink-2">{c.profile.notable_outcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
                </>
              ) : null}
              <details>
                <summary className="label cursor-pointer">Anonymised CV (exactly what the AI saw)</summary>
                <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-[12px] text-ink-2">{c.anonymised_cv_content}</pre>
                <div className="mt-1 text-[11px] text-ink-3">
                  Redacted: {Object.entries(c.redaction_summary).map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(", ") || "nothing"}
                </div>
              </details>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">Available after analysis.</p>
        )}
      </Section>

      <Section
        n={5}
        title="Interview brief"
        aside={analysed && (inPipeline || assessment) ? (
          <ActionButton url={`/api/candidates/${c.id}/assessment`} label={assessment ? "Regenerate" : "Generate brief"} busyLabel="Writing brief…" className="btn btn-sm" />
        ) : null}
      >
        {assessment ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 text-[13px]">
              <p>{assessment.interview_brief}</p>
              <div><div className="label">Strongest evidence</div><p className="text-ink-2">{assessment.strongest_evidence}</p></div>
              <div><div className="label">Biggest area to probe</div><p className="text-ink-2">{assessment.biggest_probe_area}</p></div>
              <div><div className="label">Important uncertainty</div><p className="text-ink-2">{assessment.key_uncertainty}</p></div>
              {assessment.risks.length > 0 && (
                <div><div className="label">Risks</div><ul className="list-disc pl-4 text-ink-2">{assessment.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              )}
            </div>
            <div>
              <div className="label mb-1.5">Suggested interview questions</div>
              <ol className="list-decimal space-y-2 pl-4 text-[13px]">
                {assessment.interview_questions.map((q, i) => (
                  <li key={i}>{q.question}<div className="text-xs text-ink-3">{q.why}</div></li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            {inPipeline ? "No brief yet. Generate one above." : "Briefs are written when you shortlist a candidate."}
          </p>
        )}
      </Section>

      <Section n={6} title="Email draft">
        {draft ? (
          <EmailEditor draft={draft} />
        ) : c.workflow_status === "selected" || c.workflow_status === "rejected" ? (
          <div className="flex items-center gap-3 text-[13px] text-ink-2">
            No {c.workflow_status === "selected" ? "offer" : "rejection"} draft yet.
            <ActionButton url={`/api/candidates/${c.id}/email-draft`} label="Draft email" busyLabel="Drafting…" className="btn btn-sm" />
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">An offer or rejection draft is prepared once you make a decision. Nothing is ever sent without your approval.</p>
        )}
      </Section>

      <details className="card p-4">
        <summary className="h-section cursor-pointer">Audit trail ({audit.length})</summary>
        <ul className="mt-3 space-y-1 text-xs text-ink-2">
          {audit.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="w-36 shrink-0 tabular-nums text-ink-3">{new Date(a.created_at).toLocaleString()}</span>
              <span className="w-16 shrink-0">{a.actor}</span>
              <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
              <span className="truncate text-ink-3">{Object.keys(a.details).length ? JSON.stringify(a.details) : ""}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
