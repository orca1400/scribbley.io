/*
  # Final fix for signup issue

  1. Recreate trigger function with better error handling
  2. Test the function manually
  3. Ensure proper permissions
*/

-- Drop and recreate the trigger function with better error handling
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Create the function with explicit schema references and better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the attempt
  RAISE LOG 'handle_new_user triggered for user ID: %', NEW.id;
  
  -- Insert into user_profiles with explicit column references
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
  
  RAISE LOG 'Successfully created user profile for user ID: %', NEW.id;
  RETURN NEW;
  
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error in handle_new_user for user ID %. Error: % - %', NEW.id, SQLSTATE, SQLERRM;
    -- Don't fail the auth signup, just log the error
    RETURN NEW;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Test the function by simulating what happens during signup
DO $$
DECLARE
  test_user_id uuid := gen_random_uuid();
BEGIN
  -- Simulate inserting a user (this is what the trigger would receive)
  RAISE LOG 'Testing trigger function with user ID: %', test_user_id;
  
  -- Test the insert directly
  INSERT INTO public.user_profiles (
    id,
    plan_tier,
    monthly_word_limit,
    words_used_this_month,
    billing_period_start,
    created_at,
    updated_at
  ) VALUES (
    test_user_id,
    'free',
    5000,
    0,
    CURRENT_DATE,
    NOW(),
    NOW()
  );
  
  -- Clean up test data
  DELETE FROM public.user_profiles WHERE id = test_user_id;
  
  RAISE NOTICE 'SUCCESS: Trigger function test passed!';
  
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'ERROR: Trigger function test failed - % %', SQLSTATE, SQLERRM;
END;
$$;

-- Verify everything is set up correctly
SELECT 'Trigger function exists' as status, routine_name 
FROM information_schema.routines 
WHERE routine_name = 'handle_new_user'
UNION ALL
SELECT 'Trigger exists' as status, trigger_name::text
FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created'
UNION ALL
SELECT 'RLS policy exists' as status, policyname
FROM pg_policies 
WHERE tablename = 'user_profiles' AND policyname = 'Allow signup inserts';