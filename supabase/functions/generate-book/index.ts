// functions/generate-book/index.ts
// Supabase Edge Function: generate-book
// - CORS (incl. apikey & x-client-info), OPTIONS preflight
// - JWT verify (gateway) + optional user-id assertion
// - AI consent enforcement (user_profiles.ai_processing_consent)
// - Description clamp + optional beats
// - TWO MODES:
//     mode: "chapter"  -> generate ONE full-length chapter (recommended)
//     mode: "book"     -> legacy all-in-one 5-chapter generation (kept as-is)
// - OpenAI call with timeout (stay under edge limit)
// - Usage event recording (best-effort)
// - Stable response shapes
// - INLINE COVER GENERATION (Fix B): optional include_cover returns cover in same response
// - Fire-and-forget cover queue kept for authenticated users

import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Json =
  | Record<string, unknown>
  | Array<unknown>
  | string
  | number
  | boolean
  | null;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-session-id",
  Vary: "Origin",
};

// --- Config / Constants ---
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const MAX_DESC_CHARS = 4000;
const MAX_DESC_WORDS = 500;
const OA_TIMEOUT_MS = 120_000; // keep below edge hard limit
const OUTPUT_TOKENS_CAP = Number(Deno.env.get("MAX_OUTPUT_TOKENS") ?? 12_000);

// --- Supabase admin client (service role) ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- Where to call generate-cover (Edge Function) ---
const COVER_FUNCTION_URL =
  Deno.env.get("COVER_FUNCTION_URL") ??
  `${SUPABASE_URL}/functions/v1/generate-cover`;

function json(body: Json, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
  });
}

function composeDescription(
  base: string,
  beatsActive?: boolean,
  beats?: string[],
) {
  const cleanBase = (base || "").trim();
  if (!beatsActive || !beats?.length) return cleanBase;
  const list = beats.map((s) => (s || "").trim()).filter(Boolean);
  if (!list.length) return cleanBase;
  const bullets = list.map((s) => `- ${s}`).join("\n");
  return `[USER BRIEF]\n${cleanBase}\n\n[BEATS]\n${bullets}`;
}

function trimAndClampDescription(s: string) {
  const desc = (s ?? "").toString().trim().replace(/\s+/g, " ");
  const byChars = desc.slice(0, MAX_DESC_CHARS);
  const words = byChars.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_DESC_WORDS) return byChars;
  return words.slice(0, MAX_DESC_WORDS).join(" ");
}

async function verifyUserWithJwt(
  bearerJwt: string | null,
  claimedUserId: string | null,
): Promise<{ userId: string | null; valid: boolean }> {
  if (!claimedUserId) return { userId: null, valid: true }; // anonymous allowed (no assertion)
  if (!bearerJwt) return { userId: null, valid: false };
  try {
    const { data, error } = await supabase.auth.getUser(bearerJwt);
    if (error) return { userId: null, valid: false };
    const realUserId = data.user?.id ?? null;
    return {
      userId: realUserId,
      valid: realUserId === claimedUserId || claimedUserId === DEMO_USER_ID,
    };
  } catch {
    return { userId: null, valid: false };
  }
}

async function checkAIConsent(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("ai_processing_consent")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Error checking AI consent:", error);
      return false;
    }
    return data?.ai_processing_consent === true;
  } catch (err) {
    console.error("Error in checkAIConsent:", err);
    return false;
  }
}

async function recordBookUsage(
  sessionId: string,
  userId: string | null,
  words: number,
  tokens: number,
  feature = "book_generate",
): Promise<void> {
  try {
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError) {
      console.error("Error fetching session:", sessionError);
      throw sessionError;
    }

    // Determine billability (guest one-time freebie)
    let billable = true;
    let reason = "regular";
    if (session?.is_guest && !session?.has_consumed_guest_freebie) {
      billable = false;
      reason = "guest_free_book";
      const { error: updErr } = await supabase
        .from("sessions")
        .update({ has_consumed_guest_freebie: true })
        .eq("id", sessionId);
      if (updErr) console.error("Error updating guest freebie:", updErr);
    }

    const { error: usageError } = await supabase.from("usage_events").insert({
      user_id: userId || session?.user_id || null,
      session_id: sessionId,
      feature,
      words,
      tokens,
      billable,
      reason,
    });

    if (usageError) console.error("Error recording usage:", usageError);
  } catch (error) {
    console.error("Error in recordBookUsage:", error);
  }
}

