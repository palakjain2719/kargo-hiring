import { draftEmail, extractProfile, generateAssessment, scoreAgainstRubric, type PrivateIds } from "./ai";
import { getRepo } from "./db";
import { extractPii } from "./pii";
import { computeScores } from "./scoring";
import type { Candidate, CandidateScore, EmailType, Role } from "./types";
import { ROLES } from "./types";

export const piiOf = (c: Candidate): PrivateIds => ({ name: c.private_name, email: c.private_email, phone: c.private_phone });

/** Ingestion: separate PII locally, store it apart from the anonymised content, queue for AI. */
/** role "AUTO": no role given; the pipeline assigns the better-fitting role after scoring. */
export async function ingestCv(opts: { batchId: string; role: Role | "AUTO"; fileName: string; text: string }) {
  const pii = extractPii(opts.text, opts.fileName);
  const repo = getRepo();
  const c = await repo.createCandidate({
    batch_id: opts.batchId,
    applied_role: opts.role === "AUTO" ? "PM" : opts.role, // provisional until scored
    role_source: opts.role === "AUTO" ? "best_fit" : "applicant",
    original_file_name: opts.fileName,
    private_name: pii.name,
    private_email: pii.email,
    private_phone: pii.phone,
    anonymised_cv_content: pii.anonymised,
    redaction_summary: pii.redactions,
    processing_status: "queued",
    processing_error: null,
    workflow_status: "processing",
  });
  await repo.addAudit({
    candidate_id: c.id,
    action: "cv_ingested",
    actor: "system",
    details: { file: opts.fileName, role: opts.role, redactions: pii.redactions, name_detected: !!pii.name },
  });
  return c;
}

/** Records an upload that could not be parsed, so it shows as failed and can be replaced. */
export async function recordFailedUpload(opts: { batchId: string; role: Role | "AUTO"; fileName: string; error: string }) {
  const repo = getRepo();
  const c = await repo.createCandidate({
    batch_id: opts.batchId,
    applied_role: opts.role === "AUTO" ? "PM" : opts.role,
    role_source: opts.role === "AUTO" ? "best_fit" : "applicant",
    original_file_name: opts.fileName,
    private_name: null,
    private_email: null,
    private_phone: null,
    anonymised_cv_content: null,
    redaction_summary: {},
    processing_status: "failed",
    processing_error: opts.error,
    workflow_status: "processing",
  });
  await repo.addAudit({ candidate_id: c.id, action: "upload_failed", actor: "system", details: { error: opts.error } });
  return c;
}

/**
 * AI analysis for one claimed candidate. Results are validated in full before anything
 * is written; on failure the candidate is marked failed and prior data is untouched.
 */
