-- App errors reported by the browser (sync rejections, crashes), so problems don't go unnoticed.
create table client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  happened_at timestamptz not null default now(),
  kind text not null,          -- 'sync' | 'crash' | 'unhandled' | 'action'
  message text not null,
  detail text,
  url text
);
create index client_errors_user_time_idx on client_errors (user_id, happened_at desc);

alter table client_errors enable row level security;
create policy client_errors_select on client_errors for select using (user_id = auth.uid());
create policy client_errors_insert on client_errors for insert with check (user_id = auth.uid());
create policy client_errors_delete on client_errors for delete using (user_id = auth.uid());
