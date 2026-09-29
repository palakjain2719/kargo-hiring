import type { CriterionScore, RubricCriterion } from "./types";

/**
 * Score scale used for every criterion. It only defines how strongly the CV evidences the
 * rubric's own "what a strong candidate looks like" description. It adds no criteria.
 */
export const SCORE_SCALE = [
  { score: 0, label: "No evidence in the CV" },
  { score: 1, label: "Indirect or participation-only evidence" },
  { score: 2, label: "Partial: some elements of the description, weak link to outcome" },
  { score: 3, label: "One clear example matching the description" },
  { score: 4, label: "Clear example with a visible result, candidate's own action linked to it" },
  { score: 5, label: "Repeated, strong examples fully matching the description, with results" },
] as const;
export const MAX_SCORE = 5;

export interface RawCriterionResult {
  criterion_id: string;
  score: number;
  reasoning: string;
  evidence_quotes: string[];
}

function normaliseForMatch(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•·▪●]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A quote counts as verified if it (whitespace/punctuation-normalised) appears in the CV. */
export function verifyQuote(quote: string, cv: string): boolean {
  const q = normaliseForMatch(quote).replace(/^\.\.\.|\.\.\.$/g, "").trim();
  if (q.length < 12) return false;
  const c = normaliseForMatch(cv);
  if (c.includes(q)) return true;
  // Allow the model to join two fragments with "..."
  const pieces = q.split(/\s*\.\.\.\s*/).filter((p) => p.length >= 12);
  return pieces.length > 1 && pieces.every((p) => c.includes(p));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic post-processing of the model output:
 * - exactly one result per rubric criterion (missing or unknown IDs = invalid)
 * - evidence quotes verified against the CV; unverifiable quotes are discarded
 * - a score above 1 with no verified evidence is capped at 1 (evidence not present)
 * - weighted contribution = score / 5 × weight; overall = sum (0–100)
 */
export function computeScores(
  criteria: RubricCriterion[],
  raw: RawCriterionResult[],
  anonymisedCv: string,
): { overall: number; criterionScores: CriterionScore[] } {
  const byId = new Map(raw.map((r) => [r.criterion_id, r]));
  if (byId.size !== raw.length) throw new Error("Duplicate criterion_id in model output");
  for (const r of raw) {
    if (!criteria.some((c) => c.id === r.criterion_id)) {
      throw new Error(`Unknown criterion_id in model output: ${r.criterion_id}`);
    }
  }

  const criterionScores = [...criteria]
    .sort((a, b) => a.position - b.position)
    .map((c): CriterionScore => {
      const r = byId.get(c.id);
      if (!r) throw new Error(`Model output is missing criterion ${c.criterion_name}`);
      if (!Number.isInteger(r.score) || r.score < 0 || r.score > MAX_SCORE) {
        throw new Error(`Invalid score ${r.score} for ${c.criterion_name}`);
      }
      const verified = [...new Set(r.evidence_quotes.map((q) => q.trim()))].filter((q) =>
        verifyQuote(q, anonymisedCv),
      );
      const discarded = r.evidence_quotes.length - verified.length;
      let score = r.score;
      let reasoning = r.reasoning.trim();
      let capped = false;
      if (verified.length === 0 && score > 1) {
        score = 1;
        capped = true;
        reasoning += " [Score capped at 1: no supporting quote could be verified in the CV.]";
      }
      if (verified.length === 0 && !/not present|no evidence|not evidenced|absent/i.test(reasoning)) {
        reasoning = `Evidence for this criterion is not present in the CV. ${reasoning}`;
      }
      return {
        criterion_id: c.id,
        criterion_name: c.criterion_name,
        weight: c.weight,
        score,
        weighted_contribution: round2((score / MAX_SCORE) * c.weight),
        reasoning,
        evidence: verified,
        evidence_present: verified.length > 0,
        discarded_quotes: discarded,
        capped_for_missing_evidence: capped,
      };
    });

  const overall = round2(criterionScores.reduce((s, c) => s + c.weighted_contribution, 0));
  return { overall, criterionScores };
}

/** Rank descending by score; ties share a rank (1, 2, 2, 4). */
export function rank<T>(items: T[], score: (t: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const out = new Map<T, number>();
  let prevScore: number | null = null;
  let prevRank = 0;
  sorted.forEach((item, i) => {
    const s = score(item);
    const r = prevScore !== null && s === prevScore ? prevRank : i + 1;
    out.set(item, r);
    prevScore = s;
    prevRank = r;
  });
  return out;
}
