/*
  # Debug and Fix User Profile Trigger

  This migration will:
  1. Check what currently exists
  2. Drop any problematic triggers/functions
  3. Recreate everything properly
  4. Test the setup
*/

-- First, let's see what exists
DO $$
BEGIN
  RAISE NOTICE 'Checking existing triggers and functions...';
END $$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop existing function if it exists  
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create the function with proper error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  -- Insert new user profile with error handling
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
    NOW(),
    NOW()
  );
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the user creation
    RAISE LOG 'Error creating user profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- Verify the setup
DO $$
DECLARE
  func_exists boolean;
  trigger_exists boolean;
BEGIN
  -- Check if function exists
  SELECT EXISTS(
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'handle_new_user' 
    AND routine_schema = 'public'
  ) INTO func_exists;
  
  -- Check if trigger exists
  SELECT EXISTS(
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'on_auth_user_created'
  ) INTO trigger_exists;
  
  IF func_exists AND trigger_exists THEN
    RAISE NOTICE 'SUCCESS: Both function and trigger created successfully';
  ELSE
    RAISE NOTICE 'ERROR: Function exists: %, Trigger exists: %', func_exists, trigger_exists;
  END IF;
END $$;

-- Also ensure RLS is properly configured
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Make sure the insert policy allows the trigger to work
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Add a policy that allows the trigger function to insert
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON user_profiles;
CREATE POLICY "Enable insert for authenticated users only" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (true);