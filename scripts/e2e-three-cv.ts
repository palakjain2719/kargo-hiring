/**
 * 3-CV acceptance test: run this BEFORE processing the full application set.
 *   npm run test:e2e
 * Uses a throwaway local store unless E2E_USE_CONFIGURED_DB=1 (then it writes to Supabase).
 * Uses Gemini if GEMINI_API_KEY is set, otherwise the mock provider.
 * Email sending is forced off for the whole run.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";

if (existsSync(".env.local")) loadEnvFile(".env.local");
process.env.EMAIL_SENDING_ENABLED = "false";
if (process.env.E2E_USE_CONFIGURED_DB !== "1") {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LOCAL_STORE_PATH = path.join(process.cwd(), ".data", "e2e-store.json");
  rmSync(process.env.LOCAL_STORE_PATH, { force: true });
}

const prompts: { task: string; text: string }[] = [];
(globalThis as Record<string, unknown>).__kargoPromptTap = (task: string, p: { system: string; user: string }) =>
  prompts.push({ task, text: `${p.system}\n${p.user}` });

const { getRepo } = await import("../src/lib/db");
const { seedRubric } = await import("../src/lib/rubric/seed");
const { extractText } = await import("../src/lib/parse-file");
const { ingestCv, processQueue, buildAssessment, buildEmailDraft } = await import("../src/lib/pipeline");
const { loadAll } = await import("../src/lib/views");
const { sendDraft } = await import("../src/lib/email/send");
const { isMockAi } = await import("../src/lib/ai/providers");

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  → ${detail}` : ""}`);
  if (!cond) failures++;
};

const repo = getRepo();
console.log(`Backend: ${repo.kind} · AI: ${isMockAi() ? "MOCK (keyword heuristic)" : process.env.GEMINI_MODEL || "gemini-flash-latest"} · Email sending: OFF\n`);

await seedRubric();
const criteria = await repo.listCriteria();
console.log("Rubric");
check("PM criteria seeded, weights = 100%", criteria.filter((c) => c.role === "PM").reduce((s, c) => s + c.weight, 0) === 100);
check("SPM criteria seeded, weights = 100%", criteria.filter((c) => c.role === "SPM").reduce((s, c) => s + c.weight, 0) === 100);

const TESTS = [
  { file: "01-strong-pm.txt", role: "PM" as const, kind: "strong PM", name: "Ananya Deshpande", email: "ananya.deshpande@example.com", phone: "+91 98200 11223" },
  { file: "02-weak-spm.txt", role: "SPM" as const, kind: "weak SPM", name: "Rohan Mehra", email: "rohan.mehra@example.com", phone: "022-2644-8811" },
  { file: "03-ambiguous-spm.txt", role: "SPM" as const, kind: "ambiguous", name: "Kavya Iyer", email: "kavya.iyer@example.com", phone: "+91-99876-54321" },
];

const batchId = randomUUID();
const ids: Record<string, string> = {};
for (const t of TESTS) {
  const text = await extractText(t.file, readFileSync(path.join("test-cvs", t.file)));
  const c = await ingestCv({ batchId, role: t.role, fileName: t.file, text });
  ids[t.kind] = c.id;
}
while ((await processQueue(3)) > 0) { /* drain */ }

const digits = (s: string) => s.replace(/\D/g, "");
for (const t of TESTS) {
  console.log(`\n${t.kind} (${t.file}, applied ${t.role})`);
  const c = (await repo.getCandidate(ids[t.kind]))!;
  const scores = await repo.listScores(c.id);
  const pm = scores.find((s) => s.role === "PM");
  const spm = scores.find((s) => s.role === "SPM");
  check("candidate row created", !!c);
  check("private name extracted", c.private_name === t.name, String(c.private_name));
  check("private email extracted", c.private_email === t.email, String(c.private_email));
  check("private phone extracted", c.private_phone === t.phone, String(c.private_phone));
  const anon = c.anonymised_cv_content ?? "";
  const lastName = t.name.split(" ").at(-1)!;
  check("anonymised CV has no name", !new RegExp(`${t.name.split(" ")[0]}|${lastName}`, "i").test(anon));
  check("anonymised CV has no email", !anon.toLowerCase().includes(t.email));
  check("anonymised CV has no phone", !digits(anon).includes(digits(t.phone).slice(-10)));
  check("processing completed", c.processing_status === "completed", c.processing_error ?? "");
  check("PM score generated", !!pm, "");
  check("SPM score generated", !!spm, "");
  for (const s of [pm, spm]) {
    if (!s) continue;
    const rc = criteria.filter((x) => x.role === s.role);
    check(`${s.role}: one result per rubric criterion`, s.criterion_scores.length === rc.length);
    check(`${s.role}: every criterion has reasoning`, s.criterion_scores.every((x) => x.reasoning.length > 10));
    const sum = Math.round(s.criterion_scores.reduce((a, x) => a + x.weighted_contribution, 0) * 100) / 100;
    check(`${s.role}: overall = sum of weighted contributions (${s.overall_score})`, Math.abs(sum - s.overall_score) < 0.01);
    const cvNorm = anon.toLowerCase().replace(/\s+/g, " ");
    check(`${s.role}: every evidence quote exists in the CV`, s.criterion_scores.every((x) => x.evidence.every((e) => cvNorm.includes(e.toLowerCase().replace(/\s+/g, " ").replace(/^\.\.\.|\.\.\.$/g, "").split("...")[0].trim()))));
    check(`${s.role}: missing evidence is stated explicitly`, s.criterion_scores.filter((x) => !x.evidence_present).every((x) => /not present|no evidence|not evidenced|absent/i.test(x.reasoning)));
  }
  check("status is 'analysed' (no automatic decision)", c.workflow_status === "analysed", c.workflow_status);
  console.log(`  ·    PM ${pm?.overall_score} · SPM ${spm?.overall_score}`);
}

