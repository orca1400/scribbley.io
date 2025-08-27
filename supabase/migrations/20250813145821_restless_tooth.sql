/*
  # Create missing trigger function for user signup

  1. Creates the handle_new_user() function
  2. Creates the trigger on auth.users table
  3. Ensures user profiles are automatically created on signup

  This fixes the "Database error saving new user" issue.
*/

-- Create the trigger function that creates user profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, plan_tier, monthly_word_limit, words_used_this_month, billing_period_start)
  VALUES (new.id, 'free', 5000, 0, CURRENT_DATE);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger that runs when a new user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();