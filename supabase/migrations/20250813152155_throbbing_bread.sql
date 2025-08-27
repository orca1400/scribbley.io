/*
  # Fix duplicate triggers and foreign key constraint

  1. Remove duplicate triggers
  2. Fix foreign key constraint to be DEFERRABLE INITIALLY DEFERRED
  3. Keep only one clean trigger function
*/

-- Step 1: Drop both existing triggers
DROP TRIGGER IF EXISTS create_user_profile_trigger ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Drop the old functions
DROP FUNCTION IF EXISTS create_user_profile();
DROP FUNCTION IF EXISTS handle_new_user();

-- Step 3: Fix the foreign key constraint to be DEFERRABLE INITIALLY DEFERRED
ALTER TABLE user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE user_profiles 
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) 
ON DELETE CASCADE 
DEFERRABLE INITIALLY DEFERRED;

-- Step 4: Create one clean trigger function
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
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
    -- Log the error but don't fail user creation
    RAISE LOG 'Error creating user profile for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create one trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Verify the setup
SELECT 'SUCCESS: Triggers and constraints fixed!' as result;