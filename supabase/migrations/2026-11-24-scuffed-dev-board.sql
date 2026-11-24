-- 2026-11-24-scuffed-dev-board.sql: the Scuffed dev board (kanaris-beans.com/scuffed_dev/).
--
-- Task and suggestion cards for Scuffed's VRChat world development, using the site's existing staff roles
-- (helper 1, moderator 2, admin 3, dev 4, the baloneys master login 5; see 2026-10-10-chat-moderation.sql):
--
--   moderator+  read the board: every card, its notes and its history
--   admin+      also add suggestions, post notes, and edit or delete their own cards
--   dev+        also add tasks, claim cards, change status, assign any dev, edit any card, turn a suggestion
--               into a task, and delete cards
--
-- Same trust model as the moderation panel: the two tables have row level security on and NO client policies,
-- so the browser can only reach them through the SECURITY DEFINER devboard_* functions below. Every one of
-- them checks the caller's level first (public.mod_level, so a linked device counts as its account and the
-- master token works too). Hiding buttons on the page is only convenience.
--
-- Run once in the SQL editor, after the earlier migrations (it needs 2026-10-11-device-links.sql). Safe to run again.

/* ---------- tables ---------- */
create table if not exists public.scuffed_dev_items (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('task', 'suggestion')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 4000),
  status text not null default 'unclaimed' check (status in ('unclaimed', 'claimed', 'in_progress', 'testing', 'complete')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee uuid references public.tetris_profiles (id) on delete set null,
  created_by uuid references public.tetris_profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.tetris_profiles (id) on delete set null,
  updated_by_name text not null default ''
);
create index if not exists scuffed_dev_items_updated on public.scuffed_dev_items (updated_at desc);

-- Each card's timeline: notes people post, and events the functions record (status changes, claims, edits).
create table if not exists public.scuffed_dev_updates (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.scuffed_dev_items (id) on delete cascade,
  author uuid references public.tetris_profiles (id) on delete set null,
  author_name text not null default '',
  kind text not null check (kind in ('note', 'event')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists scuffed_dev_updates_item on public.scuffed_dev_updates (item_id, id);

alter table public.scuffed_dev_items enable row level security;
alter table public.scuffed_dev_updates enable row level security;
-- (no policies: only the functions below can read or write these tables)

/* ---------- who's asking ---------- */

-- The caller's level, their profile id (null for a master login with no profile in this browser) and the
-- name their changes are signed with. Raises unless the level is at least `need`.
create or replace function public.devboard_ctx(token text, need integer, out lv integer, out uid uuid, out nm text)
language plpgsql stable security definer set search_path = public as $$
begin
  lv := coalesce(public.mod_level(token), 0);
  if lv < need then
    raise exception '%', case when need >= 4 then 'Only developers can do that.' when need = 3 then 'Only admins and developers can do that.'
      else 'The dev board is for Scuffed staff (moderator and up).' end using errcode = '42501';
  end if;
  uid := public.tetris_me();
  if uid is not null and not exists (select 1 from public.tetris_profiles where id = uid) then uid := null; end if;
  nm := coalesce((select name from public.tetris_profiles where id = uid), case when lv = 5 then 'baloneys (master)' else 'unknown' end);
end $$;

create or replace function public.devboard_log(item bigint, who uuid, who_name text, what text) returns void
language sql security definer set search_path = public as $$
  insert into public.scuffed_dev_updates (item_id, author, author_name, kind, body) values (item, who, who_name, 'event', left(what, 2000));
$$;
revoke execute on function public.devboard_log(bigint, uuid, text, text) from public, anon, authenticated;

create or replace function public.devboard_status_word(s text) returns text language sql immutable as $$
  select case s when 'unclaimed' then 'Unclaimed' when 'claimed' then 'Claimed' when 'in_progress' then 'In progress'
    when 'testing' then 'Testing' when 'complete' then 'Complete' else s end;
$$;

-- A card someone may be put on: a developer's profile.
create or replace function public.devboard_is_dev(who uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tetris_profiles where id = who and role = 'dev');
$$;

/* ---------- reading (moderator+) ---------- */

-- Everything the board shows: the caller, every card (with its note count and latest note), the people the
-- cards mention plus every staff member (for names and pictures), and the developers who can be assigned.
create or replace function public.devboard_list(token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.devboard_ctx(token, 2);
  return jsonb_build_object(
    'me', jsonb_build_object('level', c.lv, 'id', c.uid, 'name', c.nm),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title, 'body', i.body, 'status', i.status, 'priority', i.priority,
        'assignee', i.assignee, 'created_by', i.created_by, 'created_by_name', i.created_by_name, 'created_at', i.created_at,
        'updated_at', i.updated_at, 'updated_by', i.updated_by, 'updated_by_name', i.updated_by_name,
        'notes', (select count(*) from public.scuffed_dev_updates u where u.item_id = i.id and u.kind = 'note'),
        'last', (select jsonb_build_object('kind', u.kind, 'body', left(u.body, 160), 'author_name', u.author_name, 'created_at', u.created_at)
          from public.scuffed_dev_updates u where u.item_id = i.id order by u.id desc limit 1)
      ) order by i.updated_at desc) from (select * from public.scuffed_dev_items order by updated_at desc limit 3000) i), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'avatar', p.avatar, 'role', p.role, 'last_seen', p.last_seen))
      from public.tetris_profiles p
      where p.role is not null or p.id = c.uid
        or p.id in (select assignee from public.scuffed_dev_items union select created_by from public.scuffed_dev_items
                    union select updated_by from public.scuffed_dev_items)), '{}'::jsonb),
    'devs', coalesce((select jsonb_agg(p.id order by lower(p.name)) from public.tetris_profiles p where p.role = 'dev'), '[]'::jsonb)
  );
