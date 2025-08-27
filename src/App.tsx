// src/App.tsx
import React from 'react';
import {
  BookOpen,
  Sparkles,
  ArrowRight,
  Loader2,
  FileText,
  User,
  LogOut,
  Plus,
  Trash2,
  ToggleRight,
  ToggleLeft,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { AuthModal } from './components/AuthModal';
import { ChapterList } from './components/ChapterList';
import { parseBookIntoChapters, Book } from './utils/bookParser';
import { UserBook } from './types/database';
import { useUserProfile } from './hooks/useUserProfile';

import Landing from './pages/Landing';
import Learn from './pages/Learn';
import Templates from './pages/Templates';
import Help from './pages/Help';
import Changelog from './pages/Changelog';
import { useEntitlements } from './hooks/useEntitlements';

import { PLAN, CHAPTER_LENGTH_RANGES, ChapterLength, CONSENT_VERSION } from './config/plans';
import { chapterLimitFor, allowedLengthsFor } from './utils/plan';
import { countWords, clamp } from './utils/text';
import { saveBookToDatabase, upsertChapterSummary } from './services/books';
import { withRetry, consentHeadersAnon, getSessionId } from './services/generation';
import {
  streamInitialCover,
  dataUrlFromBase64,
  rerollCover,
  fetchLatestCoverPublicUrl,
  toPublicCoverUrl,
  prettyCoverError,
} from './services/covers';

/* ---------------- Error Boundary ---------------- */
class ErrorBoundary extends React.Component<{ fallback?: React.ReactNode }, { hasError: boolean; msg?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, msg: '' };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, msg: (err && (err.message || String(err))) || 'Load error' };
  }
  componentDidCatch(err: any) { console.error('Chunk load error:', err); }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <p className="font-semibold">Couldn’t load this section.</p>
          <p className="text-sm opacity-80 mt-1">{this.state.msg}</p>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* ---------------- Steps & Nav ---------------- */
type Step =
  | 'home'
  | 'pricing'
  | 'learn'
  | 'templates'
  | 'help'
  | 'changelog'
  | 'dashboard'
  | 'genre'
  | 'description'
  | 'result'
  | 'editor';

const PUBLIC_NAV: Array<{ key: Extract<Step, 'home'|'templates'|'learn'|'pricing'|'changelog'|'help'>; label: string }> = [
  { key: 'home',       label: 'Home' },
  { key: 'templates',  label: 'Templates' },
  { key: 'learn',      label: 'Learn' },
  { key: 'pricing',    label: 'Pricing' },
  { key: 'changelog',  label: 'Changelog' },
  { key: 'help',       label: 'Help' },
];

// App-level flags
const AUTO_COVER_ON_MAIN_FOR_AUTHED = false;

/* ---------------- Genre Lists ---------------- */
const fictionGenres = ['Romance','Mystery','Science Fiction','Fantasy','Horror','Thriller','Historical Fiction','Literary Fiction','Adventure','Young Adult'];
const nonFictionGenres = ['Biography','Self-Help','History','Science','Business','Travel','Health','Education','Psychology','Philosophy'];

/* ---------------- Lazy heavy views ---------------- */
const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.default ?? m.Dashboard })));
const BookEditor = React.lazy(() => import('./components/BookEditor').then(m => ({ default: m.default ?? m.BookEditor })));

// --- Beats helper & defaults ---
type Beat = { label: string; value?: string };

// For preview only (UI). The API will receive base description + beats separately.
export function buildPrompt(base: string, beats?: Beat[]) {
  const lines = (beats ?? [])
    .filter(b => b.value?.trim())
    .map(b => `- ${b.label}: ${b.value!.trim()}`);
  return lines.length
    ? `${base.trim()}\n\nKey beats:\n${lines.join('\n')}`
    : base.trim();
}

const DEFAULT_BEATS: Beat[] = [
  { label: 'Protagonist' },
  { label: 'Goal' },
  { label: 'Antagonist / Obstacle' },
  { label: 'Setting' },
  { label: 'Tone / Mood' },
  { label: 'Inciting Incident' },
  { label: 'Midpoint / Twist' },
  { label: 'Climax' },
  { label: 'Ending vibe' },
];

/* ---------------- Robust Edge Function fetch (no supabase.functions.invoke) --------- */
function getFunctionsBaseUrl(): string {
  const override = import.meta.env.VITE_EDGE_BASE as string | undefined;
  if (override) return override.replace(/\/+$/, '') + '/functions/v1';
  if (import.meta.env.DEV) return '/functions/v1';
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error('VITE_SUPABASE_URL is undefined');
  return base.replace(/\/+$/, '') + '/functions/v1';
}

function isTimeoutLike(e: any) {
  const t = (e?.message || e?.stack || '').toString().toLowerCase();
  return t.includes('timed out') || t.includes('timeout') || t.includes('504') || t.includes('gateway');
}
function isNetworkLike(e: any) {
  const t = (e?.message || e?.stack || '').toString().toLowerCase();
  return (
    t.includes('failed to fetch') ||
    t.includes('networkerror') ||
    t.includes('load failed') ||
    t.includes('err_failed') ||
    t.includes('ecconnreset') ||
    t.includes('typeerror')
  );
}

type EdgeFetchOptions = {
  bearer?: string | null;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function resolveAuth(opts?: EdgeFetchOptions) {
  const bearer = opts?.bearer?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const token = bearer || anonKey || '';
  if (!token) {
    throw new Error('Missing auth token: provide user access_token or VITE_SUPABASE_ANON_KEY');
  }
  return { token, anonKey };
}

function buildHeaders(token: string, anonKey?: string, extra?: Record<string, string>) {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (anonKey) base.apikey = anonKey;
  return { ...base, ...(extra ?? {}) };
}

function setupAbort(userSignal?: AbortSignal, timeoutMs?: number) {
  const ac = new AbortController();
  const onAbort = () => ac.abort(new DOMException('client-timeout', 'AbortError'));

  userSignal?.addEventListener('abort', onAbort, { once: true });
  const tid: ReturnType<typeof setTimeout> | null =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(() => ac.abort(new DOMException('client-timeout', 'AbortError')), timeoutMs)
      : null;

  const cleanup = () => {
    if (tid) clearTimeout(tid);
    userSignal?.removeEventListener('abort', onAbort as any);
  };

  return { signal: ac.signal, cleanup };
}

async function throwHttpError(res: Response): Promise<never> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }

  try {
    const j = text ? JSON.parse(text) : null;
    if (j?.error) throw new Error(j.error);
  } catch {
    /* ignore */
  }

  throw new Error(text || `HTTP ${res.status}`);
}

export async function edgeFetch<T>(
  fnName: string,
  payload: Record<string, any>,
  opts?: EdgeFetchOptions
): Promise<T> {
  const url = `${getFunctionsBaseUrl()}/${fnName}`;
  const { token, anonKey } = resolveAuth(opts);
  const headers = buildHeaders(token, anonKey, opts?.extraHeaders);
  const { signal, cleanup } = setupAbort(opts?.signal, opts?.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers,
      body: JSON.stringify(payload ?? {}),
      signal,
      cache: 'no-store',
      keepalive: false,
    });

    if (!res.ok) await throwHttpError(res);
    return (await res.json()) as T;
  } finally {
    cleanup();
  }
}

