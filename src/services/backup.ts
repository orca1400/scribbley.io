// src/services/backup.ts
import { supabase } from '../lib/supabase';
import type { UserBook, ChapterSummary, UserProfile } from '../types/database';

export interface BackupData {
  version: string;
  created_at: string;
  user_id: string;
  profile: UserProfile;
  books: UserBook[];
  chapter_summaries: ChapterSummary[];
  usage_events: Array<{
    id: string;
    feature: string;
    words: number;
    tokens: number;
    billable: boolean;
    reason: string;
    created_at: string;
  }>;
  metadata: {
    total_books: number;
    total_chapters: number;
    total_words: number;
    backup_size_mb: number;
  };
}

/**
 * Create a complete backup of user data
 */
export async function createUserBackup(userId: string): Promise<BackupData> {
  try {
    // Fetch all user data in parallel
    const [profileResult, booksResult, summariesResult, usageResult] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single(),
      
      supabase
        .from('user_books')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      
      supabase
        .from('chapter_summaries')
        .select('*')
        .eq('user_id', userId)
        .order('book_id, chapter_number'),
      
      supabase
        .from('usage_events')
        .select('id, feature, words, tokens, billable, reason, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000) // Last 1000 usage events
    ]);

    if (profileResult.error) throw profileResult.error;
    if (booksResult.error) throw booksResult.error;
    if (summariesResult.error) throw summariesResult.error;
    if (usageResult.error) throw usageResult.error;

    const profile = profileResult.data;
    const books = booksResult.data || [];
    const summaries = summariesResult.data || [];
    const usage = usageResult.data || [];

    // Calculate metadata
    const totalWords = books.reduce((sum, book) => sum + (book.word_count || 0), 0);
    const totalChapters = summaries.length;

    const backupData: BackupData = {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      user_id: userId,
      profile,
      books,
      chapter_summaries: summaries,
      usage_events: usage,
      metadata: {
        total_books: books.length,
        total_chapters: totalChapters,
        total_words: totalWords,
        backup_size_mb: 0, // Will be calculated after JSON.stringify
      }
    };

    // Calculate backup size
    const jsonString = JSON.stringify(backupData);
    backupData.metadata.backup_size_mb = Math.round((jsonString.length / 1024 / 1024) * 100) / 100;

    return backupData;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw new Error('Failed to create backup: ' + (error as Error).message);
  }
}

/**
 * Download backup as JSON file
 */
export function downloadBackup(backupData: BackupData, filename?: string) {
  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `backup-${backupData.created_at.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Validate backup data structure
 */
export function validateBackup(data: any): data is BackupData {
  if (!data || typeof data !== 'object') return false;
  
  const required = ['version', 'created_at', 'user_id', 'profile', 'books', 'chapter_summaries', 'usage_events', 'metadata'];
  for (const field of required) {
    if (!(field in data)) return false;
  }
  
  if (!Array.isArray(data.books) || !Array.isArray(data.chapter_summaries) || !Array.isArray(data.usage_events)) {
    return false;
  }
  
  return true;
}

/**
 * Restore backup data (careful - this will overwrite existing data)
 */
export async function restoreBackup(backupData: BackupData, userId: string): Promise<{
  success: boolean;
  errors: string[];
  partialSuccess: boolean;
  restored: { profile: boolean; books: number; summaries: number };
}> {
  if (!validateBackup(backupData)) {
    throw new Error('Invalid backup data format');
  }
  
  if (backupData.user_id !== userId) {
    throw new Error('Backup user ID does not match current user');
  }
  
  const errors: string[] = [];
  const restored = { profile: false, books: 0, summaries: 0 };
  
  // 1. Update profile (merge with existing to preserve system fields)
  try {
    const { error: profileError } = await supabase
      .from('user_profiles')
      .update({
        display_name: backupData.profile.display_name,
        bio: backupData.profile.bio,
        ui_language: backupData.profile.ui_language,
        book_language: backupData.profile.book_language,
        timezone: backupData.profile.timezone,
        avatar_url: backupData.profile.avatar_url,
        ai_processing_consent: backupData.profile.ai_processing_consent,
        allow_training: backupData.profile.allow_training,
        content_retention_days: backupData.profile.content_retention_days,
        log_retention_days: backupData.profile.log_retention_days,
        default_visibility: backupData.profile.default_visibility,
      })
      .eq('id', userId);
    
    if (profileError) {
      errors.push(`Profile restore failed: ${profileError.message}`);
    } else {
      restored.profile = true;
    }
  } catch (error) {
    errors.push(`Profile restore failed: ${(error as Error).message}`);
  }
  
  // 2. Restore books (upsert to avoid conflicts)
  if (backupData.books.length > 0) {
    try {
      const { error: booksError } = await supabase
        .from('user_books')
        .upsert(
          backupData.books.map(book => ({
            ...book,
            user_id: userId, // Ensure correct user_id
          })),
          { onConflict: 'id' }
        );
      
      if (booksError) {
        errors.push(`Books restore failed: ${booksError.message}`);
      } else {
        restored.books = backupData.books.length;
      }
    } catch (error) {
      errors.push(`Books restore failed: ${(error as Error).message}`);
    }
  }
  
  // 3. Restore chapter summaries (upsert to avoid conflicts)
  if (backupData.chapter_summaries.length > 0) {
    try {
      const { error: summariesError } = await supabase
        .from('chapter_summaries')
        .upsert(
          backupData.chapter_summaries.map(summary => ({
            ...summary,
            user_id: userId, // Ensure correct user_id
          })),
          { onConflict: 'book_id,chapter_number' }
        );
      
      if (summariesError) {
        errors.push(`Chapter summaries restore failed: ${summariesError.message}`);
      } else {
        restored.summaries = backupData.chapter_summaries.length;
      }
    } catch (error) {
      errors.push(`Chapter summaries restore failed: ${(error as Error).message}`);
    }
  }
  
  const hasAnySuccess = restored.profile || restored.books > 0 || restored.summaries > 0;
  const hasAnyFailure = errors.length > 0;
  
  if (!hasAnySuccess && hasAnyFailure) {
    // Complete failure
    throw new Error(`Backup restore failed completely: ${errors.join('; ')}`);
  }
  
  console.log('Backup restore completed:', { restored, errors });
  
  return {
    success: !hasAnyFailure,
    errors,
    partialSuccess: hasAnySuccess && hasAnyFailure,
    restored
  };
}

/**
 * Get backup statistics for a user
 */
export async function getBackupStats(userId: string) {
  try {
    const [booksCount, summariesCount, usageCount] = await Promise.all([
      supabase
        .from('user_books')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      
      supabase
        .from('chapter_summaries')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      
      supabase
        .from('usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
    ]);

    return {
      books: booksCount.count || 0,
      summaries: summariesCount.count || 0,
      usage_events: usageCount.count || 0,
    };
  } catch (error) {
    console.error('Error getting backup stats:', error);
    return { books: 0, summaries: 0, usage_events: 0 };
  }
}