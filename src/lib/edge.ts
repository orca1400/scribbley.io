// src/lib/edge.ts
import { supabase } from "./supabase";

export function functionsBase(): string {
  const override = import.meta.env.VITE_EDGE_BASE as string | undefined;
  if (override) return override.replace(/\/+$/, "") + "/functions/v1";
  if (import.meta.env.DEV) return "/functions/v1";               // Vite proxy or Supabase dev server
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error("VITE_SUPABASE_URL is undefined");
  return base.replace(/\/+$/, "") + "/functions/v1";
}

export async function edgeHeaders(extra?: Record<string, string>) {
  const { data: auth } = await supabase.auth.getSession();
  const bearer = auth?.session?.access_token ?? null;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  const token = (bearer && bearer.trim()) || (anonKey && anonKey.trim());
  if (!token) throw new Error("Missing auth token: set VITE_SUPABASE_ANON_KEY or sign in");

  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (anonKey) h["apikey"] = anonKey;
  return { ...h, ...(extra ?? {}) };
}

export async function callEdge<T>(
  fn: string,
  body: any,
  extra?: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<T> {
  const url = `${functionsBase()}/${fn}`;
  const headers = await edgeHeaders(extra);

  const ac = new AbortController();
  let tid: any = null;
  if (timeoutMs && timeoutMs > 0) tid = setTimeout(() => ac.abort(), timeoutMs);
  signal?.addEventListener("abort", () => ac.abort(), { once: true });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    signal: ac.signal,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  }).catch((e) => {
    // surface the exact URL
    console.error("[callEdge] fetch failed", url, e);
    throw e;
  }).finally(() => tid && clearTimeout(tid));

  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave text */ }

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
    const mixed =
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      (import.meta.env.VITE_SUPABASE_URL || "").startsWith("http://")
        ? " (Mixed content: app is https but SUPABASE_URL is http)"
        : "";
    throw new Error(`${msg}${mixed}`);
  }

  return (json ?? {}) as T;
}
