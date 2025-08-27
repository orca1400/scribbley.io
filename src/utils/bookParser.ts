// src/utils/bookParser.ts

export interface Chapter {
  title: string;
  content: string;
  teaser: string;
}

export interface Book {
  title: string;
  chapters: Chapter[];
}

type ParseOptions = {
  /** If true, returns only the first chapter (for previews). Default: false */
  previewMode?: boolean;
  /** Maximum chapters to return (ignored if previewMode). Default: 8 */
  maxChapters?: number;
  /** Minimum content length (in chars) a chunk must have to count as a chapter. Default: 120 */
  minChapterChars?: number;
  /** Enable heading-based splitting like "1. Title", "I. Title", "# 2. Title". Default: true */
  enableHeadingDetection?: boolean;
};

export function parseBookIntoChapters(
  bookContent: string,
  shouldLimit: boolean = false, // backward compat with existing calls
  opts?: ParseOptions
): Book {
  const previewMode = opts?.previewMode ?? shouldLimit ?? false;
  const maxChapters = previewMode ? 1 : Math.max(1, opts?.maxChapters ?? 8);
  const minChapterChars = Math.max(50, opts?.minChapterChars ?? 120);
  const enableHeadingDetection = opts?.enableHeadingDetection ?? true;

  const content = normalizeContent(bookContent);
  const lines = content.split('\n');

  // 1) Detect title in first few lines (unless it's already a chapter/heading)
  let bookTitle = 'Generated Book';
  let startIdx = 0;
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const line = stripInlineNoise(lines[i]);
    if (!line) continue;
    if (isChapterHeader(line) || (enableHeadingDetection && isHeadingHeader(line))) break;
    if (line.length >= 6 && line.length <= 120) {
      const noByline = line.replace(/\bby\s+.+$/i, '').trim();
      bookTitle = trimHash(noByline);
      startIdx = i + 1;
      break;
    }
  }

  const body = lines.slice(startIdx).join('\n').trim();

  // 2) Extract chapters (chapter headers + optional heading headers)
  const chapters = extractChapters(body, { minChapterChars, enableHeadingDetection });

  if (chapters.length > 0) {
    return {
      title: bookTitle,
      chapters: chapters.slice(0, maxChapters),
    };
  }

  // 3) Fallback: paragraph grouping
  const grouped = fallbackParagraphChapters(body, minChapterChars);
  return {
    title: bookTitle,
    chapters: grouped.slice(0, maxChapters),
  };
}

/* ------------------------------ helpers ------------------------------ */

