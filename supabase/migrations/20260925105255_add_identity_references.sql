alter table public.family_members
  add column if not exists identity_consent_at timestamptz;

create table if not exists public.identity_references (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  member_id uuid not null references public.family_members(id) on delete cascade,
  pose text not null check (pose in ('front', 'left', 'right', 'full_body')),
  storage_path text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (member_id, pose)
);

create index if not exists identity_references_family_member_idx
  on public.identity_references(family_id, member_id);

alter table public.identity_references enable row level security;
revoke all on public.identity_references from anon, authenticated;
grant select, insert, update, delete on public.identity_references to authenticated;

drop policy if exists "identity_references_family_read" on public.identity_references;
drop policy if exists "identity_references_owner_insert" on public.identity_references;
drop policy if exists "identity_references_owner_update" on public.identity_references;
drop policy if exists "identity_references_owner_delete" on public.identity_references;

create policy "identity_references_family_read"
  on public.identity_references for select to authenticated
  using (private.is_family_member(family_id));

create policy "identity_references_owner_insert"
  on public.identity_references for insert to authenticated
  with check (
    private.is_family_owner(family_id)
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.family_members member
      where member.id = member_id
        and member.family_id = identity_references.family_id
        and member.user_id is null
        and member.identity_consent_at is not null
    )
  );

create policy "identity_references_owner_update"
  on public.identity_references for update to authenticated
  using (private.is_family_owner(family_id))
  with check (
    private.is_family_owner(family_id)
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.family_members member
      where member.id = member_id
        and member.family_id = identity_references.family_id
        and member.user_id is null
        and member.identity_consent_at is not null
    )
  );

create policy "identity_references_owner_delete"
  on public.identity_references for delete to authenticated
  using (private.is_family_owner(family_id));

create or replace function public.set_identity_consent(p_member_id uuid, p_consent boolean)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
  consent_time timestamptz;
begin
  select member.family_id
    into target_family_id
    from public.family_members member
   where member.id = p_member_id
     and member.user_id is null;

  if target_family_id is null or not private.is_family_owner(target_family_id) then
    raise exception 'Only the family owner can manage identity consent';
  end if;

  if not p_consent and exists (
    select 1 from public.identity_references reference
    where reference.member_id = p_member_id
  ) then
    raise exception 'Delete identity references before withdrawing consent';
  end if;

  consent_time := case when p_consent then now() else null end;
  update public.family_members
     set identity_consent_at = consent_time
   where id = p_member_id;
  return consent_time;
end;
$$;

revoke all on function public.set_identity_consent(uuid, boolean) from public, anon;
grant execute on function public.set_identity_consent(uuid, boolean) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-references',
  'identity-references',
  false,
  2000000,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "identity_reference_objects_family_read" on storage.objects;
drop policy if exists "identity_reference_objects_owner_insert" on storage.objects;
drop policy if exists "identity_reference_objects_owner_delete" on storage.objects;

create policy "identity_reference_objects_family_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'identity-references'
    and private.is_family_member((storage.foldername(name))[1]::uuid)
  );

create policy "identity_reference_objects_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'identity-references'
    and private.is_family_owner((storage.foldername(name))[1]::uuid)
    and exists (
      select 1
      from public.family_members member
      where member.family_id = (storage.foldername(name))[1]::uuid
        and member.id = (storage.foldername(name))[2]::uuid
        and member.user_id is null
        and member.identity_consent_at is not null
    )
  );

create policy "identity_reference_objects_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'identity-references'
    and private.is_family_owner((storage.foldername(name))[1]::uuid)
  );