function buildPrompts(genre: string, subgenre: string, description: string) {
  const sharedRules = `
- Start with the book title on the first line (plain text, no quotes). Then a blank line, then the chapters.
- Exactly 5 chapters. Each chapter must be substantial (500-800 words).
- Each chapter begins with: "Chapter X: [Chapter Title]" on its own line, then the content on subsequent lines.
- Use no other headings or markdown at all (no #, ##, bold, italics, underlines).
- Dialogue or rhetorical lines must appear inside paragraphs, never as headings.
- Do not output a Prologue or Epilogue unless counted as Chapter 1 or Chapter 5.
- If the description contains a [BEATS] section, weave those beats naturally into the chapters; do not reproduce the [BEATS] list verbatim.`;

  if (genre === "fiction") {
    const systemPrompt =
      `You are a professional fiction writer specializing in ${subgenre}. ` +
      `Write engaging, well-structured stories with rich description, compelling characters, and natural dialogue. ` +
      `Maintain a consistent voice and escalate tension across chapters.`;

    const userPrompt = `Write a complete fiction book in the ${subgenre} genre based on the following description. Obey all formatting and length requirements.

DESCRIPTION (may include [BEATS] to integrate, not to copy):
${description}

Structure and constraints:
${sharedRules}

Format contract:
[Book Title]

Chapter 1: [Chapter 1 Title]
[Chapter 1 content, 500-800 words]

Chapter 2: [Chapter 2 Title]
[Chapter 2 content, 500-800 words]

Chapter 3: [Chapter 3 Title]
[Chapter 3 content, 500-800 words]

Chapter 4: [Chapter 4 Title]
[Chapter 4 content, 500-800 words]

Chapter 5: [Chapter 5 Title]
[Chapter 5 content, conclude the story, 500-800 words]`;

    return { systemPrompt, userPrompt };
  }

  const systemPrompt =
    `You are a professional non-fiction author and educator specializing in ${subgenre}. ` +
    `Write accurate, well-researched content with clear structure, examples, and practical insights.`;

  const userPrompt = `Write a complete informative and educational non-fiction book about ${subgenre} based on the following description. Obey all formatting and length requirements.

DESCRIPTION (may include [BEATS] to integrate, not to copy):
${description}

Structure and constraints:
${sharedRules}
- Use clear explanations, illustrative examples, and practical takeaways.
- Build logically from chapter to chapter.

Format contract:
[Book Title]

Chapter 1: [Chapter 1 Title]
[Chapter 1 educational content, 500-800 words]

Chapter 2: [Chapter 2 Title]
[Chapter 2 educational content, 500-800 words]

Chapter 3: [Chapter 3 Title]
[Chapter 3 educational content, 500-800 words]

Chapter 4: [Chapter 4 Title]
[Chapter 4 educational content, 500-800 words]

Chapter 5: [Chapter 5 Title]
[Chapter 5 educational content, 500-800 words]`;

  return { systemPrompt, userPrompt };
}

