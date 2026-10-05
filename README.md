# Spends: daily spend tracker

Mobile-first PWA to log daily spends in seconds, stay inside a daily budget, run the salary-day routine,
and plan goals. Next.js (App Router) + Tailwind + Supabase (Postgres, RLS, Auth).

## Setup (new Supabase project)
1. `cp .env.local.example .env.local`: project URL + publishable key (same two vars on Vercel).
2. `cp .env.db.example .env.db`: Postgres connection string (Supabase → Connect → Session pooler).
3. Apply the schema: `set -a; source .env.db; set +a; npm run db:push`.
4. Optional, personal defaults: apply your own git-ignored `supabase/personal/*.sql` (real seed numbers,
   owner-only sign-up lock).
5. `npm run dev`. Defaults are seeded on first login.

## Architecture
- **Spends** go through an offline-first store (`src/lib/store.tsx`): saved locally with a client UUID,
  queued, and upserted on reconnect (no duplicates). Rejected changes are kept for Retry/Discard.
- **Everything else** (plans, goals, loan, income, planner) is read through one shared, persisted
  TanStack Query cache (`useData(name, fetcher, key)`); any write refreshes every screen.
- **Money moves are database functions**, each one transaction: `set_plan_item`, `settle_month`,
  `undo_settlement`, `set_settlement`, `cover_shortfall`, `add_goal_contribution`, `log_income`,
  `delete_goal`, `start_cycle`. The app calls them through `rpc()` (`src/lib/rpc.ts`).
- **Triggers** keep planned/unplanned spend withdrawals and sinking-fund due dates in sync.
- **Dates** are local (`app_today()`, default Asia/Kolkata via `settings.timezone`), not server UTC.
- **Built-in goals** are found by `goals.role` (emergency / trip / buffer / long_term), never by name;
  loan plan lines link via `loan_id`.
- **Bookkeeping** (card bills, daily-budget result, leftover moved / shortfall borrowed) lives in
  `cycle_settlements`; `plan_items` holds only real plan lines. Balances come from the `goal_balances` view.
- **Errors** (sync rejections, crashes, failed actions) are recorded in `client_errors`
  and listed under Settings → Recent app errors.

## Database workflow (Supabase CLI)
- `supabase/migrations/20261005000000_baseline.sql`: full schema (example seed; no personal data).
- New change: `npm run db:new <name>`, edit the file, `npm run db:push`. Never edit an applied migration.
- `npm run db:status`: local vs remote migration history.
- `supabase/archive/`: the original hand-applied files, kept for history only.

## Tests
| Command | What |
|---|---|
| `npm test` | Pure logic: budget, alerts, loan formula, goal planner, month settlement |
| `npm run test:db` | SQL tests in one rolled-back transaction with throwaway users (RLS, triggers, every money function). Needs `DATABASE_URL`. |
| `npm run test:e2e` | Playwright smoke tests (needs `npm run build`). The signed-in spend flow runs when `E2E_EMAIL`/`E2E_PASSWORD` are set; it logs and deletes a ₹1 spend. |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and Playwright on every push;
database tests run when a `DATABASE_URL` repo secret exists.

## Privacy
Never store card numbers or bank details: cards are nicknames. Real numbers live only in the database
and in git-ignored `supabase/personal/`.
