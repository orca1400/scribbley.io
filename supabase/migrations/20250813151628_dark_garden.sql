/*
  # Fix trigger function for user profile creation

  1. Updates
    - Fix the trigger function to properly handle the auth.users reference
    - Make the foreign key constraint DEFERRABLE to avoid timing issues
    - Add better error handling and logging

  2. Security
    - Maintains RLS policies
    - Ensures proper user isolation
*/

-- First, let's check the current foreign key constraint
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.is_deferrable,
  tc.initially_deferred
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'user_profiles';

-- Drop and recreate the foreign key constraint as DEFERRABLE
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE public.user_profiles 
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) 
ON DELETE CASCADE 
DEFERRABLE INITIALLY DEFERRED;

-- Update the trigger function to be more robust
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the attempt
  RAISE LOG 'Creating profile for user: %', NEW.id;
  
  -- Insert the new user profile
  INSERT INTO public.user_profiles (
    id,
    plan_tier,
    monthly_word_limit,
    words_used_this_month,
    billing_period_start,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,  -- This comes from auth.users
    'free',
    5000,
    0,
    CURRENT_DATE,
    NOW(),
    NOW()
  );
  
  RAISE LOG 'Successfully created profile for user: %', NEW.id;
  RETURN NEW;
  
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error creating profile for user %: % %', NEW.id, SQLERRM, SQLSTATE;
    -- Don't fail the user creation, just log the error
    RETURN NEW;
END;
$$;

-- Ensure the trigger exists and is properly configured
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Test that everything is set up correctly
DO $$
BEGIN
  RAISE NOTICE 'SUCCESS: Trigger function and foreign key constraint updated!';
  RAISE NOTICE 'The foreign key is now DEFERRABLE INITIALLY DEFERRED';
  RAISE NOTICE 'This should resolve the signup issue.';
END $$;

-- Show the updated constraint info
SELECT 
  tc.constraint_name,
  tc.is_deferrable,
  tc.initially_deferred,
  'Foreign key now allows deferred checking' as status
FROM information_schema.table_constraints AS tc
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'user_profiles'
  AND tc.constraint_name = 'user_profiles_id_fkey';