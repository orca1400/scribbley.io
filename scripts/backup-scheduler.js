#!/usr/bin/env node

/**
 * Backup Scheduler Script
 * 
 * This script can be run via cron job to create automated backups.
 * 
 * Usage:
 *   node scripts/backup-scheduler.js [--user-id=<id>] [--include-usage] [--max-usage=<num>]
 * 
 * Examples:
 *   node scripts/backup-scheduler.js                    # Backup all active users
 *   node scripts/backup-scheduler.js --user-id=123     # Backup specific user
 *   node scripts/backup-scheduler.js --include-usage   # Include usage events
 * 
 * Environment Variables Required:
 *   VITE_SUPABASE_URL
 *   BACKUP_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const BACKUP_API_KEY = process.env.BACKUP_API_KEY;

if (!SUPABASE_URL || !BACKUP_API_KEY) {
  console.error('Missing required environment variables: VITE_SUPABASE_URL, BACKUP_API_KEY');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const userId = args.find(arg => arg.startsWith('--user-id='))?.split('=')[1];
const includeUsage = args.includes('--include-usage');
const maxUsageArg = args.find(arg => arg.startsWith('--max-usage='))?.split('=')[1];
const maxUsageEvents = maxUsageArg ? parseInt(maxUsageArg) : 10000;

async function runBackup() {
  try {
    console.log('🔄 Starting automated backup...');
    console.log(`📊 Config: userId=${userId || 'all'}, includeUsage=${includeUsage}, maxEvents=${maxUsageEvents}`);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/automated-backup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BACKUP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        includeUsageEvents: includeUsage,
        maxUsageEvents,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backup API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Backup completed successfully!');
      console.log(`📈 Metrics:`, result.metrics);
      
      // Save backup data to file if it's a single user backup
      if (result.backup_data && userId) {
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
        const filename = `backup_${userId}_${timestamp}.json`;
        const backupDir = path.join(process.cwd(), 'backups');
        
        // Ensure backup directory exists
        await fs.mkdir(backupDir, { recursive: true });
        
        const filepath = path.join(backupDir, filename);
        await fs.writeFile(filepath, JSON.stringify(result.backup_data, null, 2));
        
        console.log(`💾 Backup saved to: ${filepath}`);
        console.log(`📦 File size: ${result.metrics.backup_size_mb} MB`);
      }
    } else {
      console.error('❌ Backup failed:', result.error || 'Unknown error');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Backup script error:', error);
    process.exit(1);
  }
}

// Run the backup
runBackup();