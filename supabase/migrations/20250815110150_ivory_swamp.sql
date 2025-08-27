/*
  # Add AI consent tracking columns

  1. New Columns
    - `ai_processing_consent` (boolean, default false) - Whether user consented to AI processing
    - `ai_consent_at` (timestamptz, nullable) - When consent was given
    - `ai_consent_version` (text, nullable) - Version of consent terms accepted

  2. Purpose
    - Track user consent for AI processing via OpenAI
    - Required for GDPR compliance
    - Version tracking for consent term changes
*/

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS ai_processing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_consent_version text;