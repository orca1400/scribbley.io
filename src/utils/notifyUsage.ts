// src/utils/notifyUsage.ts
export async function notifyUsage({
  email,
  usagePct,
  wordsUsed,
  limit,
  userName,
  plan,
}: {
  email: string;
  usagePct: number; // 80 or 100
  wordsUsed: number;
  limit: number;
  userName?: string;
  plan?: string;
}) {
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/usage-alert`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, usagePct, wordsUsed, limit, userName, plan }),
    });
    if (!res.ok) {
      console.error("Failed to send usage alert:", await res.text());
    }
  } catch (err) {
    console.error("Error calling usage alert function:", err);
  }
}
