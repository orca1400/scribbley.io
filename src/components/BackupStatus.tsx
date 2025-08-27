// src/components/BackupStatus.tsx
import React, { useState, useEffect } from 'react';
import { HardDrive, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { useBackupScheduler } from '../hooks/useBackupScheduler';

interface BackupStatusProps {
  userId: string;
  className?: string;
}

export function BackupStatus({ userId, className = '' }: BackupStatusProps) {
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [lastBackupStatus, setLastBackupStatus] = useState<'success' | 'error' | null>(null);
  const [lastBackupError, setLastBackupError] = useState<string | null>(null);

  // Load settings from localStorage
  useEffect(() => {
    const enabled = localStorage.getItem(`autoBackup_${userId}`) === 'true';
    setAutoBackupEnabled(enabled);
  }, [userId]);

  const { lastBackup, isEnabled } = useBackupScheduler({
    enabled: autoBackupEnabled,
    intervalHours: 24, // Daily backups
    userId,
    onBackupComplete: (success, error) => {
      setLastBackupStatus(success ? 'success' : 'error');
      setLastBackupError(error || null);
    },
  });

  const toggleAutoBackup = () => {
    const newEnabled = !autoBackupEnabled;
    setAutoBackupEnabled(newEnabled);
    localStorage.setItem(`autoBackup_${userId}`, newEnabled.toString());
  };

  const getStatusIcon = () => {
    if (!isEnabled) return <HardDrive className="w-4 h-4 text-gray-400" />;
    if (lastBackupStatus === 'success') return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (lastBackupStatus === 'error') return <AlertTriangle className="w-4 h-4 text-red-600" />;
    return <Clock className="w-4 h-4 text-blue-600" />;
  };

  const getStatusText = () => {
    if (!isEnabled) return 'Auto-backup disabled';
    if (lastBackupStatus === 'success' && lastBackup) {
      return `Last backup: ${new Date(lastBackup).toLocaleDateString()}`;
    }
    if (lastBackupStatus === 'error') return 'Backup failed';
    return 'Backup scheduled';
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {getStatusIcon()}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-700">{getStatusText()}</div>
        {lastBackupError && (
          <div className="text-xs text-red-600 truncate" title={lastBackupError}>
            {lastBackupError}
          </div>
        )}
      </div>
      <button
        onClick={toggleAutoBackup}
        className={`text-xs px-2 py-1 rounded transition-colors ${
          isEnabled
            ? 'bg-green-100 text-green-800 hover:bg-green-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {isEnabled ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}