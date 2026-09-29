import type {
  AuditEntry,
  Candidate,
  CandidateAssessment,
  CandidateScore,
  EmailDraft,
  EmailType,
  Role,
  RubricCriterion,
  Settings,
} from "../types";

export type NewCandidate = Pick<
  Candidate,
  | "batch_id"
  | "applied_role"
  | "original_file_name"
  | "private_name"
  | "private_email"
  | "private_phone"
  | "anonymised_cv_content"
  | "redaction_summary"
  | "processing_status"
  | "processing_error"
  | "workflow_status"
>;

export type CandidatePatch = Partial<Omit<Candidate, "id" | "created_at" | "updated_at">>;
export type NewCriterion = Omit<RubricCriterion, "id" | "created_at">;
export type NewScore = Omit<CandidateScore, "id" | "created_at">;
export type NewAssessment = Omit<CandidateAssessment, "id" | "created_at">;
export type NewEmailDraft = Pick<EmailDraft, "candidate_id" | "email_type" | "subject" | "body">;
export type EmailPatch = Partial<
  Pick<EmailDraft, "subject" | "body" | "status" | "edited_by_founder" | "approved_at" | "sent_at" | "error" | "provider_message_id">
>;

export interface Repo {
  kind: "supabase" | "local";

  listCriteria(role?: Role): Promise<RubricCriterion[]>;
  /** Replace all rubric rows (used by the seed only). */
  replaceCriteria(rows: NewCriterion[]): Promise<void>;

  createCandidate(c: NewCandidate): Promise<Candidate>;
  getCandidate(id: string): Promise<Candidate | null>;
  listCandidates(): Promise<Candidate[]>;
  updateCandidate(id: string, patch: CandidatePatch): Promise<Candidate>;
  /** Atomically move up to n queued (or stale processing) candidates to 'processing'. */
  claimCandidates(n: number): Promise<Candidate[]>;

  upsertScore(s: NewScore): Promise<CandidateScore>;
  deleteScores(candidateId: string): Promise<void>;
  listScores(candidateId?: string): Promise<CandidateScore[]>;

  upsertAssessment(a: NewAssessment): Promise<CandidateAssessment>;
  getAssessment(candidateId: string): Promise<CandidateAssessment | null>;
  listAssessments(): Promise<CandidateAssessment[]>;

  /** Creates, or replaces the content of an unsent draft of the same type. */
  upsertEmailDraft(d: NewEmailDraft): Promise<EmailDraft>;
  getEmailDraft(id: string): Promise<EmailDraft | null>;
  getEmailDraftFor(candidateId: string, type: EmailType): Promise<EmailDraft | null>;
  listEmailDrafts(): Promise<EmailDraft[]>;
  updateEmailDraft(id: string, patch: EmailPatch): Promise<EmailDraft>;
  deleteEmailDraft(id: string): Promise<void>;

  addAudit(e: Omit<AuditEntry, "id" | "created_at">): Promise<void>;
  listAudit(candidateId?: string): Promise<AuditEntry[]>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
}
