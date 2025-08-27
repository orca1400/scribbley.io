/*
  # User Dashboard Schema

  1. New Tables
    - `user_profiles`
      - `id` (uuid, references auth.users)
      - `plan_tier` (text, default 'free')
      - `monthly_word_limit` (integer)
      - `words_used_this_month` (integer, default 0)
      - `billing_period_start` (date)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `user_books`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `title` (text)
      - `genre` (text)
      - `subgenre` (text)
      - `description` (text)
      - `content` (text)
      - `total_chapters` (integer, default 0)
      - `chapters_read` (integer, default 0)
      - `word_count` (integer, default 0)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage their own data

  3. Functions
    - Function to reset monthly usage on billing cycle
    - Function to update word usage when books are generated
*/

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_tier text DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'premium')),
  monthly_word_limit integer DEFAULT 5000,
  words_used_this_month integer DEFAULT 0,
  billing_period_start date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create user_books table
CREATE TABLE IF NOT EXISTS user_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL DEFAULT 'Untitled Book',
  genre text NOT NULL DEFAULT '',
  subgenre text NOT NULL DEFAULT '',
  description text DEFAULT '',
  content text DEFAULT '',
  total_chapters integer DEFAULT 0,
  chapters_read integer DEFAULT 0,
  word_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_books ENABLE ROW LEVEL SECURITY;

-- Policies for user_profiles
CREATE POLICY "Users can read own profile"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Policies for user_books
CREATE POLICY "Users can read own books"
  ON user_books
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own books"
  ON user_books
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own books"
  ON user_books
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own books"
  ON user_books
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, plan_tier, monthly_word_limit, words_used_this_month, billing_period_start)
  VALUES (NEW.id, 'free', 5000, 0, CURRENT_DATE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'create_user_profile_trigger'
  ) THEN
    CREATE TRIGGER create_user_profile_trigger
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION create_user_profile();
  END IF;
END $$;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'user_profiles_updated_at'
  ) THEN
    CREATE TRIGGER user_profiles_updated_at
      BEFORE UPDATE ON user_profiles
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'user_books_updated_at'
  ) THEN
    CREATE TRIGGER user_books_updated_at
      BEFORE UPDATE ON user_books
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;