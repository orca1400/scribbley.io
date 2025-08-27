// Central plan config (single source of truth)

export type PlanTier = 'free' | 'pro' | 'premium';

export const PLAN = {
  free:    { monthlyWords: 8_000,     projects: 2,    chapterLimit: 5,   lengths: ['short'] as const },
  pro:     { monthlyWords: 500_000,   projects: 5,    chapterLimit: 50,  lengths: ['short','medium','long'] as const },
  premium: { monthlyWords: 1_000_000, projects: Infinity, chapterLimit: 100, lengths: ['short','medium','long','xlong'] as const },
} as const;

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000000';

export type ChapterLength = 'short' | 'medium' | 'long' | 'xlong';

export const CHAPTER_LENGTH_RANGES: Record<ChapterLength, [number, number]> = {
  short:  [1000, 1500],
  medium: [1500, 2500],
  long:   [2500, 4000],
  xlong:  [4000, 6000],
};

// Keep consent version centralized for reuse across UI & functions
export const CONSENT_VERSION = '2025-08-15';