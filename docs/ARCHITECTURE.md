# Architecture (internal: not shown in the dashboard)

```
Browser ──► Next.js (App Router, Vercel)
              ├─ proxy.ts           basic auth on every page + API route
              ├─ Server Components  read the DB server-side; no secrets reach the client
              └─ /api/* routes      the only place that touches Supabase, Gemini, Resend
                    ├─ lib/pii          local regex/heuristic PII split + assertNoPii guard
                    ├─ lib/parse-file   PDF (unpdf) / DOCX (mammoth) / TXT
                    ├─ lib/ai           the single AI entry point: guard → JSON schema → zod → retry
                    ├─ lib/scoring      evidence verification, weighted maths, ranking (no AI)
                    ├─ lib/pipeline     ingest → claim → analyse → save; briefs; email drafts
                    ├─ lib/db           Repo interface: Supabase (prod) | local JSON (dev)
                    └─ lib/email        Resend, dry-run unless EMAIL_SENDING_ENABLED=true
```

## Pipeline, per candidate (each one is independent)

1. **Upload** (`/api/upload`, 5 files per request from the client, one batch_id). Parse the text, then `extractPii` runs locally: name (header heuristic or "Name:" label), email, phone, profile URLs, and DOB/gender/address lines are pulled out. The PII goes to `private_*` columns and the rest to `anonymised_cv_content`. Status becomes `queued`. Unreadable files become `failed` with a "Replace file" action.
2. **Claim** (`/api/process`): `claim_candidates(n)` uses `FOR UPDATE SKIP LOCKED`, so parallel workers and cron never double-process a candidate. Stale claims older than 10 minutes are reclaimed.
3. **Analyse**: Gemini extraction, PM scoring and SPM scoring run in parallel. Each call:
   - `assertNoPii` over the full prompt. If a name, email or phone is found, the call is refused and never retried.
   - `responseJsonSchema` + `temperature: 0` → `zod` validation + content checks (e.g. exactly one result per criterion id). Up to 3 attempts with backoff; failures are logged.
4. **Score** (`computeScores`, deterministic): each evidence quote must exist verbatim in the anonymised CV, or it is discarded. A score above 1 with no verified quote is capped at 1 and marked "evidence not present". contribution = score/5 × weight; overall = the sum (0–100).
5. **Save** only after everything validates. On error: `failed` + error message + audit entry; existing data is untouched; the founder can retry.
6. **Shortlist** (founder action) generates the interview brief (`candidate_assessments`).
7. **Emails**: Gemini drafts with a `{{candidate_name}}` placeholder, and the server substitutes the real name, so the model never sees it. Rejection drafts are checked for leaked scores. Offer drafts carry `[Compensation]`, `[Start date]` and `[Response deadline]` placeholders, and approval is blocked until they're filled in.

## Status model

| Dimension | Values | Who moves it |
| --- | --- | --- |
| processing_status | queued → processing → completed / failed | system (retry = founder) |
| workflow_status | processing → analysed → shortlisted → finalist → selected / rejected | **founder only** |
| email_drafts.status | draft → approved → sent / failed | founder approves + confirms send |

`selected` is reachable only through `/api/selections/confirm` with `confirm: true` (a review modal plus an acknowledgement checkbox). Sending is reachable only through `/api/emails/send` with `confirmation: "CONFIRM_SEND"` (the UI makes you type SEND) and only for `approved` drafts whose candidate still has the matching decision. Undoing a decision is blocked once its email has been sent.

The dashboard shows a combined label, e.g. `Selected · Email Draft Ready`, `Rejected · Sent`.

## Recommendation (advisory, deterministic)

Within the applied role: rank ≤ N **and** score ≥ min → "Recommend shortlist"; rank ≤ 2N → "Borderline"; otherwise "Below shortlist". N (per role) and min are editable on the shortlist pages (`settings` table). The AI never changes `workflow_status`.

## Scale

Nothing is per-CV synchronous: uploads are chunked, processing is a claimable queue, and each candidate succeeds or fails alone. 60+ CVs means more `/api/process` ticks, not a different architecture. Raise the parallelism via `WORKERS` in `Uploader.tsx` or add the cron.

## Schema

See `supabase/migrations/0001_init.sql`: `rubric_criteria`, `candidates` (PII in `private_*`), `candidate_scores` (unique per candidate × role, `criterion_scores` jsonb), `candidate_assessments`, `email_drafts` (one per candidate × type), `audit_log`, `settings`.
