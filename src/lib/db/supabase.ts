import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type CandidateScore, type Settings } from "../types";
import type { Repo } from "./repo";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

const num = <T extends Record<string, unknown>>(row: T, ...keys: (keyof T)[]) => {
  for (const k of keys) if (row[k] != null) (row as Record<string, unknown>)[k as string] = Number(row[k]);
  return row;
};

export function createSupabaseRepo(url: string, serviceKey: string): Repo {
  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    kind: "supabase",
    async listCriteria(role) {
      let q = db.from("rubric_criteria").select("*").order("role").order("position");
      if (role) q = q.eq("role", role);
      return must(await q, "listCriteria").map((r: Record<string, unknown>) => num(r, "weight")) as never;
    },
    async replaceCriteria(rows) {
      // Scores reference criteria by id inside JSON, so re-seeding only happens before scoring.
      must(await db.from("rubric_criteria").delete().neq("id", "00000000-0000-0000-0000-000000000000"), "clear rubric");
      must(await db.from("rubric_criteria").insert(rows), "insert rubric");
    },

    async createCandidate(c) {
      return must(await db.from("candidates").insert(c).select().single(), "createCandidate");
    },
    async getCandidate(id) {
      return must(await db.from("candidates").select("*").eq("id", id).maybeSingle(), "getCandidate");
    },
    async listCandidates() {
      return must(await db.from("candidates").select("*").order("created_at", { ascending: false }), "listCandidates");
    },
    async updateCandidate(id, patch) {
      return must(await db.from("candidates").update(patch).eq("id", id).select().single(), "updateCandidate");
    },
    async claimCandidates(n) {
      return must(await db.rpc("claim_candidates", { max_count: n }), "claimCandidates") ?? [];
    },

    async upsertScore(s) {
      const row = must<Record<string, unknown>>(
        await db.from("candidate_scores").upsert(s, { onConflict: "candidate_id,role" }).select().single(),
        "upsertScore",
      );
      return num(row, "overall_score") as unknown as CandidateScore;
    },
    async deleteScores(candidateId) {
      must(await db.from("candidate_scores").delete().eq("candidate_id", candidateId), "deleteScores");
    },
    async listScores(candidateId) {
      let q = db.from("candidate_scores").select("*");
      if (candidateId) q = q.eq("candidate_id", candidateId);
      return must(await q, "listScores").map((r: Record<string, unknown>) => num(r, "overall_score")) as never;
    },

    async upsertAssessment(a) {
      return must(
        await db.from("candidate_assessments").upsert(a, { onConflict: "candidate_id" }).select().single(),
        "upsertAssessment",
      );
    },
    async getAssessment(candidateId) {
      return must(await db.from("candidate_assessments").select("*").eq("candidate_id", candidateId).maybeSingle(), "getAssessment");
    },
    async listAssessments() {
      return must(await db.from("candidate_assessments").select("*"), "listAssessments");
    },

    async upsertEmailDraft(d) {
      const existing = await this.getEmailDraftFor(d.candidate_id, d.email_type);
      if (existing?.status === "sent") throw new Error("A sent email cannot be regenerated");
      const reset = { status: "draft", edited_by_founder: false, approved_at: null, error: null };
      if (existing) {
        return must(
          await db.from("email_drafts").update({ ...d, ...reset }).eq("id", existing.id).select().single(),
          "updateDraft",
        );
      }
      return must(await db.from("email_drafts").insert({ ...d, ...reset }).select().single(), "insertDraft");
    },
    async getEmailDraft(id) {
      return must(await db.from("email_drafts").select("*").eq("id", id).maybeSingle(), "getEmailDraft");
    },
    async getEmailDraftFor(candidateId, type) {
      return must(
        await db.from("email_drafts").select("*").eq("candidate_id", candidateId).eq("email_type", type).maybeSingle(),
        "getEmailDraftFor",
      );
    },
    async listEmailDrafts() {
      return must(await db.from("email_drafts").select("*").order("created_at"), "listEmailDrafts");
    },
    async updateEmailDraft(id, patch) {
      return must(await db.from("email_drafts").update(patch).eq("id", id).select().single(), "updateEmailDraft");
    },
    async deleteEmailDraft(id) {
      must(await db.from("email_drafts").delete().eq("id", id), "deleteEmailDraft");
    },

    async addAudit(e) {
      must(await db.from("audit_log").insert(e), "addAudit");
    },
    async listAudit(candidateId) {
      let q = db.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
      if (candidateId) q = q.eq("candidate_id", candidateId);
      return must(await q, "listAudit");
    },

    async getSettings(): Promise<Settings> {
      const rows = must(await db.from("settings").select("*"), "getSettings") as { key: string; value: unknown }[];
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return {
        shortlist_size: { ...DEFAULT_SETTINGS.shortlist_size, ...((map.shortlist_size as object) ?? {}) },
        min_recommend_score: Number(map.min_recommend_score ?? DEFAULT_SETTINGS.min_recommend_score),
        finalist_count: Number(map.finalist_count ?? DEFAULT_SETTINGS.finalist_count),
      };
    },
    async saveSettings(s) {
      must(
        await db.from("settings").upsert([
          { key: "shortlist_size", value: s.shortlist_size },
          { key: "min_recommend_score", value: s.min_recommend_score },
          { key: "finalist_count", value: s.finalist_count },
        ]),
        "saveSettings",
      );
    },
  };
}
