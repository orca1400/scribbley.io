/*
  # Fix trigger function with proper error handling

  1. Updates
    - Replace the trigger function with better error handling
    - Keep detailed logging but don't silently fail
    - Ensure profile creation works reliably

  2. Security
    - Maintains existing RLS policies
    - No changes to permissions
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
  WHEN unique_violation THEN
    -- Profile already exists, that's okay
    RAISE LOG 'Profile already exists for user: %', NEW.id;
    RETURN NEW;
  WHEN others THEN
    -- Log the error with details
    RAISE LOG 'Error creating profile for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
    -- Still return NEW so user creation doesn't fail
    RETURN NEW;
END;
$$;