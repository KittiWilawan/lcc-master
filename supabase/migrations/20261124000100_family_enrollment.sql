create or replace function public.join_family(p_code text)
returns table(family_id uuid, family_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_id uuid;
  found_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select f.id, f.family_code into found_id, found_code from public.families f
  where lower(f.family_code) = lower(btrim(p_code));
  if exists (select 1 from public.family_members m where m.family_id = found_id and m.user_id = auth.uid()) then
    return query select found_id, found_code;
    return;
  end if;

  if (
    select count(*)
    from private.family_join_attempts
    where user_id = (select auth.uid())
      and attempted_at > now() - interval '15 minutes'
  ) >= 5 then
    raise exception using errcode = 'P0429', message = 'Too many attempts';
  end if;

  insert into private.family_join_attempts(user_id) values ((select auth.uid()));
  if found_id is null then return; end if;

  insert into public.family_members(family_id, user_id, display_name, role)
  values (
    found_id,
    (select auth.uid()),
    coalesce(
      (select profile.full_name from public.profiles profile where profile.id = (select auth.uid())),
      'สมาชิกใหม่'
    ),
    'สมาชิก (Member)'
  )
  on conflict do nothing;

  return query select found_id, found_code;
end;
$$;

revoke all on function public.join_family(text) from public, anon;
grant execute on function public.join_family(text) to authenticated;

create or replace function public.remove_family_caregiver(p_family uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.families f where f.id = p_family and f.owner_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  delete from public.family_members m where m.id = p_member and m.family_id = p_family
    and m.user_id is not null and m.user_id <> auth.uid();
  if not found then raise exception 'Member unavailable'; end if;
end;
$$;

-- The owner uploads a complete draft before a recipient becomes visible to monitoring.
drop policy if exists enrollment_owner_stage on storage.objects;
create policy enrollment_owner_stage on storage.objects for insert to authenticated
with check (bucket_id = 'identity-references' and (storage.foldername(name))[3] = 'enrollment'
  and private.is_family_owner((storage.foldername(name))[1]::uuid));

-- Do not let cleanup from another device delete a currently committed reference.
drop policy if exists enrollment_keep_active_files on storage.objects;
create policy enrollment_keep_active_files on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'identity-references' or not exists (
  select 1 from public.identity_references r where r.storage_path = storage.objects.name
));

create or replace function public.save_body_enrollment(p_family uuid, p_member uuid, p_batch uuid,
  p_name text, p_role text, p_create boolean, p_consent boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  prefix text := p_family::text || '/' || p_member::text || '/enrollment/' || p_batch::text || '/';
  poses text[] := array['full_body','front','left','right'];
begin
  if not exists (select 1 from public.families f where f.id = p_family and f.owner_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  if p_consent is not true or p_batch is null or p_member is null then raise exception 'Consent and scan required'; end if;
  if exists (select 1 from unnest(poses) pose where not exists (
    select 1 from storage.objects obj where obj.bucket_id = 'identity-references' and obj.name = prefix || pose || '.jpg'
  )) then raise exception 'Incomplete scan'; end if;
  if p_create then
    if nullif(btrim(p_name),'') is null then raise exception 'Name required'; end if;
    insert into public.family_members(id,family_id,user_id,display_name,role,is_tracked,device_registered,identity_consent_at)
    values(p_member,p_family,null,btrim(p_name),coalesce(nullif(btrim(p_role),''),'ผู้รับการดูแล'),true,false,now())
    on conflict(id) do nothing;
    if not found and not exists(select 1 from public.identity_references r where r.member_id=p_member and r.family_id=p_family
      and r.storage_path=prefix || 'full_body.jpg') then raise exception 'Member already exists'; end if;
  end if;
  perform 1 from public.family_members m where m.family_id=p_family and m.id=p_member and m.user_id is null
    and m.identity_consent_at is not null for update;
  if not found then raise exception 'Recipient or consent unavailable'; end if;
  insert into public.identity_references(family_id,member_id,pose,storage_path,created_by)
    select p_family,p_member,pose,prefix || pose || '.jpg',auth.uid() from unnest(poses) pose
    on conflict(member_id,pose) do update set storage_path=excluded.storage_path,created_by=excluded.created_by,created_at=now();
  return p_member;
end;
$$;
drop policy if exists members_owner_insert on public.family_members;
revoke all on function public.remove_family_caregiver(uuid,uuid), public.save_body_enrollment(uuid,uuid,uuid,text,text,boolean,boolean) from public,anon;
grant execute on function public.remove_family_caregiver(uuid,uuid), public.save_body_enrollment(uuid,uuid,uuid,text,text,boolean,boolean) to authenticated;
