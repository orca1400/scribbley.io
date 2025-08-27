// src/components/BookEditor.tsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ArrowLeft,
  Edit3,
  Save,
  Plus,
  Trash2,
  BookOpen,
  Loader2,
  Sparkles,
  X,
  Wand2,
  RefreshCw,
  Lock,
  CheckCircle2,
  FileDown,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserBook } from '../types/database';
import { parseBookIntoChapters, Book as ParsedBook, Chapter } from '../utils/bookParser';
import { useUserProfile } from '../hooks/useUserProfile';
import { useEntitlements } from '../hooks/useEntitlements';
import { sha256Hex } from '../utils/hash';
import jsPDF from 'jspdf';
import CoverPreview from './CoverPreview';
import { buildCoverPrompt } from '../utils/coverPrompt';
import { generateInitialCover, prettyCoverError } from '../services/covers';
import { chapterLimitFor, allowedLengthsFor } from '../utils/plan';
import { CHAPTER_LENGTH_RANGES, type ChapterLength, CONSENT_VERSION } from '../config/plans';

/* -------------------------- Small helpers -------------------------- */

function sanitizeFileName(name: string) {
  return (name || 'book')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function newId() {
  try {
    // @ts-ignore
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;
const charCount = (s: string) => (s || '').length;

function composeEffectivePrompt(base: string, beatsActive: boolean, beats: { id: string; text: string }[]) {
  const cleanBase = (base || '').trim();
  if (!beatsActive) return cleanBase;
  const list = beats.map(b => (b.text || '').trim()).filter(Boolean);
  if (!list.length) return cleanBase;
  const beatsBlock = list.map(s => `- ${s}`).join('\n');
  return `[USER BRIEF]\n${cleanBase}\n\n[BEATS]\n${beatsBlock}`;
}

/** Build a compact outline for the next-chapter prompt continuity. */
function buildOutline(chapters: EditableChapter[], summaries: ChapterSummary[]): string {
  const byNumber = new Map<number, string>();
  summaries.forEach(s => byNumber.set(s.chapter_number, s.summary.trim()));
  const lines: string[] = [];
  chapters.forEach((c, i) => {
    const n = i + 1;
    const title = (c.title || `Chapter ${n}`).trim();
    const fromSummary = byNumber.get(n);
    const fallback = (c.content || '').split(/\n+/).join(' ').split('. ').slice(0, 2).join('. ') || '';
    const brief = (fromSummary || fallback || '').trim();
    lines.push(`Chapter ${n}: ${title}${brief ? ` — ${brief}` : ''}`);
  });
  return lines.join('\n');
}

/** Tiny PDF exporter (text-only, A4 portrait). */
function usePdfExporter(bookTitle: string, chapters: { title: string; content: string }[]) {
  return React.useCallback(() => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' }); // 595 x 842 pt
    const marginX = 56;
    const marginY = 64;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const textW = pageW - marginX * 2;
    const bottomY = pageH - marginY;

    // Title page
    doc.setFont('Times', 'Bold');
    doc.setFontSize(22);
    const title = (bookTitle || 'Untitled Book').trim();
    const titleLines = doc.splitTextToSize(title, textW);
    let y = marginY;
    titleLines.forEach((line: string, i: number) => {
      doc.text(line, marginX, y + i * 26);
    });
    y += titleLines.length * 26 + 24;

    // Chapters
    chapters.forEach((ch, idx) => {
      if (y + 28 > bottomY) {
        doc.addPage();
        y = marginY;
      }
      doc.setFont('Times', 'Bold');
      doc.setFontSize(14);
      const heading = `Chapter ${idx + 1}${ch.title ? `: ${ch.title}` : ''}`;
      const headingLines = doc.splitTextToSize(heading, textW);
      headingLines.forEach((line: string) => {
        doc.text(line, marginX, y);
        y += 18;
      });

      doc.setFont('Times', 'Normal');
      doc.setFontSize(11);
      const paragraphs = (ch.content || '')
        .split(/\n\s*\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      paragraphs.forEach((p, pi) => {
        const lines = doc.splitTextToSize(p, textW) as string[];
        lines.forEach((line) => {
          if (y > bottomY) {
            doc.addPage();
            y = marginY;
          }
          doc.text(line, marginX, y);
          y += 14;
        });
        y += 8;
        if (pi === paragraphs.length - 1) y += 6;
      });
    });

    // Page numbers
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(140);
      doc.text(`${i} / ${pages}`, pageW - marginX, pageH - 20, { align: 'right' });
      doc.setTextColor(0);
    }

    doc.save(`${sanitizeFileName(title)}.pdf`);
  }, [bookTitle, chapters]);
}

function getSessionId(): string {
  try {
    let id = localStorage.getItem('session_id');
    if (!id) {
      // Prefer crypto.randomUUID() if available, otherwise use getRandomValues fallback
      if (typeof crypto !== 'undefined') {
        if (crypto.randomUUID) {
          id = crypto.randomUUID();
        } else if (crypto.getRandomValues) {
          // Generate a 16-byte (128-bit) random hex string
          const arr = new Uint8Array(16);
          crypto.getRandomValues(arr);
          id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          // fallback for ancient browsers (shouldn't happen)
          id = `${Date.now()}-xxxxxx`;
        }
      } else {
        // fallback for environments without crypto
        id = `${Date.now()}-xxxxxx`;
      }
      localStorage.setItem('session_id', id);
    }
    return id;
  } catch {
    // fallback in error case
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now()}-xxxxxx`;
  }
}

function crossed(prevPct: number, nextPct: number, level: 80 | 100, lastAlert?: number | null) {
  if ((lastAlert ?? 0) >= level) return false;
  return prevPct < level && nextPct >= level;
}

/* -------- Robust Edge calls (mirrors App.tsx) -------- */

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

async function edgeFetch<T>(
  fnName: string,
  payload: Record<string, any>,
  opts?: {
    bearer?: string | null;
    extraHeaders?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<T> {
  const url = `${getFunctionsBaseUrl()}/${fnName}`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const authToken = (opts?.bearer && opts.bearer.trim()) || (anonKey ? anonKey : '');
  if (!authToken) throw new Error('Missing auth token: provide user access_token or VITE_SUPABASE_ANON_KEY');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
    ...(anonKey ? { apikey: anonKey } : {}),
    ...(opts?.extraHeaders ?? {}),
  };

  const ac = new AbortController();
  const onAbort = () => ac.abort(new DOMException('client-timeout', 'AbortError'));
  opts?.signal?.addEventListener('abort', onAbort, { once: true });
  const tid = typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0
    ? setTimeout(() => ac.abort(new DOMException('client-timeout', 'AbortError')), opts.timeoutMs)
    : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: ac.signal,
      cache: 'no-store',
      keepalive: false,
    });
    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch {}
      try {
        const j = text ? JSON.parse(text) : null;
        if (j && j.error) throw new Error(j.error);
      } catch {/* ignore */}
      throw new Error(text || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    if (tid) clearTimeout(tid);
    opts?.signal?.removeEventListener('abort', onAbort as any);
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

/* -------------------------- Component -------------------------- */

export const BookEditor: React.FC<{
  book: UserBook;
  user: User;
  onBack: () => void;
}> = ({ book, user, onBack }) => {
  const { profile, refreshData } = useUserProfile(user.id);
  const { entitlements } = useEntitlements(user.id);
  const effectiveTier = (entitlements?.tier ?? profile?.plan_tier ?? 'free') as PlanTier;

  // ---------- GENRE (for API & cover) ----------
  const initialPicker: 'Fiction' | 'Non-Fiction' =
    book.genre?.toLowerCase() === 'non-fiction' ? 'Non-Fiction' : 'Fiction';
  const [genrePicker] = useState<'Fiction' | 'Non-Fiction'>(initialPicker);
  const [genreCustom] = useState(
    book.genre && !/^(fiction|non-fiction)$/i.test(book.genre) ? book.genre : ''
  );
  const [subgenre] = useState<string>(book.subgenre || '');
  const [subgenreDetail] = useState<string>((book as any).custom_subgenre || '');
  const effectiveGenre = (genreCustom.trim() || genrePicker) as string;

  // ---------- PLAN & LIMITS (server-driven) ----------
  const chapterLimit = chapterLimitFor({ plan_tier: profile?.plan_tier as PlanTier | null }, user.id, effectiveTier);
  const canRewrite = effectiveTier === 'pro' || effectiveTier === 'premium';
  const allowedLengths: ChapterLength[] = allowedLengthsFor({ plan_tier: profile?.plan_tier as PlanTier | null }, effectiveTier);

  // ---------- LENGTH LABELS ----------
  const LENGTH_RANGES: Record<ChapterLength, { min: number; max: number; label: string }> = {
    short:  { min: CHAPTER_LENGTH_RANGES.short[0],  max: CHAPTER_LENGTH_RANGES.short[1],  label: `${CHAPTER_LENGTH_RANGES.short[0]} – ${CHAPTER_LENGTH_RANGES.short[1]} words` },
    medium: { min: CHAPTER_LENGTH_RANGES.medium[0], max: CHAPTER_LENGTH_RANGES.medium[1], label: `${CHAPTER_LENGTH_RANGES.medium[0]} – ${CHAPTER_LENGTH_RANGES.medium[1]} words` },
    long:   { min: CHAPTER_LENGTH_RANGES.long[0],   max: CHAPTER_LENGTH_RANGES.long[1],   label: `${CHAPTER_LENGTH_RANGES.long[0]} – ${CHAPTER_LENGTH_RANGES.long[1]} words` },
    xlong:  { min: CHAPTER_LENGTH_RANGES.xlong[0],  max: CHAPTER_LENGTH_RANGES.xlong[1],  label: `${CHAPTER_LENGTH_RANGES.xlong[0]} – ${CHAPTER_LENGTH_RANGES.xlong[1]} words` },
  };

  // ---------- STATE ----------
  const [parsedBook, setParsedBook] = useState<ParsedBook | null>(null);
  const [chapters, setChapters] = useState<EditableChapter[]>([]);
  const [bookTitle, setBookTitle] = useState(book.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [showNewChapterModal, setShowNewChapterModal] = useState(false);
  const [generationType, setGenerationType] = useState<'custom' | 'auto'>('custom');
  const [newChapterPrompt, setNewChapterPrompt] = useState('');
  const [isGeneratingChapter, setIsGeneratingChapter] = useState(false);
  const [newChapterLength, setNewChapterLength] = useState<ChapterLength | null>(null);
  const DEMO_LIMIT = 5;

  // Beats (toggle + items)
  const [beatsActive, setBeatsActive] = useState(false);
  const [beats, setBeats] = useState<{ id: string; text: string }[]>([{ id: newId(), text: '' }]);

  const [error, setError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const summaryErrorTimeoutRef = useRef<number | null>(null);

  // Rewrite UI
  const [selectedText, setSelectedText] = useState('');
  const [showRewriteModal, setShowRewriteModal] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState('');
  const [showRewriteButton, setShowRewriteButton] = useState(false);
  const [rewriteButtonPosition, setRewriteButtonPosition] = useState({ x: 0, y: 0 });

  const [chapterSummaries, setChapterSummaries] = useState<ChapterSummary[]>([]);
  const [totalChapters, setTotalChapters] = useState<number>(book.total_chapters || 10);

  // Cover state (declare BEFORE coverStreamPrompt)
  const [coverUrl, setCoverUrl] = useState<string | null>((book as any).cover_url || null);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverPrompt, setCoverPrompt] = useState(
    book.description ||
      `${book.title} — eye-catching book cover, centered title typography, high contrast, professionally composed`
  );
  const [coverStyle, setCoverStyle] = useState<'illustration' | 'photo' | 'graphic' | 'watercolor' | 'minimal'>(
    'illustration'
  );
  const [coverSize, setCoverSize] = useState<'portrait' | 'square'>('portrait');
  const [coverSeed, setCoverSeed] = useState<string>('');
  const [coverIsGenerating, setCoverIsGenerating] = useState(false);
  const [coverError, setCoverError] = useState('');

  // Streaming prompt for the placeholder
  const coverStreamPrompt = useMemo(
    () =>
      buildCoverPrompt({
        bookTitle: (bookTitle || book.title || 'Untitled').trim(),
        description: (book.description || '').trim(),
        genre: effectiveGenre || undefined,
        subgenre: subgenre || undefined,
        style: coverStyle,
        aspect: coverSize,
      }),
    [bookTitle, book.title, book.description, effectiveGenre, subgenre, coverStyle, coverSize]
  );

  // Derived usage + auth
  const monthlyUsed = profile?.words_used_this_month ?? 0;
  const monthlyLimit = profile?.monthly_word_limit ?? 0;
  const monthlyPct = monthlyLimit > 0 ? Math.floor((monthlyUsed / monthlyLimit) * 100) : 0;

  const [activeIdx, setActiveIdx] = useState(0);
  const isAuthed = !!user?.id && user.id !== '00000000-0000-0000-0000-000000000000';

  const hasExceededWordLimit = useMemo(() => {
    if (!profile) return false;
    if (!isAuthed) return false;
    return (profile.words_used_this_month ?? 0) >= (profile.monthly_word_limit ?? Number.POSITIVE_INFINITY);
  }, [profile, isAuthed]);

  const canCreateContent = useMemo(() => {
    if (!isAuthed) return true;
    if (!profile) return false;
    if (effectiveTier === 'premium' || effectiveTier === 'pro') return true;
    return !hasExceededWordLimit;
  }, [isAuthed, profile, effectiveTier, hasExceededWordLimit]);

  const canAddMoreChapters = useMemo(() => {
    if (!canCreateContent) return false;
    const limit = isAuthed ? chapterLimit : DEMO_LIMIT;
    return chapters.length < limit;
  }, [canCreateContent, isAuthed, chapters.length, chapterLimit]);

  // Total word count (UI + save)
  const totalWordCount = useMemo(() => {
    const text =
      `${bookTitle}\n\n` +
      chapters.map((ch, i) => `Chapter ${i + 1}: ${ch.title}\n\n${ch.content}`).join('\n\n');
    return text.split(/\s+/).filter(Boolean).length;
  }, [bookTitle, chapters]);

  // ---------- LOAD ----------
  useEffect(() => {
    setBookTitle(book.title);
    const initialTarget = book.total_chapters ?? 5;
    setTotalChapters(Math.min(chapterLimit, initialTarget));

    if (book.content) {
      const parsed = parseBookIntoChapters(book.content, false);

      const cleaned = parsed.chapters.filter((ch) => {
        const text = `${ch.title} ${ch.content}`.trim();
        const letters = (text.match(/[A-Za-z]/g) || []).length;
        const words = text.split(/\s+/).filter(Boolean).length;
        return letters >= 20 && words >= 15;
      });

      const limit = isAuthed ? chapterLimit : DEMO_LIMIT;
      const limited = cleaned.slice(0, limit);

      setParsedBook({ ...parsed, chapters: limited });
      setChapters(
        limited.map((ch, i) => ({
          ...ch,
          id: `chapter-${i}`,
          isEditing: false,
          hasChanges: false,
        }))
      );
    }

    if ((book as any).cover_url) setCoverUrl((book as any).cover_url);
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.content, book.title, book.total_chapters, (book as any).cover_url, chapterLimit]);

  // Load chapter summaries
  useEffect(() => {
    const load = async () => {
      if (!user?.id || !book.id) return;
      try {
        const { data, error } = await supabase
          .from('chapter_summaries')
          .select('*')
          .eq('user_id', user.id)
          .eq('book_id', book.id)
          .order('chapter_number');
        if (error) throw error;
        setChapterSummaries(data || []);
      } catch (e) {
        console.error('Error loading chapter summaries:', e);
      }
    };
    load();
  }, [user?.id, book.id]);

  useEffect(() => {
    if (!isAuthed) setTotalChapters(DEMO_LIMIT);
  }, [isAuthed]);

  // ---------- HELPERS ----------
  const toggleEdit = React.useCallback((chapterId: string) => {
    setChapters((prev) => prev.map((ch) => (ch.id === chapterId ? { ...ch, isEditing: !ch.isEditing } : ch)));
  }, []);

  const updateChapterContent = React.useCallback(
    (chapterId: string, field: 'title' | 'content', value: string) => {
      setChapters((prev) => prev.map((ch) => (ch.id === chapterId ? { ...ch, [field]: value, hasChanges: true } : ch)));
    },
    []
  );

  // ---------- SAVE BOOK ----------
  const saveChanges = React.useCallback(async () => {
    setIsSaving(true);
    setError('');
    try {
      const updatedContent =
        `${bookTitle}\n\n` +
        chapters.map((ch, i) => `Chapter ${i + 1}: ${ch.title}\n\n${ch.content}`).join('\n\n');

      const { error: updateError } = await supabase
        .from('user_books')
        .update({
          title: bookTitle,
          content: updatedContent,
          word_count: totalWordCount,
          total_chapters: totalChapters,
          chapters_read: chapters.length,
          genre: effectiveGenre,
          subgenre: subgenre || null,
          custom_subgenre: subgenreDetail || null,
          ...(coverUrl ? { cover_url: coverUrl } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', book.id);

      if (updateError) throw updateError;

      // Generate summaries for changed chapters
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (ch.hasChanges) {
          await generateAndSaveChapterSummary(ch.title, ch.content, i + 1);
        }
      }

      setChapters((prev) => prev.map((ch) => ({ ...ch, hasChanges: false, isEditing: false })));
      setParsedBook((prev) => (prev ? { ...prev, title: bookTitle } : null));
    } catch (err: any) {
      console.error('Error saving changes:', err);
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [
    book.id,
    bookTitle,
    chapters,
    totalWordCount,
    totalChapters,
    effectiveGenre,
    subgenre,
    subgenreDetail,
    coverUrl,
  ]);

  // Warn if leaving with unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (chapters.some((c) => c.hasChanges) || bookTitle !== book.title) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [chapters, book.title, bookTitle]);

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
      if (isSave) {
        e.preventDefault();
        if (!isSaving && (chapters.some((c) => c.hasChanges) || bookTitle !== book.title)) {
          void saveChanges();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSaving, chapters, book.title, bookTitle, saveChanges]);

  // Cleanup summary error timeout on unmount
  useEffect(() => {
    return () => {
      if (summaryErrorTimeoutRef.current) {
        clearTimeout(summaryErrorTimeoutRef.current);
      }
    };
  }, []);

  const generateAndSaveChapterSummary = async (
    chapterTitle: string,
    chapterContent: string,
    chapterNumber: number
  ) => {
    try {
      const contentHash = await sha256Hex(chapterContent);
      const { data: auth } = await supabase.auth.getSession();
      const token = auth?.session?.access_token ?? null;

      const resp = await edgeFetchWithRetry<{ summary?: string }>(
        'generate-summary',
        {
          chapterTitle,
          chapterContent,
          chapterNumber,
          bookTitle: parsedBook?.title || book.title,
          genre: effectiveGenre,
          subgenre,
          customSubgenre: subgenreDetail || null,
          userId: user.id,
          bookId: book.id,
          contentHash,
          model: 'gpt-4o-mini',
          promptVersion: 'v1',
        },
        {
          bearer: token,
          extraHeaders: { 'x-user-id': user.id, ...(profile?.ai_processing_consent ? { 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION } : {}) },
          timeoutMs: 60_000,
        }
      );

      const summaryText = (resp.summary ?? '').trim();
      if (!summaryText) throw new Error('Generated summary is empty');

      const { data: savedSummary, error: saveError } = await supabase
        .from('chapter_summaries')
        .upsert(
          {
            user_id: user.id,
            book_id: book.id,
            chapter_number: chapterNumber,
            summary: summaryText,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'book_id,chapter_number' }
        )
        .select()
        .single();

      if (saveError) throw saveError;

      setChapterSummaries((prev) => {
        const filtered = prev.filter((s) => s.chapter_number !== chapterNumber);
        return [...filtered, savedSummary as ChapterSummary].sort((a, b) => a.chapter_number - b.chapter_number);
      });
    } catch (error) {
      console.error('Summary generation failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
      setSummaryError(`Failed to generate summary for Chapter ${chapterNumber}: ${errorMsg}`);
      
      // Clear any existing timeout
      if (summaryErrorTimeoutRef.current) {
        clearTimeout(summaryErrorTimeoutRef.current);
      }
      
      // Auto-clear the error after 10 seconds
      summaryErrorTimeoutRef.current = window.setTimeout(() => {
        setSummaryError('');
        summaryErrorTimeoutRef.current = null;
      }, 10000);
    }
  };

  // ---------- GENERATE CHAPTER (via generate-book in "chapter" mode) ----------
  const PROMPT_LIMITS = { minWords: 20, maxWords: 500, maxChars: 4000 };
  const effectivePrompt = useMemo(
    () => composeEffectivePrompt(newChapterPrompt, beatsActive, beats),
    [newChapterPrompt, beatsActive, beats]
  );
  const epWords = useMemo(() => wordCount(effectivePrompt), [effectivePrompt]);
  const epChars = useMemo(() => charCount(effectivePrompt), [effectivePrompt]);
  const promptInvalid =
    generationType === 'custom' &&
    (epWords < PROMPT_LIMITS.minWords || epWords > PROMPT_LIMITS.maxWords || epChars > PROMPT_LIMITS.maxChars);

  const generateNewChapter = async () => {
    if (!isAuthed) {
      setError('Chapter generation is disabled in Demo Mode. Please sign in or create an account.');
      return;
    }
    if (!profile?.ai_processing_consent) {
      setError('Please enable AI Processing consent in Settings to generate chapters.');
      return;
    }
    if (!newChapterLength) {
      setError('Please choose a chapter length.');
      return;
    }
    if (generationType === 'custom' && promptInvalid) return;

    if (!canAddMoreChapters) {
      if (!canCreateContent) {
        const lim = profile?.monthly_word_limit;
        setError(
          `You've exceeded your monthly word limit${lim ? ` of ${lim.toLocaleString()} words` : ''}. Please upgrade your plan to continue creating chapters.`
        );
      } else {
        setError(
          `You've reached the maximum number of chapters (${chapterLimit}) for your ${effectiveTier} plan. Upgrade to add more chapters to this book.`
        );
      }
      return;
    }

    setIsGeneratingChapter(true);
    setError('');

    try {
      const { data: auth } = await supabase.auth.getSession();
      const accessToken = auth?.session?.access_token ?? null;
      if (!accessToken) throw new Error('You need to be signed in to generate chapters.');
      const sessionId = getSessionId();

      // If "auto", we ask the model to continue; otherwise use user prompt
      const baseDescription =
        generationType === 'auto'
          ? 'Continue the story naturally from where the previous chapter left off. Develop the plot, characters, and themes established in the existing chapters.'
          : effectivePrompt;

      const outline = buildOutline(chapters, chapterSummaries);
      const range = LENGTH_RANGES[newChapterLength];
      const idx = chapters.length + 1;

      const data = await edgeFetchWithRetry<{
        chapter_index: number;
        title: string;
        content: string;
        meta?: any;
      }>(
        'generate-book',
        {
          mode: 'chapter',
          genre: /non-fiction/i.test(effectiveGenre) ? 'non-fiction' : 'fiction',
          subgenre: subgenre || (/(fiction|non-fiction)/i.test(effectiveGenre) ? '' : effectiveGenre),
          description: baseDescription,
          beatsActive,
          beats: beatsActive ? beats.map(b => b.text) : [],
          chapter_index: idx,
          chapter_count: Math.max(idx, totalChapters || idx),
          chapter_words_min: range.min,
          chapter_words_max: range.max,
          outline,
        },
        {
          bearer: accessToken,
          extraHeaders: {
            'x-user-id': user.id,
            'x-session-id': sessionId,
            'x-ai-consent': 'true',
            'x-ai-consent-version': CONSENT_VERSION,
          },
          timeoutMs: 120_000,
          retries: 2,
        }
      );

      const newChapter: EditableChapter = {
        title: data.title || `Chapter ${idx}`,
        content: data.content,
        teaser: (data.content || '').substring(0, 200) + '...',
        id: `chapter-${chapters.length}`,
        isEditing: false,
        hasChanges: true,
      };

      setChapters((prev) => [...prev, newChapter]);
      setActiveIdx(chapters.length);

      try {
        await generateAndSaveChapterSummary(newChapter.title, newChapter.content, idx);
      } catch (summaryError) {
        console.error('Failed to generate chapter summary:', summaryError);
        // Error display is handled in generateAndSaveChapterSummary function
      }

      // usage update + notifications (keep your existing logic)
      try {
        const chapterWordCount =
          typeof newChapter.content === 'string' ? newChapter.content.split(/\s+/).filter((w: string) => w.length > 0).length : 0;

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('words_used_this_month, monthly_word_limit, last_usage_alert_pct, plan_tier, email')
          .eq('id', user.id)
          .single();

        if (!profileError && profileData) {
          const currentUsage = profileData.words_used_this_month || 0;
          const limit = profileData.monthly_word_limit || 0;
          const lastAlert = profileData.last_usage_alert_pct ?? null;
          const prevPct = limit > 0 ? Math.floor((currentUsage / limit) * 100) : 0;

          const newUsage = currentUsage + chapterWordCount;
          const nextPct = limit > 0 ? Math.floor((newUsage / limit) * 100) : prevPct;

          const send80 = limit > 0 && crossed(prevPct, nextPct, 80, lastAlert);
          const send100 = limit > 0 && crossed(prevPct, nextPct, 100, lastAlert);
          const nextLastAlert = send100 ? 100 : send80 ? 80 : lastAlert;

          const { error: updateError } = await supabase
            .from('user_profiles')
            .update({
              words_used_this_month: newUsage,
              ...(nextLastAlert != null ? { last_usage_alert_pct: nextLastAlert } : {}),
            })
            .eq('id', user.id);
          if (updateError) console.error('Error updating usage:', updateError);

          if (send80 || send100) {
            try {
              const { data: auth2 } = await supabase.auth.getSession();
              const token2 = auth2?.session?.access_token ?? null;

              await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/usage-alert`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token2 ? { Authorization: `Bearer ${token2}`, 'x-user-id': user.id } : {}),
                },
                body: JSON.stringify({
                  userId: user.id,
                  email: profileData.email || user.email,
                  level: send100 ? 100 : 80,
                  used: newUsage,
                  limit,
                  percent: nextPct,
                  planTier: profileData.plan_tier,
                  bookId: book.id,
                  bookTitle: parsedBook?.title || book.title,
                }),
              });
            } catch (mailErr) {
              console.error('Error sending usage-alert mails:', mailErr);
            }
          }
        }
      } catch (wordUpdateError) {
        console.error('Error in usage update flow:', wordUpdateError);
      }

      setShowNewChapterModal(false);
      setGenerationType('custom');
      setNewChapterPrompt('');
      setNewChapterLength(null);
      // keep beats state as user preference
    } catch (err: any) {
      console.error('Error generating chapter:', err);
      const mixedContentHint =
        typeof window !== 'undefined' &&
        window.location?.protocol === 'https:' &&
        String(import.meta.env.VITE_SUPABASE_URL || '').startsWith('http://')
          ? ' (Your SUPABASE_URL is http while the app runs on https — browsers block mixed content.)'
          : '';
      if (isNetworkLike(err)) setError(`Network error while contacting the AI function. Please retry.${mixedContentHint}`);
      else if (isTimeoutLike(err)) setError('The AI request timed out. Please retry or reduce chapter length.');
      else setError(err?.message || 'Failed to generate chapter. Please try again.');
    } finally {
      setIsGeneratingChapter(false);
    }
  };

  // ---------- TEXT SELECTION (REWRITE) ----------
  const handleTextSelection = (
    chapterId: string,
    e: React.MouseEvent<HTMLTextAreaElement> | React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (!canRewrite) return;
    const ta = e.currentTarget as HTMLTextAreaElement;
    if (!ta || ta.tagName !== 'TEXTAREA') return;

    const start = (ta.selectionStart ?? 0);
    const end = (ta.selectionEnd ?? 0);
    const raw = ta.value.slice(start, end);
    const text = raw.trim();

    if (text && text.length > 10) {
      const rect = ta.getBoundingClientRect();
      const mouseEvent = e as React.MouseEvent;
      const hasMouse = !!(mouseEvent.clientX || mouseEvent.clientY);

      const mouse = hasMouse
        ? { x: mouseEvent.clientX, y: mouseEvent.clientY + window.scrollY + 8 }
        : { x: rect.right - rect.width * 0.1, y: rect.bottom + window.scrollY + 8 };

      setRewriteButtonPosition({ x: mouse.x, y: mouse.y });
      setSelectedText(text);
      setSelectionRange({ start, end });
      setCurrentChapterId(chapterId);
      setShowRewriteButton(true);
    } else {
      setShowRewriteButton(false);
      setSelectedText('');
      setSelectionRange(null);
      setCurrentChapterId('');
    }
  };

  const handleRewriteClick = () => {
    setShowRewriteButton(false);
    setShowRewriteModal(true);
  };
  const handleCancelRewrite = () => {
    setShowRewriteButton(false);
    setSelectedText('');
    setCurrentChapterId('');
  };

  // ---------- COVER: Generate / Save URL ----------
  const generateCover = async () => {
    setCoverIsGenerating(true);
    setCoverError('');
    try {
      const title = (bookTitle || book.title || '').trim();
      if (!title) {
        setCoverError('Bitte gib dem Buch einen Titel.');
        return;
      }

      const res = await generateInitialCover({
        bookId: book.id,
        bookTitle: title,
        description: (book.description || '').trim(),
        genre: effectiveGenre || undefined,
        subgenre: subgenre || undefined,
        isAuthenticated: true,
      });

      let publicUrl: string | null = null;
      if (res?.url) publicUrl = res.url;
      else if (res?.path) publicUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/book-covers/${res.path}`;
      else if (res?.imageBase64) publicUrl = `data:image/png;base64,${res.imageBase64}`;

      if (!publicUrl) throw new Error('IMAGE_GENERATION_FAILED');

      const { error: updateError } = await supabase
        .from('user_books')
        .update({ cover_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', book.id);
      if (updateError) console.warn('Saving cover URL failed:', updateError);

      setCoverUrl(publicUrl);
      setShowCoverModal(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setCoverError(prettyCoverError(msg));
    } finally {
      setCoverIsGenerating(false);
    }
  };

  const removeCover = async () => {
    try {
      const { error: updateError } = await supabase
        .from('user_books')
        .update({ cover_url: null, updated_at: new Date().toISOString() })
        .eq('id', book.id);
      if (updateError) throw updateError;
      setCoverUrl(null);
    } catch (e) {
      console.error(e);
      alert('Failed to remove cover.');
    }
  };

  // ---------- DERIVED ----------
  const hasUnsavedChanges = chapters.some((ch) => ch.hasChanges) || bookTitle !== book.title;

  const exportPdf = usePdfExporter(
    bookTitle,
    chapters.map((c) => ({ title: c.title, content: c.content }))
  );

  // ---------- RENDER ----------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-100 via-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-12 h-12 text-purple-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Loading book editor...</p>
        </div>
      </div>
    );
  }

  const active = chapters[activeIdx];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button onClick={onBack} className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>

              <div className="flex items-center gap-4">
                {/* Cover thumbnail (with streaming fallback) */}
                {coverUrl ? (
                  <img src={coverUrl} alt="Book cover" className="w-10 h-14 object-cover rounded-md border" />
                ) : coverIsGenerating ? (
                  <CoverPreview prompt={coverStreamPrompt} className="w-10 h-14" />
                ) : (
                  <div className="w-10 h-14 rounded-md border bg-gray-100 flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}

                <div>
                  {isEditingTitle ? (
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={bookTitle}
                        onChange={(e) => setBookTitle(e.target.value)}
                        className="text-xl font-bold text-gray-800 bg-transparent border-b-2 border-purple-500 focus:outline-none focus:border-purple-600 min-w-0 flex-1"
                        onBlur={() => setIsEditingTitle(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setIsEditingTitle(false);
                          if (e.key === 'Escape') {
                            setBookTitle(book.title);
                            setIsEditingTitle(false);
                          }
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="flex items-center flex-wrap gap-2">
                      <h1 className="text-xl font-bold text-gray-800">{bookTitle}</h1>
                      <button onClick={() => setIsEditingTitle(true)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                        <Edit3 className="w-4 h-4 text-gray-500" />
                      </button>
                      <p className="w-full text-xs text-gray-500">
                        {chapters.length} chapters • {totalWordCount.toLocaleString()} words
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Cover actions */}
              <button
                onClick={() => setShowCoverModal(true)}
                className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-3 py-2 rounded-lg font-medium hover:shadow-lg transition-all duration-200 flex items-center space-x-2"
              >
                <ImageIcon className="w-4 h-4" />
                <span>{coverUrl ? 'Change Cover' : 'Generate Cover'}</span>
              </button>
              {coverUrl && (
                <button onClick={removeCover} className="px-3 py-2 rounded-lg border text-gray-700 hover:bg-gray-50" title="Remove cover">
                  Remove
                </button>
              )}

              {/* Export PDF */}
              <button
                onClick={exportPdf}
                className="px-3 py-2 rounded-lg border text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                title="Export PDF"
              >
                <FileDown className="w-4 h-4" />
                <span>Export PDF</span>
              </button>

              {/* New chapter */}
              <button
                onClick={() => setShowNewChapterModal(true)}
                disabled={!canAddMoreChapters}
                className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-4 py-2 rounded-lg font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {!canCreateContent
                    ? 'Word Limit Exceeded'
                    : !canAddMoreChapters
                    ? `Chapter Limit (${chapterLimit})`
                    : 'New Chapter'}
                </span>
              </button>

              {/* Save */}
              <button
                onClick={saveChanges}
                disabled={!hasUnsavedChanges || isSaving}
                className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div className="container mx-auto px-4 py-6">
        {/* consent banner if needed */}
        {isAuthed && profile && !profile.ai_processing_consent && (
          <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M12 18a9 9 0 110-18 9 9 0 010 18z"/>
              </svg>
              <div className="text-sm">
                <strong>AI Processing Consent required.</strong> Enable this in Settings to generate new chapters and use rewrite.
              </div>
            </div>
          </div>
        )}

        {/* error banner */}
        {!!error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4" aria-live="polite">
            {error}
          </div>
        )}

        {/* summary error banner */}
        {!!summaryError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-4" aria-live="polite">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Chapter Summary Error</div>
                <div className="text-sm">{summaryError}</div>
              </div>
            </div>
          </div>
        )}

        {/* Two-pane layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* LEFT: chapters list */}
          <aside className="bg-white/80 backdrop-blur rounded-2xl border shadow-sm p-4 lg:sticky lg:top-20 lg:self-start max-h-[calc(100vh-6rem)] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Chapters</h3>
              <span className="text-xs text-gray-500">
                {chapters.length}/{isAuthed ? chapterLimit : DEMO_LIMIT}
              </span>
            </div>

            {/* Sidebar Cover */}
            <div className="mb-3">
              {coverUrl ? (
                <img src={coverUrl} alt="Book cover" className="w-full aspect-[2/3] object-cover rounded-lg border" />
              ) : coverIsGenerating ? (
                <CoverPreview prompt={coverStreamPrompt} className="w-full aspect-[2/3]" />
              ) : (
                <div className="w-full aspect-[2/3] rounded-lg border bg-gray-100 flex items-center justify-center text-gray-400">
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
            </div>

            <ol className="space-y-2">
              {chapters.map((ch, i) => {
                const lockedForAnon = !isAuthed && i > 0;
                const selected = i === activeIdx;
                return (
                  <li key={ch.id} className="group">
                    <button
                      type="button"
                      onClick={() => !lockedForAnon && setActiveIdx(i)}
                      className={[
                        'w-full text-left px-3 py-2 rounded-lg border transition',
                        selected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300',
                        lockedForAnon ? 'opacity-60 cursor-not-allowed' : '',
                      ].join(' ')}
                      title={lockedForAnon ? 'Sign in to unlock' : ch.title}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">
                            Chapter {i + 1}
                            {ch.title ? `: ${ch.title}` : ''}
                          </div>
                          {!lockedForAnon && (
                            <div className="text-xs text-gray-500 truncate">
                              {Math.max(0, ch.content?.split(/\s+/).filter(Boolean).length || 0).toLocaleString()} words
                            </div>
                          )}
                        </div>
                        {lockedForAnon ? (
                          <Lock className="w-4 h-4 text-gray-400" />
                        ) : ch.hasChanges ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Unsaved</span>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-green-500 opacity-70" />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-4">
              <button
                onClick={() => setShowNewChapterModal(true)}
                disabled={!isAuthed || !canAddMoreChapters}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white px-3 py-2 rounded-lg font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {!isAuthed
                  ? 'Sign in to add chapters'
                  : !canAddMoreChapters
                  ? `Chapter Limit (${chapterLimit})`
                  : 'New Chapter'}
              </button>
            </div>
          </aside>

          {/* RIGHT: editor for active chapter */}
          <main>
            {/* Usage warnings */}
            {monthlyLimit > 0 && monthlyPct >= 80 && monthlyPct < 100 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-4">
                <strong>Heads up:</strong> You used {monthlyPct}% of your monthly quota (
                {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()} words).
              </div>
            )}
            {monthlyLimit > 0 && monthlyPct >= 100 && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4">
                <strong>Limit reached:</strong> {monthlyUsed.toLocaleString()} / {monthlyLimit.toLocaleString()} words. Please upgrade.
              </div>
            )}

            {active ? (
              <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm font-medium">
                      Chapter {activeIdx + 1}
                    </span>
                    {active.hasChanges && (
                      <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-medium">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => toggleEdit(active.id)} className="p-2 hover:bg-purple-100 rounded-lg transition-colors">
                      <Edit3 className="w-4 h-4 text-purple-600" />
                    </button>
                    {chapters.length > 1 && (
                      <button
                        onClick={() => {
                          setChapters((prev) => {
                            const idx = prev.findIndex((c) => c.id === active.id);
                            const next = prev.filter((c) => c.id !== active.id);
                            setActiveIdx((curr) => Math.max(0, Math.min(curr, next.length - 1, idx)));
                            return next;
                          });
                        }}
                        className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    )}
                  </div>
                </div>

                {active.isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Chapter Title</label>
                      <input
                        type="text"
                        value={active.title}
                        onChange={(e) => updateChapterContent(active.id, 'title', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Chapter Content</label>
                      <div className="relative">
                        <div className="h-[70vh] min-h-[320px]">
                          <textarea
                            value={active.content}
                            onChange={(e) => updateChapterContent(active.id, 'content', e.target.value)}
                            onMouseUp={(e) => handleTextSelection(active.id, e)}
                            onKeyUp={(e) => handleTextSelection(active.id, e)}
                            className="w-full h-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent overflow-y-auto resize-none"
                          />
                        </div>
                        {canRewrite && (
                          <div className="absolute top-2 right-2">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-700">
                              Select text to rewrite with AI
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-xl font-bold text-gray-800 mb-4">{active.title}</h3>
                    <div className="prose prose-lg max-w-none">
                      <div className="text-gray-800 leading-relaxed space-y-4">
                        {active.content
                          .split(/\n\s*\n/)
                          .filter((p) => p.trim())
                          .map((p, i) => (
                            <p key={i} className="mb-4">
                              {p.trim()}
                            </p>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Save button pinned under the editor card */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={saveChanges}
                    disabled={!hasUnsavedChanges || isSaving}
                    className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-5 py-2.5 rounded-lg font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isSaving ? (
                      <span className="inline-flex items-center">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving…
                      </span>
                    ) : (
                      <span className="inline-flex items-center">
                        <Save className="w-4 h-4 mr-2" />
                        Save changes
                      </span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white/70 border rounded-2xl p-8 text-center text-gray-600">No chapter selected.</div>
            )}
          </main>
        </div>

        <div className="h-10" />
      </div>

      {/* Floating Rewrite Button */}
      {showRewriteButton && selectedText && (
        <div
          className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2 flex items-center space-x-2"
          style={{
            left: `${rewriteButtonPosition.x}px`,
            top: `${rewriteButtonPosition.y}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <button
            onClick={handleRewriteClick}
            className="bg-blue-500 text-white px-3 py-1 rounded text-sm font-medium hover:bg-blue-600 transition-colors flex items-center space-x-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Rewrite with AI</span>
          </button>
          <button onClick={handleCancelRewrite} className="text-gray-500 hover:text-gray-700 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* New Chapter Modal */}
      {showNewChapterModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col relative">
            <button
              onClick={() => {
                setShowNewChapterModal(false);
                setGenerationType('custom');
                setNewChapterPrompt('');
                setNewChapterLength(null);
                // keep beats state as user preference
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="px-8 pt-8 pb-4 text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Create New Chapter</h2>
              <p className="text-gray-600">
                ({chapters.length}/{isAuthed ? chapterLimit : DEMO_LIMIT} chapters used)
              </p>
            </div>

            <div className="overflow-y-auto px-8 pb-6 space-y-6">
              {effectiveTier === 'free' && chapters.length >= 4 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <svg
                      className="w-5 h-5 text-amber-600 mr-2 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                    <div>
                      <h4 className="font-medium text-amber-800 mb-1">
                        {chapters.length === 4 ? 'Last Chapter for Free Plan' : 'Chapter Limit Reached'}
                      </h4>
                      <p className="text-sm text-amber-700">
                        {chapters.length === 4
                          ? 'This will be your 5th and final chapter on the free plan. Upgrade to Pro or Premium to add more chapters.'
                          : 'You’ve reached the 5-chapter limit for free plans. Upgrade to continue expanding this book.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Generation Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setGenerationType('custom')}
                    className={`p-4 rounded-lg border-2 transition-all duration-200 text-left ${
                      generationType === 'custom'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="flex items-center mb-2">
                      <Sparkles className="w-5 h-5 mr-2" />
                      <span className="font-medium">Custom Prompt</span>
                    </div>
                    <p className="text-sm opacity-90">Describe what should happen in the next chapter</p>
                  </button>

                  <button
                    onClick={() => setGenerationType('auto')}
                    className={`p-4 rounded-lg border-2 transition-all duration-200 text-left ${
                      generationType === 'auto'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="flex items-center mb-2">
                      <Wand2 className="w-5 h-5 mr-2" />
                      <span className="font-medium">Auto Continue</span>
                    </div>
                    <p className="text-sm opacity-90">Let AI continue the story naturally</p>
                  </button>
                </div>
              </div>

              {/* Length */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Chapter Length (required)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['short', 'medium', 'long', 'xlong'] as ChapterLength[]).map((len) => {
                    const allowed = allowedLengths.includes(len);
                    return (
                      <label
                        key={len}
                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                          newChapterLength === len ? 'border-purple-500 bg-purple-50' : 'border-gray-300 bg-white'
                        } ${allowed ? '' : 'opacity-60 cursor-not-allowed'}`}
                        title={allowed ? '' : len === 'xlong' ? 'Upgrade to Premium' : 'Upgrade to Pro'}
                      >
                        <input
                          type="radio"
                          name="chapter-length"
                          value={len}
                          checked={newChapterLength === len}
                          onChange={() => allowed && setNewChapterLength(len)}
                          disabled={!allowed}
                        />
                        <div>
                          <div className="font-medium text-gray-800 capitalize">
                            {len === 'xlong' ? 'Extra long' : len}
                          </div>
                          <div className="text-sm text-gray-600">{LENGTH_RANGES[len].label}</div>
                          <div className="text-xs text-gray-500">
                            {len === 'short' ? 'Free/Pro/Premium' : len === 'xlong' ? 'Premium' : 'Pro/Premium'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Prompt + Beats */}
              {generationType === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Chapter Description</label>
                  <textarea
                    value={newChapterPrompt}
                    onChange={(e) => setNewChapterPrompt(e.target.value)}
                    placeholder="Describe what should happen in this chapter..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y min-h-24 max-h-60 overflow-y-auto"
                    maxLength={PROMPT_LIMITS.maxChars}
                  />

                  {/* Beats toggle */}
                  <label className="mt-3 flex items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={beatsActive}
                      onChange={(e) => setBeatsActive(e.target.checked)}
                    />
                    <span className="text-sm text-gray-700">
                      Include beats in prompt (counts toward word/character limits)
                    </span>
                  </label>

                  {/* Beats list (only visible when active) */}
                  {beatsActive && (
                    <div className="mt-3 space-y-2">
                      {beats.map((b, i) => (
                        <div key={b.id} className="flex items-start gap-2">
                          <span className="text-sm pt-2 w-6 text-right">{i + 1}.</span>
                          <textarea
                            className="flex-1 border rounded p-2"
                            rows={2}
                            placeholder="Beat (short, concrete moment you want included)"
                            value={b.text}
                            onChange={(e) =>
                              setBeats((prev) =>
                                prev.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x))
                              )
                            }
                          />
                          <button
                            type="button"
                            className="px-2 py-1 border rounded"
                            onClick={() => setBeats((prev) => prev.filter((x) => x.id !== b.id))}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="mt-2 px-3 py-1 border rounded"
                        onClick={() => setBeats((prev) => [...prev, { id: newId(), text: '' }])}
                      >
                        + Add beat
                      </button>
                    </div>
                  )}

                  {/* Effective counter (includes beats if active) */}
                  <div className="mt-3 space-y-1">
                    <p className={`text-sm font-medium ${promptInvalid ? 'text-red-600' : 'text-gray-600'}`}>
                      Word count: {epWords} / {PROMPT_LIMITS.maxWords} • Characters: {epChars} / {PROMPT_LIMITS.maxChars}
                    </p>
                    <p className="text-sm text-gray-500">
                      Minimum {PROMPT_LIMITS.minWords} words, maximum {PROMPT_LIMITS.maxWords} words and {PROMPT_LIMITS.maxChars} characters.
                      {beatsActive ? ' Beats are included in these limits.' : ' Toggle beats on to include them in the prompt and the limits.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 bg-white border-t px-8 py-4 flex justify-end gap-4">
              <button
                onClick={() => {
                  setShowNewChapterModal(false);
                  setGenerationType('custom');
                  setNewChapterPrompt('');
                  setNewChapterLength(null);
                }}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={generateNewChapter}
                disabled={
                  !newChapterLength ||
                  isGeneratingChapter ||
                  !canCreateContent ||
                  (generationType === 'custom' && (promptInvalid))
                }
                className={`px-6 py-3 rounded-lg font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center ${
                  generationType === 'auto'
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white'
                    : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                }`}
              >
                {isGeneratingChapter ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : !canCreateContent ? (
                  <>Word Limit Exceeded</>
                ) : generationType === 'auto' ? (
                  <>
                    <Wand2 className="w-5 h-5 mr-2" />
                    Auto Generate
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Chapter
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rewrite Passage Modal */}
      {showRewriteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 relative">
            <button
              onClick={() => {
                setShowRewriteModal(false);
                setSelectedText('');
                setRewriteInstruction('');
                setShowRewriteButton(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Rewrite Passage</h2>
              <p className="text-gray-600">AI will rewrite the selected text while maintaining story consistency.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Selected Text</label>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                  <p className="text-sm text-gray-800 italic">"{selectedText}"</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rewrite Style</label>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    'Make it more dramatic and emotional',
                    'Simplify the language and make it clearer',
                    'Make it more descriptive with vivid details',
                    'Make it more concise and to the point',
                    'Improve the dialogue and character voice',
                    'Change the tone to be more suspenseful',
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => setRewriteInstruction(p)}
                      className={`p-3 text-left border rounded-lg transition-colors ${
                        rewriteInstruction === p ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <div className="font-medium text-sm">{p.split(':')[0] || p}</div>
                      <div className="text-xs opacity-75">{p}</div>
                    </button>
                  ))}
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-2">Custom Instruction (Optional)</label>
                <textarea
                  value={rewriteInstruction}
                  onChange={(e) => setRewriteInstruction(e.target.value)}
                  placeholder="Or write your own specific instructions..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  maxLength={4000}
                />
                <div className="mt-1">
                  <p className="text-xs text-gray-500">Characters: {rewriteInstruction.length} / 4000</p>
                </div>
              </div>

              <div className="flex gap-4 justify-end">
                <button
                  onClick={() => {
                    setShowRewriteModal(false);
                    setSelectedText('');
                    setRewriteInstruction('');
                    setShowRewriteButton(false);
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!selectedText || !currentChapterId || !selectionRange) return;
                    if (!profile?.ai_processing_consent) {
                      setError('Please enable AI Processing consent in Settings to use rewrite.');
                      return;
                    }
                    setIsRewriting(true);
                    setError('');
                    try {
                      const currentChapter = chapters.find((c) => c.id === currentChapterId);
                      if (!currentChapter) throw new Error('Chapter not found');

                      const fullText = currentChapter.content;
                      const { start, end } = selectionRange;
                      const ctxBefore = Math.max(0, start - 200);
                      const ctxAfter = Math.min(fullText.length, end + 200);
                      const context = fullText.substring(ctxBefore, ctxAfter);

                      const { data: auth } = await supabase.auth.getSession();
                      const token = auth?.session?.access_token ?? null;

                      const data = await edgeFetchWithRetry<{ rewrittenText?: string; rewritten_text?: string; result?: string; text?: string }>(
                        'rewrite-passage',
                        {
                          selectedText,
                          context,
                          rewriteInstruction: rewriteInstruction.trim() || undefined,
                          genre: effectiveGenre,
                          subgenre,
                          customSubgenre: subgenreDetail || null,
                        },
                        {
                          bearer: token,
                          extraHeaders: { 'x-user-id': user.id, 'x-ai-consent': 'true', 'x-ai-consent-version': CONSENT_VERSION },
                          timeoutMs: 60_000,
                          retries: 2,
                        }
                      );

                      const rewritten = data.rewrittenText ?? data.rewritten_text ?? data.result ?? data.text;
                      if (!rewritten || typeof rewritten !== 'string') throw new Error('Rewrite service returned no text.');

                      const updatedContent = fullText.slice(0, start) + rewritten + fullText.slice(end);
                      setChapters((prev) =>
                        prev.map((ch) => (ch.id === currentChapterId ? { ...ch, content: updatedContent, hasChanges: true } : ch))
                      );

                      setShowRewriteModal(false);
                      setSelectedText('');
                      setSelectionRange(null);
                      setRewriteInstruction('');
                      setCurrentChapterId('');
                      setShowRewriteButton(false);
                    } catch (err: any) {
                      console.error('Error rewriting passage:', err);
                      setError(err?.message || 'Failed to rewrite passage. Please try again.');
                    } finally {
                      setIsRewriting(false);
                    }
                  }}
                  disabled={!selectedText || isRewriting}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center"
                >
                  {isRewriting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Rewriting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2" />
                      Rewrite with AI
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cover Modal */}
      {showCoverModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col relative">
            <button
              onClick={() => {
                setShowCoverModal(false);
                setCoverError('');
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="px-8 pt-8 pb-3">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">{coverUrl ? 'Regenerate Cover' : 'Generate Cover'}</h2>
              <p className="text-sm text-gray-500">
                {isAuthed
                  ? effectiveTier === 'free'
                    ? 'Free: 5 covers/month (server enforces).'
                    : effectiveTier === 'pro'
                    ? 'Pro: 10 covers/month, 1 reroll each (server enforces).'
                    : 'Premium: 20 covers/month, 2 rerolls each (server enforces).'
                  : 'Anonymous: first book gets one low-quality cover (server enforces).'}
              </p>
            </div>

            <div className="overflow-y-auto px-8 pb-6 space-y-5">
              {!!coverError && (
                <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2 rounded-lg">{coverError}</div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                  <textarea
                    value={coverPrompt}
                    onChange={(e) => setCoverPrompt(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Describe the cover you want…"
                    maxLength={800}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Include mood, composition, colors, typography vibe, and key objects/symbols.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Style</label>
                    <select
                      value={coverStyle}
                      onChange={(e) => setCoverStyle(e.target.value as any)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="illustration">Illustration</option>
                      <option value="photo">Photorealistic</option>
                      <option value="graphic">Bold Graphic</option>
                      <option value="watercolor">Watercolor</option>
                      <option value="minimal">Minimal / Typographic</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aspect</label>
                    <select
                      value={coverSize}
                      onChange={(e) => setCoverSize(e.target.value as any)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="portrait">Portrait (1024×1536)</option>
                      <option value="square">Square (1024×1024)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Seed (optional)</label>
                    <input
                      value={coverSeed}
                      onChange={(e) => setCoverSeed(e.target.value)}
                      placeholder="e.g., 12345"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">Use a number to get a consistent style between rerolls.</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCoverModal(false);
                    setCoverError('');
                  }}
                  className="px-4 py-2 rounded-lg border hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={generateCover}
                  disabled={coverIsGenerating || !(bookTitle || book.title).trim() || !coverStreamPrompt}
                  className="px-4 py-2 rounded-lg font-semibold bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {coverIsGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating…
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4" /> Generate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type PlanTier = 'free' | 'pro' | 'premium';

interface ChapterSummary {
  id?: string;
  user_id: string;
  book_id: string;
  chapter_number: number;
  summary: string;
  created_at?: string;
  updated_at?: string;
}

interface BookEditorProps {
  book: UserBook;
  user: User;
  onBack: () => void;
}

interface EditableChapter extends Chapter {
  id: string;
  isEditing: boolean;
  hasChanges: boolean;
}

export default BookEditor;
