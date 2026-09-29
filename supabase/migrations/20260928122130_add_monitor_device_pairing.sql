create table public.monitor_devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  state text not null default 'paired' check (state in ('paired', 'idle', 'running', 'degraded', 'stopped')),
  detail text,
  camera_count integer not null default 0 check (camera_count >= 0),
  analyzed_count integer not null default 0 check (analyzed_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  revoked_at timestamptz
);

create index monitor_devices_family_idx
  on public.monitor_devices(family_id, created_at desc);

create table public.monitor_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at)
);

create index monitor_pairing_codes_expiry_idx
  on public.monitor_pairing_codes(expires_at)
  where used_at is null;

alter table public.monitor_devices enable row level security;
alter table public.monitor_pairing_codes enable row level security;

revoke all on public.monitor_devices, public.monitor_pairing_codes from public, anon, authenticated;
grant select on public.monitor_devices to authenticated;

create policy "monitor_devices_family_read"
  on public.monitor_devices for select to authenticated
  using (private.is_family_member(family_id));

alter table public.monitor_health
  add column if not exists device_id uuid references public.monitor_devices(id) on delete set null;
