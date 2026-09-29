# Kargo Hiring Dashboard

Internal tool for Arjun. **AI ranks and explains. Arjun decides.**

Bulk-upload CVs → PII separated locally → Gemini scores the anonymised CV against both rubrics in `rubric.txt` → ranked shortlists with evidence → Arjun shortlists, picks finalists, confirms offers → individual offer/rejection drafts → Arjun edits, approves and confirms sending via Resend.

Internal design notes (architecture, pipeline, status model): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). None of it is shown in the UI.

## Run locally

```bash
npm install
cp .env.example .env.local     # fill in keys (see below); blanks = dev fallbacks
npm run seed:rubric            # parses rubric.txt, validates each role = 100%, seeds rubric_criteria
npm run dev
```

With no keys set, the app runs on a local file store (`.data/`, git-ignored) and a clearly bannered **mock AI**. It's useful for exercising the flow, but it is not a real assessment. Both fallbacks refuse to run on Vercel production.

## Tests (run before the full dataset)

```bash
npm test          # unit: rubric parsing/weights, PII split, PII guard, scoring maths, evidence verification
npm run test:e2e  # the 3-CV acceptance test: strong PM, weak SPM, ambiguous
```

`test:e2e` checks, per CV: row created, private details extracted, anonymised text has no name/email/phone, PM + SPM scores, per-criterion reasoning, weighted sums, verified evidence, ranking, status. It also checks that every prompt sent to the AI is free of identifiers, the assessment for the shortlisted candidate, offer and rejection drafts, and that **no email was sent**. It forces email sending off.

Run it once with `GEMINI_API_KEY` set and read the scores and reasoning yourself before uploading the full application set. Add `E2E_USE_CONFIGURED_DB=1` to run it against Supabase.

## Deploy (GitHub → Vercel, Supabase, Gemini, Resend)

1. **Supabase**: create a project, open the SQL editor and run `supabase/migrations/0001_init.sql`. Copy the project URL and the **service-role** key.
2. Put the keys in `.env.local` and run `npm run seed:rubric` (seeds Supabase), then `npm run test:e2e` with `E2E_USE_CONFIGURED_DB=1`.
3. **GitHub**: `git remote add origin … && git push -u origin main`. `.env.local` is git-ignored; check with `git check-ignore .env.local`.
4. **Vercel**: import the repo and add every variable from `.env.example` in Project → Settings → Environment Variables. **`DASHBOARD_PASSWORD` is required**: the app returns 503 in production without it.
5. `npm run build && npm run check:client-secrets` confirms that no key or server SDK is in the client bundle.
6. **Resend**: verify your sending domain and set `RESEND_API_KEY` and `EMAIL_FROM`. Keep `EMAIL_SENDING_ENABLED=false` until everything is tested. For a live test, set `EMAIL_TEST_RECIPIENT` to your own address first: every send then goes there, not to candidates.

Optional: add a Vercel Cron hitting `GET /api/process` with header `Authorization: Bearer $CRON_SECRET`, so the queue drains even with the browser closed. Otherwise the processing page drives it.

## Environment variables

All of these are server-only. None uses the `NEXT_PUBLIC_` prefix.

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (RLS on, no policies: anon key can't read anything) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini Flash (default `gemini-flash-latest`) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Email delivery |
| `EMAIL_SENDING_ENABLED` | `true` to actually send; anything else = dry run |
| `EMAIL_TEST_RECIPIENT` | Redirect every send to this address |
| `DASHBOARD_USER`, `DASHBOARD_PASSWORD` | HTTP basic auth for the whole app |
| `CRON_SECRET` | Bearer token for the `/api/process` cron |
