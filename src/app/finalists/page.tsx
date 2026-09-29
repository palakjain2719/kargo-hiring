import { FinalistSelector } from "@/components/FinalistSelector";
import { PageHeader } from "@/components/ui";
import { loadAll } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function FinalistsPage() {
  const { rows, assessmentMap, settings } = await loadAll();
  const finalists = rows
    .filter((r) => r.workflow_status === "finalist")
    .sort((a, b) => a.applied_role.localeCompare(b.applied_role) || (b.applied ?? 0) - (a.applied ?? 0))
    .map((r) => ({
      id: r.id,
      name: r.name,
      role: r.applied_role,
      score: r.applied,
      strength: r.top_strengths[0]?.criterion_name ?? null,
      concern: r.top_gaps[0]?.criterion_name ?? null,
      probe: assessmentMap.get(r.id)?.biggest_probe_area ?? null,
      rank: r.rank,
      auto: !r.decided_by_founder,
    }));
  const selected = rows.filter((r) => r.workflow_status === "selected");

  return (
    <>
      <PageHeader
        title="Finalists"
        sub={`The top ${settings.finalist_count} per role (by rubric score, minimum ${settings.min_recommend_score}/100) are made finalists automatically, each with an interview brief. Choose who gets an offer; their offer email is then written and ready to send.`}
      />
      <FinalistSelector finalistCount={settings.finalist_count} finalists={finalists} alreadySelected={selected.map((s) => ({ id: s.id, name: s.name, role: s.applied_role, status: s.status_label }))} />
    </>
  );
}
