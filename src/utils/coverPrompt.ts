// src/utils/coverPrompt.ts

export type CoverStyle = 'illustration' | 'photo' | 'graphic' | 'watercolor' | 'minimal';
export type CoverAspect = 'portrait' | 'square';

export interface BuildCoverPromptArgs {
  bookTitle: string;
  description?: string;
  genre?: string;
  subgenre?: string;
  style?: CoverStyle;
  aspect?: CoverAspect;
  /** Falls du noch eigene Stichworte ergänzen willst (optional) */
  extraHints?: string[];
}

/** Kürzt einen String sicher auf N Zeichen */
function safeTrim(input: string | undefined | null, max = 400): string {
  const s = (input ?? '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Baut einen robusten Prompt für Bild-Modelle, damit KEIN Text auf dem Cover landet.
 * Ergebnis ist bewusst allgemein formuliert (Model-agnostisch).
 */
export function buildCoverPrompt(args: BuildCoverPromptArgs): string {
  const {
    bookTitle,
    description,
    genre,
    subgenre,
    style = 'illustration',
    aspect = 'portrait',
    extraHints = [],
  } = args;

  const moodBase =
    'cinematic, professional composition, strong focal subject, dramatic lighting, depth of field, high contrast';

  const styleCue =
    style === 'photo'
      ? 'photorealistic style, detailed textures'
      : style === 'graphic'
      ? 'bold graphic shapes, poster-like'
      : style === 'watercolor'
      ? 'soft watercolor wash, painterly edges'
      : style === 'minimal'
      ? 'minimalist layout, clean shapes'
      : 'high-quality illustration';

  const ar =
    aspect === 'square'
      ? 'square format (1:1, 1024×1024)'
      : 'portrait format (2:3, ~1024×1536)';

  const theme = safeTrim(description, 400);
  const g = (genre || '').trim();
  const sg = (subgenre || '').trim();

  const lines: string[] = [
    // WICHTIG: kein Text auf dem Bild
    'Book cover artwork without any text, titles, letters, logos, or watermarks.',
    styleCue + ', ' + moodBase + '.',
    g ? `Genre: ${g}.` : '',
    sg ? `Subgenre: ${sg}.` : '',
    `Design for a story tentatively titled "${(bookTitle || 'Untitled').trim()}". Do NOT render this title on the image.`,
    theme ? `Thematic cues: ${theme}` : '',
    `Framing: ${ar}.`,
    'Avoid borders, UI chrome, or visible typography.',
  ];

  if (extraHints.length) {
    lines.push(`Extra hints: ${extraHints.join(', ')}.`);
  }

  // Leerzeilen entfernen & zusammenbauen
  return lines.filter(Boolean).join(' ');
}

/** Kleiner Helfer, falls du nur Titel+Beschreibung hast */
export function buildSimpleCoverPrompt(bookTitle: string, description?: string): string {
  return buildCoverPrompt({ bookTitle, description });
}
