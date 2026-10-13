# Auth setup for the hosted Supabase project

Checklist for the owner. The owner has already created the Resend account and added the
domain, so the SMTP part may be done: **verify each item, do only what is missing.** Nothing here
is applied by code; the local stack takes the same settings from `supabase/config.toml`.

Do this after `db push` of `20261013120000_konto_v3.sql` and before the Lovable publish that
contains the account routes. Tell the supervisor first: this changes production settings.

## 1. Environment (Lovable Secrets)

- [ ] `PROJECT_PUBLISHABLE_KEY` is set (the `sb_publishable_…` key). Accounts need it; without it
  the app silently has no accounts (`kontextMedSession`) and the account functions answer
  "Konton är inte aktiverade just nu".
- [ ] `PROJECT_SECRET_KEY`, `PROJECT_URL` already set (v2).

## 2. Resend SMTP (Supabase dashboard → Authentication → Emails → SMTP Settings)

**Done by the owner:**

- [x] Custom SMTP enabled: host `smtp.resend.com`, port `465`, user `resend`, password = Resend
  API key, sender `noreply@binfo.slanesens.com`, sender name `Binfo`.
- [x] Minimum interval between emails 60 s; email rate limit 30/hour.

**Still to verify:**

- [ ] In Resend the domain shows **Verified** (SPF and DKIM records in DNS for the sending domain;
  a DMARC record is recommended).
- [ ] Send a real test (step 7).

The built-in Supabase mailer is limited to a few emails per hour and only to team members, so
production must use custom SMTP.

## 3. URL configuration (Authentication → URL Configuration)

- [ ] **Site URL:** `https://binfo.slanesens.com`
- [ ] **Redirect URLs:** `https://binfo.slanesens.com/**` (and `http://localhost:8080/**` if you
  want local dev against the hosted project; not recommended).

The email links are built from the Site URL (`{{ .SiteURL }}/konto/bekrafta?token_hash=…&type=…`),
so a wrong Site URL breaks every link.

## 4. Email templates (Authentication → Emails → Templates)

Paste the files from `docs/epostmallar/` (HTML) and set the subjects:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `bekrafta-konto.html` | Bekräfta din e-postadress hos Binfo |
| Reset password | `aterstall-losenord.html` | Återställ ditt lösenord hos Binfo |
| Change email address | `byt-epost.html` | Bekräfta ny e-postadress hos Binfo |

Leave "Magic link", "Invite" and "Reauthentication" untouched (unused). Keep the variables
`{{ .SiteURL }}`, `{{ .TokenHash }}` and `{{ .NewEmail }}` exactly as in the files.

## 5. Sign-in providers and policy (Authentication → Sign In / Providers → Email)

- [ ] **Email provider enabled; "Confirm email" ON.** Required: the code never logs anyone in from
  sign-up, and warns in the server log if Auth returns a session at sign-up (= confirmations off).
- [ ] **Minimum password length: 10** (the app enforces 10 and at most 72 bytes before calling Auth).
- [ ] **Leaked password protection** (HaveIBeenPwned check): enable if the plan offers it (Pro plan
  and above at the time of writing; check the dashboard). If the plan does not have it, nothing
  breaks: the app's rules still apply. Note it as a known gap.
- [ ] Anonymous sign-ins: **off**. Other providers (Google etc.): **off**.
- [ ] Secure password change: leave **off** (the recovery link signs the user in and the app then
  sets the new password through that session).
- [ ] Email OTP expiry: the default (1 hour) is fine; shorter is fine too.
- [x] Minimum interval between emails: 60 seconds (done by the owner).

## 6. Auth rate limits (Authentication → Rate Limits)

The app has its own limits (login 10/IP and 5/address per 15 min, sign-up 5/IP per hour, reset
3/address and 10/IP per hour, in `kvot.ts`); Supabase's are a second layer. Verify:

- [x] "Rate limit for sending emails": 30 per hour (done by the owner). Watch the Resend free
  tier (3 000 mails/month).
- [ ] Sign-ups and sign-ins, token refreshes, token verifications: the defaults are fine.

## 7. Smoke test (after publish)

1. `/konto/skapa` with a real address you control → Swedish confirmation mail arrives (check
   spam; check Resend → Logs) → click → you land logged in.
2. Wrong password → "Fel e-postadress eller lösenord."; about 5 quick wrong attempts for one
   address → "För många försök, vänta en stund."
3. "Glömt lösenord" → mail → link → set a new password → the old one stops working.
4. Log in on `/konto`, save a valuation and a kalkyl, open them, delete them.
5. Radera konto: you can no longer log in; the user is gone under Authentication → Users.

## 8. Things to know

- Sessions live in two httpOnly cookies (`binfo_sa`, `binfo_sr`); the browser never holds a
  Supabase client or tokens. "Sign out all sessions" and token lifetimes are Auth settings
  (JWT expiry stays 3600 s; refresh token rotation on, reuse interval 10 s, which the app relies
  on when two requests refresh at once).
- Password hashes and emails live in Supabase Auth, not in Binfo's tables. `radera konto` deletes
  the Auth user; `npm run konto -- radera <principalId>` does too (needs the publishable key in
  the CLI's env, otherwise it warns that the Auth user remains).
- The privacy text must mention accounts and saved items (docs/PLAN-v3.md §1.3, owner task).