function normalizeContent(s: string): string {
  if (!s) return '';
  let t = s
    .replace(/\r\n?/g, '\n')
    .replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
    .replace(/```[\s\S]*?```/g, (m) => stripCodeFence(m))
    .replace(/\u00A0/g, ' ');

  // --- NEW: Kapitel vorab auf eine eigene Zeile ziehen ---
  // a) Nach Satzende im gleichen Absatz: “….” Chapter 3: …
  t = t.replace(
    /([.!?]["’”\)\]]?\s+)(?=(?:Chapter|Kapitel)\s+(?:\d+|[IVXLCDM]+)\s*[:.\-–—]?)/g,
    (_m, p1: string) => p1.replace(/\s+$/, '') + '\n'
  );
  // b) Buchtitel + "Chapter 1" direkt hintereinander am Dokumentanfang
  t = t.replace(
    /^(.{1,140}?)(\s+)(?=(?:Chapter|Kapitel)\s+(?:\d+|[IVXLCDM]+)\s*[:.\-–—]?)/i,
    (_m, p1: string) => p1.trimEnd() + '\n'
  );

  // strip markdown emphasis noise
  t = t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1');

  // collapse many blanks
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

function stripCodeFence(block: string): string {
  return block.replace(/^```(?:[^\n]*)?\n?/, '').replace(/```$/, '');
}

function trimHash(s: string): string {
  return s.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '').trim();
}

function stripInlineNoise(s: string): string {
  return trimHash(s.replace(/[^\S\r\n]+/g, ' ').trim());
}

/* -------------------------- header detection (fixed) -------------------------- */

/** Localized "Chapter" keywords (keep actual chapter words here) */
const CHAPTER_KEYWORDS =
  '(?:Chapter|CHAPTER|Kapitel|Chapitre|Cap(?:i|í)tulo|Capitulo|Capitolo|Capítulo)';

/** Non-capturing numeric variants */
const ROMAN = '(?=[MDCLXVI])M{0,4}(?:CM)?D?C{0,3}(?:XC)?L?X{0,3}(?:IX)?V?I{0,3}';
const WORDNUM = '(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)';
const DIGITNUM = '\\d{1,3}';
const ANY_NUMBER = `(?:${DIGITNUM}|${ROMAN}|${WORDNUM})`;

/** Separators between number and title */
const TITLE_SEP = '(?::|\\.|—|–|-|\\)|\\])';

/** Optional markdown hashes at line start */
const HEADER_PREFIX = '\\s{0,3}#{0,3}\\s*';

/** A) Classic: "Chapter X: Title" or "Kapitel IV — Title"
 *    NOTE: Only one capture group: the trailing title
 *    FIX: require start-of-line ^ so wir matchen nur echte Überschriften.
 */
const CHAPTER_HEADER_RE = new RegExp(
  `^${HEADER_PREFIX}(?:${CHAPTER_KEYWORDS})\\s+${ANY_NUMBER}(?:\\s*${TITLE_SEP}\\s*(.+))?$`,
  'i'
);

/** B) Heading-based chapters:
 *    "1. Title", "12) Title", "I. Title", "Part IV — Title", "Teil 3 - Title"
 *    Only one capture group: the trailing title
 *    FIX: ebenfalls ^ verankern.
 */
const NUMBERED_HEADING_RE = new RegExp(
  `^${HEADER_PREFIX}(?:(?:Part|Teil|Parte)\\s+${ANY_NUMBER}|${ANY_NUMBER})(?:\\s*${TITLE_SEP}\\s*(.+))?$`,
  'i'
);

function isChapterHeader(line: string): boolean {
  return CHAPTER_HEADER_RE.test(stripInlineNoise(line));
}

function isHeadingHeader(line: string): boolean {
  const clean = stripInlineNoise(line);
  if (clean.length > 160) return false; // heuristik gegen false positives
  return NUMBERED_HEADING_RE.test(clean);
}

/* --------------------------- chapter extraction --------------------------- */

function extractChapters(
  content: string,
  opts: { minChapterChars: number; enableHeadingDetection: boolean }
): Chapter[] {
  const lines = content.split('\n');
  const indices: number[] = [];

  // collect indices of all header lines (jetzt nur noch echte Zeilen-Header)
  for (let i = 0; i < lines.length; i++) {
    const line = stripInlineNoise(lines[i]);
    if (!line) continue;
    if (isChapterHeader(line) || (opts.enableHeadingDetection && isHeadingHeader(line))) {
      indices.push(i);
    }
  }

  if (indices.length === 0) return [];

  const chapters: Chapter[] = [];
  for (let idx = 0; idx < indices.length; idx++) {
    const start = indices[idx];
    const end = idx + 1 < indices.length ? indices[idx + 1] : lines.length;

    const header = stripInlineNoise(lines[start]);
    const bodyLines = lines.slice(start + 1, end);
    while (bodyLines.length && !stripInlineNoise(bodyLines[0])) bodyLines.shift();

    let contentBlock = bodyLines.join('\n').trim();

    // Title from header (works for both chapter & heading)
    let title = deriveTitleFromHeader(header, idx);
    if (!title) title = `Chapter ${idx + 1}`;

    // If body is too short, include header as part of content to avoid empty chapters
    if (contentBlock.length < opts.minChapterChars) {
      contentBlock = [header, contentBlock].filter(Boolean).join('\n').trim();
    }

    if (contentBlock.length >= opts.minChapterChars) {
      chapters.push({
        title,
        content: contentBlock,
        teaser: createTeaser(contentBlock),
      });
    }
  }

  return chapters;
}

function deriveTitleFromHeader(headerLine: string, indexZeroBased: number): string | null {
  // Try classic chapter first
  const m1 = CHAPTER_HEADER_RE.exec(headerLine);
  if (m1) {
    const trailing = (m1[1] || '').toString().trim();
    if (trailing) return trailing.replace(/[#*]+/g, '').trim();
    return `Chapter ${indexZeroBased + 1}`;
  }

  // Then numbered/roman heading
  const m2 = NUMBERED_HEADING_RE.exec(headerLine);
  if (m2) {
    const trailing = (m2[1] || '').toString().trim(); // capture group for title after separator
    if (trailing) return trailing.replace(/[#*]+/g, '').trim();

    // If there was no trailing title, synthesize one
    const numOrRoman = headerLine
      .replace(/^\s{0,3}#{0,3}\s*/, '')
      .match(new RegExp(`^(${DIGITNUM}|${ROMAN})`, 'i'))?.[1];
    if (numOrRoman) return `Chapter ${normalizeRomanOrDigit(numOrRoman, indexZeroBased + 1)}`;
    return `Chapter ${indexZeroBased + 1}`;
  }

  return null;
}

function normalizeRomanOrDigit(token: string, fallback: number): string {
  if (!token) return String(fallback);
  const asInt = parseInt(token, 10);
  if (!Number.isNaN(asInt)) return String(asInt);
  // roman → leave as-is (e.g., "IV")
  return token.toUpperCase();
}

/* ----------------------- fallback paragraph grouping ----------------------- */

function fallbackParagraphChapters(content: string, minChapterChars: number): Chapter[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= Math.max(50, Math.floor(minChapterChars * 0.8)));

  if (paragraphs.length === 0) {
    const trimmed = content.trim();
    return [{ title: 'Chapter 1', content: trimmed, teaser: createTeaser(trimmed) }];
  }

  const groups = Math.min(6, Math.max(1, Math.ceil(paragraphs.length / 6)));
  const size = Math.max(1, Math.ceil(paragraphs.length / groups));

  const chapters: Chapter[] = [];
  for (let i = 0; i < paragraphs.length; i += size) {
    const chunk = paragraphs.slice(i, i + size).join('\n\n').trim();
    if (chunk.length < minChapterChars) continue;
    chapters.push({
      title: `Chapter ${Math.floor(i / size) + 1}`,
      content: chunk,
      teaser: createTeaser(chunk),
    });
  }

  if (chapters.length === 0) {
    const trimmed = content.trim();
    return [{ title: 'Chapter 1', content: trimmed, teaser: createTeaser(trimmed) }];
  }
  return chapters;
}

/* ------------------------------- teaser ------------------------------- */

function createTeaser(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);

  let teaser = '';
  for (let i = 0; i < parts.length; i++) {
    const next = parts[i];
    if ((teaser + (teaser ? ' ' : '') + next).length > 240 || i >= 3) break;
    teaser += (teaser ? ' ' : '') + next;
  }

  if (!teaser) return text.slice(0, 200).trim() + (text.length > 200 ? '…' : '');
  if (!/[.!?…]$/.test(teaser)) teaser += '…';
  return teaser;
}
