// functions/generate-chapter/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/* -------------------- CORS -------------------- */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
  "Access-Control-Expose-Headers":
    "x-session-id, x-plan-max-chapters, x-effective-total-chapters, x-applied-chapter-length, x-max-output-tokens",
};

/* -------------------- Types -------------------- */
type PlanTier = "free" | "pro" | "premium";
type ChapterLength = "short" | "medium" | "long" | "xlong";

interface ChapterRequest {
  bookTitle?: string;
  existingChapters: Array<{ title: string; content: string }>;
  chapterSummaries?: Array<{ chapterNumber: number; summary: string }>;
  prompt: string;
  originalDescription?: string;
  genre: string;
  subgenre: string;
  currentChapter?: number;
  totalChapters?: number;
  chapterLength?: ChapterLength;
  minWords?: number;
  maxWords?: number;
}

/* -------------------- Supabase -------------------- */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/* -------------------- Constants & plan caps -------------------- */
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const OA_TIMEOUT_MS = 180_000; // more headroom for expansion/tighten passes
const MAX_PROMPT_CHARS = 4000;
const MAX_PROMPT_WORDS = 500;

// Allow a higher single-pass output if the model/account supports it
const OUTPUT_TOKENS_CAP = Number(Deno.env.get("MAX_OUTPUT_TOKENS") ?? 12_000);
console.log("[generate-chapter] MAX_OUTPUT_TOKENS =", OUTPUT_TOKENS_CAP);

const PLAN_ALLOWED_LENGTHS: Record<PlanTier, ChapterLength[]> = {
  premium: ["short", "medium", "long", "xlong"],
  pro: ["short", "medium", "long"],
  free: ["short"],
};

const PLAN_MAX_CHAPTERS: Record<PlanTier, number> = {
  premium: 100,
  pro: 50,
  free: 5, // <= non-auth/Free tier cap matches your book function
};

// Default ranges (we’ll default to 1000–1500 “short” unless overridden by plan)
const DEFAULT_LENGTH_RANGES: Record<ChapterLength, { min: number; max: number }> = {
  short: { min: 1000, max: 1500 },
  medium: { min: 1500, max: 2500 },
  long: { min: 2500, max: 4000 },
  xlong: { min: 4000, max: 6000 },
};

/* -------------------- Helpers -------------------- */
const wordsToTokens = (words: number) => Math.ceil(words / 0.75);
const countWords = (s: string) => (s || "").split(/\s+/).filter(Boolean).length;

function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function trimAndClamp(s: string) {
  const t = (s ?? "").toString().trim().replace(/\s+/g, " ");
  const byChars = t.slice(0, MAX_PROMPT_CHARS);
  const words = byChars.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_PROMPT_WORDS) return byChars;
  return words.slice(0, MAX_PROMPT_WORDS).join(" ");
}

// Remove markdown headings and accidental "Chapter X:" lines from content.
function sanitizeContent(raw: string) {
  let c = (raw || "").toString();
  // strip leading chapter line (if model added it)
  c = c.replace(/^\s*chapter\s*\d{1,3}\s*:\s*.*\n+/i, "");
  // demote any markdown headings to plain text
  c = c.replace(/^#{1,6}\s+/gm, "");
  // collapse excess blank lines
  c = c.replace(/\n{3,}/g, "\n\n");
  return c.trim();
}

// Ensure title has no quotes or "Chapter X:" prefix
function sanitizeTitle(t: string) {
  return (t || "")
    .replace(/^\s*chapter\s*\d{1,3}\s*:\s*/i, "")
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, "")
    .trim();
}

async function verifyUserWithJwt(
  bearerJwt: string | null,
  claimedUserId: string | null,
): Promise<{ userId: string | null; valid: boolean }> {
  if (!claimedUserId) return { userId: null, valid: false }; // must be authed here
  if (claimedUserId === DEMO_USER_ID) return { userId: DEMO_USER_ID, valid: true };
  if (!bearerJwt) return { userId: null, valid: false };
  try {
    const { data, error } = await supabase.auth.getUser(bearerJwt);
    if (error) return { userId: null, valid: false };
    const realUserId = data.user?.id ?? null;
    return { userId: realUserId, valid: realUserId === claimedUserId };
  } catch {
    return { userId: null, valid: false };
  }
}

