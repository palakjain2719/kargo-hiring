/**
 * The only entry point to AI models. Every call:
 *  1. builds the prompt from anonymised content only
 *  2. runs assertNoPii on the full prompt (blocks the call if a private identifier is present)
 *  3. requests structured JSON output
 *  4. validates it with zod, retrying on malformed output (max 3 attempts)
 * Callers save results only after validation succeeds, so a bad response never corrupts a record.
 */
import type { z } from "zod";
import { assertNoPii, PiiLeakError } from "../pii";
import type { CriterionScore, RubricCriterion, Role } from "../types";
import * as mock from "./mock";
import { assessmentPrompt, emailPrompt, extractionPrompt, scoringPrompt } from "./prompts";
import { getProvider, type Prompt } from "./providers";
import {
  AssessmentSchema,
  EmailSchema,
  ProfileSchema,
  RubricResultSchema,
  type AssessmentOut,
  type EmailOut,
  type ProfileOut,
  type RubricResultOut,
} from "./schemas";

export interface PrivateIds {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
  }
}

const MAX_ATTEMPTS = 3;

function stripFences(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

async function run<T>(
  task: string,
  prompt: Prompt,
  schema: z.ZodType<T>,
  pii: PrivateIds,
  mockResult: () => T,
  extraCheck?: (v: T) => string | null,
): Promise<{ data: T; model: string }> {
  assertNoPii(`${prompt.system}\n${prompt.user}`, pii); // throws PiiLeakError; never retried
  // Test hook: lets the 3-CV test inspect every prompt that would leave the server.
  (globalThis as { __kargoPromptTap?: (task: string, p: Prompt) => void }).__kargoPromptTap?.(task, prompt);
  const provider = getProvider();
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = provider.name === "mock" ? JSON.stringify(mockResult()) : await provider.generate(task, prompt, schema);
      const parsed = schema.safeParse(JSON.parse(stripFences(raw)));
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.message.slice(0, 400)}`);
      const problem = extraCheck?.(parsed.data);
      if (problem) throw new Error(`content check failed: ${problem}`);
      return { data: parsed.data, model: provider.name };
    } catch (e) {
      if (e instanceof PiiLeakError) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[ai] ${task} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new AiError(`${task} failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`, MAX_ATTEMPTS);
}

export function extractProfile(cv: string, pii: PrivateIds) {
  return run<ProfileOut>("extract_profile", extractionPrompt(cv), ProfileSchema, pii, () => mock.mockProfile(cv));
}

export function scoreAgainstRubric(cv: string, role: Role, criteria: RubricCriterion[], pii: PrivateIds) {
  const ids = new Set(criteria.map((c) => c.id));
  return run<RubricResultOut>(
    `score_${role}`,
    scoringPrompt(cv, role, criteria),
    RubricResultSchema,
    pii,
    () => mock.mockScore(cv, criteria),
    (v) => {
      const got = new Set(v.criteria.map((c) => c.criterion_id));
      if (got.size !== v.criteria.length) return "duplicate criterion_id";
      for (const id of ids) if (!got.has(id)) return `missing criterion ${id}`;
      for (const id of got) if (!ids.has(id)) return `unknown criterion ${id}`;
      return null;
    },
  );
}

export function generateAssessment(
  cv: string,
  role: Role,
  overall: number,
  scores: CriterionScore[],
  pii: PrivateIds,
) {
  return run<AssessmentOut>(
    "assessment",
    assessmentPrompt(cv, role, overall, scores),
    AssessmentSchema,
    pii,
    () => mock.mockAssessment(role, scores),
  );
}

const SCORE_LEAK = /\bscor(e|ed|ing)\b|\brubric\b|\branked?\b|\d+(\.\d+)?\s*(%|\/\s*(5|100)\b)|\bartificial intelligence\b|\bAI\b/i;

export function draftEmail(
  type: "offer" | "rejection",
  role: Role,
  strengths: string[],
  gaps: string[],
  pii: PrivateIds,
) {
  return run<EmailOut>(
    `email_${type}`,
    emailPrompt(type, role, strengths, gaps),
    EmailSchema,
    pii,
    () => mock.mockEmail(type, role, strengths, gaps),
    (v) => {
      if (!v.body.includes("{{candidate_name}}")) return "body must address {{candidate_name}}";
      if (type === "rejection" && SCORE_LEAK.test(`${v.subject}\n${v.body}`)) {
        return "rejection email exposes scoring details";
      }
      return null;
    },
  );
}
