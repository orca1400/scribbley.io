/*
  # Create sessions and usage_events tables for guest freebie tracking

  1. New Tables
    - `sessions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable, foreign key to auth.users)
      - `is_guest` (boolean, default true)
      - `has_consumed_guest_freebie` (boolean, default false)
      - `created_at` (timestamptz, default now())
    
    - `usage_events`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable, foreign key to auth.users)
      - `session_id` (uuid, foreign key to sessions)
      - `feature` (text, e.g., 'book_5_chapters')
      - `words` (integer)
      - `tokens` (integer)
      - `billable` (boolean)
      - `reason` (text, e.g., 'guest_free_book', 'regular')
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on both tables
    - Policies for authenticated users to manage own data
    - Policies for anonymous users to create guest sessions and usage events
*/

-- 1) Create tables
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  is_guest boolean NOT NULL DEFAULT true,
  has_consumed_guest_freebie boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  feature text NOT NULL,
  words int NOT NULL,
  tokens int NOT NULL,
  billable boolean NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Enable RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- 3) Create policies
-- Usage events policies
CREATE POLICY "usage_events_select_own"
ON public.usage_events FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "usage_events_insert_own"
ON public.usage_events FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "usage_events_insert_guest"
ON public.usage_events FOR INSERT
TO anon
WITH CHECK (user_id IS NULL);

-- Sessions policies
CREATE POLICY "sessions_select_own"
ON public.sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR is_guest = true);

CREATE POLICY "sessions_insert_any"
ON public.sessions FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "sessions_update_own"
ON public.sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR is_guest = true)
WITH CHECK (auth.uid() = user_id OR is_guest = true);

-- Allow service role to update sessions (for linking guest sessions)
CREATE POLICY "sessions_service_role_all"
ON public.sessions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "usage_events_service_role_all"
ON public.usage_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4) Refresh PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');