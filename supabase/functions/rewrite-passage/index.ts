// functions/rewrite/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
  "Access-Control-Expose-Headers": "x-session-id",
};

interface RewriteRequest {
  selectedText: string;
  context: string;
  rewriteInstruction?: string;
  genre: string;
  subgenre: string;
}

type Json = Record<string, unknown>;

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const OA_TIMEOUT_MS = 60_000;

// Input caps (defensive)
const MAX_SELECTED_CHARS = 8000;        // ~4-5k tokens raw
const MAX_SELECTED_WORDS = 1500;
const MAX_CONTEXT_CHARS = 60_000;       // big but bounded
const MAX_CONTEXT_WORDS = 10_000;
const MAX_INSTR_CHARS = 600;
const MAX_GENRE_CHARS = 60;
const MAX_SUBGENRE_CHARS = 80;

// --- Supabase (service role) ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/* -------------------- helpers -------------------- */
function json(body: Json, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function sanitizeTrim(s: string, maxChars: number) {
  const t = (s ?? "").toString().trim().replace(/\s+/g, " ");
  return t.slice(0, maxChars);
}

function clampText(s: string, maxChars: number, maxWords: number) {
  const byChars = (s ?? "").toString().slice(0, maxChars);
  const words = byChars.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return byChars;
  return words.slice(0, maxWords).join(" ");
}

function stripWrappingQuotesOrFences(s: string) {
  let t = s.trim();
  // Remove leading/trailing backticks fences
  t = t.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "");
  // Remove single pair of leading/trailing quotes if they wrap whole text
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”")) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

async function verifyUserWithJwt(
  bearerJwt: string | null,
  claimedUserId: string | null,
): Promise<{ userId: string | null; valid: boolean }> {
  if (!claimedUserId) return { userId: null, valid: false }; // authenticated endpoint
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
    const { data, error } = await supabase
      .from("user_profiles")
      .select("ai_processing_consent")
      .eq("id", userId)
      .single();
    if (error) return false;
    return data?.ai_processing_consent === true;
  } catch {
    return false;
  }
}

async function recordRewriteUsage(
  sessionId: string,
  userId: string,
  words: number,
  tokens: number
) {
  try {
    await supabase.from("usage_events").insert({
      user_id: userId,
      session_id: sessionId,
      feature: "rewrite_passage",
      words,
      tokens,
      billable: true,
      reason: "regular",
    });
  } catch (e) {
    console.error("usage log failed:", e);
  }
}

async function callOpenAI({
  systemPrompt,
  userPrompt,
  model,
  maxTokens,
  apiKey,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
  apiKey: string;
}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OA_TIMEOUT_MS);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return text;
}

/* -------------------- handler -------------------- */
serve(async (req: Request) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Auth/session headers
    const authHeader = req.headers.get("Authorization");
    const bearerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const rawSessionId = req.headers.get("x-session-id");
    const sessionId = rawSessionId ?? crypto.randomUUID();

    const claimedUserId = req.headers.get("x-user-id");

    // Auth required (demo allowed)
    const { valid: jwtOk, userId: verifiedUserId } = await verifyUserWithJwt(bearerJwt, claimedUserId);
    if (!jwtOk || !verifiedUserId) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Upsert session (server-side)
    const { error: sessErr } = await supabase
      .from("sessions")
      .upsert({ id: sessionId, user_id: verifiedUserId, is_guest: false }, { onConflict: "id" });
    if (sessErr) console.error("session upsert error:", sessErr);

    // Consent (skip for demo)
    if (verifiedUserId !== DEMO_USER_ID) {
      const hasConsent = await checkAIConsent(verifiedUserId);
      if (!hasConsent) {
        return json(
          { error: "AI processing consent required. Please update your consent in account settings." },
          403
        );
      }
    }

    // Body
    let body: RewriteRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    let { selectedText, context, rewriteInstruction, genre, subgenre } = body;

    // Sanitize and clamp
    selectedText = clampText(sanitizeTrim(selectedText ?? "", MAX_SELECTED_CHARS), MAX_SELECTED_CHARS, MAX_SELECTED_WORDS);
    context = clampText(context ?? "", MAX_CONTEXT_CHARS, MAX_CONTEXT_WORDS);
    rewriteInstruction = sanitizeTrim(rewriteInstruction ?? "", MAX_INSTR_CHARS);
    genre = sanitizeTrim(genre ?? "", MAX_GENRE_CHARS).toLowerCase();
    subgenre = sanitizeTrim(subgenre ?? "", MAX_SUBGENRE_CHARS);

    if (!selectedText || !context || !genre || !subgenre) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (selectedText.split(/\s+/).filter(Boolean).length < 3) {
      return json({ error: "Selected text too short to rewrite" }, 400);
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return json({ error: "OpenAI API key not configured" }, 500);
    }

    // Prompts
    const systemPrompt = `You are a professional editor and writer specializing in ${genre} (${subgenre}). 
Rewrite the user’s selected passage to improve clarity, flow, and engagement while preserving meaning, plot continuity, character voice, style, tone, tense, and POV.
Strict rules:
- Keep names, lore, and facts consistent with the context.
- Do NOT add new plot points that contradict the context.
- Do NOT summarize; produce a full rewritten passage.
- Return ONLY the rewritten text. No quotes, code fences, or commentary.`;

    const userPrompt = `CONTEXT (surrounding text):
${context}

SELECTED PASSAGE (to rewrite):
${selectedText}

${rewriteInstruction ? `SPECIFIC INSTRUCTION: ${rewriteInstruction}\n` : ""}Return ONLY the rewritten passage, without quotes or code fences.`;

    // Model call (you can swap to gpt-4o-mini if you want to save tokens)
    const rewritten = await callOpenAI({
      systemPrompt,
      userPrompt,
      model: "gpt-4o-mini",
      maxTokens: 4500,
      apiKey: openaiApiKey,
    });

    const rewrittenText = stripWrappingQuotesOrFences(rewritten || "");

    if (!rewrittenText) {
      return json({ error: "No rewritten text generated" }, 500);
    }

    // Usage (best-effort)
    const words = rewrittenText.split(/\s+/).filter(Boolean).length;
    const estTokens = Math.ceil(words * 1.3);
    recordRewriteUsage(sessionId, verifiedUserId, words, estTokens).catch((e) =>
      console.error("usage log failed:", e)
    );

    return new Response(JSON.stringify({ rewrittenText }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-session-id": sessionId },
    });
  } catch (error) {
    console.error("rewrite error:", error);
    const isAbort = (error as any)?.name === "AbortError";
    return json({ error: isAbort ? "OpenAI request timed out" : "Internal server error" }, 500);
  }
});
