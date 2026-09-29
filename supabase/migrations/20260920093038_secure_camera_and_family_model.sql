-- Apply to the Supabase project named by EXPO_PUBLIC_SUPABASE_URL.
-- This migration is intentionally not deployed to the separately connected project.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  expo_push_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists fall_alerts boolean default true;
alter table public.profiles add column if not exists activity_summary boolean default true;
alter table public.profiles add column if not exists emergency_sms boolean default false;
alter table public.profiles add column if not exists expo_push_token text;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family_code text unique not null,
  created_at timestamptz default now()
);
alter table public.families add column if not exists family_code text;
alter table public.families alter column family_code type text;
alter table public.families add column if not exists code text;
alter table public.families add column if not exists owner_id uuid references auth.users(id);
alter table public.families add column if not exists created_by uuid references public.profiles(id);
update public.families set family_code = code where family_code is null;
update public.families set owner_id = created_by where owner_id is null;
create unique index if not exists families_family_code_key on public.families(family_code);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role text,
  is_tracked boolean default false,
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.family_members add column if not exists location text;
alter table public.family_members add column if not exists device_registered boolean default false;
create index if not exists family_members_user_idx on public.family_members(user_id, family_id);

create table if not exists public.cameras (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  type text not null,
  url text,
  protocol text,
  assigned_member_id uuid references public.family_members(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.cameras add column if not exists snapshot_url text;
create index if not exists cameras_family_idx on public.cameras(family_id);

create table if not exists public.fall_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_name text not null,
  camera_name text not null,
  image_url text,
  details text,
  ground_duration numeric,
  torso_angle numeric,
  event_type text default 'actual',
  status text default 'notified',
  created_at timestamptz default now()
);
create index if not exists fall_events_family_time_idx on public.fall_events(family_id, created_at desc);
alter table public.fall_events alter column ground_duration drop default;
alter table public.fall_events alter column torso_angle drop default;

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz default now()
);
alter table public.emergency_contacts add column if not exists profile_id uuid references auth.users(id) on delete cascade;
alter table public.emergency_contacts add column if not exists family_id uuid references public.families(id) on delete cascade;
alter table public.emergency_contacts add column if not exists is_primary boolean default false;
alter table public.emergency_contacts add column if not exists icon_name text;
create index if not exists emergency_contacts_profile_idx on public.emergency_contacts(profile_id);

create or replace function private.is_family_member(target_family uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.family_members
    where family_id = target_family and user_id = (select auth.uid())
  );
$$;
create or replace function private.is_family_owner(target_family uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.families
    where id = target_family and owner_id = (select auth.uid())
  );
$$;
create or replace function private.shares_family(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.family_members mine
    join public.family_members theirs on theirs.family_id = mine.family_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = target_user
  );
