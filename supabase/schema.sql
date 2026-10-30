-- SmartPhysio — Supabase schema (real accounts + locked-down access)
-- =================================================================
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- WARNING: this starts fresh. It DELETES the old patients, exercises and
-- sessions tables and everything in them.
--
-- How access works:
--   • Every signed-in person has a row in `profiles`, created automatically
--     when they sign up. Sign-ups are ALWAYS patients.
--   • Physio accounts are made by an admin only: create the user in
--     Dashboard → Authentication → Users → Add user, then run
--       select make_physio('physio@clinic.com', 'apex', 'Dr. Name');
--     in this SQL Editor. That function can't be called from the app.
--   • Patients see only their own profile, sessions, and the exercises
--     assigned to them (or to everyone) in their practice.
--   • Physios see the patients, sessions and exercises of their own
--     practice, and manage exercises for that practice only.
--   • Someone who isn't signed in sees nothing.
-- =================================================================

-- ---------------------------------------------------------------
-- Clean slate
-- ---------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists sessions cascade;
drop table if exists exercises cascade;
drop table if exists patients cascade;
drop table if exists profiles cascade;
drop table if exists practices cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.my_role() cascade;
drop function if exists public.my_practice() cascade;
drop function if exists public.make_physio(text, text, text) cascade;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- practices — must match PRACTICES in frontend/src/lib/mockData.ts
-- ---------------------------------------------------------------
create table practices (
  id text primary key,
  name text not null
);

insert into practices (id, name) values
  ('apex', 'Apex Sports Rehabilitation'),
  ('summit', 'Summit Orthopaedic Clinic'),
  ('meridian', 'Meridian Physiotherapy Group');

