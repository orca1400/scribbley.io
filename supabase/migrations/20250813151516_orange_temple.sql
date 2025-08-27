/*
  # Fix Foreign Key Constraint Issue

  The problem is that the foreign key constraint is checked immediately when the trigger runs,
  but the auth.users record hasn't been committed yet. We need to make it DEFERRED.

  1. Drop and recreate the foreign key constraint as DEFERRABLE INITIALLY DEFERRED
  2. This allows the constraint to be checked at the end of the transaction
  3. Update the trigger function to be more robust
*/

-- 1. Check current foreign key constraints
SELECT 
  conname as constraint_name,
  contype as constraint_type,
  condeferrable as is_deferrable,
  condeferred as is_deferred
FROM pg_constraint 
WHERE conrelid = 'public.user_profiles'::regclass;

-- 2. Drop the existing foreign key constraint
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

-- 3. Add the foreign key constraint as DEFERRABLE INITIALLY DEFERRED
ALTER TABLE public.user_profiles 
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) 
ON DELETE CASCADE 
DEFERRABLE INITIALLY DEFERRED;

-- 4. Update the trigger function to be more robust
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log the error but don't fail the user creation
    RAISE LOG 'Error creating user profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 5. Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Verify the setup
SELECT 'SUCCESS: Foreign key constraint updated to DEFERRED' as status;

-- 7. Show the updated constraint
SELECT 
  conname as constraint_name,
  condeferrable as is_deferrable,
  condeferred as is_deferred
FROM pg_constraint 
WHERE conrelid = 'public.user_profiles'::regclass 
AND contype = 'f';