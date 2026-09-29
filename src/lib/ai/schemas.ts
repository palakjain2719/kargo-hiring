import { z } from "zod";

export const ProfileSchema = z.object({
  headline: z.string().max(300),
  experience: z
    .array(
      z.object({
        organisation: z.string(),
        title: z.string(),
        period: z.string(),
        highlights: z.array(z.string()).max(8),
      }),
    )
    .max(15),
  domains: z.array(z.string()).max(10),
  notable_outcomes: z.array(z.string()).max(10),
});

export const RubricResultSchema = z.object({
  criteria: z
    .array(
      z.object({
        criterion_id: z.string(),
        score: z.number().int().min(0).max(5),
        reasoning: z.string().min(10).max(1200),
        evidence_quotes: z.array(z.string()).max(4),
      }),
    )
    .min(1),
  summary: z.string().min(10).max(1200),
});

export const AssessmentSchema = z.object({
  interview_brief: z.string().min(20).max(1500),
  strongest_evidence: z.string().min(10).max(800),
  biggest_probe_area: z.string().min(10).max(800),
  key_uncertainty: z.string().min(10).max(800),
  strengths: z.array(z.string()).min(1).max(5),
  gaps: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
  interview_questions: z
    .array(z.object({ question: z.string().min(10), why: z.string().min(5) }))
    .min(3)
    .max(8),
});

export const EmailSchema = z.object({
  subject: z.string().min(3).max(150),
  body: z.string().min(40).max(4000),
});

export type ProfileOut = z.infer<typeof ProfileSchema>;
export type RubricResultOut = z.infer<typeof RubricResultSchema>;
export type AssessmentOut = z.infer<typeof AssessmentSchema>;
export type EmailOut = z.infer<typeof EmailSchema>;

/** Gemini-compatible JSON schema derived from the zod schema. */
export function toGeminiSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
