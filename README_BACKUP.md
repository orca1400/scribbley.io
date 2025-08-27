# Backup System Documentation

## Overview
The AI Book Generator includes a comprehensive backup system with both manual and automated backup capabilities. This ensures your data is safe and can be restored when needed.

## Features

### 1. Manual Backups
- **User Interface**: Accessible through Settings → Backup & Restore
- **Complete Data Export**: Includes profile, books, chapter summaries, and usage history
- **JSON Format**: Human-readable and portable
- **Instant Download**: Creates and downloads backup immediately

### 2. Automated Backups
- **Client-Side Scheduling**: Optional daily auto-backups for users
- **Server-Side Backups**: System-wide backups via Edge Functions
- **Configurable Intervals**: Customizable backup frequency
- **Status Monitoring**: Real-time backup status in dashboard

### 3. Data Restoration
- **File Upload**: Drag-and-drop backup file restoration
- **Validation**: Automatic backup file format validation
- **Merge Strategy**: Safely merges with existing data
- **Preview**: Shows backup contents before restoration

## Components

### Frontend Components
- `BackupPanel.tsx`: Main backup interface
- `BackupStatus.tsx`: Shows backup status in dashboard
- `useBackupScheduler.ts`: Hook for automated backups

### Backend Services
- `backup.ts`: Core backup/restore logic
- `automated-backup` Edge Function: Server-side backup API
- Database tables for backup logging and metrics

### Scripts
- `backup-scheduler.js`: CLI tool for automated backups
- `restore-backup.js`: CLI tool for backup restoration

## Usage

### Creating a Manual Backup
1. Go to Settings → Backup & Restore
2. Click "Create & Download Backup"
3. Save the JSON file to a secure location

### Enabling Auto-Backups
1. In the dashboard, find the backup status widget
2. Toggle "Auto-backup" to ON
3. Backups will be created daily and auto-downloaded

### Restoring a Backup
1. Go to Settings → Backup & Restore
2. Upload your backup JSON file
3. Review the preview information
4. Click "Restore Backup" to apply changes

### CLI Backup Operations
```bash
# Create backup for all active users
npm run backup

# Create backup for specific user
npm run backup:user -- --user-id=<user-id>

# Restore backup from file
npm run restore -- backup-2025-01-15.json

# Dry run restore (preview only)
node scripts/restore-backup.js backup.json --dry-run
```

## Database Schema

### system_backups Table
- Tracks all backup operations
- Stores metrics and status
- Used for monitoring and analytics

### usage_alert_logs Table
- Prevents duplicate usage alert emails
- Tracks notification history
- Ensures idempotent alert system

## Security

### Access Control
- User backups: Protected by RLS policies
- System backups: Service role access only
- API endpoints: Require authentication tokens

### Data Privacy
- Backups include only user's own data
- No cross-user data leakage
- GDPR compliant data export

### Validation
- Backup file format validation
- User ID verification during restore
- Safe merge operations (no data loss)

## Monitoring

### Backup Metrics
- Total users backed up
- Data size and compression
- Success/failure rates
- Performance timing

### Status Tracking
- Real-time backup status
- Error logging and reporting
- Historical backup records

## Best Practices

### For Users
1. **Regular Backups**: Create backups before major changes
2. **Secure Storage**: Store backup files in secure locations
3. **Version Control**: Keep multiple backup versions
4. **Test Restores**: Periodically test backup restoration

### For Administrators
1. **Monitor Logs**: Check backup success rates
2. **Storage Management**: Clean up old backup files
3. **Performance**: Monitor backup duration and size
4. **Alerts**: Set up monitoring for backup failures

## Troubleshooting

### Common Issues
- **Large Backups**: May take time for users with many books
- **Network Timeouts**: Retry failed backup operations
- **File Corruption**: Validate backup files before restoration
- **Permission Errors**: Ensure proper RLS policies

### Error Messages
- `"Invalid backup file format"`: File is corrupted or wrong format
- `"Backup user ID does not match"`: Trying to restore another user's backup
- `"Failed to create backup"`: Database or permission error

## Cron Job Setup

Add to your server's crontab for automated system backups:

```bash
# Daily backup at 2 AM
0 2 * * * cd /path/to/app && npm run backup >> /var/log/backup.log 2>&1

# Weekly full backup on Sundays at 3 AM
0 3 * * 0 cd /path/to/app && npm run backup -- --include-usage >> /var/log/backup-full.log 2>&1
```

## Recovery Scenarios

### User Data Loss
1. User reports lost data
2. Locate most recent backup
3. Use restore script with user's backup file
4. Verify data integrity after restoration

### System-Wide Issues
1. Use automated backup system
2. Restore from most recent system backup
3. Verify all user data is intact
4. Notify users of any data recovery actions

## Future Enhancements

### Planned Features
- **Incremental Backups**: Only backup changed data
- **Cloud Storage**: Automatic upload to S3/GCS
- **Encryption**: Encrypt backup files at rest
- **Compression**: Reduce backup file sizes
- **Scheduling UI**: User-configurable backup schedules

### Integration Options
- **External Storage**: AWS S3, Google Cloud Storage
- **Monitoring**: Integration with monitoring services
- **Notifications**: Email alerts for backup status
- **API**: RESTful backup management API