function buildChapterPrompts(
  genre: string,
  subgenre: string,
  description: string,
  chapterIndex: number,
  chapterCount: number,
  minWords: number,
  maxWords: number,
  outline?: string | null,
  forcedTitle?: string | null,
) {
  const systemPrompt =
    `You are a professional ${genre} author (${subgenre}). ` +
    `Write polished, long-form chapters with consistent voice and continuity. ` +
    `No markdown headings other than the required "Chapter X: Title" line.`;

  const titleRule = forcedTitle
    ? `Use this exact title: "${forcedTitle}".`
    : `Invent a concise, evocative title.`;

  const contextBlock = outline
    ? `OUTLINE (for continuity)
${outline}

`
    : "";

  const userPrompt = `${contextBlock}BOOK DESCRIPTION
${description}

TASK
Write Chapter ${chapterIndex} of ${chapterCount}.

Length: ${minWords}–${maxWords} words.

Rules:
- The FIRST line must be exactly: "Chapter ${chapterIndex}: ${forcedTitle ?? "[Title]"}"
- ${titleRule}
- Then prose paragraphs only (no other headings/markdown).
- Natural dialogue; show, don't tell.
- Maintain continuity with prior outline/description.
- Build toward the overall arc; avoid premature resolution.`;

  return { systemPrompt, userPrompt };
}

// --- Fire-and-forget cover queue (authenticated users only) ---
async function queueCoverGeneration(opts: {
  sessionId: string;
  userId: string | null;
  description: string;
  genre: string;
  subgenre: string;
  aiConsent: boolean;
  aiConsentVersion: string | null;
}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000); // don't block book generation
    await fetch(COVER_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Service-side auth to internal edge function:
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        // Pass through session & meta for server-side persistence
        "x-session-id": opts.sessionId,
        "x-user-id": opts.userId ?? "",
        "x-ai-consent": String(!!opts.aiConsent),
        "x-ai-consent-version": opts.aiConsentVersion ?? "",
      },
      body: JSON.stringify({
        description: opts.description,
        prompt: opts.description, // compatibility
        genre: opts.genre,
        subgenre: opts.subgenre,
        source: "generate-book",
        session_id: opts.sessionId,
        user_id: opts.userId, // nullable for guests
      }),
      signal: ctrl.signal,
    }).catch((e) => {
      console.error("generate-cover fetch failed:", e?.message ?? e);
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    console.error("queueCoverGeneration error:", err);
  }
}