$$;
revoke all on function private.is_family_member(uuid), private.is_family_owner(uuid), private.shares_family(uuid) from public, anon;
grant execute on function private.is_family_member(uuid), private.is_family_owner(uuid), private.shares_family(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.cameras enable row level security;
alter table public.fall_events enable row level security;
alter table public.emergency_contacts enable row level security;

do $$
declare old_policy record;
begin
  for old_policy in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in
      ('profiles', 'families', 'family_members', 'cameras', 'fall_events', 'emergency_contacts')
  loop
    execute format('drop policy %I on %I.%I', old_policy.policyname, old_policy.schemaname, old_policy.tablename);
  end loop;
end;
$$;

revoke all on public.profiles, public.families, public.family_members, public.cameras, public.fall_events, public.emergency_contacts from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update on public.families to authenticated;
grant select, insert, delete on public.family_members to authenticated;
grant update (display_name, role, is_tracked, avatar_url, location, device_registered) on public.family_members to authenticated;
grant select, insert, update, delete on public.cameras, public.fall_events, public.emergency_contacts to authenticated;

create policy "profiles_family_read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_family(id));
create policy "profiles_self_insert" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles_self_update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "families_member_read" on public.families for select to authenticated
  using (private.is_family_member(id));
create policy "families_owner_update" on public.families for update to authenticated
  using (private.is_family_owner(id)) with check (private.is_family_owner(id));
create policy "members_family_read" on public.family_members for select to authenticated
  using (private.is_family_member(family_id));
create policy "members_owner_insert" on public.family_members for insert to authenticated
  with check (private.is_family_owner(family_id) and user_id is null);
create policy "members_family_update" on public.family_members for update to authenticated
  using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
create policy "members_owner_or_self_delete" on public.family_members for delete to authenticated
  using (private.is_family_owner(family_id) or user_id = (select auth.uid()));
create policy "cameras_family_access" on public.cameras for all to authenticated
  using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
create policy "events_family_access" on public.fall_events for all to authenticated
  using (private.is_family_member(family_id)) with check (private.is_family_member(family_id));
create policy "contacts_owner_access" on public.emergency_contacts for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

create table if not exists private.family_join_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists family_join_attempts_user_time on private.family_join_attempts(user_id, attempted_at desc);
revoke all on private.family_join_attempts from public, anon, authenticated;

create or replace function public.create_family(p_name text)
returns table(family_id uuid, family_code text)
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  new_code text;
  attempt integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  for attempt in 1..10 loop
    new_code := replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.families(name, code, family_code, created_by, owner_id)
      values (coalesce(nullif(trim(p_name), ''), 'ครอบครัว'), new_code, new_code,
        (select auth.uid()), (select auth.uid()))
      returning id into new_id;
      exit;
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
  insert into public.family_members(family_id, user_id, display_name, role)
  values (new_id, (select auth.uid()), coalesce((select full_name from public.profiles where id = (select auth.uid())), 'ผู้ดูแลหลัก'), 'ผู้ดูแลหลัก (Caregiver)');
  return query select new_id, new_code;
end;
$$;

create or replace function public.join_family(p_code text)
returns table(family_id uuid, family_code text)
language plpgsql security definer set search_path = '' as $$
declare found_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if (select count(*) from private.family_join_attempts
      where user_id = (select auth.uid()) and attempted_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many attempts. Please try later';
  end if;
  insert into private.family_join_attempts(user_id) values ((select auth.uid()));
  select f.id into found_id from public.families f where f.family_code = p_code;
  if found_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat(found_id, (select auth.uid())), 0::bigint));
  if not exists (
    select 1 from public.family_members
    where family_id = found_id and user_id = (select auth.uid())
  ) then
    insert into public.family_members(family_id, user_id, display_name, role)
    values (found_id, (select auth.uid()),
      coalesce((select full_name from public.profiles where id = (select auth.uid())), 'สมาชิกใหม่'),
      'สมาชิก (Member)');
  end if;
  return query select found_id, p_code;
end;
$$;
revoke all on function public.create_family(text), public.join_family(text) from public, anon;
grant execute on function public.create_family(text), public.join_family(text) to authenticated;

create or replace function private.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;
insert into public.profiles(id, full_name, phone)
select u.id, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'phone'
from auth.users u on conflict (id) do nothing;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal
  ) then
    drop trigger if exists create_profile_after_signup on auth.users;
    create trigger create_profile_after_signup after insert on auth.users
      for each row execute function private.create_profile_for_user();
  end if;
end;
$$;

insert into storage.buckets(id, name, public)
values ('avatars', 'avatars', true), ('fall-evidence', 'fall-evidence', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Allow public upload fall evidence" on storage.objects;
drop policy if exists "Allow public view fall evidence" on storage.objects;
drop policy if exists "family_evidence_insert" on storage.objects;
drop policy if exists "family_evidence_read" on storage.objects;
drop policy if exists "avatars_authenticated_insert" on storage.objects;

create policy "family_evidence_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'fall-evidence' and private.is_family_member((storage.foldername(name))[1]::uuid));
create policy "family_evidence_read" on storage.objects for select to authenticated
  using (bucket_id = 'fall-evidence' and private.is_family_member((storage.foldername(name))[1]::uuid));
create policy "avatars_authenticated_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');
