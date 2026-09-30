-- Lull: a practice log of breathing sessions, for streaks and a calendar on the Relax screen.
--
-- The one exception to "nothing about listening is stored": a breathing session's pattern, start time,
-- length, rounds and whether it ran to the end. Never sounds, mixes or anything else. Only the person
-- themselves can read, add or remove their rows (RLS); the app writes them directly with the user's token.
--
-- Ids are made on the device, so a session logged offline and uploaded twice is stored once.

create table public.relax_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pattern text not null check (pattern in ('478', 'box', 'even')),
  started_at timestamptz not null,
  seconds int not null check (seconds between 60 and 86400),
  rounds int not null default 0 check (rounds >= 0),
  planned_min int not null default 0 check (planned_min >= 0),
  completed boolean not null,
  created_at timestamptz not null default now()
);
create index relax_sessions_user_started on public.relax_sessions (user_id, started_at desc);

alter table public.relax_sessions enable row level security;

create policy "own sessions: read" on public.relax_sessions for select using (user_id = auth.uid());
create policy "own sessions: add" on public.relax_sessions for insert with check (user_id = auth.uid());
create policy "own sessions: remove" on public.relax_sessions for delete using (user_id = auth.uid());