// --- INLINE cover generation (Fix B) ---
async function generateCoverInline(opts: {
  sessionId: string;
  userId: string | null;
  bookId?: string | null;
  bookTitle?: string | null;
  description: string;
  genre: string;
  subgenre: string;
  aiConsent: boolean;
  aiConsentVersion: string | null;
}): Promise<{ cover_url?: string; cover_path?: string; cover_image_base64?: string; attempt?: number } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);

    const isAuthenticated = !!opts.userId && !!opts.bookId; // only store if we have both
    const res = await fetch(COVER_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Internal service role auth (never exposed to browser)
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "x-session-id": opts.sessionId,
        "x-user-id": opts.userId ?? "",
        "x-ai-consent": String(!!opts.aiConsent),
        "x-ai-consent-version": opts.aiConsentVersion ?? "",
      },
      body: JSON.stringify({
        bookId: opts.bookId ?? null,
        bookTitle: opts.bookTitle ?? null,
        description: opts.description,
        prompt: opts.description, // compatibility
        genre: opts.genre,
        subgenre: opts.subgenre,
        isAuthenticated,
        inline: true, // hint to return data immediately
        source: "generate-book-inline",
        session_id: opts.sessionId,
        user_id: opts.userId,
      }),
      signal: ctrl.signal,
    });

    clearTimeout(timer);

    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};

    if (!res.ok) {
      console.error("Inline cover error:", res.status, payload?.error || text);
      return null;
    }

    if (payload?.imageBase64) {
      return { cover_image_base64: payload.imageBase64, attempt: payload.attempt ?? 1 };
    }
    if (payload?.url || payload?.path) {
      return { cover_url: payload.url, cover_path: payload.path, attempt: payload.attempt ?? 1 };
    }
    return null;
  } catch (e) {
    console.error("generateCoverInline failed:", e);
    return null;
  }
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Headers
    const authHeader = req.headers.get("Authorization");
    const bearerJwt = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    const rawSessionId = req.headers.get("x-session-id");
    const sessionId = rawSessionId ?? crypto.randomUUID();

    const claimedUserId = req.headers.get("x-user-id");
    const aiConsentHeader = (req.headers.get("x-ai-consent") || "false")
      .toLowerCase();
    const aiConsentVersion = req.headers.get("x-ai-consent-version") || null;
    const aiConsent = aiConsentHeader === "true";

    // Verify claimed user with JWT when present
    const { valid: jwtOk, userId: verifiedUserId } = await verifyUserWithJwt(
      bearerJwt,
      claimedUserId,
    );
    if (!jwtOk) {
      return json({ error: "Invalid or missing authentication." }, 401);
    }

    // Upsert session
    const upsertPayload: Record<string, unknown> = {
      id: sessionId,
      user_id: claimedUserId ?? null,
      is_guest: !claimedUserId,
    };
    if (aiConsent) {
      upsertPayload["ai_processing_consent"] = true;
      upsertPayload["ai_consent_at"] = new Date().toISOString();
      upsertPayload["ai_consent_version"] = aiConsentVersion;
    } else if (!claimedUserId) {
      upsertPayload["ai_processing_consent"] = false;
    }

    const { error: upsertErr } = await supabase
      .from("sessions")
      .upsert(upsertPayload, { onConflict: "id" });
    if (upsertErr) {
      console.error("Session upsert error:", upsertErr);
    }

    // Enforce consent for authenticated users (real accounts, not demo)
    const effectiveUserId = claimedUserId ?? verifiedUserId;
    if (effectiveUserId && effectiveUserId !== DEMO_USER_ID) {
      const hasConsent = await checkAIConsent(effectiveUserId);
      if (!hasConsent) {
        return json(
          {
            error:
              "AI processing consent required. Please update your consent in account settings.",
          },
          403,
        );
      }
    }

    // Parse & validate body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    let {
      mode = "book", // "book" (legacy) | "chapter" (recommended)
      genre,
      subgenre,
      description,
      isAuthenticated = false, // tolerated
      beatsActive,
      beats,

      // chapter-mode specific
      chapter_index,
      chapter_count,
      chapter_words_min,
      chapter_words_max,
      outline,
      chapter_title,

      // COVER (Fix B)
      include_cover,
      book_id,
      book_title,
    } = body;

    mode = (mode ?? "book").toString().toLowerCase();

    genre = (genre ?? "").toString().trim().toLowerCase();
    if (genre !== "fiction" && genre !== "non-fiction") {
      return json({ error: "Invalid genre" }, 400);
    }

    subgenre = (subgenre ?? "").toString().trim();
    if (!subgenre || subgenre.length > 100) {
      return json({ error: "Invalid subgenre" }, 400);
    }

    // Combine beats BEFORE clamping so they count toward same budget
    const combined = composeDescription(description ?? "", beatsActive, beats);
    description = trimAndClampDescription(combined);
    if (!description || description.split(/\s+/).filter(Boolean).length < 20) {
      return json({ error: "Description too short" }, 400);
    }

    // OpenAI key (shared)
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey || openaiApiKey.length < 10) {
      console.error("OPENAI_API_KEY missing/invalid");
      return json({ error: "OpenAI API key not configured" }, 500);
    }

    // Kick off cover generation only for authenticated users.
    // Guests: inline cover below handles it (no double-consumption of freebie).
    if (effectiveUserId) {
      queueCoverGeneration({
        sessionId,
        userId: effectiveUserId,
        description,
        genre,
        subgenre,
        aiConsent,
        aiConsentVersion,
      });
    }

    // -------------------- CHAPTER MODE --------------------
    if (mode === "chapter") {
      const idx = Number(chapter_index);
      const count = Number(chapter_count);
      const wmin = Math.max(600, Number(chapter_words_min ?? 1200));
      const wmax = Math.min(3000, Number(chapter_words_max ?? 1600));

      if (!Number.isInteger(idx) || idx < 1) {
        return json({ error: "chapter_index must be >= 1" }, 400);
      }
      if (!Number.isInteger(count) || count < idx || count > 50) {
        return json({ error: "chapter_count invalid" }, 400);
      }
      if (wmin > wmax) {
        return json(
          { error: "chapter_words_min must be <= chapter_words_max" },
          400,
        );
      }

      const { systemPrompt, userPrompt } = buildChapterPrompts(
        genre,
        subgenre,
        description,
        idx,
        count,
        wmin,
        wmax,
        outline,
        chapter_title,
      );

      // Reasonable cap: ~1.6 tokens per word + headroom
      const chapterTokenCap = Math.round(Math.max(wmax * 1.6, 1200));
      const maxTokens = Math.min(chapterTokenCap, OUTPUT_TOKENS_CAP);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OA_TIMEOUT_MS);

      let oaRes: Response;
      try {
        oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: maxTokens,
            temperature: 0.8,
          }),
          signal: ctrl.signal,
        });
      } catch (err: any) {
        clearTimeout(timer);
        console.error("Failed to fetch from OpenAI API:", err);
        if (err?.name === "AbortError") {
          return json({ error: "OpenAI request timed out" }, 500);
        }
        return json({ error: "Failed to connect to OpenAI API" }, 500);
      } finally {
        clearTimeout(timer);
      }

      if (!oaRes.ok) {
        const errText = await oaRes.text().catch(() => "Unknown error");
        console.error("OpenAI API error (chapter):", {
          status: oaRes.status,
          body: errText,
        });
        if (oaRes.status === 401)
          return json({ error: "Invalid OpenAI API key" }, 500);
        if (oaRes.status === 429)
          return json({ error: "OpenAI rate limit exceeded" }, 500);
        return json({ error: "Failed to generate chapter content" }, 500);
      }

      const chapterJson = await oaRes.json();
      const chapterContent: string | undefined =
        chapterJson?.choices?.[0]?.message?.content;
      if (!chapterContent) return json({ error: "No content generated" }, 500);

      // Parse title
      const firstLine = chapterContent.split("\n")[0]?.trim() ?? "";
      const m = firstLine.match(/^Chapter\s+(\d+)\s*:\s*(.+)$/i);
      const parsedTitle = m ? m[2].trim() : null;
      const resolvedTitle = chapter_title || parsedTitle || `Chapter ${idx}`;

      // Rough usage calc
      const wordCount = chapterContent
        .split(/\s+/)
        .filter((w: string) => w.length > 0).length;
      const estimatedTokens = Math.ceil(wordCount * 1.3);

      // Record usage (best-effort)
      const featureName =
        genre === "fiction"
          ? "book_generate_fiction_chapter"
          : "book_generate_nonfiction_chapter";
      recordBookUsage(
        sessionId,
        effectiveUserId ?? null,
        wordCount,
        estimatedTokens,
        featureName,
      ).catch((e) => console.error("recordBookUsage failed:", e));

      // Optional inline cover only for chapter 1
      let coverInline: any = null;
      if (include_cover && idx === 1) {
        const defaultBookTitle =
          book_title ??
          (genre === "fiction" ? "Fiction Book" : "Non-Fiction Book");
        coverInline = await generateCoverInline({
          sessionId,
          userId: effectiveUserId ?? null,
          bookId: book_id ?? null,
          bookTitle: defaultBookTitle,
          description,
          genre,
          subgenre,
          aiConsent,
          aiConsentVersion,
        });
      }

      const resp: any = {
        chapter_index: idx,
        title: resolvedTitle,
        content: chapterContent,
        meta: {
          chapterCount: count,
          minWordsPerChapter: wmin,
          maxWordsPerChapter: wmax,
          estimatedTokens,
        },
      };

      if (coverInline) {
        resp.cover_url = coverInline.cover_url;
        resp.cover_path = coverInline.cover_path;
        resp.cover_image_base64 = coverInline.cover_image_base64;
        resp.attempt = coverInline.attempt ?? 1;
          // no "cover: {queued}" when inline present
      } else if (effectiveUserId) {
        // only say "queued" when we actually queued for authed users
        resp.cover = { queued: true };
      }
      // guests + no inline: omit cover field entirely

      return json(resp, 200, { "x-session-id": sessionId });
    }
    // ------------------ END CHAPTER MODE -------------------

    // -------------------- BOOK MODE (legacy, 5-chapter clamp) --------------------
    const requestedChapters = body?.chapters;
    const effectiveChapters = 5; // legacy clamp kept as-is
    if (requestedChapters && requestedChapters !== 5) {
      // optional: hint header could be added here
    }

    const { systemPrompt, userPrompt } = buildPrompts(
      genre,
      subgenre,
      description,
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OA_TIMEOUT_MS);

    let oaRes: Response;
    try {
      oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: OUTPUT_TOKENS_CAP,
          temperature: 0.8,
        }),
        signal: ctrl.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      console.error("Failed to fetch from OpenAI API:", err);
      if (err?.name === "AbortError") {
        return json({ error: "OpenAI request timed out" }, 500);
      }
      return json({ error: "Failed to connect to OpenAI API" }, 500);
    } finally {
      clearTimeout(timer);
    }

    if (!oaRes.ok) {
      const errText = await oaRes.text().catch(() => "Unknown error");
      console.error("OpenAI API error:", {
        status: oaRes.status,
        statusText: oaRes.statusText,
        body: errText,
      });
      if (oaRes.status === 401)
        return json({ error: "Invalid OpenAI API key" }, 500);
      if (oaRes.status === 429)
        return json({ error: "OpenAI rate limit exceeded" }, 500);
      return json({ error: "Failed to generate book content" }, 500);
    }

    const data = await oaRes.json();
    const bookContent: string | undefined = data?.choices?.[0]?.message?.content;
    if (!bookContent) {
      return json({ error: "No content generated" }, 500);
    }

    // Rough usage calc
    const wordCount = bookContent
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;
    const estimatedTokens = Math.ceil(wordCount * 1.3);

    // Record usage (best-effort, async)
    const featureName =
      genre === "fiction"
        ? "book_generate_fiction"
        : "book_generate_nonfiction";
    recordBookUsage(
      sessionId,
      effectiveUserId ?? null,
      wordCount,
      estimatedTokens,
      featureName,
    ).catch((e) => console.error("recordBookUsage failed:", e));

    // Optional inline cover (Fix B)
    let coverInline: any = null;
    if (include_cover) {
      const defaultBookTitle =
        book_title ??
        (genre === "fiction" ? "Fiction Book" : "Non-Fiction Book");
      coverInline = await generateCoverInline({
        sessionId,
        userId: effectiveUserId ?? null,
        bookId: book_id ?? null,           // typically null for guests
        bookTitle: defaultBookTitle,
        description,
        genre,
        subgenre,
        aiConsent,
        aiConsentVersion,
      });
    }

    // Build response
    const resp: any = {
      book: bookContent,
      content: bookContent,
      meta: {
        chapters: effectiveChapters,
        minWordsPerChapter: 500,
        maxWordsPerChapter: 800,
      },
    };

    if (coverInline) {
      resp.cover_url = coverInline.cover_url;
      resp.cover_path = coverInline.cover_path;
      resp.cover_image_base64 = coverInline.cover_image_base64;
      resp.attempt = coverInline.attempt ?? 1;
    } else if (effectiveUserId) {
      // only say "queued" when we actually queued for authed users
      resp.cover = { queued: true };
    }
    // guests + no inline: omit cover field entirely

    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "x-session-id": sessionId,
      },
    });
    // ------------------ END BOOK MODE --------------------
  } catch (error: any) {
    console.error("Unhandled error:", error);
    const isAbort = error?.name === "AbortError";
    return json(
      { error: isAbort ? "OpenAI request timed out" : "Internal server error" },
      500,
    );
  }
});
