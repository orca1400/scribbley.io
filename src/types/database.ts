// src/types/database.ts

export type PlanTier = 'free' | 'pro' | 'premium';
export type Visibility = 'private' | 'unlisted' | 'public';

export interface UserProfile {
  id: string;
  // Plan / usage
  plan_tier: PlanTier;
  monthly_word_limit: number;
  words_used_this_month: number;
  billing_period_start: string; // ISO date "YYYY-MM-DD"
  created_at: string;           // ISO timestamp
  updated_at: string;           // ISO timestamp

  // Privacy & AI consent
  ai_processing_consent: boolean;
  ai_consent_at: string | null;       // ISO timestamp or null
  ai_consent_version: string | null;
  allow_training: boolean;
  content_retention_days: number;
  log_retention_days: number;
  default_visibility: Visibility;
  gdpr_acknowledged_at: string | null;

  // Profile fields
  display_name: string | null;
  bio: string | null;
  ui_language: string | null;
  book_language: string | null;
  timezone: string | null;
  avatar_url: string | null;
}

export interface UserBook {
  id: string;
  user_id: string;
  title: string;
  cover_url?: string | null;
  genre: string;      
  subgenre: string;
  description: string;
  content: string;
  total_chapters: number;
  chapters_read: number;
  word_count: number;
  created_at: string;  // ISO timestamp
  updated_at: string;  // ISO timestamp
}

export interface ChapterSummary {
  // Optional: some schemas have a surrogate id, others only use (book_id, chapter_number)
  id?: string;

  user_id: string;
  book_id: string;
  chapter_number: number;
  summary: string;

  // New columns used by generate-summary
  content_hash: string | null;
  model: string | null;
  prompt_version: string | null;

  created_at?: string; // present if you selected it
  updated_at?: string;
}

export interface PlanLimits {
  free:    { monthly_words: number; books_per_month: number; name: string };
  pro:     { monthly_words: number; books_per_month: number; name: string };
  premium: { monthly_words: number; books_per_month: number; name: string };
}

export interface Session {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  has_consumed_guest_freebie: boolean;
  created_at: string;     // ISO timestamp
  updated_at?: string;    // optional if present in DB

  // Optional consent echo (we wrote these in edge functions)
  ai_processing_consent?: boolean | null;
  ai_consent_at?: string | null;
  ai_consent_version?: string | null;
}

export interface UsageEvent {
  id: string;
  user_id: string | null;
  session_id: string;
  feature: string;  // e.g., 'book_generate_fiction', 'chapter_generate', 'rewrite_passage'
  words: number;
  tokens: number;
  billable: boolean;
  reason: string;   // e.g., 'regular' | 'guest_free_book'
  created_at: string; // ISO timestamp
}
