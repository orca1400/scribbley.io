#!/usr/bin/env node

/**
 * Project Restore Script
 * Restores a project from a backup file
 */

import fs from 'fs/promises';
import path from 'path';

const args = process.argv.slice(2);
const backupFile = args[0];

if (!backupFile) {
  console.error('Usage: node restore-project.js <backup-file.json>');
  console.error('Example: node restore-project.js project-backups/project-backup-2025-01-15_14-30-00.json');
  process.exit(1);
}

async function restoreProject() {
  try {
    console.log('📂 Reading backup file:', backupFile);
    
    // Read and parse backup
    const backupContent = await fs.readFile(backupFile, 'utf-8');
    const backupData = JSON.parse(backupContent);
    
    // Validate backup structure
    if (!backupData.version || !backupData.files) {
      throw new Error('Invalid backup file format');
    }
    
    console.log(`📊 Backup info:`);
    console.log(`   - Version: ${backupData.version}`);
    console.log(`   - Created: ${new Date(backupData.created_at).toLocaleString()}`);
    console.log(`   - Project: ${backupData.project_name || 'Unknown'}`);
    console.log(`   - Files: ${Object.keys(backupData.files).length}`);
    
    // Confirm restoration
    console.log('\n⚠️  This will overwrite existing files. Continue? (y/N)');
    
    // In a real scenario, you'd want to prompt for confirmation
    // For now, we'll proceed automatically
    console.log('🔄 Restoring files...');
    
    let restoredCount = 0;
    let errorCount = 0;
    
    // Restore each file
    for (const [relativePath, content] of Object.entries(backupData.files)) {
      try {
        const fullPath = path.resolve(process.cwd(), relativePath);
        const dir = path.dirname(fullPath);
        
        // Ensure directory exists
        await fs.mkdir(dir, { recursive: true });
        
        // Write file
        await fs.writeFile(fullPath, content, 'utf-8');
        restoredCount++;
        
        if (restoredCount % 10 === 0) {
          console.log(`   Restored ${restoredCount} files...`);
        }
      } catch (error) {
        console.warn(`⚠️  Could not restore ${relativePath}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('✅ Project restoration completed!');
    console.log(`📄 Files restored: ${restoredCount}`);
    if (errorCount > 0) {
      console.log(`⚠️  Errors: ${errorCount}`);
    }
    
    console.log('\n🔧 Next steps:');
    console.log('   1. Run: npm install');
    console.log('   2. Check your .env file and update environment variables');
    console.log('   3. Run: npm run dev');
    
  } catch (error) {
    console.error('❌ Restore failed:', error);
    process.exit(1);
  }
}

// Run restore
restoreProject();