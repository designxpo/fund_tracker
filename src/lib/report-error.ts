import { createClient } from "@/lib/supabase/client";

export type ErrorKind = "sync" | "crash" | "unhandled" | "action";

const recent = new Map<string, number>();

/** Record an app error in `client_errors` (fire-and-forget; never throws, skips repeats within 30s). */
export function reportError(kind: ErrorKind, error: unknown, detail?: string) {
  try {
    const message = (error instanceof Error ? error.message : String(error ?? "Unknown error")).slice(0, 500);
    const key = `${kind}:${message}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - 30_000) return;
    recent.set(key, now);
    console.error(`[${kind}]`, error, detail ?? "");
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    void createClient()
      .from("client_errors")
      .insert({
        kind,
        message,
        detail: (detail ?? (error instanceof Error ? error.stack : undefined))?.slice(0, 2000) ?? null,
        url: typeof location !== "undefined" ? location.pathname : null,
      })
      .then(() => {});
  } catch {
    // reporting must never break the app
  }
}
