alter table public.monitor_health add column if not exists last_frame_at timestamptz;
alter table public.fall_events add column if not exists camera_id uuid;
alter table public.fall_events add column if not exists source_track_id text;
