#!/usr/bin/env node

/**
 * Backup Restore Script
 * 
 * This script restores a backup file to the database.
 * 
 * Usage:
 *   node scripts/restore-backup.js <backup-file.json> [--user-id=<id>] [--dry-run]
 * 
 * Examples:
 *   node scripts/restore-backup.js backup_2025-01-15.json
 *   node scripts/restore-backup.js backup.json --user-id=123 --dry-run
 * 
 * Environment Variables Required:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Parse command line arguments
const args = process.argv.slice(2);
const backupFile = args[0];
const targetUserId = args.find(arg => arg.startsWith('--user-id='))?.split('=')[1];
const isDryRun = args.includes('--dry-run');

if (!backupFile) {
  console.error('Usage: node scripts/restore-backup.js <backup-file.json> [--user-id=<id>] [--dry-run]');
  process.exit(1);
}

async function restoreBackup() {
  try {
    console.log('📂 Reading backup file:', backupFile);
    
    // Read and parse backup file
    const fileContent = await fs.readFile(backupFile, 'utf-8');
    const backupData = JSON.parse(fileContent);
    
    // Validate backup structure
    if (!backupData.version || !backupData.user_id || !backupData.data) {
      throw new Error('Invalid backup file format');
    }
    
    const userId = targetUserId || backupData.user_id;
    console.log(`👤 Target user ID: ${userId}`);
    console.log(`📊 Backup contains:`);
    console.log(`   - ${backupData.data.books?.length || 0} books`);
    console.log(`   - ${backupData.data.chapter_summaries?.length || 0} chapter summaries`);
    console.log(`   - ${backupData.data.usage_events?.length || 0} usage events`);
    console.log(`   - Created: ${new Date(backupData.created_at).toLocaleString()}`);
    
    if (isDryRun) {
      console.log('🔍 DRY RUN - No changes will be made');
      return;
    }
    
    console.log('🔄 Starting restore process...');
    
    // Restore profile
    if (backupData.data.profiles?.[0]) {
      const profile = backupData.data.profiles[0];
      console.log('📝 Updating user profile...');
      
      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert({
          ...profile,
          id: userId, // Ensure correct user ID
        }, { onConflict: 'id' });
      
      if (profileError) throw profileError;
      console.log('✅ Profile updated');
    }
    
    // Restore books
    if (backupData.data.books?.length > 0) {
      console.log(`📚 Restoring ${backupData.data.books.length} books...`);
      
      const { error: booksError } = await supabase
        .from('user_books')
        .upsert(
          backupData.data.books.map(book => ({
            ...book,
            user_id: userId, // Ensure correct user ID
          })),
          { onConflict: 'id' }
        );
      
      if (booksError) throw booksError;
      console.log('✅ Books restored');
    }
    
    // Restore chapter summaries
    if (backupData.data.chapter_summaries?.length > 0) {
      console.log(`📖 Restoring ${backupData.data.chapter_summaries.length} chapter summaries...`);
      
      const { error: summariesError } = await supabase
        .from('chapter_summaries')
        .upsert(
          backupData.data.chapter_summaries.map(summary => ({
            ...summary,
            user_id: userId, // Ensure correct user ID
          })),
          { onConflict: 'book_id,chapter_number' }
        );
      
      if (summariesError) throw summariesError;
      console.log('✅ Chapter summaries restored');
    }
    
    // Note: We don't restore usage_events as they are historical and should not be modified
    
    console.log('🎉 Backup restore completed successfully!');
    
  } catch (error) {
    console.error('❌ Restore failed:', error);
    process.exit(1);
  }
}

// Run the restore
restoreBackup();