import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { toGeminiSchema } from "./schemas";

export interface Prompt {
  system: string;
  user: string;
}

export interface JsonProvider {
  /** "gemini:<model>" or "mock" */
  name: string;
  generate(task: string, prompt: Prompt, schema: z.ZodType): Promise<string>;
}

let cached: JsonProvider | null = null;

export function getProvider(): JsonProvider {
  if (cached) return cached;
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const ai = new GoogleGenAI({ apiKey: key });
    cached = {
      name: `gemini:${model}`,
      async generate(_task, prompt, schema) {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt.user }] }],
          config: {
            systemInstruction: prompt.system,
            temperature: 0,
            topP: 1,
            responseMimeType: "application/json",
            responseJsonSchema: toGeminiSchema(schema),
          },
        });
        const text = res.text;
        if (!text) throw new Error("Gemini returned an empty response");
        return text;
      },
    };
  } else {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("GEMINI_API_KEY is not set. The mock AI provider is disabled in production.");
    }
    cached = { name: "mock", generate: async () => "__MOCK__" };
  }
  return cached;
}

export function isMockAi() {
  return !process.env.GEMINI_API_KEY;
}
