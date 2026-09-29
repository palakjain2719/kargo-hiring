/**
 * Deterministic, local PII separation. Runs at ingestion, before any AI call.
 * No part of this module talks to a model.
 */

export interface PiiResult {
  name: string | null;
  email: string | null;
  phone: string | null;
  anonymised: string;
  redactions: Record<string, number>;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-like: optional +country, 9–15 digits with spaces, dots, dashes or brackets.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g;
const PROFILE_URL_RE =
  /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|twitter\.com|x\.com|facebook\.com|instagram\.com)\/[^\s)|,;]+/gi;
// Lines that carry personal details irrelevant to the rubric.
const PERSONAL_LINE_RE =
  /^\s*(?:address|residence|location|date of birth|dob|d\.o\.b|age|gender|sex|marital status|nationality|religion|passport|father'?s name|mother'?s name)\s*[:\-–].*$/gim;
const NAME_LABEL_RE = /^\s*(?:name|full name|candidate name)\s*[:\-–]\s*(.+)$/im;
const HEADING_WORDS = new Set(
  [
    "curriculum", "vitae", "resume", "résumé", "cv", "profile", "summary", "experience", "education",
    "skills", "contact", "product", "manager", "senior", "objective", "professional", "work", "history",
    "about", "me", "personal", "details", "projects", "achievements",
  ],
);

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

function looksLikeName(line: string): boolean {
  const cleaned = line.replace(/[|•·,]+.*$/, "").trim();
  if (cleaned.length < 3 || cleaned.length > 60) return false;
  if (/\d|@|\/|:/.test(cleaned)) return false;
  const words = cleaned.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (words.every((w) => HEADING_WORDS.has(w.toLowerCase()))) return false;
  if (words.some((w) => HEADING_WORDS.has(w.toLowerCase()) && words.length <= 2)) return false;
  // Title Case or ALL CAPS words, allowing initials, hyphens and apostrophes
  return words.every((w) => /^(?:[A-Z][a-zA-Z'’\-]+|[A-Z]\.?|[A-Z][A-Z'’\-]+)$/.test(w));
}

function toDisplayName(raw: string): string {
  const cleaned = raw.replace(/[|•·,]+.*$/, "").trim();
  if (cleaned === cleaned.toUpperCase()) {
    return cleaned
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return cleaned;
}

export function detectName(text: string): string | null {
  const labelled = NAME_LABEL_RE.exec(text);
  if (labelled && looksLikeName(labelled[1])) return toDisplayName(labelled[1]);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of lines) {
    if (looksLikeName(line)) return toDisplayName(line);
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes every occurrence of the given name (full, and each part of three or more letters). */
export function redactName(text: string, name: string): { text: string; count: number } {
  let count = 0;
  const parts = name.split(/\s+/).filter((p) => p.replace(/\./g, "").length >= 3);
  const patterns = [name, ...parts].map((p) => new RegExp(`\\b${escapeRe(p)}(?:'s|’s)?\\b`, "gi"));
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, () => {
      count++;
      return "[CANDIDATE]";
    });
  }
  out = out.replace(/\[CANDIDATE\](?:\s+\[CANDIDATE\])+/g, "[CANDIDATE]");
  return { text: out, count };
}

/**
 * Fallback when the CV text carries no name: "pm_03_deepika_nair.pdf" / "01_rohan-mehta.docx" → "Deepika Nair".
 * The filename is never sent to the AI; this only fills the private record and drives redaction.
 */
export function nameFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/^(?:s?pm[_\-\s]+)?\d+[_\-\s]+/i, "");
  const words = base.split(/[_\-\s]+/).filter(Boolean);
  if (words.length < 2 || words.length > 4 || words.some((w) => !/^[a-z]+$/i.test(w))) return null;
  if (words.some((w) => HEADING_WORDS.has(w.toLowerCase()))) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export function extractPii(rawText: string, fileName?: string): PiiResult {
  const text = rawText.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const redactions: Record<string, number> = {};
  const bump = (k: string, n = 1) => (redactions[k] = (redactions[k] ?? 0) + n);

  const emails = text.match(EMAIL_RE) ?? [];
  const email = emails[0] ?? null;

  // Only accept phone-like strings with 9–15 digits that aren't obviously years or ranges.
  const phoneCandidates = (text.match(PHONE_RE) ?? []).filter((p) => {
    const d = digitsOnly(p);
    return d.length >= 9 && d.length <= 15 && !/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(p.trim());
  });
  const phone = phoneCandidates[0]?.trim() ?? null;
  const fileNameGuess = fileName ? nameFromFileName(fileName) : null;
  // A name in the filename is deliberate; a header guess can pick up a job title or place, so the filename wins.
  const name = fileNameGuess ?? detectName(text);

  let anon = text;
  anon = anon.replace(EMAIL_RE, () => (bump("email"), "[EMAIL REDACTED]"));
  for (const p of phoneCandidates) {
    anon = anon.split(p).join("[PHONE REDACTED]");
    bump("phone");
  }
  anon = anon.replace(PROFILE_URL_RE, () => (bump("profile_url"), "[PROFILE URL REDACTED]"));
  anon = anon.replace(PERSONAL_LINE_RE, () => (bump("personal_detail_line"), "[PERSONAL DETAIL REDACTED]"));
  anon = anon.replace(NAME_LABEL_RE, () => "Name: [CANDIDATE]");
  if (name) {
    const r = redactName(anon, name);
    anon = r.text;
    if (r.count) bump("name", r.count);
  }
  anon = anon.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return { name, email, phone, anonymised: anon, redactions };
}

export class PiiLeakError extends Error {}

/**
 * Last line of defence before any AI call: refuses to send the payload if it contains
 * the candidate's private name, email or phone in any form.
 */
export function assertNoPii(
  payload: string,
  pii: { name?: string | null; email?: string | null; phone?: string | null },
) {
  const lower = payload.toLowerCase();
  if (pii.email && lower.includes(pii.email.toLowerCase())) throw new PiiLeakError("email present in AI payload");
  if (pii.phone) {
    const d = digitsOnly(pii.phone);
    // Match the national number (last 10 digits, or all if shorter) with any separators,
    // so "+91 98200 11223", "9820011223" and "98200-11223" are all caught.
    const national = d.length > 10 ? d.slice(-10) : d;
    if (national.length >= 8) {
      const re = new RegExp(national.split("").join("[\\s.\\-()]*"));
      if (re.test(payload)) throw new PiiLeakError("phone present in AI payload");
    }
  }
  if (pii.name) {
    const parts = [pii.name, ...pii.name.split(/\s+/).filter((p) => p.replace(/\./g, "").length >= 3)];
    for (const p of parts) {
      if (new RegExp(`\\b${escapeRe(p)}\\b`, "i").test(payload)) {
        throw new PiiLeakError("name present in AI payload");
      }
    }
  }
}
