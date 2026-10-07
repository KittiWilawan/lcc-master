create table public.native_monitor_devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index native_monitor_devices_user_family_idx on public.native_monitor_devices(user_id, family_id);
create table public.native_monitor_deliveries (
  event_id uuid primary key references public.fall_events(id) on delete cascade,
  device_id uuid not null references public.native_monitor_devices(id) on delete cascade,
  accepted_tokens jsonb not null default '[]',
  lease_until timestamptz,
  last_result text,
  updated_at timestamptz not null default now()
);
alter table public.native_monitor_devices enable row level security;
alter table public.native_monitor_deliveries enable row level security;
revoke all on public.native_monitor_devices, public.native_monitor_deliveries from public, anon, authenticated;
grant all on public.native_monitor_devices, public.native_monitor_deliveries to service_role;

create function public.claim_native_monitor_delivery(p_event_id uuid, p_device_id uuid, p_seconds integer)
returns boolean language sql security invoker set search_path = '' as $$
  with claimed as (
    update public.native_monitor_deliveries
      set lease_until = now() + make_interval(secs => p_seconds), updated_at = now()
      where event_id = p_event_id and device_id = p_device_id
        and (lease_until is null or lease_until < now())
      returning event_id
  ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_native_monitor_delivery(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_native_monitor_delivery(uuid, uuid, integer) to service_role;
