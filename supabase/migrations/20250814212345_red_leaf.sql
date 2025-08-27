/*
  # Add unique constraint for chapter summaries

  1. Database Changes
    - Add unique constraint on (book_id, chapter_number) if it doesn't exist
    - This enables the upsert operation with onConflict to work properly

  2. Notes
    - Required for chapter_summaries.upsert(..., { onConflict: 'book_id,chapter_number' })
    - Prevents duplicate summaries for the same chapter in the same book
*/

-- Add unique constraint on (book_id, chapter_number) if it doesn't already exist
CREATE UNIQUE INDEX IF NOT EXISTS chapter_summaries_book_id_chapter_number_key
  ON public.chapter_summaries (book_id, chapter_number);