// src/utils/plan.ts
import { PLAN, type ChapterLength } from '../config/plans';

export type PlanTier = 'free' | 'pro' | 'premium';

// Keep this tiny to match what App actually reads from profile
type ProfileLike = { plan_tier?: PlanTier | string | null } | null | undefined;

/** Normalize any incoming tier-ish string to a strict PlanTier */
function normalizeTier(t?: string | null): PlanTier {
  const v = (t || '').toLowerCase();
  if (v === 'pro') return 'pro';
  if (v === 'premium') return 'premium';
  return 'free';
}

/** Resolve the effective tier from (override → profile → free) */
export function effectivePlanTier(
  profile: ProfileLike,
  overrideTier?: PlanTier | string | null
): PlanTier {
  if (overrideTier) return normalizeTier(overrideTier);
  return normalizeTier(profile?.plan_tier ?? 'free');
}

/**
 * How many chapters a user can target per book, based on plan.
 * Backward compatible:
 *   chapterLimitFor(profile)
 *   chapterLimitFor(profile, userId)
 * New (preferred):
 *   chapterLimitFor(profile, userId, overrideTier)
 */
export function chapterLimitFor(
  profile: ProfileLike,
  _userId?: string | null,              // kept for backward-compat / potential future logic
  overrideTier?: PlanTier | string | null
): number {
  const tier = effectivePlanTier(profile, overrideTier);
  return PLAN[tier]?.chapterLimit ?? PLAN.free.chapterLimit;
}

/**
 * Which chapter lengths are available in the UI for this plan.
 * Backward compatible:
 *   allowedLengthsFor(profile)
 * New (preferred):
 *   allowedLengthsFor(profile, overrideTier)
 */
export function allowedLengthsFor(
  profile: ProfileLike,
  overrideTier?: PlanTier | string | null
): ChapterLength[] {
  const tier = effectivePlanTier(profile, overrideTier);
  if (tier === 'free') return ['short'];
  if (tier === 'pro') return ['short', 'medium', 'long'];
  return ['short', 'medium', 'long', 'xlong']; // premium
}

/*
  NOTE: We intentionally do not expose client-side toggles like isDemoUser.
  All gating should flow from server entitlements (overrideTier) or persisted profile fields.
*/
