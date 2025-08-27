/*
  # Create chapter summaries table

  1. New Tables
    - `chapter_summaries`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `book_id` (uuid, references user_books)
      - `chapter_number` (integer)
      - `summary` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `chapter_summaries` table
    - Add policies for authenticated users to manage their own summaries

  3. Indexes
    - Add index on user_id and book_id for efficient queries
    - Add unique constraint on book_id and chapter_number
*/

CREATE TABLE IF NOT EXISTS chapter_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL,
  chapter_number integer NOT NULL,
  summary text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE chapter_summaries ADD CONSTRAINT chapter_summaries_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE chapter_summaries ADD CONSTRAINT chapter_summaries_book_id_fkey 
  FOREIGN KEY (book_id) REFERENCES user_books(id) ON DELETE CASCADE;

ALTER TABLE chapter_summaries ADD CONSTRAINT chapter_summaries_unique_chapter 
  UNIQUE (book_id, chapter_number);

CREATE INDEX IF NOT EXISTS chapter_summaries_user_book_idx 
  ON chapter_summaries(user_id, book_id);

CREATE INDEX IF NOT EXISTS chapter_summaries_book_chapter_idx 
  ON chapter_summaries(book_id, chapter_number);

ALTER TABLE chapter_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chapter summaries"
  ON chapter_summaries
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_chapter_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chapter_summaries_updated_at
  BEFORE UPDATE ON chapter_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_chapter_summaries_updated_at();