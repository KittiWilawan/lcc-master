alter table public.profiles
  drop constraint if exists profiles_mobile_phone_format;

alter table public.profiles
  add constraint profiles_mobile_phone_format
  check (
    phone is null
    or (
      char_length(phone) = 10
      and left(phone, 1) = '0'
      and translate(phone, '0123456789', '') = ''
    )
  ) not valid;

alter table public.emergency_contacts
  drop constraint if exists emergency_contacts_mobile_phone_format;

alter table public.emergency_contacts
  add constraint emergency_contacts_mobile_phone_format
  check (
    char_length(phone) = 10
    and left(phone, 1) = '0'
    and translate(phone, '0123456789', '') = ''
  ) not valid;
