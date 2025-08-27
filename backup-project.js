#!/usr/bin/env node

/**
 * Project Backup Script
 * Creates a backup of the current project state including all files and structure
 */

import fs from 'fs/promises';
import path from 'path';

const BACKUP_DIR = 'project-backups';
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.env',
  '.env.local',
  'project-backups',
  'package-lock.json',
  '.bolt'
];

async function shouldIgnore(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return IGNORE_PATTERNS.some(pattern => 
    relativePath.includes(pattern) || relativePath.startsWith(pattern)
  );
}

async function getAllFiles(dir, fileList = []) {
  const files = await fs.readdir(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    
    if (await shouldIgnore(filePath)) {
      continue;
    }
    
    const stat = await fs.stat(filePath);
    
    if (stat.isDirectory()) {
      await getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

async function createBackup() {
  try {
    console.log('🔄 Creating project backup...');
    
    // Create backup directory
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    // Get all files
    const files = await getAllFiles(process.cwd());
    console.log(`📁 Found ${files.length} files to backup`);
    
    // Create backup data structure
    const backupData = {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      project_name: 'ai-book-generator',
      files: {}
    };
    
    // Read all files
    for (const filePath of files) {
      try {
        const relativePath = path.relative(process.cwd(), filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        backupData.files[relativePath] = content;
      } catch (error) {
        console.warn(`⚠️  Could not read ${filePath}:`, error.message);
      }
    }
    
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const backupFileName = `project-backup-${timestamp}.json`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    
    // Write backup file
    await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
    
    // Calculate file size
    const stats = await fs.stat(backupPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log('✅ Backup created successfully!');
    console.log(`📦 File: ${backupPath}`);
    console.log(`📊 Size: ${sizeMB} MB`);
    console.log(`📄 Files backed up: ${Object.keys(backupData.files).length}`);
    
    return backupPath;
  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

// Run backup
createBackup();