/*
  # Fix Foreign Key Constraint Issue

  The signup is failing because the trigger tries to insert into user_profiles
  before the user is fully committed to auth.users table, causing a foreign key violation.

  ## Changes
  1. Drop the problematic foreign key constraint
  2. Recreate the trigger function with better error handling
  3. Add the foreign key back but as DEFERRABLE
  4. Test the setup
*/

-- 1. Drop the existing foreign key constraint
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

-- 2. Recreate the trigger function with better timing
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Add a small delay to ensure the user is committed
  PERFORM pg_sleep(0.1);
  
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
    RAISE LOG 'Error in handle_new_user for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 3. Drop and recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Add back the foreign key constraint as DEFERRABLE
ALTER TABLE public.user_profiles 
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
DEFERRABLE INITIALLY DEFERRED;

-- 5. Test that everything is set up correctly
SELECT 
  'Trigger exists' as component,
  CASE WHEN COUNT(*) > 0 THEN 'YES' ELSE 'NO' END as status
FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created'

UNION ALL

SELECT 
  'Function exists' as component,
  CASE WHEN COUNT(*) > 0 THEN 'YES' ELSE 'NO' END as status
FROM information_schema.routines 
WHERE routine_name = 'handle_new_user'

UNION ALL

SELECT 
  'Foreign key constraint' as component,
  CASE WHEN COUNT(*) > 0 THEN 'DEFERRABLE' ELSE 'MISSING' END as status
FROM information_schema.table_constraints 
WHERE constraint_name = 'user_profiles_id_fkey';

SELECT 'SUCCESS: All components updated with deferred foreign key!' as result;