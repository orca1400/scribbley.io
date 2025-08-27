/*
  # Create user_profiles table and setup

  1. New Tables
    - `user_profiles`
      - `id` (uuid, primary key, references auth.users)
      - `plan_tier` (text, default 'free')
      - `monthly_word_limit` (bigint, default 5000)
      - `words_used_this_month` (bigint, default 0)
      - `billing_period_start` (date, default current date)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `user_profiles` table
    - Add policies for users to read, create, and update their own profiles

  3. Automation
    - Add trigger to automatically create user profile when new user signs up
*/

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  plan_tier text DEFAULT 'free'::text NOT NULL,
  monthly_word_limit bigint DEFAULT 5000 NOT NULL,
  words_used_this_month bigint DEFAULT 0 NOT NULL,
  billing_period_start date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
CREATE POLICY "Users can view their own profile." ON public.user_profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can create their own profile." ON public.user_profiles
FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile." ON public.user_profiles
FOR UPDATE USING (auth.uid() = id);

-- Create function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, plan_tier, monthly_word_limit, words_used_this_month, billing_period_start)
  VALUES (NEW.id, 'free', 5000, 0, CURRENT_DATE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create user profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();