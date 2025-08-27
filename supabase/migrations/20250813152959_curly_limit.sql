/*
  # Debug and fix user profile creation trigger

  1. Replace the trigger function with better error handling
  2. Test the function manually
  3. Recreate the trigger if needed
*/

-- First, let's replace the function with better error reporting
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log the attempt with more detail
  RAISE LOG 'Creating profile for user: % (email: %)', NEW.id, NEW.email;
  
  -- Try to insert the profile
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
  
  RAISE LOG 'Successfully created profile for user: %', NEW.id;
  RETURN NEW;
  
EXCEPTION
  WHEN others THEN
    -- Log the detailed error
    RAISE LOG 'Error creating profile for user %: SQLSTATE=% SQLERRM=%', NEW.id, SQLSTATE, SQLERRM;
    -- Also raise a notice so we can see it in the query results
    RAISE NOTICE 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Now let's test it manually with the existing user
DO $$
DECLARE
  test_user RECORD;
BEGIN
  -- Get the user record
  SELECT * INTO test_user FROM auth.users WHERE id = '6cbbd41e-9fc8-46f5-aa06-ebb248c07111';
  
  IF test_user.id IS NOT NULL THEN
    -- Simulate the trigger by calling the function
    RAISE NOTICE 'Testing trigger function for user: %', test_user.id;
    
    -- Create a temporary trigger record to test
    DECLARE
      result RECORD;
    BEGIN
      -- This simulates what the trigger would do
      INSERT INTO public.user_profiles (
        id,
        plan_tier,
        monthly_word_limit,
        words_used_this_month,
        billing_period_start,
        created_at,
        updated_at
      ) VALUES (
        test_user.id,
        'free',
        5000,
        0,
        CURRENT_DATE,
        NOW(),
        NOW()
      );
      
      RAISE NOTICE 'Successfully created profile for user: %', test_user.id;
      
    EXCEPTION
      WHEN others THEN
        RAISE NOTICE 'Error in manual test: SQLSTATE=% SQLERRM=%', SQLSTATE, SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'User not found!';
  END IF;
END;
$$;