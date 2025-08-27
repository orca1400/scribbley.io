// src/components/BackupPanel.tsx
import React, { useState, useRef } from 'react';
import { Download, Upload, Database, AlertTriangle, CheckCircle, X, FileText, Clock } from 'lucide-react';
import { createUserBackup, downloadBackup, restoreBackup, validateBackup, getBackupStats, type BackupData } from '../services/backup';

interface BackupPanelProps {
  userId: string;
  onClose: () => void;
}

export function BackupPanel({ userId, onClose }: BackupPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stats, setStats] = useState<{ books: number; summaries: number; usage_events: number } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<BackupData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    loadStats();
  }, [userId]);

  const loadStats = async () => {
    try {
      const backupStats = await getBackupStats(userId);
      setStats(backupStats);
    } catch (error) {
      console.error('Error loading backup stats:', error);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsCreating(true);
      setError(null);
      setSuccess(null);

      const backupData = await createUserBackup(userId);
      downloadBackup(backupData);
      
      setSuccess(`Backup created successfully! Downloaded ${backupData.metadata.backup_size_mb}MB file with ${backupData.metadata.total_books} books.`);
    } catch (error) {
      setError('Failed to create backup: ' + (error as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setSelectedFile(file);
      setError(null);
      setBackupPreview(null);

      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!validateBackup(data)) {
        throw new Error('Invalid backup file format');
      }

      if (data.user_id !== userId) {
        throw new Error('This backup belongs to a different user account');
      }

      setBackupPreview(data);
    } catch (error) {
      setError('Invalid backup file: ' + (error as Error).message);
      setSelectedFile(null);
    }
  };

  const handleRestoreBackup = async () => {
    if (!backupPreview) return;

    try {
      setIsRestoring(true);
      setError(null);
      setSuccess(null);

      const result = await restoreBackup(backupPreview, userId);
      
      if (result.success) {
        setSuccess(`Backup restored successfully! Restored: ${result.restored.books} books, ${result.restored.summaries} summaries, and profile data.`);
      } else if (result.partialSuccess) {
        const successParts = [];
        if (result.restored.profile) successParts.push('profile');
        if (result.restored.books > 0) successParts.push(`${result.restored.books} books`);
        if (result.restored.summaries > 0) successParts.push(`${result.restored.summaries} summaries`);
        
        setError(`Partial restore completed. Successfully restored: ${successParts.join(', ')}. Errors: ${result.errors.join('; ')}`);
      }
      
      // Refresh stats
      await loadStats();
      
      // Clear file selection
      setSelectedFile(null);
      setBackupPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setError('Failed to restore backup: ' + (error as Error).message);
    } finally {
      setIsRestoring(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Backup & Restore</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close backup panel"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {/* Current Data Stats */}
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Your Current Data
            </h3>
            {stats ? (
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-900">{stats.books}</div>
                  <div className="text-blue-700">Books</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-900">{stats.summaries}</div>
                  <div className="text-blue-700">Chapter Summaries</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-900">{stats.usage_events}</div>
                  <div className="text-blue-700">Usage Events</div>
                </div>
              </div>
            ) : (
              <div className="text-center text-blue-700">Loading stats...</div>
            )}
          </section>

          {/* Create Backup */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Download className="w-5 h-5 text-green-600" />
              Create Backup
            </h3>
            <p className="text-gray-600 mb-4">
              Download a complete backup of your profile, books, chapter summaries, and usage history as a JSON file.
            </p>
            
            <button
              onClick={handleCreateBackup}
              disabled={isCreating}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating Backup...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Create & Download Backup
                </>
              )}
            </button>
          </section>

          {/* Restore Backup */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-orange-600" />
              Restore Backup
            </h3>
            <p className="text-gray-600 mb-4">
              Upload a backup file to restore your data. This will merge with your existing data (books and summaries will be updated if they exist).
            </p>
            
            {/* Best effort warning */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-blue-800">
                  <div className="font-medium">Best Effort Restore</div>
                  <div className="mt-1">
                    Backup restoration is performed on a "best effort" basis. If the process is interrupted by network issues, browser closure, or other errors, only some of your data may be restored. Please ensure a stable connection and avoid closing the browser during restoration.
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              {selectedFile && (
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="text-sm text-gray-700">
                    <strong>Selected file:</strong> {selectedFile.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    Size: {formatFileSize(selectedFile.size)} • Modified: {formatDate(new Date(selectedFile.lastModified).toISOString())}
                  </div>
                </div>
              )}

              {backupPreview && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-2 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Backup Preview
                  </h4>
                  <div className="text-sm text-green-800 space-y-1">
                    <div>Version: {backupPreview.version}</div>
                    <div>Created: {formatDate(backupPreview.created_at)}</div>
                    <div>Books: {backupPreview.metadata.total_books}</div>
                    <div>Chapters: {backupPreview.metadata.total_chapters}</div>
                    <div>Total Words: {backupPreview.metadata.total_words.toLocaleString()}</div>
                    <div>Size: {backupPreview.metadata.backup_size_mb} MB</div>
                  </div>
                </div>
              )}

              {backupPreview && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <strong>Important:</strong> Restoring will merge this backup with your current data. 
                      Books and summaries with matching IDs will be updated. This action cannot be undone.
                      <br /><br />
                      <strong>Partial Restore Risk:</strong> If the restore process is interrupted due to network issues, 
                      browser closure, or other errors, only some data may be restored successfully. Ensure you have a 
                      stable connection and keep this tab open during the entire process.
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleRestoreBackup}
                disabled={!backupPreview || isRestoring}
                className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {isRestoring ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Restore Backup
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Automated Backups Info */}
          <section className="bg-gray-50 border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Automated Backups
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              Your data is automatically backed up by our system:
            </p>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Database snapshots every 6 hours</li>
              <li>• Point-in-time recovery for 7 days</li>
              <li>• Geo-redundant storage across multiple regions</li>
              <li>• 99.9% uptime SLA with automatic failover</li>
            </ul>
            <p className="text-xs text-gray-500 mt-3">
              Manual backups are recommended before major changes or for personal archives.
            </p>
          </section>

          {/* Status Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">{error}</div>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-800">{success}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50">
          <div className="flex justify-between items-center">
            <div className="text-xs text-gray-500">
              Backups include all your books, summaries, and settings
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}