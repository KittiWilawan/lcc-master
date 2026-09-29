with ranked_members as (
  select
    member.id,
    row_number() over (
      partition by member.family_id, member.user_id
      order by
        (family.owner_id = member.user_id) desc,
        member.created_at asc,
        member.id asc
    ) as position
  from public.family_members member
  join public.families family on family.id = member.family_id
  where member.user_id is not null
)
delete from public.family_members member
using ranked_members ranked
where member.id = ranked.id
  and ranked.position > 1;

create unique index if not exists family_members_family_user_unique
  on public.family_members(family_id, user_id)
  where user_id is not null;

create or replace function public.join_family(p_code text)
returns table(family_id uuid, family_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if (
    select count(*)
    from private.family_join_attempts
    where user_id = (select auth.uid())
      and attempted_at > now() - interval '15 minutes'
  ) >= 5 then
    raise exception 'Too many attempts. Please try later';
  end if;

  insert into private.family_join_attempts(user_id) values ((select auth.uid()));
  select family.id into found_id
  from public.families family
  where family.family_code = p_code;
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
  on conflict (family_id, user_id) where user_id is not null do nothing;

  return query select found_id, p_code;
end;
$$;

revoke all on function public.join_family(text) from public, anon;
grant execute on function public.join_family(text) to authenticated;
