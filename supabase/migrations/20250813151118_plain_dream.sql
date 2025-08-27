/*
  # Create user_profiles table and setup

  1. New Tables
    - `user_profiles`
      - `id` (uuid, primary key, references auth.users)
      - `plan_tier` (text, default 'free')
      - `monthly_word_limit` (integer, default 5000)
      - `words_used_this_month` (integer, default 0)
      - `billing_period_start` (date, default current_date)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `user_profiles` table
    - Add policies for authenticated users to manage their own data
    - Add policy for signup inserts

  3. Triggers
    - Auto-create profile when user signs up
    - Auto-update updated_at timestamp
*/

-- First, let's see what tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Create the user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_tier text DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'premium')),
  monthly_word_limit integer DEFAULT 5000,
  words_used_this_month integer DEFAULT 0,
  billing_period_start date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Allow signup inserts" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;

CREATE POLICY "Allow signup inserts" 
  ON public.user_profiles 
  FOR INSERT 
  TO public 
  WITH CHECK (true);

CREATE POLICY "Users can read own profile" 
  ON public.user_profiles 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.user_profiles 
  FOR UPDATE 
  TO authenticated 
  USING (auth.uid() = id) 
  WITH CHECK (auth.uid() = id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create updated_at trigger
DROP TRIGGER IF EXISTS user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Create the signup trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    plan_tier,
    monthly_word_limit,
    words_used_this_month,
    billing_period_start,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    'free',
    5000,
    0,
    CURRENT_DATE,
    now(),
    now()
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error in handle_new_user for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Create the auth trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Verify everything was created
SELECT 'Tables created:' as status;
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'user_profiles';

SELECT 'Policies created:' as status;
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'user_profiles';

SELECT 'Triggers created:' as status;
SELECT trigger_name, event_manipulation 
FROM information_schema.triggers 
WHERE trigger_name IN ('on_auth_user_created', 'user_profiles_updated_at');

SELECT 'SUCCESS: user_profiles table and all components created!' as result;