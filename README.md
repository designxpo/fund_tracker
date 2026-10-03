# Spends: daily spend tracker

Next.js (App Router) + Tailwind + Supabase. Spec: `../spend-tracker-app-spec.md`.

## Setup
1. Create a Supabase project. In the SQL editor run, in order:
   `supabase/migrations/0001_init.sql`, `0002_phases_2_4.sql`, `0003_planner_income.sql`
   (tables, RLS on every table, seed, salary-day rollover, goal planner, extra income).
2. Auth → Email templates → *Magic Link*: add `{{ .Token }}` to the body, e.g.
   `Your code: {{ .Token }}`. This enables the 6-digit code on the login screen, which is the reliable
   path for the installed iOS PWA (links open in Safari, which has separate storage).
3. Auth → URL configuration: add `http://localhost:3000/auth/callback` and your Vercel URL
   `/auth/callback` to the redirect allow-list.
4. `cp .env.local.example .env.local` and fill in the project URL + publishable key
   (on Vercel: add the same two variables under Settings → Environment Variables).
5. `npm run dev` (service worker only registers in production builds: `npm run build && npm start`).
6. After your first login, turn off *Allow new users to sign up* in Supabase (single-user app).

Defaults are seeded automatically on first login. Deploy by importing the folder into Vercel with the same two env vars.

## Notes
- Offline: spends are saved locally with a client-generated UUID, queued, and upserted on reconnect, so retries cannot duplicate.
- `npm test` runs the pure-logic tests: budget maths, card suggestion, bill reminders, loan payoff formula, goal planner.
- `categories.small_card_id`: spends under ₹200 in that category suggest a different card (data, not hard-coded).
- **Personal numbers stay out of git.** The migrations seed an example persona. Put your real defaults in
  `supabase/personal/seed_defaults.sql` (git-ignored) and apply it after the migrations.
