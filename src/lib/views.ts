import { getRepo } from "./db";
import { rank } from "./scoring";
import type { Candidate, CandidateAssessment, CandidateScore, CriterionScore, EmailDraft, Role, Settings } from "./types";
import { ROLES } from "./types";
import { displayStatus } from "./workflow";

export type Recommendation = "Recommend shortlist" | "Borderline" | "Below shortlist" | "—";

export interface CandidateRow {
  id: string;
  name: string;
  applied_role: Role;
  file: string;
  created_at: string;
  processing_status: Candidate["processing_status"];
  processing_error: string | null;
  workflow_status: Candidate["workflow_status"];
  status_label: string;
  pm: number | null;
  spm: number | null;
  applied: number | null;
  rank: number | null; // within applied role
  recommendation: Recommendation;
  top_strengths: CriterionScore[];
  top_gaps: CriterionScore[];
  has_assessment: boolean;
  drafts: EmailDraft[];
}

export function strengthsOf(s: CandidateScore | undefined, n = 2) {
  if (!s) return [];
  return [...s.criterion_scores].filter((c) => c.score >= 3).sort((a, b) => b.weighted_contribution - a.weighted_contribution).slice(0, n);
}
export function gapsOf(s: CandidateScore | undefined, n = 2) {
  if (!s) return [];
  // Weakest relative to weight: points lost on each criterion.
  return [...s.criterion_scores]
    .filter((c) => c.score <= 2)
    .sort((a, b) => b.weight - b.weighted_contribution - (a.weight - a.weighted_contribution))
    .slice(0, n);
}

export function candidateName(c: Pick<Candidate, "private_name" | "original_file_name">) {
  return c.private_name ?? `Unnamed (${c.original_file_name})`;
}

/**
 * Recommendation is advisory only and fully deterministic: top N by applied-role score
 * within the role (N = configurable shortlist size), above the configurable minimum.
 */
function recommend(r: number | null, score: number | null, role: Role, settings: Settings): Recommendation {
  if (r == null || score == null) return "—";
  const n = settings.shortlist_size[role];
  if (score < settings.min_recommend_score) return "Below shortlist";
  if (r <= n) return "Recommend shortlist";
  if (r <= n * 2) return "Borderline";
  return "Below shortlist";
}

export async function loadAll() {
  const repo = getRepo();
  const [candidates, scores, assessments, drafts, settings, criteria] = await Promise.all([
    repo.listCandidates(),
    repo.listScores(),
    repo.listAssessments(),
    repo.listEmailDrafts(),
    repo.getSettings(),
    repo.listCriteria(),
  ]);
  const scoreMap = new Map<string, Partial<Record<Role, CandidateScore>>>();
  for (const s of scores) scoreMap.set(s.candidate_id, { ...scoreMap.get(s.candidate_id), [s.role]: s });
  const assessmentMap = new Map<string, CandidateAssessment>(assessments.map((a) => [a.candidate_id, a]));

  const ranks = new Map<string, number>();
  for (const role of ROLES) {
    const pool = candidates.filter((c) => c.applied_role === role && scoreMap.get(c.id)?.[role]);
    const r = rank(pool, (c) => scoreMap.get(c.id)![role]!.overall_score);
    for (const [c, v] of r) ranks.set(c.id, v);
  }

  const rows: CandidateRow[] = candidates.map((c) => {
    const s = scoreMap.get(c.id) ?? {};
    const applied = s[c.applied_role]?.overall_score ?? null;
    const r = ranks.get(c.id) ?? null;
    const cd = drafts.filter((d) => d.candidate_id === c.id);
    const relevant = cd.find((d) => d.email_type === (c.workflow_status === "selected" ? "offer" : "rejection"));
    return {
      id: c.id,
      name: candidateName(c),
      applied_role: c.applied_role,
      file: c.original_file_name,
      created_at: c.created_at,
      processing_status: c.processing_status,
      processing_error: c.processing_error,
      workflow_status: c.workflow_status,
      status_label: c.processing_status === "failed" ? "Failed" : displayStatus(c.workflow_status, relevant),
      pm: s.PM?.overall_score ?? null,
      spm: s.SPM?.overall_score ?? null,
      applied,
      rank: r,
      recommendation: recommend(r, applied, c.applied_role, settings),
      top_strengths: strengthsOf(s[c.applied_role]),
      top_gaps: gapsOf(s[c.applied_role]),
      has_assessment: assessmentMap.has(c.id),
      drafts: cd,
    };
  });

  return { rows, candidates, scoreMap, assessmentMap, drafts, settings, criteria };
}

export async function loadCandidate(id: string) {
  const repo = getRepo();
  const c = await repo.getCandidate(id);
  if (!c) return null;
  const all = await loadAll();
  const row = all.rows.find((r) => r.id === id)!;
  const [assessment, audit] = await Promise.all([repo.getAssessment(id), repo.listAudit(id)]);
  const poolSize = all.rows.filter((r) => r.applied_role === c.applied_role && r.applied != null).length;
  return {
    candidate: c,
    row,
    scores: all.scoreMap.get(id) ?? {},
    assessment,
    drafts: all.drafts.filter((d) => d.candidate_id === id),
    audit,
    poolSize,
    settings: all.settings,
  };
}