console.log("\nPII never sent to AI");
check(`${prompts.length} AI prompts captured`, prompts.length >= TESTS.length * 3);
for (const t of TESTS) {
  const leaked = prompts.filter((p) =>
    new RegExp(`\\b(${t.name.split(" ").join("|")})\\b`, "i").test(p.text) ||
    p.text.toLowerCase().includes(t.email) ||
    digits(p.text).includes(digits(t.phone).slice(-10)),
  );
  check(`no prompt contains ${t.kind}'s name, email or phone`, leaked.length === 0, leaked.map((l) => l.task).join(","));
}

console.log("\nRanking & recommendation");
let view = await loadAll();
const row = (k: string) => view.rows.find((r) => r.id === ids[k])!;
check("strong PM ranked #1 in PM", row("strong PM").rank === 1);
check("SPM ranking uses SPM scores", row("ambiguous").applied === row("ambiguous").spm && row("weak SPM").applied === row("weak SPM").spm);
check("ambiguous ranks above weak SPM", (row("ambiguous").rank ?? 99) < (row("weak SPM").rank ?? 0), `ambiguous #${row("ambiguous").rank}, weak #${row("weak SPM").rank}`);
check("strong PM scores higher than weak SPM on both rubrics", (row("strong PM").pm ?? 0) > (row("weak SPM").pm ?? 0) && (row("strong PM").spm ?? 0) > (row("weak SPM").spm ?? 0));
check("weak SPM is not recommended", row("weak SPM").recommendation !== "Recommend shortlist", row("weak SPM").recommendation);
console.log(`  ·    ${view.rows.map((r) => `${r.name}: ${r.applied_role} #${r.rank} ${r.applied} (${r.recommendation})`).join(" | ")}`);

console.log("\nHuman workflow");
// Founder shortlists → finalist → confirms selection; rejects weak SPM.
const strong = ids["strong PM"];
await repo.updateCandidate(strong, { workflow_status: "shortlisted" });
const brief = await buildAssessment(strong);
check("assessment generated for shortlisted candidate", !!brief && brief.interview_questions.length >= 3);
check("no assessment for non-shortlisted candidates", !(await repo.getAssessment(ids["weak SPM"])));
await repo.updateCandidate(strong, { workflow_status: "finalist" });
await repo.updateCandidate(strong, { workflow_status: "selected" });
const offer = await buildEmailDraft(strong, "offer");
check("offer draft generated with real name", offer.body.includes("Ananya") && !offer.body.includes("{{candidate_name}}"));
check("offer draft status is 'draft'", offer.status === "draft");

await repo.updateCandidate(ids["weak SPM"], { workflow_status: "rejected" });
const rej = await buildEmailDraft(ids["weak SPM"], "rejection");
check("rejection draft is personalised with real name", rej.body.includes("Rohan"));
check("rejection draft mentions applied role", /Senior Product Manager/.test(rej.body + rej.subject));
check("rejection draft exposes no scores", !/\d+\s*(%|\/\s*(5|100))|score|rubric/i.test(rej.body));

// With sending switched off, clicking Send is a dry run: nothing is delivered.
const dry = await sendDraft(offer);
check("send with sending off is a dry run", dry.ok && dry.dryRun);

const drafts = await repo.listEmailDrafts();
const audit = await repo.listAudit();
check("no email was sent automatically", drafts.every((d) => d.status !== "sent" && !d.sent_at) && !audit.some((a) => a.action === "email_sent"));
check("ambiguous candidate still awaiting founder review", (await repo.getCandidate(ids["ambiguous"]))!.workflow_status === "analysed");
check("audit trail recorded", audit.some((a) => a.action === "cv_ingested") && audit.some((a) => a.action === "analysis_completed"));

view = await loadAll();
check("dashboard shows combined status", row("strong PM").status_label === "Selected · Email Draft Ready", row("strong PM").status_label);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (isMockAi()) console.log("Note: ran with MOCK AI. Re-run with GEMINI_API_KEY set to verify real scoring quality.");
process.exit(failures ? 1 : 0);
