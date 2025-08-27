import { supabase } from "../lib/supabase";

export type Entitlements = {
  tier: "free" | "pro" | "premium";
  status?: string;
  price_id?: string;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

export async function fetchEntitlements(signal?: AbortSignal): Promise<Entitlements> {
  try {
    const { data: auth } = await supabase.auth.getSession();
    const token = auth?.session?.access_token ?? null;

    // Use anon key if no session — server will still return "free"
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    const authz = token || anon || "";

    const urlBase =
      (import.meta.env.VITE_EDGE_BASE?.replace(/\/+$/, "") || import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "")) ??
      "";
    if (!urlBase) throw new Error("Missing VITE_SUPABASE_URL");

    const res = await fetch(`${urlBase}/functions/v1/get-entitlements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authz}`,
        ...(anon ? { apikey: anon } : {}),
      },
      body: "{}",
      signal,
    });

    if (!res.ok) {
      // Fallback to free on any error
      return { tier: "free" };
    }
    return (await res.json()) as Entitlements;
  } catch {
    return { tier: "free" };
  }
}
