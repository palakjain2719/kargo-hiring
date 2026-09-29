/**
 * Development-only file store (.data/store.json, git-ignored). Used when Supabase env vars
 * are absent so the full flow can run locally. Refuses to run on Vercel production.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type AuditEntry, type Candidate, type CandidateAssessment, type CandidateScore, type EmailDraft, type RubricCriterion, type Settings } from "../types";
import type { Repo } from "./repo";

interface Store {
  rubric_criteria: RubricCriterion[];
  candidates: Candidate[];
  candidate_scores: CandidateScore[];
  candidate_assessments: CandidateAssessment[];
  email_drafts: EmailDraft[];
  audit_log: AuditEntry[];
  settings: Settings;
}

const file = () => process.env.LOCAL_STORE_PATH || path.join(process.cwd(), ".data", "store.json");
const now = () => new Date().toISOString();
const empty = (): Store => ({
  rubric_criteria: [],
  candidates: [],
  candidate_scores: [],
  candidate_assessments: [],
  email_drafts: [],
  audit_log: [],
  settings: structuredClone(DEFAULT_SETTINGS),
});

function load(): Store {
  const f = file();
  if (!existsSync(f)) return empty();
  return { ...empty(), ...JSON.parse(readFileSync(f, "utf8")) };
}
function save(s: Store) {
  const f = file();
  mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, f);
}

// Serialise all mutations within this process.
let chain: Promise<unknown> = Promise.resolve();
function tx<T>(fn: (s: Store) => T): Promise<T> {
  const p = chain.then(() => {
    const s = load();
    const out = fn(s);
    save(s);
    return structuredClone(out);
  });
  chain = p.catch(() => undefined);
  return p;
}
const read = async <T>(fn: (s: Store) => T): Promise<T> => {
  await chain;
  return structuredClone(fn(load()));
};

function mustFind<T extends { id: string }>(arr: T[], id: string, what: string): T {
  const x = arr.find((r) => r.id === id);
  if (!x) throw new Error(`${what} ${id} not found`);
  return x;
}

export function createLocalRepo(): Repo {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Supabase is not configured. The local file store is disabled in production.");
  }
  return {
    kind: "local",
    listCriteria: (role) => read((s) => s.rubric_criteria.filter((c) => !role || c.role === role).sort((a, b) => a.position - b.position)),
    replaceCriteria: (rows) =>
      tx((s) => {
        s.rubric_criteria = rows.map((r) => ({ ...r, id: randomUUID(), created_at: now() }));
      }),

    createCandidate: (c) =>
      tx((s) => {
        const row: Candidate = { ...c, id: randomUUID(), decided_by_founder: false, profile: null, processing_attempts: 0, created_at: now(), updated_at: now() };
        s.candidates.push(row);
        return row;
      }),
    getCandidate: (id) => read((s) => s.candidates.find((c) => c.id === id) ?? null),
    listCandidates: () => read((s) => s.candidates),
    updateCandidate: (id, patch) =>
      tx((s) => {
        const c = mustFind(s.candidates, id, "candidate");
        Object.assign(c, patch, { updated_at: now() });
        return c;
      }),
    claimCandidates: (n) =>
      tx((s) => {
        const stale = Date.now() - 10 * 60_000;
        const picked = s.candidates
          .filter((c) => c.processing_status === "queued" || (c.processing_status === "processing" && Date.parse(c.updated_at) < stale))
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, n);
        for (const c of picked) {
          c.processing_status = "processing";
          c.processing_attempts += 1;
          c.processing_error = null;
          c.updated_at = now();
        }
        return picked;
      }),

    upsertScore: (sc) =>
      tx((s) => {
        s.candidate_scores = s.candidate_scores.filter((x) => !(x.candidate_id === sc.candidate_id && x.role === sc.role));
        const row: CandidateScore = { ...sc, id: randomUUID(), created_at: now() };
        s.candidate_scores.push(row);
        return row;
      }),
    deleteScores: (candidateId) =>
      tx((s) => {
        s.candidate_scores = s.candidate_scores.filter((x) => x.candidate_id !== candidateId);
      }),
    listScores: (candidateId) => read((s) => s.candidate_scores.filter((x) => !candidateId || x.candidate_id === candidateId)),

    upsertAssessment: (a) =>
      tx((s) => {
        s.candidate_assessments = s.candidate_assessments.filter((x) => x.candidate_id !== a.candidate_id);
        const row: CandidateAssessment = { ...a, id: randomUUID(), created_at: now() };
        s.candidate_assessments.push(row);
        return row;
      }),
    getAssessment: (id) => read((s) => s.candidate_assessments.find((x) => x.candidate_id === id) ?? null),
    listAssessments: () => read((s) => s.candidate_assessments),

    upsertEmailDraft: (d) =>
      tx((s) => {
        const existing = s.email_drafts.find((x) => x.candidate_id === d.candidate_id && x.email_type === d.email_type);
        if (existing) {
          if (existing.status === "sent") throw new Error("A sent email cannot be regenerated");
          Object.assign(existing, d, { status: "draft", edited_by_founder: false, approved_at: null, error: null, updated_at: now() });
          return existing;
        }
        const row: EmailDraft = {
          ...d,
          id: randomUUID(),
          status: "draft",
          edited_by_founder: false,
          approved_at: null,
          sent_at: null,
          error: null,
          provider_message_id: null,
          created_at: now(),
          updated_at: now(),
        };
        s.email_drafts.push(row);
        return row;
      }),
    getEmailDraft: (id) => read((s) => s.email_drafts.find((x) => x.id === id) ?? null),
    getEmailDraftFor: (cid, type) => read((s) => s.email_drafts.find((x) => x.candidate_id === cid && x.email_type === type) ?? null),
    listEmailDrafts: () => read((s) => s.email_drafts),
    updateEmailDraft: (id, patch) =>
      tx((s) => {
        const d = mustFind(s.email_drafts, id, "email draft");
        Object.assign(d, patch, { updated_at: now() });
        return d;
      }),
    deleteEmailDraft: (id) =>
      tx((s) => {
        s.email_drafts = s.email_drafts.filter((x) => x.id !== id);
      }),

    addAudit: (e) =>
      tx((s) => {
        s.audit_log.push({ ...e, id: randomUUID(), created_at: now() });
      }),
    listAudit: (cid) =>
      read((s) => s.audit_log.filter((x) => !cid || x.candidate_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at))),

    getSettings: () => read((s) => ({ ...DEFAULT_SETTINGS, ...s.settings })),
    saveSettings: (settings) =>
      tx((s) => {
        s.settings = settings;
      }),
  };
}
