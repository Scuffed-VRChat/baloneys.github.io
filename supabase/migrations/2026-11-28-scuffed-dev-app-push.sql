-- 2026-11-28-scuffed-dev-app-push.sql: push notifications + notification history for the scuffed_dev app
-- (kanaris-beans.com/scuffed_dev/app/, also packaged as the Android APK).
--
-- Who gets what (levels from the moderation panel: helper 1, moderator 2, admin 3, dev 4, master 5):
--   moderator+  dev board updates, announcements (the notification body is the full announcement), new world builds
--   developer+  also deploys (live / failed) and new suggestions
-- Each phone can turn kinds off in the app's Settings (prefs).
--
-- Same trust model as the dev board: the tables have row level security on and NO client policies. Phones reach
-- them only through the SECURITY DEFINER push_* functions below, which check the caller's level with
-- public.devboard_ctx (so a linked device counts as its account, and the master login works). The scuffed-perms
-- Worker, which sends the notifications, uses the project's service role key (a Worker secret), so it can read the
-- subscriptions, write the history and remember where it got to.
--
-- Run once in the SQL editor, after 2026-11-24-scuffed-dev-board.sql. Safe to run again.

/* ---------- tables ---------- */

-- One row per phone/browser that allowed notifications. endpoint is the push service URL (unique per install).
create table if not exists public.scuffed_push_subs (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  uid uuid,
  actor text not null default '',
  level integer not null default 0,
  prefs jsonb not null default '{}'::jsonb,       -- {"board":true,"announce":true,"world":true,"deploy":true,"suggest":true}
  device text not null default '' check (char_length(device) <= 160),
  fails integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scuffed_push_subs_level on public.scuffed_push_subs (level);

-- Every notification that was sent: the app's notification history.
create table if not exists public.scuffed_push_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('board', 'announce', 'world', 'deploy', 'suggest', 'test')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 8000),
  url text not null default '' check (char_length(url) <= 500),
  min_level integer not null default 2,
  meta jsonb not null default '{}'::jsonb,
  sent integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists scuffed_push_log_recent on public.scuffed_push_log (id desc);

-- Where the Worker's once-a-minute check got to (last board update id, last GitHub Pages run, ...).
create table if not exists public.scuffed_push_state (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.scuffed_push_subs enable row level security;
alter table public.scuffed_push_log enable row level security;
alter table public.scuffed_push_state enable row level security;
-- (no policies: only the functions below, and the service role, can read or write these tables)

/* ---------- what the app calls ---------- */

-- Turn notifications on (or update them) for this phone. Stores the caller's level so the Worker knows what to
-- send; the level is refreshed every time the app opens.
create or replace function public.push_subscribe(token text, sub_endpoint text, sub_p256dh text, sub_auth text,
  sub_prefs jsonb default '{}'::jsonb, sub_device text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.devboard_ctx(token, 2);
  insert into public.scuffed_push_subs (endpoint, p256dh, auth, uid, actor, level, prefs, device, fails, updated_at)
  values (sub_endpoint, sub_p256dh, sub_auth, c.uid, c.nm, c.lv, coalesce(sub_prefs, '{}'::jsonb), left(coalesce(sub_device, ''), 160), 0, now())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, uid = excluded.uid, actor = excluded.actor,
    level = excluded.level, prefs = excluded.prefs, device = excluded.device, fails = 0, updated_at = now();
  return jsonb_build_object('level', c.lv, 'name', c.nm);
end $$;

-- Turn them off for this phone (knowing the endpoint is enough: it's this install's own secret URL).
create or replace function public.push_unsubscribe(sub_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.scuffed_push_subs where endpoint = sub_endpoint;
$$;

-- The notification history this caller may see, newest first. `before` pages back (0 = from the newest).
create or replace function public.push_history(token text, before bigint default 0, max_rows integer default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.devboard_ctx(token, 2);
  return jsonb_build_object(
    'level', c.lv,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title, 'body', l.body,
        'url', l.url, 'meta', l.meta, 'created_at', l.created_at) order by l.id desc)
      from (select * from public.scuffed_push_log
            where min_level <= c.lv and (before <= 0 or id < before)
            order by id desc limit greatest(1, least(coalesce(max_rows, 60), 200))) l), '[]'::jsonb));
end $$;

grant execute on function public.push_subscribe(text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;
grant execute on function public.push_history(text, bigint, integer) to anon, authenticated;