end $$;

-- One card's full timeline, oldest first.
create or replace function public.devboard_updates(token text, item bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.devboard_ctx(token, 2);
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'body', u.body, 'author', u.author,
      'author_name', u.author_name, 'created_at', u.created_at) order by u.id)
    from public.scuffed_dev_updates u where u.item_id = item), '[]'::jsonb);
end $$;

/* ---------- writing ---------- */

-- New card. Suggestions: admin+. Tasks: dev+. Only devs can assign someone straight away (themselves or another dev).
create or replace function public.devboard_create(token text, item_kind text, item_title text, item_body text default '',
    item_priority text default 'normal', item_assignee uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare c record; new_id bigint; t text := btrim(coalesce(item_title, ''));
begin
  if item_kind not in ('task', 'suggestion') then raise exception 'Pick task or suggestion.'; end if;
  select * into c from public.devboard_ctx(token, case when item_kind = 'task' then 4 else 3 end);
  if t = '' then raise exception 'Give it a title.'; end if;
  if char_length(t) > 120 then raise exception 'Titles can be at most 120 characters.'; end if;
  if char_length(coalesce(item_body, '')) > 4000 then raise exception 'Descriptions can be at most 4000 characters.'; end if;
  if coalesce(item_priority, 'normal') not in ('low', 'normal', 'high') then raise exception 'Unknown priority.'; end if;
  if item_assignee is not null then
    if c.lv < 4 then raise exception 'Only developers can assign cards.'; end if;
    if not (public.devboard_is_dev(item_assignee) or item_assignee = c.uid) then raise exception 'Cards can only be assigned to developers.'; end if;
  end if;
  insert into public.scuffed_dev_items (kind, title, body, priority, status, assignee, created_by, created_by_name, updated_by, updated_by_name)
    values (item_kind, t, coalesce(item_body, ''), coalesce(item_priority, 'normal'),
      case when item_assignee is null then 'unclaimed' else 'claimed' end, item_assignee, c.uid, c.nm, c.uid, c.nm)
    returning id into new_id;
  perform public.devboard_log(new_id, c.uid, c.nm, 'created this ' || item_kind);
  if item_assignee is not null then
    perform public.devboard_log(new_id, c.uid, c.nm, case when item_assignee = c.uid then 'claimed this'
      else 'assigned ' || coalesce((select name from public.tetris_profiles where id = item_assignee), 'a developer') end);
  end if;
  return new_id;
end $$;

-- Title, description, priority: the card's creator (admin+), or any developer.
create or replace function public.devboard_edit(token text, item bigint, item_title text, item_body text, item_priority text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; i record; t text := btrim(coalesce(item_title, '')); changed text[] := '{}';
begin
  select * into c from public.devboard_ctx(token, 3);
  select * into i from public.scuffed_dev_items where id = item for update;
  if i is null then raise exception 'That card doesn''t exist any more.'; end if;
  if c.lv < 4 and (c.uid is null or i.created_by is distinct from c.uid) then raise exception 'You can only edit cards you made.' using errcode = '42501'; end if;
  if t = '' then raise exception 'Give it a title.'; end if;
  if char_length(t) > 120 then raise exception 'Titles can be at most 120 characters.'; end if;
  if char_length(coalesce(item_body, '')) > 4000 then raise exception 'Descriptions can be at most 4000 characters.'; end if;
  if coalesce(item_priority, 'normal') not in ('low', 'normal', 'high') then raise exception 'Unknown priority.'; end if;
  if t <> i.title then changed := changed || 'the title'::text; end if;
  if coalesce(item_body, '') <> i.body then changed := changed || 'the description'::text; end if;
  if coalesce(item_priority, 'normal') <> i.priority then changed := changed || ('priority to ' || coalesce(item_priority, 'normal'))::text; end if;
  if cardinality(changed) = 0 then return; end if;
  update public.scuffed_dev_items set title = t, body = coalesce(item_body, ''), priority = coalesce(item_priority, 'normal'),
    updated_at = now(), updated_by = c.uid, updated_by_name = c.nm where id = item;
  perform public.devboard_log(item, c.uid, c.nm, 'changed ' || array_to_string(changed, ', '));
end $$;

-- Status (dev+). Moving a card back to Unclaimed takes it off whoever had it; starting work on a card nobody
-- has claimed claims it for you.
create or replace function public.devboard_set_status(token text, item bigint, new_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; i record; who uuid;
begin
  select * into c from public.devboard_ctx(token, 4);
  if new_status not in ('unclaimed', 'claimed', 'in_progress', 'testing', 'complete') then raise exception 'Unknown status.'; end if;
  select * into i from public.scuffed_dev_items where id = item for update;
  if i is null then raise exception 'That card doesn''t exist any more.'; end if;
  if i.status = new_status then return; end if;
  who := i.assignee;
  if new_status = 'unclaimed' then who := null;
  elsif who is null and new_status in ('claimed', 'in_progress') then who := c.uid;
  end if;
  if new_status = 'claimed' and who is null then raise exception 'Claiming needs a profile: make one on this browser first.'; end if;
  update public.scuffed_dev_items set status = new_status, assignee = who, updated_at = now(), updated_by = c.uid, updated_by_name = c.nm where id = item;
  perform public.devboard_log(item, c.uid, c.nm, 'moved this to ' || public.devboard_status_word(new_status)
    || case when who is not null and i.assignee is null then ' and claimed it' when who is null and i.assignee is not null then ' (nobody has it now)' else '' end);
end $$;

-- Who's on it (dev+): yourself or any developer, or nobody (null). Assigning an unclaimed card marks it Claimed;
-- taking everyone off a merely-claimed card puts it back to Unclaimed.
create or replace function public.devboard_assign(token text, item bigint, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record; i record; st text; wn text;
begin
  select * into c from public.devboard_ctx(token, 4);
  select * into i from public.scuffed_dev_items where id = item for update;
  if i is null then raise exception 'That card doesn''t exist any more.'; end if;
  if who is not distinct from i.assignee then return; end if;
  if who is not null and not (public.devboard_is_dev(who) or (who = c.uid)) then raise exception 'Cards can only be assigned to developers.'; end if;
  st := i.status;
  if who is not null and st = 'unclaimed' then st := 'claimed'; end if;
  if who is null and st = 'claimed' then st := 'unclaimed'; end if;
  update public.scuffed_dev_items set assignee = who, status = st, updated_at = now(), updated_by = c.uid, updated_by_name = c.nm where id = item;
  wn := coalesce((select name from public.tetris_profiles where id = coalesce(who, i.assignee)), 'a developer');
  perform public.devboard_log(item, c.uid, c.nm, case
    when who is null and i.assignee = c.uid then 'unclaimed this'
    when who is null then 'took ' || wn || ' off this'
    when who = c.uid then 'claimed this'
    else 'assigned ' || wn end);
end $$;

-- Suggestion <-> task (dev+): a developer picks a suggestion up as real work.
create or replace function public.devboard_set_kind(token text, item bigint, new_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; i record;
begin
  select * into c from public.devboard_ctx(token, 4);
  if new_kind not in ('task', 'suggestion') then raise exception 'Pick task or suggestion.'; end if;
  select * into i from public.scuffed_dev_items where id = item for update;
  if i is null then raise exception 'That card doesn''t exist any more.'; end if;
  if i.kind = new_kind then return; end if;
  update public.scuffed_dev_items set kind = new_kind, updated_at = now(), updated_by = c.uid, updated_by_name = c.nm where id = item;
  perform public.devboard_log(item, c.uid, c.nm, case when new_kind = 'task' then 'turned this suggestion into a task' else 'turned this task back into a suggestion' end);
end $$;

-- A note on a card's timeline (admin+). Counts as the card's latest update.
create or replace function public.devboard_note(token text, item bigint, note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare c record; n text := btrim(coalesce(note, '')); new_id bigint;
begin
  select * into c from public.devboard_ctx(token, 3);
  if n = '' then raise exception 'Write something first.'; end if;
  if char_length(n) > 2000 then raise exception 'Notes can be at most 2000 characters.'; end if;
  if not exists (select 1 from public.scuffed_dev_items where id = item) then raise exception 'That card doesn''t exist any more.'; end if;
  insert into public.scuffed_dev_updates (item_id, author, author_name, kind, body) values (item, c.uid, c.nm, 'note', n) returning id into new_id;
  update public.scuffed_dev_items set updated_at = now(), updated_by = c.uid, updated_by_name = c.nm where id = item;
  return new_id;
end $$;

-- Delete a card and its timeline: any developer, or the card's own creator (admin+). Recorded in the
-- moderation audit log, since the card itself is gone.
create or replace function public.devboard_delete(token text, item bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c record; i record;
begin
  select * into c from public.devboard_ctx(token, 3);
  select * into i from public.scuffed_dev_items where id = item for update;
  if i is null then return; end if;
  if c.lv < 4 and (c.uid is null or i.created_by is distinct from c.uid) then raise exception 'You can only delete cards you made.' using errcode = '42501'; end if;
  delete from public.scuffed_dev_items where id = item;
  perform public.mod_log_action(token, 'dev board delete', null, jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title));
end $$;