-- ---------------------------------------------------------------
-- profiles — one row per account (patient or physio)
-- ---------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'patient' check (role in ('patient', 'physio')),
  name text not null,
  email text not null,
  practice_id text not null references practices (id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index profiles_practice_role_idx on profiles (practice_id, role);

-- New sign-up → patient profile. The role is never taken from sign-up data,
-- so nobody can make themselves a physio from the app.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, name, email, practice_id)
  values (
    new.id,
    'patient',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(
      (select p.id from public.practices p where p.id = new.raw_user_meta_data ->> 'practice_id'),
      'apex'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin-only: turn an existing account into a physio for a practice.
create function public.make_physio(user_email text, practice text, display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set role = 'physio',
         practice_id = practice,
         name = coalesce(nullif(trim(display_name), ''), name)
   where lower(email) = lower(user_email);
  if not found then
    raise exception 'No account with email %. Create it first under Authentication → Users.', user_email;
  end if;
end;
$$;

revoke execute on function public.make_physio(text, text, text) from public, anon, authenticated;

-- The signed-in user's role and practice. SECURITY DEFINER so the access
-- rules below can use them without the profiles rules calling themselves.
create function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create function public.my_practice()
returns text
language sql
stable
security definer
set search_path = public
as $$ select practice_id from public.profiles where id = auth.uid() $$;

-- ---------------------------------------------------------------
-- exercises — protocols a physio has created for their practice.
-- angle_configs mirrors the app's AngleConfig[]:
--   [{ "id": "...", "nodeA": 2, "nodeB": 3, "targetMin": 100, "targetMax": 135, "faultThresholdDeg": 15 }]
-- muscle_emg_targets mirrors MuscleEmgTarget[]:
--   [{ "muscleId": "...", "targetMvc": 65 }]
-- practice_id and created_by fill themselves in from the signed-in physio.
-- ---------------------------------------------------------------
create table exercises (
  id uuid primary key default gen_random_uuid(),
  practice_id text not null default public.my_practice() references practices (id),
  created_by uuid default auth.uid() references profiles (id) on delete set null,
  title text not null,
  muscle_groups text[] not null default '{}',
  sets integer not null,
  reps integer not null,
  muscle_emg_targets jsonb not null default '[]',
  therapist_note text not null default '',
  setup_instructions text not null default '',
  est_minutes integer not null,
  angle_configs jsonb not null default '[]',
  assigned_patient_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index exercises_practice_idx on exercises (practice_id);
create index exercises_assigned_patient_id_idx on exercises (assigned_patient_id);

-- ---------------------------------------------------------------
-- sessions — one completed live session.
-- reps mirrors the app's RepSample[]:
--   [{ "rep": 1, "angle": 109, "emgLeft": 72, "emgRight": 68, "faultActive": false }]
-- ---------------------------------------------------------------
create table sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  patient_name text not null,
  exercise_id uuid not null references exercises (id) on delete cascade,
  exercise_title text not null,
  completed_at timestamptz not null,
  duration_sec integer not null,
  target_min numeric not null,
  target_max numeric not null,
  reps jsonb not null default '[]'
);

create index sessions_patient_id_idx on sessions (patient_id);
create index sessions_exercise_id_idx on sessions (exercise_id);

-- ---------------------------------------------------------------
-- Access rules (Row Level Security)
-- ---------------------------------------------------------------
alter table practices enable row level security;
alter table profiles enable row level security;
alter table exercises enable row level security;
alter table sessions enable row level security;

-- practices: anyone signed in can read the list.
create policy "read practices" on practices
  for select to authenticated using (true);

-- profiles: your own row; physios also see their practice's patients.
create policy "read own profile, physio reads practice patients" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.my_role() = 'physio' and role = 'patient' and practice_id = public.my_practice())
  );

-- You may change only your own name and last-seen time — never your role
-- or practice.
revoke insert, update, delete on profiles from anon, authenticated;
grant update (name, last_seen_at) on profiles to authenticated;
create policy "update own profile" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- exercises: physios manage their practice's; patients read theirs.
create policy "read practice exercises" on exercises
  for select to authenticated
  using (
    practice_id = public.my_practice()
    and (
      public.my_role() = 'physio'
      or assigned_patient_id is null
      or assigned_patient_id = auth.uid()
    )
  );

create policy "physio creates practice exercises" on exercises
  for insert to authenticated
  with check (
    public.my_role() = 'physio'
    and practice_id = public.my_practice()
    and (
      assigned_patient_id is null
      or exists (
        select 1 from profiles p
        where p.id = assigned_patient_id and p.role = 'patient' and p.practice_id = public.my_practice()
      )
    )
  );

create policy "physio updates practice exercises" on exercises
  for update to authenticated
  using (public.my_role() = 'physio' and practice_id = public.my_practice())
  with check (
    public.my_role() = 'physio'
    and practice_id = public.my_practice()
    and (
      assigned_patient_id is null
      or exists (
        select 1 from profiles p
        where p.id = assigned_patient_id and p.role = 'patient' and p.practice_id = public.my_practice()
      )
    )
  );

create policy "physio deletes practice exercises" on exercises
  for delete to authenticated
  using (public.my_role() = 'physio' and practice_id = public.my_practice());

-- sessions: patients record and read their own; physios read their
-- practice's. Nobody edits or deletes a recorded session.
create policy "read own or practice sessions" on sessions
  for select to authenticated
  using (
    patient_id = auth.uid()
    or (
      public.my_role() = 'physio'
      and exists (
        select 1 from profiles p
        where p.id = sessions.patient_id and p.practice_id = public.my_practice()
      )
    )
  );

create policy "patient records own session" on sessions
  for insert to authenticated
  with check (patient_id = auth.uid() and public.my_role() = 'patient');

-- ---------------------------------------------------------------
-- Starter exercises for every practice (same defaults the app uses
-- when it runs without Supabase).
-- ---------------------------------------------------------------
insert into exercises (practice_id, title, muscle_groups, sets, reps, therapist_note, est_minutes, angle_configs)
select p.id, e.title, e.muscle_groups, e.sets, e.reps, e.therapist_note, e.est_minutes, e.angle_configs
from practices p
cross join (
  values
    ('Bicep Curl', array['Arm'], 3, 10, '', 5,
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'nodeA', 2, 'nodeB', 3, 'targetMin', 100, 'targetMax', 135, 'faultThresholdDeg', 15))),
    ('Squats', array['Upper Leg', 'Lower Leg'], 3, 15, 'Keep weight in the heels and knees tracking over the toes.', 8,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 1, 'nodeB', 3, 'targetMin', 90, 'targetMax', 110, 'faultThresholdDeg', 15),
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 2, 'nodeB', 4, 'targetMin', 90, 'targetMax', 110, 'faultThresholdDeg', 15))),
    ('Push Up', array['Chest', 'Arm'], 3, 12, 'Keep a straight line from shoulders to ankles throughout the movement.', 6,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 9, 'nodeB', 11, 'targetMin', 20, 'targetMax', 145, 'faultThresholdDeg', 15),
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 10, 'nodeB', 12, 'targetMin', 20, 'targetMax', 145, 'faultThresholdDeg', 15))),
    ('Shoulder Press', array['Shoulder', 'Arm'], 3, 10, 'Press straight overhead without arching the lower back.', 7,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 7, 'nodeB', 9, 'targetMin', 30, 'targetMax', 150, 'faultThresholdDeg', 15),
        jsonb_build_object('id', gen_random_uuid(), 'nodeA', 8, 'nodeB', 10, 'targetMin', 30, 'targetMax', 150, 'faultThresholdDeg', 15)))
) as e (title, muscle_groups, sets, reps, therapist_note, est_minutes, angle_configs);

-- ---------------------------------------------------------------
-- Realtime — live updates between devices. Each person only receives
-- changes to rows the rules above let them read.
-- ---------------------------------------------------------------
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table exercises;
alter publication supabase_realtime add table sessions;
