// src/lib/firstBook.ts
import { supabase } from "@/lib/supabase";
import { getOrCreateSession } from "@/lib/session";

const FN_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

function makeWorkingTitle(description: string) {
  // quick, non-LLM title for simultaneous cover
  const words = (description || "").trim().split(/\s+/).slice(0, 7);
  return words.length ? words.join(" ") : "Untitled";
}

type StartFirstBookArgs = {
  genre: "fiction" | "non-fiction";
  subgenre: string;
  description: string;
  beatsActive?: boolean;
  beats?: string[];
  mode?: "book" | "chapter";           // default 'book'
  chapter_count?: number;               // if you use chapter mode
};

export async function startFirstBookFlow(args: StartFirstBookArgs) {
  const {
    genre,
    subgenre,
    description,
    beatsActive = false,
    beats = [],
    mode = "book",
    chapter_count = 5,
  } = args;

  // 1) Session + auth
  const session = await getOrCreateSession();
  const { data: auth } = await supabase.auth.getSession();
  const accessToken = auth.session?.access_token ?? null;

  const { data: { user } } = await supabase.auth.getUser();
  const isAuthenticated = !!user;
  const userId = user?.id ?? null;

  // 2) (Authed only) create a placeholder book row so we have an id for storage
  let bookId: string | undefined;
  let workingTitle = makeWorkingTitle(description);

  if (isAuthenticated) {
    const { data: created, error } = await supabase
      .from("books")
      .insert({
        title: workingTitle,
        description,
        genre,
        subgenre,
        status: "generating",
      })
      .select("id")
      .single();

    if (error) throw error;
    bookId = created!.id;
  }

  // 3) Common headers
  const hdrs: Record<string, string> = {
    "content-type": "application/json",
    "x-session-id": session.id,
  };
  if (userId) hdrs["x-user-id"] = userId;                 // optional
  if (accessToken) hdrs["authorization"] = `Bearer ${accessToken}`;

  // 4) Kick off cover right away (simultaneous)
  const coverBody = {
    bookId,                            // undefined → guest: returns base64
    userId: userId ?? undefined,       // informational
    bookTitle: workingTitle,           // quick hint title so we don't wait
    description,
    genre,
    subgenre,
    isAuthenticated,
  };

  const coverPromise = fetch(`${FN_BASE}/generate-cover`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(coverBody),
  }).then(r => r.json());

  // 5) Kick off the book generation
  const bookBody =
    mode === "chapter"
      ? {
          mode: "chapter",
          genre,
          subgenre,
          description,
          beatsActive,
          beats,
          chapter_index: 1,
          chapter_count,
          chapter_words_min: 900,
          chapter_words_max: 1300,
        }
      : {
          mode: "book",
          genre,
          subgenre,
          description,
          beatsActive,
          beats,
        };

  const bookPromise = fetch(`${FN_BASE}/generate-book`, {
    method: "POST",
    headers: {
      ...hdrs,
      // you’re already enforcing consent on the server for real users;
      // sending the hint helps you record it on the session for guests too
      "x-ai-consent": "true",
      "x-ai-consent-version": "1",
    },
    body: JSON.stringify(bookBody),
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Book generation failed");
    return j;
  });

  // 6) Wait for both (independently handle errors)
  const [coverRes, bookRes] = await Promise.allSettled([
    coverPromise,
    bookPromise,
  ]);

  // 7) Handle cover result (guest → base64; authed → url)
  let coverUrl: string | null = null;
  if (coverRes.status === "fulfilled") {
    const cr = coverRes.value;
    if (cr?.url) coverUrl = cr.url; // stored in bucket (authed + bookId)
    else if (cr?.imageBase64) coverUrl = `data:image/png;base64,${cr.imageBase64}`;
  }

  // 8) Handle book result (this one we typically require)
  if (bookRes.status !== "fulfilled") {
    // Fail hard on book errors; still return any cover we got for the UI
    throw Object.assign(new Error("Book generation failed"), {
      coverUrl,
      raw: bookRes.reason,
    });
  }

  const bookPayload = bookRes.value;
  const bookText: string =
    bookPayload.book || bookPayload.content || "";

  // Parse first line as title (your format contract already does this)
  const firstLine = (bookText.split("\n")[0] || "").trim();
  const parsedTitle = firstLine.replace(/^["\s]+|["\s]+$/g, "") || workingTitle;

  // 9) Persist updates for authed users
  if (isAuthenticated && bookId) {
    await supabase.from("books").update({
      title: parsedTitle,
      cover_url: coverUrl,       // ok if null; you might update when reroll finishes
      status: "ready",
      content: bookText,         // if you store whole book
    }).eq("id", bookId);
  }

  return {
    bookId,
    title: parsedTitle,
    bookText,
    coverUrl, // data: URL (guest) or public URL (authed)
  };
}
