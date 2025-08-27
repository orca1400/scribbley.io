// src/hooks/useBackupScheduler.ts
import { useEffect, useRef } from 'react';

interface BackupSchedulerOptions {
  enabled: boolean;
  intervalHours: number;
  userId: string;
  onBackupComplete?: (success: boolean, error?: string) => void;
}

/**
 * Hook to schedule automatic local backups
 * Note: This creates client-side backups. Server-side backups are handled separately.
 */
export function useBackupScheduler({
  enabled,
  intervalHours,
  userId,
  onBackupComplete,
}: BackupSchedulerOptions) {
  const intervalRef = useRef<number | null>(null);
  const lastBackupRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Check if we need to create a backup
    const checkAndBackup = async () => {
      try {
        const lastBackupKey = `lastBackup_${userId}`;
        const lastBackup = localStorage.getItem(lastBackupKey);
        const now = Date.now();
        const intervalMs = intervalHours * 60 * 60 * 1000;

        if (lastBackup && (now - parseInt(lastBackup)) < intervalMs) {
          return; // Too soon for next backup
        }

        // Import backup service dynamically to avoid circular dependencies
        const { createUserBackup, downloadBackup } = await import('../services/backup');
        
        console.log('Creating scheduled backup for user:', userId);
        const backupData = await createUserBackup(userId);
        
        // Auto-download with timestamp
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
        downloadBackup(backupData, `auto-backup-${timestamp}.json`);
        
        // Update last backup time
        localStorage.setItem(lastBackupKey, now.toString());
        lastBackupRef.current = new Date().toISOString();
        
        onBackupComplete?.(true);
        console.log('Scheduled backup completed successfully');
      } catch (error) {
        console.error('Scheduled backup failed:', error);
        onBackupComplete?.(false, (error as Error).message);
      }
    };

    // Initial check
    checkAndBackup();

    // Set up interval
    intervalRef.current = window.setInterval(checkAndBackup, 60 * 60 * 1000); // Check every hour

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, intervalHours, userId, onBackupComplete]);

  return {
    lastBackup: lastBackupRef.current,
    isEnabled: enabled && !!userId,
  };
}