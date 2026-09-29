/**
 * MOCK AI: development only. Used when GEMINI_API_KEY is not set, so the pipeline can be
 * exercised end to end without network access. Its output is a crude keyword heuristic and
 * is NOT a real assessment. The UI shows a banner whenever this mode is active.
 */
import type { CriterionScore, RubricCriterion, Role } from "../types";
import { ROLE_LABEL } from "../types";
import type { AssessmentOut, EmailOut, ProfileOut, RubricResultOut } from "./schemas";

const STOP = new Set(
  "about above after again against because before being below between could during every example other person should their there these those through which while would where strong candidate looks shows rather than simply including evidence".split(
    " ",
  ),
);

function sentences(cv: string): string[] {
  return cv
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[\s\-•*·]+/, "").trim())
    .filter((s) => s.length >= 25 && !/\[(EMAIL|PHONE|CANDIDATE|PROFILE)/.test(s));
}

function keywords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z]{5,}/g)
      ?.filter((w) => !STOP.has(w))
      .map((w) => w.slice(0, 6)) ?? [],
  );
}

export function mockProfile(cv: string): ProfileOut {
  const s = sentences(cv);
  return {
    headline: s[0]?.slice(0, 200) ?? "Not stated",
    experience: [],
    domains: [],
    notable_outcomes: s.filter((x) => /\d+%|\d+x|reduced|increased|cut /i.test(x)).slice(0, 5),
  };
}

export function mockScore(cv: string, criteria: RubricCriterion[]): RubricResultOut {
  const sents = sentences(cv);
  return {
    criteria: criteria.map((c) => {
      const kw = keywords(`${c.criterion_name} ${c.description}`);
      const ranked = sents
        .map((s) => {
          const words = [...keywords(s)];
          const overlap = words.filter((w) => kw.has(w)).length;
          const metric = /\d+\s?%|\d+x\b|\d+\s?(hours|days|weeks|tickets|customers)/i.test(s) ? 1 : 0;
          return { s, v: overlap + metric };
        })
        .filter((x) => x.v >= 2)
        .sort((a, b) => b.v - a.v);
      const top = ranked.slice(0, 2);
      const best = top[0]?.v ?? 0;
      const score = Math.max(0, Math.min(5, best === 0 ? 0 : Math.round(best / 1.5)));
      return {
        criterion_id: c.id,
        score,
        reasoning: top.length
          ? `[MOCK] Keyword overlap with the criterion description found in ${ranked.length} CV line(s).`
          : "[MOCK] Evidence is not present in the CV for this criterion.",
        evidence_quotes: top.map((t) => t.s),
      };
    }),
    summary: "[MOCK] Heuristic keyword match, not a real assessment. Set GEMINI_API_KEY for real scoring.",
  };
}

export function mockAssessment(role: Role, scores: CriterionScore[]): AssessmentOut {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const strong = sorted.filter((c) => c.score >= 3);
  const weak = [...scores].sort((a, b) => a.score - b.score || b.weight - a.weight).filter((c) => c.score <= 2);
  return {
    interview_brief: `[MOCK] ${ROLE_LABEL[role]} brief built from rubric scores. Strongest on ${sorted[0]?.criterion_name}; weakest on ${weak[0]?.criterion_name ?? "none"}.`,
    strongest_evidence: sorted[0]?.evidence[0] ?? "No verified evidence.",
    biggest_probe_area: weak[0] ? `${weak[0].criterion_name}: ${weak[0].reasoning}` : "No major gaps identified.",
    key_uncertainty: "[MOCK] Whether the outcomes listed were driven by the candidate personally.",
    strengths: strong.length ? strong.map((c) => c.criterion_name) : ["No strong criteria"],
    gaps: weak.map((c) => c.criterion_name),
    risks: ["[MOCK] Heuristic output; verify with real Gemini scoring."],
    interview_questions: [...weak, ...strong].slice(0, 4).map((c) => ({
      question: `Walk me through a specific example that shows ${c.criterion_name.toLowerCase()}.`,
      why: `Tests the ${c.criterion_name} criterion.`,
    })).concat([{ question: "What happened after you left that project, and who ran it?", why: "Tests durability of outcomes." }]).slice(0, 5),
  };
}

export function mockEmail(type: "offer" | "rejection", role: Role, strengths: string[], gaps: string[]): EmailOut {
  if (type === "offer") {
    return {
      subject: `Offer: ${ROLE_LABEL[role]} at Kargo`,
      body: `Hi {{candidate_name}},\n\nI'm delighted to offer you the ${ROLE_LABEL[role]} role at Kargo. ${strengths[0] ? `What stood out to us was: ${strengths[0]}.` : ""}\n\nCompensation: [Compensation]\nStart date: [Start date]\nPlease let us know by [Response deadline]. A formal offer letter will follow.\n\nArjun Mehta\nFounder, Kargo`,
    };
  }
  return {
    subject: `Your application for ${ROLE_LABEL[role]} at Kargo`,
    body: `Hi {{candidate_name}},\n\nThank you for applying for the ${ROLE_LABEL[role]} role at Kargo. After careful review, we won't be progressing your application.\n\n${strengths[0] ? `We appreciated seeing ${strengths[0].toLowerCase()} in your CV.` : ""} ${gaps[0] ? `For this role we were looking for stronger evidence of ${gaps[0].toLowerCase()}.` : ""}\n\nThank you again for your interest in Kargo, and I wish you the very best.\n\nArjun Mehta\nFounder, Kargo`,
  };
}
