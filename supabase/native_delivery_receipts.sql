-- Additive upgrade; private transport records remain unavailable to app clients.
alter table public.native_monitor_deliveries add column if not exists push_tickets jsonb not null default '[]'::jsonb;
create table if not exists public.native_notification_receipts (
  event_id uuid not null references public.fall_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  opened_at timestamptz,
  primary key (event_id,user_id)
);
alter table public.native_notification_receipts enable row level security;
revoke all on public.native_notification_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.native_notification_receipts to service_role;
