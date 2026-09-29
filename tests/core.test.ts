import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertNoPii, extractPii, PiiLeakError } from "../src/lib/pii";
import { parseRubric, RubricError } from "../src/lib/rubric/parse";
import { computeScores, rank, verifyQuote } from "../src/lib/scoring";
import { unresolvedPlaceholders } from "../src/lib/email/send";
import type { RubricCriterion } from "../src/lib/types";

const rubricText = readFileSync("rubric.txt", "utf8");
const cv = (f: string) => readFileSync(`test-cvs/${f}`, "utf8");

test("rubric: parses exactly 5 PM + 5 SPM criteria with the file's weights", () => {
  const r = parseRubric(rubricText);
  const pm = r.filter((c) => c.role === "PM");
  const spm = r.filter((c) => c.role === "SPM");
  assert.deepEqual(pm.map((c) => c.weight), [25, 20, 20, 20, 15]);
  assert.deepEqual(spm.map((c) => c.weight), [30, 20, 20, 15, 15]);
  assert.equal(pm[0].criterion_name, "Problem -> Change -> Result");
  assert.equal(spm[0].criterion_name, "Independent Decision Ownership");
  assert.ok(pm[0].description.startsWith("The CV shows at least one example"));
});

test("rubric: refuses a rubric whose weights don't total 100%", () => {
  const bad = rubricText.replace("Weight: 25%", "Weight: 30%");
  assert.throws(() => parseRubric(bad), RubricError);
});

test("pii: strong PM CV — name, email, phone separated; anonymised text has none", () => {
  const p = extractPii(cv("01-strong-pm.txt"));
  assert.equal(p.name, "Ananya Deshpande");
  assert.equal(p.email, "ananya.deshpande@example.com");
  assert.equal(p.phone, "+91 98200 11223");
  assert.ok(!/ananya|deshpande|98200|@example\.com|Koregaon/i.test(p.anonymised), p.anonymised.slice(0, 300));
  assert.ok(p.anonymised.includes("pick-confirmation flow"));
  assert.doesNotThrow(() => assertNoPii(p.anonymised, p));
});

test("pii: labelled fields, DOB and gender lines removed", () => {
  const p = extractPii(cv("02-weak-spm.txt"));
  assert.equal(p.name, "Rohan Mehra");
  assert.equal(p.email, "rohan.mehra@example.com");
  assert.equal(p.phone, "022-2644-8811");
  assert.ok(!/rohan|mehra|2644|1986|Male/i.test(p.anonymised));
  assert.doesNotThrow(() => assertNoPii(p.anonymised, p));
});

test("pii: dotted-separator header", () => {
  const p = extractPii(cv("03-ambiguous-spm.txt"));
  assert.equal(p.name, "Kavya Iyer");
  assert.equal(p.phone, "+91-99876-54321");
  assert.ok(!/kavya|iyer|99876/i.test(p.anonymised));
});

test("pii guard blocks payloads containing identifiers", () => {
  const ids = { name: "Kavya Iyer", email: "k@x.com", phone: "+91-99876-54321" };
  assert.throws(() => assertNoPii("Candidate Kavya did well", ids), PiiLeakError);
  assert.throws(() => assertNoPii("reach me at 99876 54321", ids), PiiLeakError);
  assert.throws(() => assertNoPii("mail K@X.com", ids), PiiLeakError);
  assert.doesNotThrow(() => assertNoPii("cut costs by 20% in 2021", ids));
});

const criteria: RubricCriterion[] = [
  { id: "a", role: "PM", position: 1, criterion_name: "A", description: "", weight: 60, created_at: "" },
  { id: "b", role: "PM", position: 2, criterion_name: "B", description: "", weight: 40, created_at: "" },
];
const text = "Redesigned the pick-confirmation flow to 3 taps; mis-picks fell 38%.";

test("scoring: weighted contribution = score/5 × weight, overall sums", () => {
  const r = computeScores(criteria, [
    { criterion_id: "a", score: 5, reasoning: "Strong example.", evidence_quotes: ["Redesigned the pick-confirmation flow to 3 taps"] },
    { criterion_id: "b", score: 0, reasoning: "Evidence not present.", evidence_quotes: [] },
  ], text);
  assert.equal(r.criterionScores[0].weighted_contribution, 60);
  assert.equal(r.criterionScores[1].weighted_contribution, 0);
  assert.equal(r.overall, 60);
});

test("scoring: fabricated quotes are discarded and the score is capped at 1", () => {
  const r = computeScores(criteria, [
    { criterion_id: "a", score: 5, reasoning: "Great.", evidence_quotes: ["Grew revenue 300% as head of product"] },
    { criterion_id: "b", score: 3, reasoning: "Ok.", evidence_quotes: ["mis-picks fell 38%"] },
  ], text);
  assert.equal(r.criterionScores[0].score, 1);
  assert.equal(r.criterionScores[0].discarded_quotes, 1);
  assert.equal(r.criterionScores[0].capped_for_missing_evidence, true);
  assert.match(r.criterionScores[0].reasoning, /not present/);
  assert.equal(r.criterionScores[1].score, 3);
  assert.equal(r.overall, 12 + 24);
});

test("scoring: missing or unknown criteria are rejected (never partially saved)", () => {
  assert.throws(() => computeScores(criteria, [{ criterion_id: "a", score: 1, reasoning: "x", evidence_quotes: [] }], text));
  assert.throws(() => computeScores(criteria, [
    { criterion_id: "a", score: 1, reasoning: "x", evidence_quotes: [] },
    { criterion_id: "b", score: 1, reasoning: "x", evidence_quotes: [] },
    { criterion_id: "z", score: 1, reasoning: "x", evidence_quotes: [] },
  ], text));
  assert.throws(() => computeScores(criteria, [
    { criterion_id: "a", score: 7, reasoning: "x", evidence_quotes: [] },
    { criterion_id: "b", score: 1, reasoning: "x", evidence_quotes: [] },
  ], text));
});

test("verifyQuote tolerates whitespace and smart quotes, not paraphrase", () => {
  assert.ok(verifyQuote("redesigned the  pick-confirmation   flow", text));
  assert.ok(!verifyQuote("rebuilt the picking flow", text));
});

test("rank: descending with shared ranks for ties", () => {
  const r = rank([{ s: 50 }, { s: 90 }, { s: 50 }, { s: 10 }], (x) => x.s);
  assert.deepEqual([...r.values()], [1, 2, 2, 4]);
});

test("email placeholders are detected", () => {
  assert.deepEqual(unresolvedPlaceholders("Start: [Start date]. Hi {{candidate_name}}"), ["[Start date]", "{{candidate_name}}"]);
  assert.deepEqual(unresolvedPlaceholders("All filled in."), []);
});
