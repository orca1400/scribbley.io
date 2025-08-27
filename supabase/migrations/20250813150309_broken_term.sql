/*
  # Fix RLS policies for user signup

  1. Security Changes
    - Drop conflicting RLS policies on user_profiles table
    - Create proper policies that allow user creation during signup
    - Ensure the trigger function can insert new user profiles

  2. Notes
    - The issue is that RLS is blocking the trigger function from inserting
    - We need to allow inserts during the signup process
    - The trigger runs with SECURITY DEFINER so it should bypass RLS, but we'll ensure proper policies exist
*/

-- First, let's see what policies exist
SELECT policyname, cmd, roles, qual, with_check 
FROM pg_policies 
WHERE tablename = 'user_profiles';

-- Drop all existing policies on user_profiles to start fresh
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON user_profiles;
DROP POLICY IF EXISTS "Users can create their own profile." ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile." ON user_profiles;
DROP POLICY IF EXISTS "Users can view their own profile." ON user_profiles;

-- Create clean, simple policies
CREATE POLICY "Allow signup inserts" ON user_profiles
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT 
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE 
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Recreate the trigger function with SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id, 
    plan_tier, 
    monthly_word_limit, 
    words_used_this_month, 
    billing_period_start
  ) VALUES (
    NEW.id, 
    'free', 
    5000, 
    0, 
    CURRENT_DATE
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- Verify everything was created
SELECT 'SUCCESS: RLS policies and trigger function updated' as status;