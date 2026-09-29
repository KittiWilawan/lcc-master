create table public.monitor_health (
  family_id uuid primary key references public.families(id) on delete cascade,
  state text not null check (state in ('idle', 'running', 'degraded', 'stopped')),
  camera_count integer not null default 0 check (camera_count >= 0),
  analyzed_count integer not null default 0 check (analyzed_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  detail text,
  checked_at timestamptz not null default now()
);

alter table public.monitor_health enable row level security;
revoke all on public.monitor_health from anon, authenticated;
grant select, insert, update on public.monitor_health to authenticated;

create policy "monitor_health_family_read" on public.monitor_health
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "monitor_health_family_insert" on public.monitor_health
  for insert to authenticated
  with check (private.is_family_member(family_id));

create policy "monitor_health_family_update" on public.monitor_health
  for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

alter table public.fall_events add column resolution_deadline timestamptz;

create function public.cancel_pending_fall(p_event_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  with changed as (
    update public.fall_events
       set status = 'cancelled'
     where id = p_event_id
       and event_type = 'actual'
       and status = 'pending'
       and resolution_deadline > now()
    returning id
  )
  select exists (select 1 from changed);
$$;

create function public.finalize_pending_fall(p_event_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  with changed as (
    update public.fall_events
       set status = 'notified'
     where id = p_event_id
       and event_type = 'actual'
       and status = 'pending'
       and resolution_deadline <= now()
    returning id
  )
  select exists (select 1 from changed);
$$;

revoke all on function public.cancel_pending_fall(uuid), public.finalize_pending_fall(uuid) from public, anon;
grant execute on function public.cancel_pending_fall(uuid), public.finalize_pending_fall(uuid) to authenticated;