async function checkAIConsent(userId: string): Promise<boolean> {
  try {
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("ai_processing_consent")
      .eq("id", userId)
      .single();
    if (error) return false;
    return profile?.ai_processing_consent === true;
  } catch {
    return false;
  }
}

async function recordChapterUsage(
  sessionId: string,
  userId: string,
  words: number,
  tokens: number
) {
  try {
    await supabase.from("usage_events").insert({
      user_id: userId,
      session_id: sessionId,
      feature: "chapter_generate",
      words,
      tokens,
      billable: true,
      reason: "regular",
    });
  } catch (e) {
    console.error("usage log failed:", e);
  }
}

async function callOpenAIJSON(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  apiKey: string
) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OA_TIMEOUT_MS);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

/* -------------------- Handler -------------------- */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // headers
    const authHeader = req.headers.get("Authorization");
    const bearerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const rawSessionId = req.headers.get("x-session-id");
    const sessionId = rawSessionId ?? crypto.randomUUID();

    const claimedUserId = req.headers.get("x-user-id");

    // must be authenticated (demo allowed)
    const { valid: jwtOk, userId: verifiedUserId } = await verifyUserWithJwt(bearerJwt, claimedUserId);
    if (!jwtOk || !verifiedUserId) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ensure tracked session (server-side, bypasses RLS)
    const { error: sessErr } = await supabase
      .from("sessions")
      .upsert(
        {
          id: sessionId,
          user_id: verifiedUserId,
          // FIX: real users are not guests; demo user is guest
          is_guest: verifiedUserId === DEMO_USER_ID,
        },
        { onConflict: "id" }
      );
    if (sessErr) console.error("session upsert error:", sessErr);

    // consent (skip for demo user)
    if (verifiedUserId !== DEMO_USER_ID) {
      const hasConsent = await checkAIConsent(verifiedUserId);
      if (!hasConsent) {
        return json(
          { error: "AI processing consent required. Please update your consent in account settings." },
          403
        );
      }
    }

    // body
    let body: ChapterRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    let {
      bookTitle,
      existingChapters,
      chapterSummaries,
      prompt,
      originalDescription,
      genre,
      subgenre,
      currentChapter = 1,
      totalChapters = 10,
      chapterLength,
      minWords,
      maxWords,
    } = body;

    // validate + sanitize
    if (!Array.isArray(existingChapters)) {
      return json({ error: "Missing required fields: existingChapters" }, 400);
    }
    genre = (genre ?? "").toString().trim().toLowerCase();
    subgenre = (subgenre ?? "").toString().trim();
    if (!genre || !subgenre) {
      return json({ error: "Missing genre/subgenre" }, 400);
    }

    prompt = trimAndClamp(prompt ?? "");
    originalDescription = originalDescription ? trimAndClamp(originalDescription) : undefined;

    if (!prompt || prompt.length < 20) {
      return json({ error: "Prompt too short" }, 400);
    }

    // plan limits
    const { data: up, error: upErr } = await supabase
      .from("user_profiles")
      .select("plan_tier")
      .eq("id", verifiedUserId)
      .single();

    if (upErr || !up?.plan_tier) {
      console.error("profile load error:", upErr);
      return json({ error: "Profile not found" }, 400);
    }

    const plan = (String(up.plan_tier).toLowerCase() as PlanTier) || "free";
    const planMaxChapters = PLAN_MAX_CHAPTERS[plan] ?? PLAN_MAX_CHAPTERS.free;
    const safeTotalChapters = Math.max(1, Math.min(planMaxChapters, totalChapters || 1));

    if (currentChapter < 1) currentChapter = 1;
    if (currentChapter > safeTotalChapters) {
      return json(
        { error: `Your plan allows up to ${planMaxChapters} chapters; requested chapter ${currentChapter} exceeds ${safeTotalChapters}.` },
        403
      );
    }

    // enforce chapterLength by plan, derive range
    const allowedLengths = PLAN_ALLOWED_LENGTHS[plan] ?? ["short"];
    const requestedLength = (chapterLength ?? "short") as ChapterLength;
    const effectiveLength = allowedLengths.includes(requestedLength)
      ? requestedLength
      : allowedLengths[allowedLengths.length - 1];

    const baseRange = DEFAULT_LENGTH_RANGES[effectiveLength];
    const appliedMinWords = Math.max(1000, Number.isFinite(minWords as number) ? Number(minWords) : baseRange.min);
    const appliedMaxWords = Math.max(
      appliedMinWords + 200,
      Number.isFinite(maxWords as number) ? Number(maxWords) : baseRange.max
    );

    // dynamic output tokens (buffer for JSON & continuation)
    const desiredOutputTokens = Math.min(
      OUTPUT_TOKENS_CAP,
      wordsToTokens(appliedMaxWords) + 800
    );

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return json({ error: "OpenAI API key not configured" }, 500);
    }

    // context block
    let existingContext = "";
    if (chapterSummaries?.length) {
      existingContext = chapterSummaries
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map((s) => `Chapter ${s.chapterNumber} Summary: ${s.summary}`)
        .join("\n\n");
    } else if (existingChapters.length) {
      existingContext = existingChapters
        .map(
          (ch, idx) =>
            `Chapter ${idx + 1}: ${ch.title}\n${(ch.content || "").substring(0, 600)}...`
        )
        .join("\n\n");
    }

    // OUTPUT CONTRACT for clean paragraphs & no rogue headings
    const outputContract = `
OUTPUT CONTRACT (obey strictly):
- Return JSON only.
- "title" must NOT include "Chapter X:" or quotes.
- "content" must be plain paragraphs (no markdown headings like #, ##, ### and no "Chapter X:" line).
- Keep tone/POV consistent with prior chapters.
- Word count target: ${appliedMinWords}–${appliedMaxWords} words.
- No meta notes, no disclaimers, no system echoes.
`;

    // prompts
    const systemPrompt = `You are a professional writer continuing a ${genre} book in the ${subgenre} genre titled "${bookTitle || "(to be decided)"}".

${originalDescription ? `ORIGINAL BOOK CONCEPT: ${originalDescription}` : ""}

${originalDescription
  ? "Always keep this original concept and vision in mind while writing. The new chapter should stay true to the core themes, characters, and story direction established in the original description."
  : ""}

This book is planned to have ${safeTotalChapters} chapters total, and you are writing chapter ${currentChapter} of ${safeTotalChapters}. The user's plan allows for a maximum of ${planMaxChapters} chapters per book.

${!bookTitle ? `Since this is a new book, create an engaging title that fits the ${genre} ${subgenre} genre and the story concept.` : ""}
${outputContract}

Respond with JSON matching exactly:
{
  ${!bookTitle ? '"bookTitle": "Engaging book title (no quotes, no Chapter prefix)",' : ""}
  "title": "Chapter title (no 'Chapter X:' prefix, no quotes)",
  "content": "Full chapter content as plain paragraphs (no headings)"
}`;

    const userPrompt = `Context from previous chapters:

${existingContext || "(no previous chapters provided)"}

${chapterSummaries?.length
  ? "The above summaries provide the complete story context up to this point."
  : "The above excerpts show the beginning of each existing chapter."}

${!bookTitle
  ? `This is a new book. Create an engaging title and write the first chapter based on this concept: ${prompt}`
  : `Now write chapter ${currentChapter} of ${safeTotalChapters} based on this request: ${prompt}`}

The chapter must flow naturally from the existing story, maintain the same tone and style, and land between ${appliedMinWords} and ${appliedMaxWords} words.`;

    /* -------- First pass -------- */
    let chapterData = await callOpenAIJSON(
      systemPrompt,
      userPrompt,
      desiredOutputTokens,
      openaiApiKey
    );

    if (!chapterData?.title || !chapterData?.content) {
      return json({ error: "Invalid chapter data generated" }, 500);
    }

    // Sanitize title/content against headings & prefixes
    chapterData.title = sanitizeTitle(String(chapterData.title));
    chapterData.content = sanitizeContent(String(chapterData.content));

    /* -------- Expansion passes (append-only) if too short -------- */
    let passes = 0;
    let currentWords = countWords(chapterData.content);
    const targetMin = appliedMinWords;
    const targetMax = appliedMaxWords;

    while (currentWords < Math.floor(targetMin * 0.95) && passes < 3) {
      passes += 1;

      const expandSystem = `You are adding new content to extend an existing chapter.
Do NOT repeat any existing text. Maintain continuity of plot, POV, style, tone, and tense.
Add new scenes, deepen descriptions and dialogue. Aim for a total of ${targetMin}-${targetMax} words.
Return JSON ONLY in this shape:
{"contentAppend":"<only the new paragraphs to append, no recap, no headings>"}`;

      const expandUser = `Existing chapter so far:\n\n${chapterData.content}\n\nContinue the SAME chapter. Append new material only; do not restate or summarize existing text. Stay within ${targetMin}-${targetMax} words total.`;

      const remainingWords = Math.max(0, targetMin - currentWords);
      const expandTokens = Math.min(
        OUTPUT_TOKENS_CAP,
        Math.max(2000, wordsToTokens(remainingWords) + 400)
      );

      const expand = await callOpenAIJSON(
        expandSystem,
        expandUser,
        expandTokens,
        openaiApiKey
      );

      const addition = sanitizeContent((expand?.contentAppend || "").toString().trim());
      if (!addition) break;

      chapterData.content += (chapterData.content.endsWith("\n") ? "" : "\n\n") + addition;
      currentWords = countWords(chapterData.content);
    }

    /* -------- Tighten pass if way over max -------- */
    if (currentWords > Math.ceil(targetMax * 1.15)) {
      const tightenSystem = `You are tightening a chapter to fit a target word range without losing key plot beats, voice, or continuity. No headings. JSON output only.`;
      const tightenUser = `Current chapter (${currentWords} words) exceeds ${targetMax}.
Rewrite concisely to land inside ${targetMin}-${targetMax} words. Preserve crucial events and tone.

Return JSON exactly as:
{"contentTight":"<rewritten chapter in plain paragraphs, no headings>"}`;

      const tighten = await callOpenAIJSON(
        tightenSystem,
        tightenUser + "\n\n" + chapterData.content,
        Math.min(OUTPUT_TOKENS_CAP, wordsToTokens(targetMax) + 800),
        openaiApiKey
      );

      const tightened = sanitizeContent((tighten?.contentTight || "").toString());
      if (tightened) {
        chapterData.content = tightened;
        currentWords = countWords(chapterData.content);
      }
    }

    /* -------- Usage logging -------- */
    const finalWordCount = countWords(chapterData.content);
    const estimatedTokens = Math.ceil(finalWordCount * 1.3); // rough input+output coverage
    recordChapterUsage(sessionId, verifiedUserId, finalWordCount, estimatedTokens)
      .catch((e) => console.error("usage log failed:", e));

    /* -------- Response -------- */
    const payload = {
      ...chapterData,
      effectiveTotalChapters: safeTotalChapters,
      planMaxChapters,
      appliedChapterLength: effectiveLength,
      appliedWordRange: { minWords: appliedMinWords, maxWords: appliedMaxWords },
      finalWordCount,
      expansionPasses: passes,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-session-id": sessionId,
        "x-plan-max-chapters": String(planMaxChapters),
        "x-effective-total-chapters": String(safeTotalChapters),
        "x-applied-chapter-length": effectiveLength,
        "x-max-output-tokens": String(OUTPUT_TOKENS_CAP),
      },
    });
  } catch (error) {
    console.error("Error:", error);
    const isAbort = (error as any)?.name === "AbortError";
    return json({ error: isAbort ? "OpenAI request timed out" : "Internal server error" }, 500);
  }
});