export async function analyseCandidate(c: Candidate): Promise<void> {
  const repo = getRepo();
  try {
    const cv = c.anonymised_cv_content;
    if (!cv) throw new Error("No readable CV content. Replace the file and retry.");
    const pii = piiOf(c);
    const criteria = await repo.listCriteria();
    for (const role of ROLES) {
      if (!criteria.some((x) => x.role === role)) throw new Error(`Rubric for ${role} is not seeded`);
    }

    const [profile, ...scored] = await Promise.all([
      extractProfile(cv, pii),
      ...ROLES.map(async (role) => {
        const rc = criteria.filter((x) => x.role === role);
        const res = await scoreAgainstRubric(cv, role, rc, pii);
        const { overall, criterionScores } = computeScores(rc, res.data.criteria, cv);
        return { role, overall, criterionScores, summary: res.data.summary, model: res.model };
      }),
    ]);

    // Everything validated. Write.
    for (const s of scored) {
      await repo.upsertScore({
        candidate_id: c.id,
        role: s.role,
        overall_score: s.overall,
        criterion_scores: s.criterionScores,
        generated_reasoning: s.summary,
        model: s.model,
      });
    }
    // No role given: place the candidate where the rubric says they fit best.
    // SPM wins ties, since matching the senior rubric equally well is the stronger signal.
    let bestFit: Role | null = null;
    if (c.role_source === "best_fit") {
      const pm = scored.find((s) => s.role === "PM")!.overall;
      const spm = scored.find((s) => s.role === "SPM")!.overall;
      bestFit = spm >= pm ? "SPM" : "PM";
    }
    await repo.updateCandidate(c.id, {
      profile: profile.data,
      processing_status: "completed",
      processing_error: null,
      workflow_status: c.workflow_status === "processing" ? "analysed" : c.workflow_status,
      ...(bestFit ? { applied_role: bestFit } : {}),
    });
    if (bestFit) {
      await repo.addAudit({
        candidate_id: c.id,
        action: "role_assigned_best_fit",
        actor: "system",
        details: { role: bestFit, ...Object.fromEntries(scored.map((s) => [`${s.role}_score`, s.overall])) },
      });
    }
    await repo.addAudit({
      candidate_id: c.id,
      action: "analysis_completed",
      actor: "system",
      details: Object.fromEntries(scored.map((s) => [`${s.role}_score`, s.overall])),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pipeline] candidate ${c.id} failed: ${msg}`);
    await repo.updateCandidate(c.id, { processing_status: "failed", processing_error: msg.slice(0, 1000) });
    await repo.addAudit({ candidate_id: c.id, action: "analysis_failed", actor: "system", details: { error: msg.slice(0, 500) } });
  }
}

/** Claim up to `n` queued candidates and analyse them concurrently. Each succeeds or fails on its own. */
export async function processQueue(n = 3) {
  const claimed = await getRepo().claimCandidates(n);
  await Promise.all(claimed.map(analyseCandidate));
  return claimed.length;
}

export async function queueRetry(candidateId: string) {
  const repo = getRepo();
  const c = await repo.getCandidate(candidateId);
  if (!c) throw new Error("Candidate not found");
  if (c.processing_status !== "failed") throw new Error("Only failed candidates can be retried");
  if (!c.anonymised_cv_content) throw new Error("This file could not be read. Replace the file instead.");
  await repo.updateCandidate(candidateId, { processing_status: "queued", processing_error: null });
  await repo.addAudit({ candidate_id: candidateId, action: "retry_queued", actor: "founder", details: {} });
}

export async function scoreFor(candidateId: string, role: Role): Promise<CandidateScore | undefined> {
  return (await getRepo().listScores(candidateId)).find((s) => s.role === role);
}

export async function buildAssessment(candidateId: string) {
  const repo = getRepo();
  const c = await repo.getCandidate(candidateId);
  if (!c?.anonymised_cv_content) throw new Error("Candidate not analysed");
  const score = await scoreFor(candidateId, c.applied_role);
  if (!score) throw new Error("No score for applied role");
  const res = await generateAssessment(c.anonymised_cv_content, c.applied_role, score.overall_score, score.criterion_scores, piiOf(c));
  const a = await repo.upsertAssessment({ candidate_id: c.id, role: c.applied_role, ...res.data, model: res.model });
  await repo.addAudit({ candidate_id: c.id, action: "assessment_generated", actor: "system", details: { model: res.model } });
  return a;
}

/** Fills the real name into an AI draft server-side. The model only ever sees the placeholder. */
export function personalise(text: string, c: Candidate) {
  const first = c.private_name?.split(/\s+/)[0] ?? "there";
  return text.replaceAll("{{candidate_name}}", first);
}

export async function buildEmailDraft(candidateId: string, type: EmailType) {
  const repo = getRepo();
  const c = await repo.getCandidate(candidateId);
  if (!c) throw new Error("Candidate not found");
  const expected = type === "offer" ? "selected" : "rejected";
  if (c.workflow_status !== expected) throw new Error(`Candidate must be ${expected} to draft a ${type} email`);
  const score = await scoreFor(candidateId, c.applied_role);
  if (!score) throw new Error("No score for applied role");
  const sorted = [...score.criterion_scores].sort((a, b) => b.score - a.score || b.weight - a.weight);
  // Feedback comes only from verified, evidence-backed criterion reasoning.
  const strengths = sorted.filter((x) => x.score >= 3 && x.evidence_present).slice(0, 2).map((x) => `${x.criterion_name}: ${x.reasoning}`);
  const gaps = [...score.criterion_scores]
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .filter((x) => x.score <= 2)
    .slice(0, 2)
    .map((x) => `${x.criterion_name}: ${x.reasoning}`);
  const res = await draftEmail(type, c.applied_role, strengths, gaps, piiOf(c));
  const draft = await repo.upsertEmailDraft({
    candidate_id: c.id,
    email_type: type,
    subject: personalise(res.data.subject, c),
    body: personalise(res.data.body, c),
  });
  await repo.addAudit({ candidate_id: c.id, action: `${type}_draft_generated`, actor: "system", details: { draft_id: draft.id } });
  return draft;
}

/**
 * Keeps the top N per role (N = settings.finalist_count) in "finalist", by applied-role score,
 * among candidates at or above the minimum score. Only touches candidates the founder hasn't
 * decided on manually: auto-finalists that drop out of the top N return to "analysed".
 * New finalists get an interview brief. Runs whenever the processing queue is empty.
 */
export async function autoAssignFinalists() {
  const repo = getRepo();
  const [candidates, scores, settings] = await Promise.all([repo.listCandidates(), repo.listScores(), repo.getSettings()]);
  if (candidates.some((c) => c.processing_status === "queued" || c.processing_status === "processing")) {
    return { skipped: "processing still running" };
  }
  const scoreOf = (c: Candidate) => scores.find((s) => s.candidate_id === c.id && s.role === c.applied_role)?.overall_score ?? null;
  const promoted: string[] = [];
  const demoted: string[] = [];
  for (const role of ROLES) {
    const pool = candidates
      .filter((c) => c.applied_role === role && c.processing_status === "completed")
      .filter((c) => ["analysed", "shortlisted", "finalist"].includes(c.workflow_status))
      .filter((c) => (scoreOf(c) ?? -1) >= settings.min_recommend_score)
      .sort((a, b) => scoreOf(b)! - scoreOf(a)!);
    const top = new Set(pool.slice(0, settings.finalist_count).map((c) => c.id));
    for (const c of candidates.filter((x) => x.applied_role === role && !x.decided_by_founder)) {
      if (top.has(c.id) && c.workflow_status !== "finalist") {
        await repo.updateCandidate(c.id, { workflow_status: "finalist" });
        await repo.addAudit({ candidate_id: c.id, action: "auto_finalist", actor: "system", details: { role, score: scoreOf(c) } });
        promoted.push(c.id);
      } else if (!top.has(c.id) && c.workflow_status === "finalist") {
        await repo.updateCandidate(c.id, { workflow_status: "analysed" });
        await repo.addAudit({ candidate_id: c.id, action: "auto_finalist_removed", actor: "system", details: { role, score: scoreOf(c) } });
        demoted.push(c.id);
      }
    }
  }
  const assessments = await repo.listAssessments();
  const finalists = (await repo.listCandidates()).filter((c) => c.workflow_status === "finalist" && !assessments.some((a) => a.candidate_id === c.id));
  for (const c of finalists) {
    try {
      await buildAssessment(c.id);
    } catch (e) {
      console.error(`[finalists] brief failed for ${c.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { promoted: promoted.length, demoted: demoted.length };
}
