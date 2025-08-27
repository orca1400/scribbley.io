-- user_profiles: add AI consent + privacy fields
alter table public.user_profiles
  add column if not exists ai_processing_consent boolean not null default false,
  add column if not exists ai_consent_at timestamptz,
  add column if not exists ai_consent_version text,
  add column if not exists allow_training boolean not null default false,
  add column if not exists content_retention_days integer not null default 365,
  add column if not exists log_retention_days integer not null default 90,
  add column if not exists default_visibility text not null default 'private',
  add column if not exists gdpr_acknowledged_at timestamptz;