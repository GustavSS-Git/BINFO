# Deploy runbook: v3 to production

For the owner and the supervisor together. Every step that touches production
needs the owner's OK at the time. Estimated time: 45–60 minutes. API cost: about
10 kr (two re-runs and a smoke-test upload).

## What changes

| Part | Change | Reversible? |
|---|---|---|
| Database | Two additive migrations: `20261013120000_konto_v3.sql` (saved items, account RPCs) and `20261013120100_register_v3.sql` (register columns, summary table, `pg_trgm`) | Yes: `supabase/rollback/*.down.sql` (konto_v3 first) |
| Edge Function `analys-steg` | Pipeline v7 (`PIPELINE_VERSION` `p6.i1.s1` → `p7.i1.s1`): BRF addresses, page-reference verifier, register area + summary, error logging | Yes: redeploy from the previous `main` commit |
| Web app (Lovable publish) | Accounts, `/konto`, `/brf`, `/sitemap.xml`, calculator rules/KALP/exports, Spara | Yes: Lovable version history |
| Supabase Auth settings | Site URL, redirect URLs, Swedish templates, providers | Yes (dashboard) |

Why the order below matters: the prompt version is part of `pipeline_version`.
If the new Edge worker runs while the old web app is still creating `p6` jobs,
those jobs fail with `versionskonflikt` (and vice versa). The kill switch
stops new uploads during the switch-over.

## 0. Before the window

- [ ] `v3` is green: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
  (the supervisor reports the real output).
- [ ] Owner has read `docs/auth-setup.md`; Resend domain shows **Verified**.
- [ ] `PROJECT_PUBLISHABLE_KEY` is in Lovable Secrets (done 2026-10-13).
- [ ] The Edge Function secret `ANTHROPIC_API_KEY` is current (rotated 2026-10-13).
- [ ] Nobody edits in Lovable during the window.

## 1. Stop new uploads (owner)

1. Set `ANALYSIS_KILL_SWITCH=on` in **Lovable Secrets** and in **Supabase → Edge
   Functions → Secrets**. New uploads are refused (the copy is the generic "kunde inte slutföras"
   error, `fel.ts` maps the kill switch to `unknown` on purpose).
2. Wait until no job is running: `npm run register -- list --limit 10` shows no
   `queued`/`running` rows (usually within 5 minutes).

## 2. Database (supervisor, owner OK)

```
npx supabase@2.117.0 db push          # applies konto_v3, then register_v3
npm run verify-rls                    # against production: must say GODKÄNT
```

Both migrations are additive; the running v2 code keeps working on the new
schema (new columns have defaults or are nullable).

## 3. Edge Function (supervisor, owner OK)

```
npm run deploy:edge                   # bundles steg.ts (v7) and deploys analys-steg
```

## 4. Web app (owner)

1. Supervisor merges `v3` into `main` and pushes (owner OK).
2. Lovable syncs `main`. Check the build succeeds (the Worker bundle measured
   1.70 MB gzipped locally; Cloudflare's free-plan limit is 3 MB).
3. **Publish** in Lovable.

## 5. Supabase Auth settings (owner)

Follow `docs/auth-setup.md` §3–§6: Site URL `https://binfo.slanesens.com`,
redirect URLs, the three Swedish templates from `docs/epostmallar/`, "Confirm
email" on, minimum password length 10, other providers off.

## 6. Re-open uploads and re-run existing reports

1. Set `ANALYSIS_KILL_SWITCH=off` in both places.
2. The two existing register reports (Brf Laxöringen 1, Brf Pontonjären 3) are
   still `p6`: they are served with a "tidigare version" note and re-run lazily
   on the next read. To get them into `/brf` straight away:
   `npm run register -- rerun --to-current --dry-run`, then without
   `--dry-run` (queues the older-version reports; the worker runs them,
   ≈ 3.5 kr each; supervisor, owner OK).

## 7. Smoke test (supervisor + owner)

- [ ] Upload a text report on `/analysera` → preview → full report; the API log
  shows ≈ 3 kr; `register -- inspect` shows `p7.i1.s1`, `proveniens api`.
- [ ] The BRF appears on `/brf` in the right area; its page shows nyckeltal with
  page references and no buyer data; view-source has title, description,
  canonical and JSON-LD.
- [ ] `https://binfo.slanesens.com/sitemap.xml` lists it; `robots.txt` has the
  Sitemap line.
- [ ] Accounts: `docs/auth-setup.md` §7 (sign up with a real address, confirm,
  reset password, save a valuation and a kalkyl, export PDF/Excel from the
  profile, delete the account).
- [ ] `/bolanekalkyl`: fill in, download PDF and Excel, open the Excel file in
  Excel or Numbers and change the interest rate.
- [ ] No console errors on `/`, `/brf`, `/konto`, `/bolanekalkyl`.

## Rollback

| Problem | Action |
|---|---|
| Web app broken | Lovable → version history → restore the previous version. Uploads keep working against the v3 database (additive). |
| Edge worker failing | Kill switch on; redeploy the previous Edge version (`git checkout <previous main> -- . && npm run deploy:edge` in a separate clone, never on the shared tree). |
| Migrations must go | Kill switch on; run `supabase/rollback/20261013120000_konto_v3.down.sql`, then `…120100_register_v3.down.sql` (manual, in the SQL editor). Saved items are lost; the register is kept. |
| Auth emails not arriving | Resend → Logs; Supabase → Auth logs. Accounts can be switched off by removing `PROJECT_PUBLISHABLE_KEY` from Lovable Secrets (the app falls back to anonymous). |
