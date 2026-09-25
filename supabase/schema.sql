-- SmartPhysio — Supabase schema
-- =================================================================
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Security note: this app currently uses a fake login (any email
-- signs you in, no password check — see frontend/src/lib/AuthContext.tsx
-- and LoginPage.tsx). Because of that, Supabase has no way to verify
-- who is actually making a request, so the RLS policies below grant
-- the anon (public) role full read/write access to these three
-- tables. That means anyone with the project URL + anon key — which
-- is meant to be embedded in client-side code, so effectively anyone
-- who can load the app — can read or write any patient's data. This
-- is an accepted tradeoff for now; if real accounts (Supabase Auth)
-- are added later, these policies should be tightened to scope rows
-- by auth.uid() instead of leaving them wide open.
-- =================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- patients — one row per patient who has signed in.
-- ---------------------------------------------------------------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- exercises — protocols a physio has created.
-- angle_configs mirrors the app's AngleConfig[] shape directly:
--   [{ "id": "...", "nodeA": 1, "nodeB": 3, "targetMin": 90, "targetMax": 110, "faultThresholdDeg": 8 }, ...]
-- muscle_emg_targets mirrors the app's MuscleEmgTarget[] shape — one target
-- %MVC per muscle node, replacing the old single global target_emg_mvc:
--   [{ "podId": 1, "targetMvc": 65 }, ...]
-- ---------------------------------------------------------------
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  muscle_groups text[] not null default '{}',
  sets integer not null,
  reps integer not null,
  muscle_emg_targets jsonb not null default '[]',
  therapist_note text not null default '',
  setup_instructions text not null default '',
  est_minutes integer not null,
  angle_configs jsonb not null default '[]',
  assigned_patient_id uuid references patients(id) on delete set null,
  created_at timestamptz not null default now()
);

-- If you ran this script before muscle_emg_targets existed, apply this once
-- in the SQL Editor to migrate an existing exercises table in place:
--   alter table exercises add column if not exists muscle_emg_targets jsonb not null default '[]';
--   alter table exercises drop column if exists target_emg_mvc;

-- ---------------------------------------------------------------
-- sessions — a completed live session, recorded once per patient run.
-- reps mirrors the app's RepSample[] shape directly:
--   [{ "rep": 1, "angle": 109, "emgLeft": 72, "emgRight": 68, "faultActive": false }, ...]
-- ---------------------------------------------------------------
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  patient_name text not null,
  exercise_id uuid not null references exercises(id) on delete cascade,
  exercise_title text not null,
  completed_at timestamptz not null,
  duration_sec integer not null,
  target_min numeric not null,
  target_max numeric not null,
  reps jsonb not null default '[]'
);

create index if not exists sessions_patient_id_idx on sessions (patient_id);
create index if not exists sessions_exercise_id_idx on sessions (exercise_id);
create index if not exists exercises_assigned_patient_id_idx on exercises (assigned_patient_id);

-- ---------------------------------------------------------------
-- Row Level Security — permissive, see the note at the top of this file.
-- ---------------------------------------------------------------
alter table patients enable row level security;
alter table exercises enable row level security;
alter table sessions enable row level security;

create policy "anon full access" on patients for all
  using (true) with check (true);
create policy "anon full access" on exercises for all
  using (true) with check (true);
create policy "anon full access" on sessions for all
  using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime — lets every open tab/device see writes from any other
-- (replaces the old localStorage 'storage' event cross-tab sync).
-- If you re-run this script and see "relation is already member of
-- publication", that's fine — it just means this part already ran.
-- ---------------------------------------------------------------
alter publication supabase_realtime add table patients;
alter publication supabase_realtime add table exercises;
alter publication supabase_realtime add table sessions;
