export const ROLES = ["PM", "SPM"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export type ProcessingStatus = "queued" | "processing" | "completed" | "failed";
export type WorkflowStatus =
  | "processing"
  | "analysed"
  | "shortlisted"
  | "finalist"
  | "selected"
  | "rejected";
export type EmailType = "offer" | "rejection";
export type EmailStatus = "draft" | "approved" | "sent" | "failed";

export interface RubricCriterion {
  id: string;
  role: Role;
  position: number;
  criterion_name: string;
  description: string;
  weight: number; // percent, sums to 100 per role
  created_at: string;
}

/** Structured summary Gemini extracts from the anonymised CV (never contains PII). */
export interface CvProfile {
  headline: string;
  experience: { organisation: string; title: string; period: string; highlights: string[] }[];
  domains: string[];
  notable_outcomes: string[];
}

export interface Candidate {
  id: string;
  batch_id: string;
  applied_role: Role;
  /** "best_fit": the applicant gave no role; applied_role is set from whichever rubric they score higher on. */
  role_source: "applicant" | "best_fit";
  /** Set once the founder makes any manual status decision; automatic finalisting never overrides it. */
  decided_by_founder: boolean;
  original_file_name: string;
  private_name: string | null;
  private_email: string | null;
  private_phone: string | null;
  anonymised_cv_content: string | null;
  redaction_summary: Record<string, number>;
  profile: CvProfile | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  processing_attempts: number;
  workflow_status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export interface CriterionScore {
  criterion_id: string;
  criterion_name: string;
  weight: number;
  /** 0–5 on the anchored scale in lib/scoring.ts */
  score: number;
  /** score / 5 × weight, in points out of 100 */
  weighted_contribution: number;
  reasoning: string;
  /** Verbatim quotes that were verified to exist in the anonymised CV. */
  evidence: string[];
  evidence_present: boolean;
  /** Quotes the model returned that could not be found in the CV and were discarded. */
  discarded_quotes: number;
  /** True when the model's score was lowered because no quote could be verified. */
  capped_for_missing_evidence: boolean;
}

export interface CandidateScore {
  id: string;
  candidate_id: string;
  role: Role;
  overall_score: number;
  criterion_scores: CriterionScore[];
  generated_reasoning: string;
  model: string;
  created_at: string;
}

export interface InterviewQuestion {
  question: string;
  why: string;
}

export interface CandidateAssessment {
  id: string;
  candidate_id: string;
  role: Role;
  interview_brief: string;
  strongest_evidence: string;
  biggest_probe_area: string;
  key_uncertainty: string;
  strengths: string[];
  gaps: string[];
  risks: string[];
  interview_questions: InterviewQuestion[];
  model: string;
  created_at: string;
}

export interface EmailDraft {
  id: string;
  candidate_id: string;
  email_type: EmailType;
  subject: string;
  body: string;
  status: EmailStatus;
  edited_by_founder: boolean;
  approved_at: string | null;
  sent_at: string | null;
  error: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  candidate_id: string | null;
  action: string;
  actor: "founder" | "system";
  details: Record<string, unknown>;
  created_at: string;
}

export interface Settings {
  shortlist_size: Record<Role, number>;
  /** Candidates below this applied-role score are never recommended, even if they rank in the top N. */
  min_recommend_score: number;
  /** Top N per role (by applied-role score) are moved to finalist automatically. */
  finalist_count: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shortlist_size: { PM: 5, SPM: 5 },
  min_recommend_score: 50,
  finalist_count: 3,
};
