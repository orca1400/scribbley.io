import { supabase } from '../lib/supabase';

export async function saveBookToDatabase(
  userId: string,
  book: {
    title: string;
    genre: string;
    subgenre: string;
    description: string;
    content: string;
    wordCount: number;
    totalChapters?: number;
    chaptersRead?: number;
  },
  updateWordUsage = true
) {
  try {
    const { data, error } = await supabase
      .from('user_books')
      .insert({
        user_id: userId,
        title: book.title,
        genre: book.genre,
        subgenre: book.subgenre,
        description: book.description,
        content: book.content,
        word_count: book.wordCount,
        total_chapters: book.totalChapters!,
        chapters_read: book.chaptersRead!,
      })
      .select()
      .single();

    if (error) throw error;

    // ⚠️ Consider moving this to a DB trigger/RPC to prevent client tampering.
    if (updateWordUsage) {
      const { data: profileData, error: fetchError } = await supabase
        .from('user_profiles')
        .select('words_used_this_month')
        .eq('id', userId)
        .single();

      if (!fetchError && profileData) {
        const currentUsage = profileData.words_used_this_month || 0;
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update({ words_used_this_month: currentUsage + book.wordCount })
          .eq('id', userId);
        if (updateError) console.error('Error updating word usage:', updateError);
      }
    }

    return data;
  } catch (e) {
    console.error('Error saving book:', e);
    throw e;
  }
}

export async function upsertChapterSummary(args: {
  userId: string;
  bookId: string;
  chapterNumber: number;
  summary: string;
}) {
  const { data, error } = await supabase
    .from('chapter_summaries')
    .upsert(
      {
        user_id: args.userId,
        book_id: args.bookId,
        chapter_number: args.chapterNumber,
        summary: args.summary,
      },
      { onConflict: 'user_id,book_id,chapter_number' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}