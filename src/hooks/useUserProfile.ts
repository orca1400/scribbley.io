// src/hooks/useUserProfile.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { UserProfile, UserBook } from '../types/database';
import { getBillableWordsThisMonth, getFreeWordsThisMonth } from '../lib/usage';

/* ----------------------------- helpers ----------------------------- */

type PlanTier = 'free' | 'pro' | 'premium';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000000';

const PROFILE_FIELDS = `
  id,
  plan_tier,
  monthly_word_limit,
  words_used_this_month,
  billing_period_start,
  created_at,
  updated_at,
  ai_processing_consent,
  ai_consent_at,
  ai_consent_version,
  allow_training,
  content_retention_days,
  log_retention_days,
  default_visibility,
  gdpr_acknowledged_at,
  display_name,
  bio,
  ui_language,
  book_language,
  timezone,
  avatar_url
`;

/** Normalize DB row -> safe UI shape */
function normalizeProfile(p: any): UserProfile {
  return {
    ...p,
    plan_tier: (p?.plan_tier ?? 'free') as PlanTier,
    monthly_word_limit: p?.monthly_word_limit ?? 20_000,
    words_used_this_month: p?.words_used_this_month ?? 0,
    billing_period_start: p?.billing_period_start ?? new Date().toISOString().slice(0, 10),
    created_at: p?.created_at ?? new Date().toISOString(),
    updated_at: p?.updated_at ?? new Date().toISOString(),
    ai_processing_consent: !!p?.ai_processing_consent,
    ai_consent_at: p?.ai_consent_at ?? null,
    ai_consent_version: p?.ai_consent_version ?? null,
    allow_training: !!p?.allow_training,
    content_retention_days: p?.content_retention_days ?? 365,
    log_retention_days: p?.log_retention_days ?? 90,
    default_visibility: (p?.default_visibility ?? 'private') as 'private' | 'unlisted' | 'public',
    gdpr_acknowledged_at: p?.gdpr_acknowledged_at ?? null,
    display_name: p?.display_name ?? null,
    bio: p?.bio ?? null,
    ui_language: p?.ui_language ?? 'en',
    book_language: p?.book_language ?? 'en',
    // Use a sensible EU default if missing
    timezone: p?.timezone ?? 'Europe/Luxembourg',
    avatar_url: p?.avatar_url ?? null,
  };
}

/* ------------------------------ hook ------------------------------ */