async function edgeFetchWithRetry<T>(
  fnName: string,
  payload: Record<string, any>,
  opts?: {
    bearer?: string | null;
    extraHeaders?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  }
): Promise<T> {
  const max = Math.max(1, opts?.retries ?? 3);
  let attempt = 0;
  let lastErr: any = null;
  while (attempt < max) {
    try {
      return await edgeFetch<T>(fnName, payload, {
        bearer: opts?.bearer ?? null,
        extraHeaders: opts?.extraHeaders,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
      });
    } catch (e) {
      lastErr = e;
      if (!(isNetworkLike(e) || isTimeoutLike(e)) || attempt === max - 1) break;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
      attempt++;
    }
  }
  throw lastErr;
}

/* ======================================================================== */
/*                                  APP                                     */
/* ======================================================================== */
function App() {
  /* -------- State -------- */
  const [step, setStep] = React.useState<Step>('home');
  const [user, setUser] = React.useState<SupabaseUser | null>(null);

  const [showAuthModal, setShowAuthModal] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');

  const [selectedGenre, setSelectedGenre] = React.useState<'fiction' | 'non-fiction' | null>(null);
  const [selectedSubgenre, setSelectedSubgenre] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [beats, setBeats] = React.useState<Beat[]>(DEFAULT_BEATS);
  const [includeBeats, setIncludeBeats] = React.useState(true);

  const [showPromptPreview, setShowPromptPreview] = React.useState(false);

  const [generatedBook, setGeneratedBook] = React.useState('');
  const [parsedBook, setParsedBook] = React.useState<Book | null>(null);
  const [currentBook, setCurrentBook] = React.useState<UserBook | null>(null);

  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showingSignupSuccess, setShowingSignupSuccess] = React.useState(false);

  const [isCreatingFromDashboard, setIsCreatingFromDashboard] = React.useState(false);
  const [totalChapters, setTotalChapters] = React.useState(5);
  const [chapterLength, setChapterLength] = React.useState<ChapterLength>('short');
  const [anonConsent, setAnonConsent] = React.useState(false);

  const [authedConsent, setAuthedConsent] = React.useState(false);

  // Covers
  const [coverUrl, setCoverUrl] = React.useState<string | null>(null);
  const [coverAttempt, setCoverAttempt] = React.useState<number>(0);
  const [coverErr, setCoverErr] = React.useState<string>('');
  const [coverLoading, setCoverLoading] = React.useState<boolean>(false);

  // Summary generation errors/warnings
  const [summaryErrors, setSummaryErrors] = React.useState<string[]>([]);
  const [summaryWarnings, setSummaryWarnings] = React.useState<string[]>([]);

  // Refs to fight stale closures
  const pendingBookSaveRef = React.useRef<{
    title: string; genre: string; subgenre: string; description: string; content: string; wordCount: number;
  } | null>(null);
  const creatingFromDashRef = React.useRef(isCreatingFromDashboard);
  const parsedRef = React.useRef(parsedBook);
  const genreRef = React.useRef(selectedGenre);
  const subgenreRef = React.useRef(selectedSubgenre);
  const descRef = React.useRef(description);
  const generatedRef = React.useRef(generatedBook);

  React.useEffect(() => { creatingFromDashRef.current = isCreatingFromDashboard; }, [isCreatingFromDashboard]);
  React.useEffect(() => { parsedRef.current = parsedBook; }, [parsedBook]);
  React.useEffect(() => { genreRef.current = selectedGenre; }, [selectedGenre]);
  React.useEffect(() => { subgenreRef.current = selectedSubgenre; }, [selectedSubgenre]);
  React.useEffect(() => { descRef.current = description; }, [description]);
  React.useEffect(() => { generatedRef.current = generatedBook; }, [generatedBook]);

  React.useEffect(() => { document.title = 'scribbley.io'; }, []);

  // Abort controllers
  const genAbortRef = React.useRef<AbortController | null>(null);
  const coverStreamAbortRef = React.useRef<AbortController | null>(null);

  // Profile & server entitlements
  const { profile, refreshData } = useUserProfile(user?.id);
  const { entitlements } = useEntitlements(user?.id);
  const effectiveTier = entitlements?.tier ?? (profile?.plan_tier ?? 'free'); // SERVER wins

  // Sync consent
  React.useEffect(() => { setAuthedConsent(!!profile?.ai_processing_consent); }, [profile?.ai_processing_consent]);

  const hasExceededWordLimit = React.useMemo(() => {
    if (!profile) return false;
    const used = profile.words_used_this_month ?? 0;
    const limit = profile.monthly_word_limit ?? Number.POSITIVE_INFINITY;
    return used >= limit;
  }, [profile]);

  const canCreateContent = React.useMemo(() => {
    if (!user) return true; // guests can generate the legacy 5-chapter book
    if (!profile) return false;
    if (effectiveTier === 'pro' || effectiveTier === 'premium') return true;
    return !hasExceededWordLimit;
  }, [user, profile, effectiveTier, hasExceededWordLimit]);

  const chapterLimit = React.useMemo(
    () => chapterLimitFor(profile, user?.id, effectiveTier),
    [profile, user?.id, effectiveTier]
  );
  const allowedLengths = React.useMemo(
    () => allowedLengthsFor(profile, effectiveTier),
    [profile, effectiveTier]
  );

  // Keep chapterLength valid per plan
  React.useEffect(() => {
    const desiredDefault: ChapterLength = effectiveTier === 'free' ? 'short' : 'medium';
    setChapterLength(prev => (allowedLengths.includes(prev) ? prev : desiredDefault));
  }, [effectiveTier, JSON.stringify(allowedLengths)]);

  // Total chapter defaults by plan
  React.useEffect(() => {
    if (!user) { setTotalChapters(PLAN.free.chapterLimit); return; }
    const limit = chapterLimitFor(profile, user.id, effectiveTier);
    const defaultChapters = effectiveTier === 'free' ? 5 : 10;
    setTotalChapters(prev => clamp(prev ?? defaultChapters, 1, limit));
  }, [user?.id, effectiveTier, profile]);

  React.useEffect(() => { setTotalChapters(prev => clamp(prev, 1, chapterLimit)); }, [chapterLimit]);

  /* -------- Build final prompt (for preview only) -------- */
  const promptText = React.useMemo(() => {
    return includeBeats ? buildPrompt(description, beats) : description.trim();
  }, [includeBeats, description, beats]);

  const promptWordCount = React.useMemo(() => countWords(promptText), [promptText]);
  const promptCharCount = promptText.length;

  /* -------- Auth state -------- */
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(session?.user || null);
      setStep(session?.user ? 'dashboard' : 'home');
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      const newUser = session?.user || null;
      setUser(newUser);

      if (newUser && event === 'SIGNED_IN' && (pendingBookSaveRef.current || (parsedRef.current && !creatingFromDashRef.current))) {
        setShowAuthModal(false);
        setShowingSignupSuccess(false);

        if (pendingBookSaveRef.current) {
          await saveBookToDatabase(newUser.id, pendingBookSaveRef.current, true);
          pendingBookSaveRef.current = null;
        } else if (parsedRef.current) {
          const parsed = parsedRef.current;
          await saveBookToDatabase(
            newUser.id,
            {
              title: parsed.title,
              genre: genreRef.current || 'fiction',
              subgenre: subgenreRef.current || '',
              description: (descRef.current || '').trim(),
              content: generatedRef.current,
              wordCount: countWords(generatedRef.current),
              totalChapters: parsed.chapters.length,
              chaptersRead: parsed.chapters.length,
            },
            true
          );
        }

        setParsedBook(null);
        setGeneratedBook('');
        setStep('dashboard');
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); genAbortRef.current?.abort(); coverStreamAbortRef.current?.abort(); };
  }, []);

  /* -------- Handlers: navigation & auth -------- */
  const handleAuthModalOpen = (mode: 'login'|'signup') => { setAuthMode(mode); setShowAuthModal(true); };
  const handleAuthSuccess = () => { setShowAuthModal(false); setShowingSignupSuccess(false); setStep('dashboard'); };
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    try { localStorage.removeItem('session_id'); } catch {}
    setIsCreatingFromDashboard(false);
    setCoverUrl(null); setCoverAttempt(0); setCoverErr('');
    setStep('home');
  };

  /* -------- Handlers: generator flow -------- */
  const handleGenreSelect = (genre: 'fiction' | 'non-fiction') => { setSelectedGenre(genre); setSelectedSubgenre(''); };
  const handleSubgenreSelect = (subgenre: string) => setSelectedSubgenre(subgenre);
  const proceedToDescription = () => { if (selectedGenre && selectedSubgenre.trim()) setStep('description'); };

  const loadCoverForBook = React.useCallback(async (bookId: string) => {
    try {
      setCoverLoading(true);
      const url = await fetchLatestCoverPublicUrl(bookId);
      setCoverUrl(url); setCoverAttempt(0); setCoverErr('');
    } finally { setCoverLoading(false); }
  }, []);

  const startStreamingCover = React.useCallback((params: {
    bookId?: string;
    bookTitle: string;
    description: string;
    genre?: string;
    subgenre?: string;
    isAuthenticated: boolean;
    aiConsent?: boolean;
    aiConsentVersion?: string;
  }) => {
    coverStreamAbortRef.current?.abort();
    const ctrl = new AbortController();
    coverStreamAbortRef.current = ctrl;
    setCoverLoading(true);
    setCoverErr('');

    streamInitialCover(
      params,
      (evt) => {
        if (evt.type === 'partial' && (evt as any).b64) {
          setCoverUrl(dataUrlFromBase64((evt as any).b64));
        } else if (evt.type === 'final') {
          if ((evt as any).url) setCoverUrl((evt as any).url);
          else if ((evt as any).imageBase64) setCoverUrl(dataUrlFromBase64((evt as any).imageBase64));
        } else if (evt.type === 'error') {
          setCoverErr(prettyCoverError((evt as any).message, effectiveTier));
        } else if (evt.type === 'done') {
          setCoverLoading(false);
        }
      },
      { signal: ctrl.signal }
    ).catch((e) => {
      if ((e as any)?.name === 'AbortError') return;
      setCoverErr(prettyCoverError(String((e as Error)?.message || e), effectiveTier));
      setCoverLoading(false);
    });
  }, [effectiveTier]);

  async function generateAndSaveChapterSummary(
    userId: string, bookId: string, chapterTitle: string, chapterContent: string, chapterNumber: number,
    bookTitle: string, genre: string, subgenre: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: auth } = await supabase.auth.getSession();
      const bearer = auth?.session?.access_token ?? null;
      const isAuthed = !!auth?.session?.user;

      const extraHeaders: Record<string, string> = {
        ...(isAuthed ? { 'x-user-id': userId } : {}),
        ...(!isAuthed
          ? (anonConsent ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION } : {})
          : ((profile?.ai_processing_consent || authedConsent)
              ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION }
              : {})),
      };

      const data = await edgeFetchWithRetry<{ summary?: string }>(
        'generate-summary',
        { chapterTitle, chapterContent, chapterNumber, bookTitle, genre, subgenre },
        { bearer, extraHeaders, timeoutMs: 60_000 }
      );

      const summaryText = (data.summary ?? '').trim();
      if (!summaryText) throw new Error('Generated summary is empty');

      await upsertChapterSummary({ userId, bookId, chapterNumber, summary: summaryText });
      return { success: true };
    } catch (e) { 
      console.error('Chapter summary error:', e); 
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error: `Chapter ${chapterNumber} summary failed: ${errorMsg}` };
    }
  }

  /** Transform beats [{label,value}] into an array of strings "Label: value" for the API */
  function serializeBeats(bts: Beat[], include: boolean): string[] {
    if (!include) return [];
    return bts
      .map(b => {
        const label = (b.label || '').trim();
        const val = (b.value || '').trim();
        if (!label && !val) return '';
        if (label && val) return `${label}: ${val}`;
        return label || val;
      })
      .filter(Boolean);
  }

  /** Generate N chapters sequentially via the generate-book function in "chapter" mode */
  async function generateChaptersViaEdge(
    params: {
      genre: 'fiction' | 'non-fiction';
      subgenre: string;
      baseDescription: string;
      beatsActive: boolean;
      beats: string[];
      chapterCount: number;
      minWords: number;
      maxWords: number;
    },
    opts: { bearer: string | null; extraHeaders: Record<string, string>; signal: AbortSignal }
  ) {
    const chapters: { index: number; title: string; content: string }[] = [];
    for (let i = 1; i <= params.chapterCount; i++) {
      const data = await edgeFetchWithRetry<{
        chapter_index: number;
        title: string;
        content: string;
        meta: any;
      }>(
        'generate-book',
        {
          mode: 'chapter',
          genre: params.genre,
          subgenre: params.subgenre,
          description: params.baseDescription,
          beatsActive: params.beatsActive,
          beats: params.beats,
          chapter_index: i,
          chapter_count: params.chapterCount,
          chapter_words_min: params.minWords,
          chapter_words_max: params.maxWords,
        },
        {
          bearer: opts.bearer,
          extraHeaders: opts.extraHeaders,
          signal: opts.signal,
          timeoutMs: 120_000,
          retries: 2,
        }
      );

      chapters.push({ index: data.chapter_index, title: data.title, content: data.content });
      await new Promise(r => setTimeout(r, 300));
    }
    return chapters;
  }

  const generateBook = async () => {
    if (!description.trim()) return;
    if (!canCreateContent) {
      const lim = profile?.monthly_word_limit;
      setError(
        `You've exceeded your monthly word limit${lim ? ` of ${lim.toLocaleString()} words` : ''}. Please upgrade your plan to continue creating books.`
      );
      return;
    }

    // If authed and consent is required, persist it first
    if (user && profile && !profile.ai_processing_consent) {
      if (!authedConsent) {
        setError('Please accept the AI Processing consent to continue.');
        return;
      }
      try {
        await supabase
          .from('user_profiles')
          .upsert(
            {
              id: user.id,
              ai_processing_consent: true,
              ai_consent_at: new Date().toISOString(),
              ai_consent_version: CONSENT_VERSION,
            },
            { onConflict: 'id' }
          );
        await refreshData?.();
      } catch (e: any) {
        setError(e?.message || 'Failed to store consent. Please try again.');
        return;
      }
    }

    // NOTE: For the API we send base description + beats separately
    const baseDescription = description.trim();
    const beatsPayload = serializeBeats(beats, includeBeats);

    setIsGenerating(true);
    setError('');

    // Project limit check
    if (user && profile?.projects_limit != null) {
      const { count, error: cErr } = await supabase
        .from('user_books')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (!cErr) {
        const used = count ?? 0;
        if (used >= (profile.projects_limit ?? 0)) {
          setError(`Projektlimit erreicht (${profile.projects_limit}). Bitte alte Projekte archivieren/löschen oder Plan upgraden.`);
          setIsGenerating(false);
          return;
        }
      }
    }

    genAbortRef.current?.abort();
    const ctrl = new AbortController();
    genAbortRef.current = ctrl;

    try {
      let bearer: string | null = null;
      if (user) {
        const { data: auth } = await supabase.auth.getSession();
        bearer = auth?.session?.access_token ?? null;
      }

      const consentHeaders = !user
        ? consentHeadersAnon(anonConsent)
        : (profile?.ai_processing_consent || authedConsent)
        ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION }
        : {};

      // Decide chapter count & lengths based on plan and UI
      const requestedTotal = clamp(totalChapters, 1, chapterLimit);
      const [minWords, maxWords] = CHAPTER_LENGTH_RANGES[chapterLength];

      // Base params for cover
      const coverParamsBase = {
        bookTitle: selectedSubgenre || (selectedGenre === 'fiction' ? 'Fiction Book' : 'Non-Fiction Book'),
        description: baseDescription,
        genre: selectedGenre || undefined,
        subgenre: selectedSubgenre || undefined,
      };

      /* -------- Path A: dashboard flow → generate FIRST CHAPTER then open editor -------- */
      if (user && isCreatingFromDashboard) {
        if (user && AUTO_COVER_ON_MAIN_FOR_AUTHED) {
          startStreamingCover({
            ...coverParamsBase,
            isAuthenticated: false, // just a visual preview; stored cover happens server-side later
            aiConsent: true,
            aiConsentVersion: CONSENT_VERSION,
          });
        }

        const extraHeaders = {
          'x-user-id': user.id,
          'x-session-id': getSessionId(),
          ...consentHeaders,
        };

        const chapters = await generateChaptersViaEdge(
          {
            genre: (selectedGenre || 'fiction') as 'fiction' | 'non-fiction',
            subgenre: selectedSubgenre,
            baseDescription,
            beatsActive: includeBeats,
            beats: beatsPayload,
            chapterCount: 1,
            minWords,
            maxWords,
          },
          { bearer, extraHeaders, signal: ctrl.signal }
        );

        const first = chapters[0];
        const bookTitle = coverParamsBase.bookTitle;
        const bookContent = `${bookTitle}\n\n${first.content}`;

        const savedBook = await saveBookToDatabase(
          user.id,
          {
            title: bookTitle,
            genre: selectedGenre || 'fiction',
            subgenre: selectedSubgenre || '',
            description: buildPrompt(baseDescription, includeBeats ? beats : []),
            content: bookContent,
            wordCount: countWords(bookContent),
            totalChapters: requestedTotal,
            chaptersRead: 1,
          },
          true
        );

        if (savedBook) {
          if (AUTO_COVER_ON_MAIN_FOR_AUTHED) {
            // persisted cover tied to the book id
            startStreamingCover({
              ...coverParamsBase,
              bookId: savedBook.id,
              isAuthenticated: true,
              aiConsent: true,
              aiConsentVersion: CONSENT_VERSION,
            });
          }

          withRetry(() =>
            generateAndSaveChapterSummary(
              user.id,
              savedBook.id,
              first.title,
              first.content,
              1,
              bookTitle,
              selectedGenre || 'fiction',
              selectedSubgenre || ''
            )
          ).then((result) => {
            if (!result.success && result.error) {
              setSummaryWarnings(prev => [...prev, result.error!]);
            }
          }).catch((e) => {
            console.error('First chapter summary failed:', e);
            setSummaryErrors(prev => [...prev, 'Failed to generate summary for Chapter 1']);
          });

          setCurrentBook(savedBook);
          setStep('editor');
          setIsCreatingFromDashboard(false);
        }

        return; // finally{} will clear isGenerating
      }

      /* -------- Path B: public or non-dashboard flow -------- */
      const extraHeaders = {
        'x-session-id': localStorage.getItem('session_id') || '',
        ...(user ? { 'x-user-id': user.id } : {}),
        ...consentHeaders,
      };

      // Guests: always start preview cover. Authed on main flow: only if flag is enabled.
      if (user && AUTO_COVER_ON_MAIN_FOR_AUTHED) {
        startStreamingCover({
          bookTitle: coverParamsBase.bookTitle,
          description: baseDescription,
          genre: selectedGenre || undefined,
          subgenre: selectedSubgenre || undefined,
          isAuthenticated: true,
          aiConsent: true,
          aiConsentVersion: CONSENT_VERSION,
        });
      }

      // Guest branch → single-shot "book" mode
      if (!user) {
        const result = await edgeFetchWithRetry<{
          book?: string;
          content?: string;
          cover_url?: string;
          cover_path?: string;
          cover_image_base64?: string;
          attempt?: number;
        }>(
          'generate-book',
          {
            mode: 'book',
            genre: (selectedGenre || 'fiction') as 'fiction' | 'non-fiction',
            subgenre: selectedSubgenre,
            description: baseDescription,
            beatsActive: includeBeats,
            beats: beatsPayload,
            include_cover: true, // ask server to return inline cover when possible
          },
          {
            bearer: null,
            extraHeaders: {
              'x-session-id': localStorage.getItem('session_id') || '',
              ...(anonConsent ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION } : {}),
            },
            signal: ctrl.signal,
            timeoutMs: 180_000,
            retries: 2,
          }
        );

        const bookContent = (result.book || result.content || '').trim();
        if (!bookContent) throw new Error('Empty book content');

        // Inline cover handling
        if (result.cover_url) {
          setCoverUrl(result.cover_url);
          setCoverLoading(false);
        } else if (result.cover_path) {
          setCoverUrl(toPublicCoverUrl(result.cover_path));
          setCoverLoading(false);
        } else if (result.cover_image_base64) {
          setCoverUrl(dataUrlFromBase64(result.cover_image_base64));
          setCoverLoading(false);
        } else {
          // Fallback if server didn’t include inline cover
          startStreamingCover({
            bookTitle: selectedSubgenre || (selectedGenre === 'fiction' ? 'Fiction Book' : 'Non-Fiction Book'),
            description: baseDescription,
            genre: selectedGenre || undefined,
            subgenre: selectedSubgenre || undefined,
            isAuthenticated: false,
            aiConsent: anonConsent,
            aiConsentVersion: CONSENT_VERSION,
          });
        }

        setGeneratedBook(bookContent);
        const parsed = parseBookIntoChapters(bookContent, false);
        setParsedBook(parsed);
        setStep('result');
        return; // stop here for guest flow
      }

      // Authenticated branch (non-dashboard) → multi-chapter then save
      const chapters = await generateChaptersViaEdge(
        {
          genre: (selectedGenre || 'fiction') as 'fiction' | 'non-fiction',
          subgenre: selectedSubgenre,
          baseDescription,
          beatsActive: includeBeats,
          beats: beatsPayload,
          chapterCount: requestedTotal,
          minWords,
          maxWords,
        },
        { bearer, extraHeaders, signal: ctrl.signal }
      );

      const bookTitle = `${selectedSubgenre || (selectedGenre === 'fiction' ? 'Fiction' : 'Non-Fiction')} Book`;
      const manuscript = [bookTitle, '', ...chapters.sort((a, b) => a.index - b.index).map((c) => c.content)].join('\n');

      setGeneratedBook(manuscript);
      const parsed = parseBookIntoChapters(manuscript, false);
      setParsedBook(parsed);

      if (parsed && user) {
        const savedBook = await saveBookToDatabase(
          user.id,
          {
            title: parsed.title,
            genre: selectedGenre || 'fiction',
            subgenre: selectedSubgenre || '',
            description: buildPrompt(baseDescription, includeBeats ? beats : []),
            content: manuscript,
            wordCount: countWords(manuscript),
            totalChapters: parsed.chapters.length,
            chaptersRead: parsed.chapters.length,
          },
          false
        );

        if (savedBook) {
          if (AUTO_COVER_ON_MAIN_FOR_AUTHED) {
            startStreamingCover({
              bookId: savedBook.id,
              bookTitle: parsed.title,
              description: baseDescription,
              genre: selectedGenre || undefined,
              subgenre: selectedSubgenre || undefined,
              isAuthenticated: true,
              aiConsent: true,
              aiConsentVersion: CONSENT_VERSION,
            });
          }

          // Summaries in small batches
          const BATCH = 3;
          for (let i = 0; i < parsed.chapters.length; i += BATCH) {
            const slice = parsed.chapters.slice(i, i + BATCH).map((chapter, idx) =>
              withRetry(async () => {
                const resp = await edgeFetchWithRetry<{ summary?: string }>(
                  'generate-summary',
                  {
                    chapterTitle: chapter.title,
                    chapterContent: chapter.content,
                    chapterNumber: i + idx + 1,
                    bookTitle: parsed.title,
                    genre: selectedGenre as any,
                    subgenre: selectedSubgenre as any,
                  },
                  {
                    bearer,
                    extraHeaders: {
                      ...(user ? { 'x-user-id': user.id } : {}),
                      ...(!user
                        ? consentHeadersAnon(anonConsent)
                        : (profile?.ai_processing_consent || authedConsent)
                        ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION }
                        : {}),
                    },
                    timeoutMs: 60_000,
                    retries: 3,
                  }
                );
                const summaryText = (resp.summary ?? '').trim();
                if (!summaryText) throw new Error('empty summary');
                return upsertChapterSummary({
                  userId: user.id,
                  bookId: savedBook.id,
                  chapterNumber: i + idx + 1,
                  summary: summaryText,
                });
              })
            );
            
            // Handle batch results and collect errors
            const results = await Promise.allSettled(slice);
            const failures = results
              .map((result, idx) => ({ result, chapterNum: i + idx + 1 }))
              .filter(({ result }) => result.status === 'rejected')
              .map(({ chapterNum }) => `Chapter ${chapterNum} summary failed`);
            
            if (failures.length > 0) {
              setSummaryWarnings(prev => [...prev, ...failures]);
            }
          }
        }
      }

      setStep('result');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error generating book:', err);

      const mixedContentHint =
        typeof window !== 'undefined' &&
        window.location?.protocol === 'https:' &&
        String(import.meta.env.VITE_SUPABASE_URL || '').startsWith('http://')
          ? ' (Your SUPABASE_URL is http while the app runs on https — browsers block mixed content.)'
          : '';

      if (isNetworkLike(err)) {
        setError(`Network error while contacting the AI function. Please retry.${mixedContentHint}`);
      } else if (isTimeoutLike(err)) {
        setError('The AI request timed out. Please retry or reduce chapter length.');
      } else {
        const msg = err?.message || err?.name || 'Unknown error';
        setError(`Calling Supabase Edge Function failed: ${msg}`);
      }
    } finally {
      if (genAbortRef.current?.signal === ctrl.signal) genAbortRef.current = null;
      setIsGenerating(false);
    }
  };

  const startOver = () => {
    setStep(user ? 'dashboard' : 'home');
    setSelectedGenre(null);
    setSelectedSubgenre('');
    setCoverUrl(null); setCoverAttempt(0); setCoverErr('');
    setDescription(''); setGeneratedBook(''); setParsedBook(null); setError('');
    setCurrentBook(null);
    setTotalChapters(effectiveTier === 'free' ? 5 : 10);
    setAnonConsent(false);
    setAuthedConsent(!!profile?.ai_processing_consent);
    setSummaryErrors([]); setSummaryWarnings([]);
    
    // Abort controllers and ensure loading states are cleared
    coverStreamAbortRef.current?.abort();
    genAbortRef.current?.abort();
    setCoverLoading(false);
    setIsGenerating(false);
  };

  const handleCreateBook = async () => {
    await refreshData?.();
    setIsCreatingFromDashboard(true);
    setStep('genre');
    setCurrentBook(null);
    setSelectedGenre(null);
    setSelectedSubgenre(''); setDescription(''); setGeneratedBook(''); setParsedBook(null);
    setCoverUrl(null); setCoverAttempt(0); setCoverErr(''); setError('');
    setSummaryErrors([]); setSummaryWarnings([]);
    
    // Abort controllers and ensure loading states are cleared
    coverStreamAbortRef.current?.abort();
    genAbortRef.current?.abort();
    setCoverLoading(false);
    setIsGenerating(false);
    
    const limit = chapterLimitFor(profile, user?.id ?? null, effectiveTier);
    const defaultChapters = effectiveTier === 'free' ? 5 : 10;
    setTotalChapters(Math.min(defaultChapters, limit));
  };

  const handleOpenBook = (book: UserBook) => {
    setCurrentBook(book);
    
    // Clear any ongoing operations and loading states
    coverStreamAbortRef.current?.abort();
    genAbortRef.current?.abort();
    setCoverLoading(false);
    setIsGenerating(false);
    setSummaryErrors([]); setSummaryWarnings([]);
    
    loadCoverForBook(book.id);
    setStep('editor');
  };

  const handleViewBook = (book: UserBook) => {
    setCurrentBook(book);
    setGeneratedBook(book.content);
    const parsed = parseBookIntoChapters(book.content, false);
    setParsedBook(parsed);
    
    // Clear any ongoing operations and loading states
    coverStreamAbortRef.current?.abort();
    genAbortRef.current?.abort();
    setCoverLoading(false);
    setIsGenerating(false);
    setSummaryErrors([]); setSummaryWarnings([]);
    
    loadCoverForBook(book.id);
    setStep('result');
  };

  /* ---------------- Beats UI helpers ---------------- */
  const updateBeatLabel = (idx: number, label: string) => {
    setBeats(prev => prev.map((b, i) => i === idx ? { ...b, label } : b));
  };
  const updateBeatValue = (idx: number, value: string) => {
    setBeats(prev => prev.map((b, i) => i === idx ? { ...b, value } : b));
  };
  const addBeat = () => setBeats(prev => [...prev, { label: 'New beat', value: '' }]);
  const removeBeat = (idx: number) => setBeats(prev => prev.filter((_, i) => i !== idx));

  /* ---------------- Render ---------------- */
  const showHero = step === 'genre' || step === 'description' || step === 'result';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-blue-50 to-indigo-100">
      {/* Header with Navigation — always visible */}
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <BookOpen className="w-8 h-8 text-purple-600 mr-2" />
            <span className="text-xl font-bold text-gray-800">scribbley.io</span>
          </div>

          <div className="flex items-center gap-6">
            {/* Primary nav */}
            <nav className="hidden md:flex items-center gap-4">
              {PUBLIC_NAV.map(item => (
                <button
                  key={item.key}
                  onClick={() => setStep(item.key)}
                  className={[
                    'text-sm font-medium transition-colors',
                    step === item.key ? 'text-purple-700 underline underline-offset-4' : 'text-gray-600 hover:text-gray-800'
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
              {user && (
                <button
                  onClick={() => setStep('dashboard')}
                  className={[
                    'text-sm font-medium transition-colors',
                    step === 'dashboard' ? 'text-purple-700 underline underline-offset-4' : 'text-gray-600 hover:text-gray-800'
                  ].join(' ')}
                >
                  Dashboard
                </button>
              )}
            </nav>

            {/* Auth area */}
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 bg-white/70 backdrop-blur-sm rounded-full px-4 py-2">
                  <User className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-gray-700">
                    {user.user_metadata?.name || user.email}
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm">Sign Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleAuthModalOpen('login')}
                  className="bg-white/70 backdrop-blur-sm text-purple-600 px-4 py-2 rounded-full font-medium hover:bg-white/90 transition-all duration-200"
                >
                  Sign In
                </button>
                <button
                  onClick={() => handleAuthModalOpen('signup')}
                  className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-full font-medium hover:shadow-lg transition-all duration-200"
                >
                  Create Account
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pages */}
      {user && step === 'dashboard' && (
        <ErrorBoundary>
          <React.Suspense fallback={<div className="p-6">Loading dashboard…</div>}>
            <Dashboard user={user} onCreateBook={handleCreateBook} onOpenBook={handleOpenBook} />
          </React.Suspense>
        </ErrorBoundary>
      )}

      {user && step === 'editor' && currentBook && (
        <div className="min-h-screen">
          <ErrorBoundary>
            <React.Suspense fallback={<div className="p-6">Loading editor…</div>}>
              <BookEditor book={currentBook} user={user} onBack={() => setStep('dashboard')} />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Public / creation flow and standalone pages when not on dashboard/editor */}
      {step !== 'dashboard' && step !== 'editor' && (
        <>
          {/* Hero for creation steps */}
          {showHero && (
            <div className="container mx-auto px-4 py-8">
              <div className="text-center mb-12">
                <div className="flex items-center justify-center mb-4">
                  <BookOpen className="w-12 h-12 text-purple-600 mr-3" />
                  <h1 className="text-4xl font-bold text-gray-800">AI Book Generator</h1>
                  <Sparkles className="w-8 h-8 text-yellow-500 ml-3" />
                </div>
                <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                  Transform your ideas into complete books using the power of GPT-4o
                </p>
              </div>
            </div>
          )}

          {/* Standalone Pages */}
          {step === 'home' && (
            <Landing onStart={() => setStep('genre')} onPricing={() => setStep('pricing')} />
          )}
          {step === 'templates' && (
            <Templates
              onUseTemplate={({ genreGroup, subgenre, prompt, beats: tmplBeats }) => {
                setSelectedGenre(genreGroup);
                setSelectedSubgenre(subgenre);
                setDescription(prompt);
                setBeats(tmplBeats?.length ? tmplBeats : DEFAULT_BEATS);
                setIncludeBeats(true);
                setStep('description');
              }}
            />
          )}
          {step === 'learn' && <Learn />}
          {step === 'help' && <Help />}
          {step === 'changelog' && <Changelog />}

          {/* Pricing */}
          {step === 'pricing' && (
            <div className="container mx-auto px-4 pb-12">
              <div className="max-w-6xl mx-auto">
                <div className="text-center mb-12">
                  <h2 className="text-3xl font-bold text-gray-800 mb-4">Choose Your Plan</h2>
                  <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                    {(selectedGenre ?? '—')} → {(selectedSubgenre || '—')}
                  </p>
                </div>
                {/* Plans */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 items-stretch">
                  {/* Free */}
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8 border-2 border-gray-200 flex flex-col h-full">
                    <div className="text-center mb-6 min-h-40 flex flex-col justify-end">
                      <h3 className="text-2xl font-bold text-gray-800 mb-2">Free</h3>
                      <div className="text-4xl font-bold text-gray-800 mb-1">€0</div>
                      <div className="text-sm text-gray-600">per month</div>
                    </div>
                    <ul className="space-y-3">
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">20,000 words / month</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Words per chapter: <strong>1,000–1,500</strong></span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">5 chapters per book</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">3 active projects</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Export to PDF</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-gray-300 rounded-full mr-3" /><span className="text-gray-500">Rewrite chapters (Pro & Premium)</span></li>
                    </ul>
                    <div className="mt-auto pt-8">
                      <button onClick={() => handleAuthModalOpen('signup')} className="w-full bg-gray-600 text-white py-3 rounded-lg font-semibold hover:bg-gray-700 transition-colors">
                        Get Started Free
                      </button>
                    </div>
                  </div>

                  {/* Pro */}
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8 border-2 border-blue-500 relative flex flex-col h-full">
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-medium">Most Popular</span>
                    </div>
                    <div className="text-center mb-6 min-h-40 flex flex-col justify-end">
                      <h3 className="text-2xl font-bold text-gray-800 mb-2">Pro</h3>
                      <div className="text-4xl font-bold text-gray-800 mb-1">€19.90</div>
                      <div className="text-sm text-gray-600">per month</div>
                      <div className="text-xs text-gray-500 mt-1">or €9.90 / mo billed yearly</div>
                    </div>
                    <ul className="space-y-3">
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">500,000 words / month</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Words per chapter: <strong>2,500–4,000</strong></span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">50 chapters per book</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">10 active projects</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Export to PDF</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Rewrite chapters</span></li>
                    </ul>
                    <div className="mt-auto pt-8">
                      <button onClick={() => handleAuthModalOpen('signup')} className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                        Upgrade to Pro
                      </button>
                    </div>
                  </div>

                  {/* Premium */}
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8 border-2 border-purple-500 flex flex-col h-full">
                    <div className="text-center mb-6 min-h-40 flex flex-col justify-end">
                      <h3 className="text-2xl font-bold text-gray-800 mb-2">Premium</h3>
                      <div className="text-4xl font-bold text-gray-800 mb-1">€29.90</div>
                      <div className="text-sm text-gray-600">per month</div>
                      <div className="text-xs text-gray-500 mt-1">or €14.90 / mo billed yearly</div>
                    </div>
                    <ul className="space-y-3">
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">2,000,000 words / month</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Words per chapter: <strong>4,000–6,000</strong></span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">100 chapters per book</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">20 active projects</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Export to PDF</span></li>
                      <li className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-3" /><span className="text-gray-700">Rewrite chapters</span></li>
                    </ul>
                    <div className="mt-auto pt-8">
                      <button onClick={() => handleAuthModalOpen('signup')} className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors">
                        Upgrade to Premium
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <button onClick={() => setStep('genre')} className="text-purple-600 hover:text-purple-700 font-medium">
                    ← Back to Book Generator
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Genre selection */}
          {step === 'genre' && (
            <div className="container mx-auto px-4 pb-12 max-w-4xl">
              {user && (
                <div className="text-center mb-6">
                  <button onClick={() => setStep('dashboard')} className="text-purple-600 hover:text-purple-700 font-medium flex items-center mx-auto">
                    ← Back to Dashboard
                  </button>
                </div>
              )}

              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8 mb-8">
                <h2 className="text-2xl font-bold text-center mb-8 text-gray-800">Choose Your Book Category</h2>

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                  <div
                    onClick={() => handleGenreSelect('fiction')}
                    className={`cursor-pointer rounded-xl p-6 transition-all duration-300 ${selectedGenre === 'fiction' ? 'bg-purple-500 text-white shadow-lg scale-105' : 'bg-purple-100 hover:bg-purple-200 text-purple-800'}`}
                  >
                    <h3 className="text-xl font-bold mb-2">Fiction</h3>
                    <p className="text-sm opacity-90">Stories from imagination - novels, tales, and creative narratives</p>
                  </div>

                  <div
                    onClick={() => handleGenreSelect('non-fiction')}
                    className={`cursor-pointer rounded-xl p-6 transition-all duration-300 ${selectedGenre === 'non-fiction' ? 'bg-blue-500 text-white shadow-lg scale-105' : 'bg-blue-100 hover:bg-blue-200 text-blue-800'}`}
                  >
                    <h3 className="text-xl font-bold mb-2">Non-Fiction</h3>
                    <p className="text-sm opacity-90">Real-world topics - educational, informational, and factual content</p>
                  </div>
                </div>

                {selectedGenre && (
                  <div className="animate-fade-in">
                    <h3 className="text-lg font-semibold mb-4 text-gray-700">Select a {selectedGenre} subgenre:</h3>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                      {(selectedGenre === 'fiction' ? fictionGenres : nonFictionGenres).map((genre) => (
                        <button
                          key={genre}
                          onClick={() => handleSubgenreSelect(genre)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                            selectedSubgenre === genre
                              ? selectedGenre === 'fiction'
                                ? 'bg-purple-500 text-white shadow-md'
                                : 'bg-blue-500 text-white shadow-md'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                          }`}
                        >
                          {genre}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Or type your own subgenre</label>
                      <input
                        type="text"
                        value={selectedSubgenre}
                        onChange={(e) => setSelectedSubgenre(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && selectedSubgenre.trim()) proceedToDescription(); }}
                        list="subgenre-suggestions"
                        placeholder={selectedGenre === 'fiction'
                          ? 'e.g. Cozy Mystery, Space Western, Magical Realism…'
                          : 'e.g. Climate Nonfiction, Behavioral Economics, Productivity…'}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <datalist id="subgenre-suggestions">
                        {(selectedGenre === 'fiction' ? fictionGenres : nonFictionGenres).map((g) => <option key={g} value={g} />)}
                      </datalist>
                      <p className="text-xs text-gray-500 mt-1">Tip: pick a chip above or type anything you want.</p>
                    </div>

                    {selectedSubgenre.trim() && (
                      <div className="text-center mt-6">
                        <button className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-8 py-3 rounded-lg font-semibold hover:shadow-lg transition-all duration-300 flex items-center mx-auto" onClick={proceedToDescription}>
                          Continue <ArrowRight className="w-5 h-5 ml-2" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description + Controls + Beats + Preview + Consent */}
          {step === 'description' && (
            <div className="container mx-auto px-4 pb-16 max-w-4xl">
              {user && (
                <div className="text-center mb-6">
                  <button onClick={() => setStep('dashboard')} className="text-purple-600 hover:text-purple-700 font-medium flex items-center mx-auto">
                    ← Back to Dashboard
                  </button>
                </div>
              )}

              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl p-8">
                <h2 className="text-2xl font-bold text-center mb-8 text-gray-800">Describe Your Book</h2>

                {/* Selection pills */}
                <div className="flex items-center mb-4">
                  <span className="text-sm font-medium text-gray-600">Selected: </span>
                  <span className={`ml-2 px-3 py-1 rounded-full text-sm font-medium ${selectedGenre === 'fiction' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {selectedGenre} → {selectedSubgenre}
                  </span>
                </div>

                {/* Description textarea - larger */}
                <div className="mb-6">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your book idea in detail. Include characters, plot, setting, themes, or any specific elements you want to include..."
                    className="w-full h-64 p-5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                    disabled={isGenerating}
                    maxLength={4000}
                  />
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-gray-600 font-medium">
                      Word count: {promptWordCount} / 500 • Characters: {promptCharCount} / 4000
                    </p>
                    <p className="text-sm text-gray-500">
                      {includeBeats ? '(Includes beats)' : '(Base description only)'} • Minimum 20 words, maximum 500 words and 4000 characters.
                    </p>
                  </div>
                </div>

                {/* ---- PRO CONTROLS (BEFORE preview & consent) ---- */}
                {user && isCreatingFromDashboard && (
                  <>
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Target Number of Chapters</label>
                      <div className="flex items-center space-x-4">
                        <input
                          type="number"
                          value={totalChapters}
                          onChange={(e) => setTotalChapters(clamp(parseInt(e.target.value || '1', 10), 1, chapterLimit))}
                          min={1}
                          max={chapterLimit}
                          className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                        <span className="text-sm text-gray-600">chapters (max {chapterLimit} for your plan)</span>
                      </div>
                    </div>

                    <div className="mb-8">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Chapter length</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {(['short','medium','long','xlong'] as ChapterLength[]).map((len) => {
                          const [min, max] = CHAPTER_LENGTH_RANGES[len] ?? [0, 0];
                          const enabled = allowedLengths.includes(len);
                          const selected = chapterLength === len;
                          const label = len === 'short' ? 'Short' : len === 'medium' ? 'Medium' : len === 'long' ? 'Long' : 'Extra long';
                          return (
                            <label
                              key={len}
                              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-300 bg-white'} ${enabled ? '' : 'opacity-60 cursor-not-allowed'}`}
                              title={enabled ? '' : len === 'xlong' ? 'Upgrade to Premium to unlock Extra long' : 'Upgrade to Pro to unlock'}
                            >
                              <input type="radio" name="chapter-length" value={len} checked={selected} onChange={() => enabled && setChapterLength(len)} disabled={!enabled} />
                              <div>
                                <div className="font-medium text-gray-800">{label}</div>
                                <div className="text-sm text-gray-600">{min} – {max} words</div>
                                <div className="text-xs text-gray-500">
                                  {len === 'short' ? 'Free, Pro, Premium' : len === 'xlong' ? 'Premium' : 'Pro, Premium'}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* Beats editor */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">Key Beats</h3>
                    <button
                      type="button"
                      onClick={() => setIncludeBeats(v => !v)}
                      className="flex items-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-800"
                      title={includeBeats ? 'Click to exclude beats from the prompt' : 'Click to include beats in the prompt'}
                    >
                      {includeBeats ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      {includeBeats ? 'Included in prompt' : 'Excluded from prompt'}
                    </button>
                  </div>

                  {includeBeats ? (
                    <>
                      <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {beats.map((beat, idx) => (
                            <div key={idx} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <input
                                  value={beat.label}
                                  onChange={(e) => updateBeatLabel(idx, e.target.value)}
                                  className="w-44 px-3 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                                  placeholder="Label"
                                  aria-label={`Beat label ${idx + 1}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeBeat(idx)}
                                  className="p-2 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-600"
                                  title="Remove beat"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <textarea
                                value={beat.value || ''}
                                onChange={(e) => updateBeatValue(idx, e.target.value)}
                                className="w-full min-h-[80px] px-3 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm resize-y"
                                placeholder={beat.label === 'Protagonist'
                                  ? 'e.g., A shy archivist who discovers a forbidden map…'
                                  : beat.label === 'Goal'
                                  ? 'e.g., Recover a lost artifact before a rival does…'
                                  : beat.label === 'Antagonist / Obstacle'
                                  ? 'e.g., A cunning rival historian sabotages their research…'
                                  : beat.label === 'Setting'
                                  ? 'e.g., Rain-soaked neo-Venice, 2189…'
                                  : beat.label === 'Tone / Mood'
                                  ? 'e.g., Lyrical, melancholic, slow-burn tension…'
                                  : ''}
                                aria-label={`Beat value ${idx + 1}`}
                              />
                            </div>
                          ))}
                        </div>

                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={addBeat}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-purple-200 text-purple-700 hover:bg-purple-50 text-sm font-medium"
                          >
                            <Plus className="w-4 h-4" /> Add beat
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-gray-500 mt-2">
                        Beats help the model stay on track. Toggle them off if you want a freer interpretation.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500">Beats are currently excluded from the prompt.</p>
                  )}
                </div>

                {/* Prompt preview */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-gray-800">
                      <FileText className="w-5 h-5 text-purple-600" />
                      <span className="font-semibold">Prompt preview</span>
                      <span className="text-xs text-gray-500">(what will be sent)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPromptPreview(v => !v)}
                      className="text-sm font-medium text-purple-700 hover:text-purple-800 inline-flex items-center gap-2"
                    >
                      {showPromptPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {showPromptPreview ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  {showPromptPreview && (
                    <div className="rounded-lg border border-gray-200 bg-white/70 p-3">
                      <textarea
                        readOnly
                        value={promptText}
                        className="w-full min-h-[140px] p-3 font-mono text-sm rounded-md border border-gray-200 bg-white/80 focus:outline-none resize-y whitespace-pre-wrap"
                      />
                      <div className="mt-2 text-xs text-gray-500">
                        {promptWordCount} words • {promptCharCount} characters
                      </div>
                    </div>
                  )}
                </div>

                {/* Authenticated consent (only shown if profile lacks consent) */}
                {user && profile && !profile.ai_processing_consent && (
                  <div className="mt-4 rounded-lg border p-4 bg-blue-50 border-blue-200">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={authedConsent}
                        onChange={(e) => setAuthedConsent(e.target.checked)}
                        required
                      />
                      <span className="text-sm text-blue-900">
                        <strong>AI Processing Consent:</strong> I consent to my prompts and content being processed by OpenAI (USA) for generation.
                        I understand this per the Privacy Policy and agree not to include personal data.
                      </span>
                    </label>
                    <p className="text-xs text-blue-800 mt-2">
                      You can change this anytime in Settings.
                    </p>
                  </div>
                )}

                {/* GDPR consent for anonymous users */}
                {!user && (
                  <div className="mt-6 rounded-lg border p-4 bg-gray-50">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={anonConsent}
                        onChange={(e) => setAnonConsent(e.target.checked)}
                        required
                      />
                      <span className="text-sm text-gray-700">
                        I consent to my inputs being processed by OpenAI (USA), and I will not include personal data. I acknowledge the GDPR notice in the Privacy Policy.
                      </span>
                    </label>
                  </div>
                )}

                {/* Errors */}
                {error && (
                  <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg mt-4" aria-live="polite">
                    {error}
                  </div>
                )}

                {/* Summary Errors */}
                {summaryErrors.length > 0 && (
                  <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg mt-4" aria-live="polite">
                    <div className="font-semibold mb-2">Chapter Summary Errors:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {summaryErrors.map((err, i) => (
                        <li key={i} className="text-sm">{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Summary Warnings */}
                {summaryWarnings.length > 0 && (
                  <div className="bg-amber-100 border border-amber-300 text-amber-700 px-4 py-3 rounded-lg mt-4" aria-live="polite">
                    <div className="font-semibold mb-2">Chapter Summary Warnings:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {summaryWarnings.map((warn, i) => (
                        <li key={i} className="text-sm">{warn}</li>
                      ))}
                    </ul>
                    <div className="text-sm mt-2 opacity-80">
                      Your book was generated successfully, but some chapter summaries could not be created. You can still read and edit your chapters normally.
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-4 justify-center mt-8">
                  <button onClick={() => setStep('genre')} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    Back
                  </button>
                  <button
                    onClick={generateBook}
                    disabled={
                      promptWordCount < 20 ||
                      promptWordCount > 500 ||
                      promptCharCount > 4000 ||
                      isGenerating ||
                      !canCreateContent ||
                      (!user && !anonConsent) ||
                      (user && profile && !profile.ai_processing_consent && !authedConsent)
                    }
                    aria-busy={isGenerating}
                    className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-10 py-4 rounded-lg font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        {user && isCreatingFromDashboard ? 'Generate First Chapter' : 'Generate Book'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Result */}
          {step === 'result' && (
            <div className="container mx-auto px-4 pb-12 max-w-7xl">
              <div className="mb-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                    <FileText className="w-7 h-7 mr-3 text-purple-600" />
                    {currentBook ? currentBook.title : 'Your Generated Book'}
                  </h2>
                  <button
                    onClick={() => (user ? setStep('dashboard') : handleAuthModalOpen('signup'))}
                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                  >
                    {user ? 'Back to Dashboard' : 'Create Books with More Chapters'}
                  </button>
                </div>

                <div className="mb-6">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${selectedGenre === 'fiction' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {selectedGenre} → {selectedSubgenre}
                  </span>
                </div>

                <div className="mb-6">
                  <div className="w-full max-w-sm mx-auto">
                    <div className="aspect-[2/3] rounded-xl overflow-hidden shadow-md border bg-white">
                      {coverUrl ? (
                        <img src={coverUrl} alt="Book cover" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full animate-pulse bg-gradient-to-br from-gray-200 via-gray-100 to-gray-200" />
                      )}
                    </div>
                    {coverLoading && <p className="text-center text-xs text-gray-500 mt-2">Generating cover…</p>}
                    {!!coverErr && <p className="text-center text-sm text-red-600 mt-2">{coverErr}</p>}
                  </div>

                  {user && currentBook && (
                    <div className="text-center mt-3">
                      <button
                        onClick={async () => {
                          setCoverErr('');
                          try {
                            const res = await rerollCover(currentBook.id);
                            if (res?.url) setCoverUrl(res.url);
                            else if (res?.path) setCoverUrl(toPublicCoverUrl(res.path));
                            setCoverAttempt(n => n + 1);
                          } catch (e: any) {
                            const msg = typeof e === 'string' ? e : e?.message ?? JSON.stringify(e);
                            setCoverErr(prettyCoverError(msg, effectiveTier));
                          }
                        }}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                        disabled={effectiveTier === 'free'}
                        title={effectiveTier === 'free' ? 'Rerolls sind im Free-Plan nicht verfügbar.' : undefined}
                      >
                        Reroll Cover
                      </button>
                      {!!coverErr && <p className="text-red-600 text-sm mt-2">{coverErr}</p>}
                    </div>
                  )}
                </div>

                {parsedBook && (
                  <ChapterList
                    book={parsedBook}
                    isAuthenticated={!!user}
                    onAuthRequired={() => { setAuthMode('signup'); setShowAuthModal(true); }}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onAuthSuccess={handleAuthSuccess} mode={authMode} />
    </div>
  );
}

export default App;
