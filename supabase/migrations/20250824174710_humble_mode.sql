/*
  # Create backup and monitoring tables

  1. New Tables
    - `system_backups`
      - `id` (uuid, primary key)
      - `backup_type` (text) - 'user' or 'system'
      - `user_ids` (text array) - list of user IDs included
      - `metrics` (jsonb) - backup statistics
      - `data_size_mb` (numeric) - backup file size
      - `created_at` (timestamp)
      - `completed_at` (timestamp)
      - `status` (text) - 'pending', 'completed', 'failed'
    
    - `usage_alert_logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - references users
      - `threshold` (integer) - 80 or 100
      - `month_year` (text) - "2025-01" format
      - `sent_at` (timestamp)

  2. Security
    - Enable RLS on both tables
    - Add policies for service role access
    - Add indexes for performance

  3. Functions
    - Add trigger to auto-update completed_at
*/

-- Create system_backups table
CREATE TABLE IF NOT EXISTS system_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type text NOT NULL CHECK (backup_type IN ('user', 'system')),
  user_ids text[] NOT NULL DEFAULT '{}',
  metrics jsonb,
  data_size_mb numeric(10,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Create usage_alert_logs table for idempotency
CREATE TABLE IF NOT EXISTS usage_alert_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  threshold integer NOT NULL CHECK (threshold IN (80, 100)),
  month_year text NOT NULL, -- "2025-01" format
  sent_at timestamptz DEFAULT now(),
  UNIQUE(user_id, threshold, month_year)
);

-- Enable RLS
ALTER TABLE system_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_alert_logs ENABLE ROW LEVEL SECURITY;

-- Policies for system_backups (service role only)
CREATE POLICY "Service role can manage backups"
  ON system_backups
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policies for usage_alert_logs (service role can manage, users can read own)
CREATE POLICY "Service role can manage alert logs"
  ON usage_alert_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can read own alert logs"
  ON usage_alert_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_backups_created_at 
  ON system_backups (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_backups_type_status 
  ON system_backups (backup_type, status);

CREATE INDEX IF NOT EXISTS idx_usage_alert_logs_user_month 
  ON usage_alert_logs (user_id, month_year);

CREATE INDEX IF NOT EXISTS idx_usage_alert_logs_sent_at 
  ON usage_alert_logs (sent_at DESC);

-- Function to auto-update completed_at when status changes to 'completed'
CREATE OR REPLACE FUNCTION update_backup_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating completed_at
DROP TRIGGER IF EXISTS trg_backup_completed_at ON system_backups;
CREATE TRIGGER trg_backup_completed_at
  BEFORE UPDATE ON system_backups
  FOR EACH ROW
  EXECUTE FUNCTION update_backup_completed_at();

-- Add foreign key constraint for usage_alert_logs (if users table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    ALTER TABLE usage_alert_logs 
    ADD CONSTRAINT usage_alert_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists, ignore
    NULL;
END $$;