export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [books, setBooks] = useState<UserBook[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [error, setError] = useState<string | null>(null);
  const [realTimeUsage, setRealTimeUsage] = useState<{ billableWords: number; freeWords: number } | null>(null);

  const isDemoMode = userId === DEMO_USER_ID;

  // Guards to avoid setting state after unmount or from stale requests
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const setSafe = useCallback(<T,>(setter: (v: T) => void, value: T) => {
    if (mountedRef.current) setter(value);
  }, []);

  /* ------------------------- demo bootstrap ------------------------- */
  useEffect(() => {
    if (!userId) {
      setSafe(setLoading, false);
      return;
    }

    if (!isDemoMode) return;

    const savedPlan = (localStorage.getItem('demo_plan_tier') as PlanTier) || 'free';
    const planLimits: Record<PlanTier, { monthly_word_limit: number }> = {
      free: { monthly_word_limit: 20_000 },
      pro: { monthly_word_limit: 500_000 },
      premium: { monthly_word_limit: 2_000_000 },
    };

    const demoProfile: UserProfile = {
      id: userId,
      plan_tier: savedPlan,
      monthly_word_limit: planLimits[savedPlan].monthly_word_limit,
      words_used_this_month: 1250,
      billing_period_start: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ai_processing_consent: true,
      ai_consent_at: new Date().toISOString(),
      ai_consent_version: '2025-01-15',
      allow_training: false,
      content_retention_days: 365,
      log_retention_days: 90,
      default_visibility: 'private',
      gdpr_acknowledged_at: new Date().toISOString(),
      display_name: null,
      bio: null,
      ui_language: 'en',
      book_language: 'en',
      timezone: 'Europe/Luxembourg',
      avatar_url: null,
    };

    const testBooks: UserBook[] = [
      {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        user_id: userId,
        title: 'The Enchanted Forest',
        genre: 'fiction',
        subgenre: 'Fantasy',
        description: 'A magical adventure through an enchanted forest',
        content: `The Enchanted Forest

Chapter 1: The Mysterious Path

Maya had always been drawn to the old forest...`,
        total_chapters: 1,
        chapters_read: 1,
        word_count: 847,
        created_at: new Date(Date.now() - 86_400_000).toISOString(),
        updated_at: new Date(Date.now() - 86_400_000).toISOString(),
      } as UserBook,
    ];

    setSafe(setProfile, demoProfile);
    setSafe(setBooks, testBooks);
    setSafe(setLoading, false);

    const planChangeFromStorage = (e: StorageEvent) => {
      if (e.key !== 'demo_plan_tier' || !e.newValue) return;
      const newPlan = e.newValue as PlanTier;
      setSafe(setProfile, (prev => prev ? {
        ...prev,
        plan_tier: newPlan,
        monthly_word_limit: planLimits[newPlan].monthly_word_limit,
      } : prev) as any);
    };

    const planChangeFromCustom = (e: Event) => {
      const ce = e as CustomEvent;
      if ((ce.detail as any)?.type === 'demo_plan_change') {
        const newPlan = (ce.detail as any).plan as PlanTier;
        setSafe(setProfile, (prev => prev ? {
          ...prev,
          plan_tier: newPlan,
          monthly_word_limit: planLimits[newPlan].monthly_word_limit,
        } : prev) as any);
      }
    };

    window.addEventListener('storage', planChangeFromStorage);
    window.addEventListener('demo-plan-change', planChangeFromCustom as EventListener);

    return () => {
      window.removeEventListener('storage', planChangeFromStorage);
      window.removeEventListener('demo-plan-change', planChangeFromCustom as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isDemoMode]);

  /* ------------------------ data fetchers (real) ------------------------ */

  const fetchUserData = useCallback(async () => {
    if (!userId || isDemoMode) return;

    const rid = ++requestIdRef.current;
    setSafe(setLoading, true);
    setSafe(setError, null);

    try {
      // Profile
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select(PROFILE_FIELDS)
        .eq('id', userId)
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profileData) {
        // retry with backoff (up to ~15s)
        let tries = 0;
        while (tries < 6) {
          const delay = Math.min(1000 * Math.pow(2, tries), 8000);
          await new Promise(res => setTimeout(res, delay));
          const { data: retry, error: retryErr } = await supabase
            .from('user_profiles')
            .select(PROFILE_FIELDS)
            .eq('id', userId)
            .maybeSingle();
          if (retryErr) throw retryErr;
          if (retry) {
            if (rid === requestIdRef.current) setSafe(setProfile, normalizeProfile(retry));
            break;
          }
          tries++;
        }
        if (tries >= 6) {
          if (rid === requestIdRef.current) {
            setSafe(setError, 'Profile creation is taking longer than expected. Please refresh.');
          }
        }
      } else {
        if (rid === requestIdRef.current) setSafe(setProfile, normalizeProfile(profileData));
      }

      // Books (limit 12 for dashboard)
      const { data: booksData, error: booksError } = await supabase
        .from('user_books')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(12);

      if (booksError) throw booksError;
      if (rid === requestIdRef.current) setSafe(setBooks, booksData || []);
    } catch (e: any) {
      if (rid === requestIdRef.current) {
        setSafe(setError, e?.message || 'Failed to load profile');
      }
      console.error('Error fetching user data:', e);
    } finally {
      if (rid === requestIdRef.current) setSafe(setLoading, false);
    }
  }, [userId, isDemoMode]);

  // initial + on userId change (real users only)
  useEffect(() => {
    if (!userId || isDemoMode) return;
    fetchUserData();
  }, [userId, isDemoMode, fetchUserData]);

  /* ---------------------- realtime & focus refresh ---------------------- */

  // Realtime subscription to profile updates
  useEffect(() => {
    if (!userId || isDemoMode) return;

    const channel = supabase
      .channel('user_profiles_changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_profiles',
        filter: `id=eq.${userId}`,
      }, () => {
        fetchUserData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, isDemoMode, fetchUserData]);

  // Refetch when window regains focus (e.g., coming back from billing portal)
  useEffect(() => {
    if (!userId || isDemoMode) return;
    const onFocus = () => fetchUserData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, isDemoMode, fetchUserData]);

  /* -------------------------- usage live snapshot -------------------------- */
  useEffect(() => {
    if (!userId || isDemoMode) return;
    (async () => {
      try {
        const [billableWords, freeWords] = await Promise.all([
          getBillableWordsThisMonth(userId),
          getFreeWordsThisMonth(userId),
        ]);
        setSafe(setRealTimeUsage, { billableWords, freeWords });
      } catch (e) {
        console.error('Error loading usage data:', e);
      }
    })();
  }, [userId, isDemoMode]);

  /* ------------------------------- actions ------------------------------- */

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!userId) return;

    if (isDemoMode) {
      // local-only adjustments for demo
      setSafe(setProfile, prev => (prev ? { ...prev, ...updates } : prev));
      if (updates.plan_tier) {
        const plan = updates.plan_tier as PlanTier;
        localStorage.setItem('demo_plan_tier', plan);
        const planLimits: Record<PlanTier, number> = { free: 20_000, pro: 500_000, premium: 2_000_000 };
        setSafe(setProfile, prev => (prev ? { ...prev, monthly_word_limit: planLimits[plan] } : prev));
        window.dispatchEvent(new CustomEvent('demo-plan-change', {
          detail: { type: 'demo_plan_change', plan },
        }));
      }
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      setSafe(setProfile, normalizeProfile(data));
    } catch (e: any) {
      setSafe(setError, e?.message || 'Failed to update profile');
      console.error('Error updating profile:', e);
    }
  }, [userId, isDemoMode]);

  /** Prefer server-side accounting via triggers; this is a fallback */
  const updateWordUsage = useCallback(async (additionalWords: number) => {
    if (!userId || isDemoMode || !Number.isFinite(additionalWords)) return;
    try {
      const { data: current, error: fetchErr } = await supabase
        .from('user_profiles')
        .select('words_used_this_month')
        .eq('id', userId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const cur = current?.words_used_this_month ?? 0;
      const next = Math.max(0, cur + Math.max(0, Math.floor(additionalWords)));
      const { data, error } = await supabase
        .from('user_profiles')
        .update({ words_used_this_month: next })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      setSafe(setProfile, normalizeProfile(data));
    } catch (e: any) {
      setSafe(setError, e?.message || 'Failed to update usage');
      console.error('Error updating word usage:', e);
    }
  }, [userId, isDemoMode]);

  const refreshData = useCallback(() => {
    if (!userId) return;
    fetchUserData();
    if (!isDemoMode) {
      (async () => {
        try {
          const [billableWords, freeWords] = await Promise.all([
            getBillableWordsThisMonth(userId),
            getFreeWordsThisMonth(userId),
          ]);
          setSafe(setRealTimeUsage, { billableWords, freeWords });
        } catch (e) {
          console.error('Error loading usage data:', e);
        }
      })();
    }
  }, [userId, isDemoMode, fetchUserData]);

  return {
    profile,
    realTimeUsage,
    books,
    loading,
    error,
    updateProfile,
    updateWordUsage,
    refreshData,
  };
}
